import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import { createTenant, issueToken, revokeToken, type Tenant } from './auth.ts';
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
