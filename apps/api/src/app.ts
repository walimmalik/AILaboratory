import type { FileAttributes, OperationErrorBody, RecordEnvelope } from '@ailab/schema';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { Assistant } from './assistant/assistant.ts';
import { findConversation, toSummary } from './assistant/store.ts';
import { resolveContext, resolveSession, SESSION_DAYS, signIn, signOut } from './auth.ts';
import type { Db } from './db/client.ts';
import { labs, users } from './db/schema.ts';
import { readBytes } from './files/operations.ts';
import { type FileStore, MemoryFileStore } from './files/store.ts';
import { describeOperation, openApiDocument } from './operations/describe.ts';
import { httpStatus, toErrorBody } from './operations/errors.ts';
import { ActivityBus, createRegistry } from './operations/index.ts';
import { handleMcpRequest } from './operations/mcp.ts';
import { KindRegistry } from './records/kinds.ts';
import type { RecordContext } from './records/service.ts';

export interface AppDependencies {
  db: Db;
  kinds?: KindRegistry;
  bus?: ActivityBus;
  /** The in-app assistant and its model; without one, asking it is refused with a message. */
  assistant?: Assistant;
  /** Where file bytes live; in memory unless given (tests). */
  files?: FileStore;
}

type Env = { Variables: { ctx: RecordContext } };

const unauthorized: OperationErrorBody = {
  code: 'unauthorized',
  message: 'Sign in, or send a valid API token (Authorization: Bearer <token>)',
};

export const SESSION_COOKIE = 'ailab_session';
const LoginBody = z.object({ email: z.string().min(1), password: z.string().min(1) });

export function createApp({
  db,
  kinds = new KindRegistry(),
  bus = new ActivityBus(),
  assistant = new Assistant({ reason: 'No model is set up' }),
  files = new MemoryFileStore(),
}: AppDependencies) {
  const registry = createRegistry(db, kinds, bus, assistant, files);
  const app = new Hono<Env>();

  app.get('/health', (c) => c.json({ status: 'ok', service: 'api' }));

  app.post('/auth/login', async (c) => {
    const body = LoginBody.safeParse(await c.req.json().catch(() => undefined));
    if (!body.success) {
      return c.json({ code: 'invalid_input', message: 'Send {"email", "password"}' }, 400);
    }
    const token = await signIn(db, body.data.email, body.data.password);
    if (!token) return c.json({ code: 'unauthorized', message: 'Wrong email or password' }, 401);
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'Strict',
      secure: new URL(c.req.url).protocol === 'https:',
      path: '/',
      maxAge: SESSION_DAYS * 24 * 60 * 60,
    });
    return c.json({ signedIn: true });
  });

  app.post('/auth/logout', async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await signOut(db, token);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ signedIn: false });
  });

  /** Everything below requires a bearer token or a session cookie. */
  app.use('*', async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const bearer = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    const session = bearer ? undefined : getCookie(c, SESSION_COOKIE);
    const ctx = bearer
      ? await resolveContext(db, bearer)
      : session
        ? await resolveSession(db, session)
        : undefined;
    if (!ctx) return c.json(unauthorized, 401);
    // Cookie-authenticated writes must be JSON, which a cross-site form cannot send.
    const safe = c.req.method === 'GET' || c.req.method === 'HEAD';
    if (session && !safe && !c.req.header('content-type')?.startsWith('application/json')) {
      return c.json({ code: 'forbidden', message: 'Requests must be JSON' }, 403);
    }
    c.set('ctx', ctx);
    await next();
  });

  /** Who the caller acts as, with display names for the UI. */
  app.get('/me', async (c) => {
    const ctx = c.get('ctx');
    const userId = ctx.actor.type === 'user' ? ctx.actor.userId : ctx.actor.onBehalfOf;
    const [user] = await db
      .select({ id: users.id, displayName: users.displayName, email: users.email })
      .from(users)
      .where(eq(users.id, userId));
    const [lab] = await db
      .select({ id: labs.id, name: labs.name })
      .from(labs)
      .where(eq(labs.id, ctx.labId));
    return c.json({ ...ctx, user, lab });
  });

  app.get('/v1/operations', (c) => c.json({ operations: registry.list().map(describeOperation) }));

  app.get('/v1/openapi.json', (c) => c.json(openApiDocument(registry.list())));

  /**
   * A stored file's bytes, for people to open or download (plan 011a). Types a browser would run
   * (HTML, SVG) are served sandboxed so a file can never act as the app.
   */
  app.get('/v1/files/:id', async (c) => {
    try {
      const result = await registry.execute(c.get('ctx'), 'files.get', {
        id: c.req.param('id'),
        as: 'none',
      });
      const { file } = (result as { output: { file: RecordEnvelope } }).output;
      const attributes = file.attributes as FileAttributes;
      const bytes = await readBytes(file, registry.deps.files);
      const viewable =
        attributes.mediaType === 'application/pdf' ||
        /^image\/(png|jpeg|gif|webp)$/.test(attributes.mediaType);
      const disposition = c.req.query('download') === '1' ? 'attachment' : 'inline';
      return new Response(bytes.slice().buffer as ArrayBuffer, {
        headers: {
          'Content-Type': attributes.mediaType.startsWith('text/')
            ? `${attributes.mediaType}; charset=utf-8`
            : attributes.mediaType,
          'Content-Length': String(bytes.byteLength),
          'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(attributes.originalName)}`,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'private, max-age=31536000, immutable',
          ...(viewable ? {} : { 'Content-Security-Policy': "sandbox; default-src 'none'" }),
        },
      });
    } catch (error) {
      const body = toErrorBody(error);
      if (body.code === 'internal') console.error(error);
      return c.json(body, httpStatus(body.code));
    }
  });

  app.post('/v1/ops/:operationId', async (c) => {
    let input: unknown = {};
    const text = await c.req.text();
    if (text.trim()) {
      try {
        input = JSON.parse(text);
      } catch {
        return c.json(
          { code: 'invalid_input', message: 'The request body is not valid JSON' },
          400,
        );
      }
    }
    const preview = c.req.query('preview') === 'true';
    try {
      return c.json(
        await registry.execute(c.get('ctx'), c.req.param('operationId'), input, { preview }),
      );
    } catch (error) {
      const body = toErrorBody(error);
      if (body.code === 'internal') console.error(error);
      return c.json(body, httpStatus(body.code));
    }
  });

  /** The live ledger: every new activity entry in the caller's lab, as server-sent events. */
  app.get('/v1/activity/stream', (c) => {
    const { labId } = c.get('ctx');
    // Tell proxies (nginx, the Vite dev proxy) not to buffer or transform the stream.
    c.header('Cache-Control', 'no-cache, no-transform');
    c.header('X-Accel-Buffering', 'no');
    return streamSSE(c, async (stream) => {
      const unsubscribe = bus.subscribe(labId, (entry) => {
        void stream.writeSSE({ event: 'activity', id: entry.id, data: JSON.stringify(entry) });
      });
      const closed = new Promise<void>((resolve) => stream.onAbort(resolve));
      await stream.writeSSE({ event: 'ready', data: '{}' });
      while (!stream.aborted) {
        await Promise.race([stream.sleep(25_000), closed]);
        if (!stream.aborted) await stream.writeSSE({ event: 'ping', data: '{}' });
      }
      unsubscribe();
    });
  });

  /** One conversation with the assistant, live: each new message and status change as it happens. */
  app.get('/v1/assistant/conversations/:id/stream', async (c) => {
    const ctx = c.get('ctx');
    let conversation: Awaited<ReturnType<typeof findConversation>>;
    try {
      conversation = await findConversation(db, ctx, c.req.param('id'));
    } catch (error) {
      const body = toErrorBody(error);
      return c.json(body, httpStatus(body.code));
    }
    c.header('Cache-Control', 'no-cache, no-transform');
    c.header('X-Accel-Buffering', 'no');
    return streamSSE(c, async (stream) => {
      const unsubscribe = assistant.bus.subscribe(conversation.id, (event) => {
        void stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
      });
      const closed = new Promise<void>((resolve) => stream.onAbort(resolve));
      // The state now, so a client that connects mid-run knows where things stand.
      await stream.writeSSE({
        event: 'ready',
        data: JSON.stringify({ type: 'status', conversation: toSummary(conversation) }),
      });
      while (!stream.aborted) {
        await Promise.race([stream.sleep(25_000), closed]);
        if (!stream.aborted) await stream.writeSSE({ event: 'ping', data: '{}' });
      }
      unsubscribe();
    });
  });

  /** MCP (Streamable HTTP, stateless) over the same operations. */
  app.all('/mcp', (c) => handleMcpRequest(registry, c.get('ctx'), c.req.raw));

  return app;
}
