import type { OperationErrorBody } from '@ailab/schema';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { resolveContext } from './auth.ts';
import type { Db } from './db/client.ts';
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
}

type Env = { Variables: { ctx: RecordContext } };

const unauthorized: OperationErrorBody = {
  code: 'unauthorized',
  message: 'A valid API token is required (Authorization: Bearer <token>)',
};

export function createApp({
  db,
  kinds = new KindRegistry(),
  bus = new ActivityBus(),
}: AppDependencies) {
  const registry = createRegistry(db, kinds, bus);
  const app = new Hono<Env>();

  app.get('/health', (c) => c.json({ status: 'ok', service: 'api' }));

  /** Everything below requires a bearer token. */
  app.use('*', async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    const ctx = token ? await resolveContext(db, token) : undefined;
    if (!ctx) return c.json(unauthorized, 401);
    c.set('ctx', ctx);
    await next();
  });

  /** Who the token acts as. */
  app.get('/me', (c) => c.json(c.get('ctx')));

  app.get('/v1/operations', (c) => c.json({ operations: registry.list().map(describeOperation) }));

  app.get('/v1/openapi.json', (c) => c.json(openApiDocument(registry.list())));

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

  /** MCP (Streamable HTTP, stateless) over the same operations. */
  app.all('/mcp', (c) => handleMcpRequest(registry, c.get('ctx'), c.req.raw));

  return app;
}
