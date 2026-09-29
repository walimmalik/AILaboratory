import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import { createTenant, issueToken, revokeToken, setPassword, type Tenant } from './auth.ts';
import type { Db } from './db/client.ts';
import { createTestDb } from './db/testing.ts';

let db: Db;
let close: () => Promise<void>;
let tenant: Tenant;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  tenant = await createTenant(db, { orgName: 'Org', labName: 'Lab', userName: 'Wali' });
});
afterEach(() => close());

describe('api', () => {
  it('reports health without a token', async () => {
    const response = await createApp({ db }).request('/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', service: 'api' });
  });

  it('refuses requests without a valid token', async () => {
    const app = createApp({ db });
    expect((await app.request('/me')).status).toBe(401);
    const bad = await app.request('/me', { headers: { authorization: 'Bearer nope' } });
    expect(bad.status).toBe(401);
  });

  it('resolves a person', async () => {
    const token = await issueToken(db, { userId: tenant.userId });
    const response = await createApp({ db }).request('/me', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(await response.json()).toEqual({
      actor: { type: 'user', userId: tenant.userId },
      orgId: tenant.orgId,
      labId: tenant.labId,
      user: { id: tenant.userId, displayName: 'Wali', email: null },
      lab: { id: tenant.labId, name: 'Lab' },
    });
  });

  it('resolves an agent acting on behalf of a person', async () => {
    const token = await issueToken(db, { userId: tenant.userId, agentName: 'Claude' });
    const response = await createApp({ db }).request('/me', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect((await response.json()).actor).toEqual({
      type: 'agent',
      agentName: 'Claude',
      onBehalfOf: tenant.userId,
    });
  });

  it('refuses revoked tokens', async () => {
    const token = await issueToken(db, { userId: tenant.userId });
    await revokeToken(db, token);
    const response = await createApp({ db }).request('/me', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(401);
  });

  it('returns 401 before 404 for unknown routes', async () => {
    const response = await createApp({ db }).request('/nope');
    expect(response.status).toBe(401);
  });
});

describe('web sign-in', () => {
  const login = (app: ReturnType<typeof createApp>, email: string, password: string) =>
    app.request('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

  const cookieFrom = (response: Response) =>
    (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

  beforeEach(async () => {
    await setPassword(db, {
      userId: tenant.userId,
      email: 'Wali@Example.org',
      password: 'correct horse battery',
    });
  });

  it('refuses a wrong password or unknown email the same way', async () => {
    const app = createApp({ db });
    const wrong = await login(app, 'wali@example.org', 'nope nope nope');
    const unknown = await login(app, 'someone@example.org', 'correct horse battery');
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
  });

  it('signs in with an HttpOnly cookie that acts as the person', async () => {
    const app = createApp({ db });
    const response = await login(app, ' wali@example.org ', 'correct horse battery');
    expect(response.status).toBe(200);
    const header = response.headers.get('set-cookie') ?? '';
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Strict');
    const me = await app.request('/me', { headers: { cookie: cookieFrom(response) } });
    expect((await me.json()).actor).toEqual({ type: 'user', userId: tenant.userId });
  });

  it('runs operations with the cookie only when the body is JSON', async () => {
    const app = createApp({ db });
    const cookie = cookieFrom(await login(app, 'wali@example.org', 'correct horse battery'));
    const json = await app.request('/v1/ops/proposals.list', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(json.status).toBe(200);
    const form = await app.request('/v1/ops/proposals.list', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'a=1',
    });
    expect(form.status).toBe(403);
  });

  it('ends the session on sign-out', async () => {
    const app = createApp({ db });
    const cookie = cookieFrom(await login(app, 'wali@example.org', 'correct horse battery'));
    await app.request('/auth/logout', { method: 'POST', headers: { cookie } });
    expect((await app.request('/me', { headers: { cookie } })).status).toBe(401);
  });

  it('refuses short passwords', async () => {
    await expect(
      setPassword(db, { userId: tenant.userId, email: 'w@example.org', password: 'short' }),
    ).rejects.toThrow(/at least/);
  });
});
