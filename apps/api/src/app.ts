import { Hono } from 'hono';
import { resolveContext } from './auth.ts';
import type { Db } from './db/client.ts';
import type { RecordContext } from './records/service.ts';

export interface AppDependencies {
  db: Db;
}

type Env = { Variables: { ctx: RecordContext } };

export function createApp({ db }: AppDependencies) {
  const app = new Hono<Env>();

  app.get('/health', (c) => c.json({ status: 'ok', service: 'api' }));

  /** Everything below requires a bearer token. */
  app.use('*', async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    const ctx = token ? await resolveContext(db, token) : undefined;
    if (!ctx)
      return c.json({ error: 'unauthorized', message: 'A valid API token is required' }, 401);
    c.set('ctx', ctx);
    await next();
  });

  /** Who the token acts as. */
  app.get('/me', (c) => c.json(c.get('ctx')));

  return app;
}
