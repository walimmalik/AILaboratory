import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import { createTenant, issueToken } from './auth.ts';
import type { Db } from './db/client.ts';
import { createTestDb } from './db/testing.ts';
import { ActivityBus } from './operations/index.ts';
import { KindRegistry } from './records/kinds.ts';
import { widget } from './records/test-kinds.ts';

let db: Db;
let close: () => Promise<void>;
let app: ReturnType<typeof createApp>;
let personToken: string;
let agentToken: string;

const attributes = { color: 'teal', volume: { value: '50', unit: 'uL' } };

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const tenant = await createTenant(db, { orgName: 'Org', labName: 'Lab', userName: 'Wali' });
  personToken = await issueToken(db, { userId: tenant.userId });
  agentToken = await issueToken(db, { userId: tenant.userId, agentName: 'Claude' });
  app = createApp({ db, kinds: new KindRegistry().register(widget), bus: new ActivityBus() });
});
afterEach(() => close());

const post = (path: string, body: unknown, token = personToken) =>
  app.request(path, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('REST', () => {
  it('lists operations with JSON Schemas', async () => {
    const response = await app.request('/v1/operations', {
      headers: { authorization: `Bearer ${personToken}` },
    });
    const { operations } = await response.json();
    const create = operations.find((o: { id: string }) => o.id === 'records.create');
    expect(create.effect).toBe('write');
    expect(create.input.required).toEqual(expect.arrayContaining(['kind', 'label', 'attributes']));
  });

  it('serves OpenAPI generated from the contracts', async () => {
    const response = await app.request('/v1/openapi.json', {
      headers: { authorization: `Bearer ${personToken}` },
    });
    const document = await response.json();
    expect(document.openapi).toBe('3.1.0');
    expect(document.paths['/v1/ops/records.update'].post.operationId).toBe('records.update');
  });

  it('runs, previews and refuses operations', async () => {
    const preview = await post('/v1/ops/records.create?preview=true', {
      kind: 'widget',
      label: 'A',
      attributes,
    });
    expect(await preview.json()).toMatchObject({ status: 'preview', output: { name: 'WDG-0001' } });

    const done = await post('/v1/ops/records.create', { kind: 'widget', label: 'A', attributes });
    expect(done.status).toBe(200);
    expect(await done.json()).toMatchObject({
      status: 'done',
      output: { name: 'WDG-0001', version: 1 },
    });

    const invalid = await post('/v1/ops/records.create', { kind: 'widget' });
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).code).toBe('invalid_input');

    const unknown = await post('/v1/ops/records.nope', {});
    expect(unknown.status).toBe(404);

    const unknownKind = await post('/v1/ops/records.create', {
      kind: 'plasmid',
      label: 'A',
      attributes,
    });
    expect(await unknownKind.json()).toMatchObject({ code: 'unknown_kind' });
  });

  it('refuses agents approving proposals', async () => {
    const response = await post(
      '/v1/ops/proposals.approve',
      { id: `prp_${'0'.repeat(26)}` },
      agentToken,
    );
    expect(response.status).toBe(403);
  });

  it('streams new ledger entries live', async () => {
    const response = await app.request('/v1/activity/stream', {
      headers: { authorization: `Bearer ${personToken}` },
    });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let text = '';
    const readUntil = async (marker: string) => {
      while (!text.includes(marker)) text += decoder.decode((await reader.read()).value);
    };
    await readUntil('event: ready');
    await post('/v1/ops/records.create', { kind: 'widget', label: 'Live', attributes });
    await readUntil('event: activity');
    expect(text).toContain('"operationId":"records.create"');
    await reader.cancel();
  });
});

describe('MCP', () => {
  const rpc = (method: string, params: unknown, token = agentToken) =>
    app.request('/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });

  it('offers two tools', async () => {
    const response = await rpc('tools/list', {});
    const { result } = await response.json();
    expect(result.tools.map((t: { name: string }) => t.name)).toEqual([
      'describe_operations',
      'run_operation',
    ]);
  });

  it('describes operations by namespace', async () => {
    const response = await rpc('tools/call', {
      name: 'describe_operations',
      arguments: { namespace: 'proposals' },
    });
    const { result } = await response.json();
    expect(result.structuredContent.operations.map((o: { id: string }) => o.id)).toEqual([
      'proposals.approve',
      'proposals.list',
      'proposals.reject',
    ]);
  });

  it('runs operations as the agent, and proposes archiving', async () => {
    const created = await rpc('tools/call', {
      name: 'run_operation',
      arguments: {
        operation: 'records.create',
        input: { kind: 'widget', label: 'From MCP', attributes },
      },
    });
    const { result } = await created.json();
    expect(result.structuredContent).toMatchObject({
      status: 'done',
      output: { createdBy: { type: 'agent', agentName: 'Claude' } },
    });

    const archive = await rpc('tools/call', {
      name: 'run_operation',
      arguments: {
        operation: 'records.archive',
        input: { id: result.structuredContent.output.id, expectedVersion: 1 },
      },
    });
    expect((await archive.json()).result.structuredContent.status).toBe('proposed');
  });

  it('returns refusals as tool errors the agent can act on', async () => {
    const response = await rpc('tools/call', {
      name: 'run_operation',
      arguments: { operation: 'records.create', input: { kind: 'widget' } },
    });
    const { result } = await response.json();
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).code).toBe('invalid_input');
  });

  it('requires a token', async () => {
    const response = await app.request('/mcp', { method: 'POST', body: '{}' });
    expect(response.status).toBe(401);
  });
});

describe('assistant stream', () => {
  it('streams only your own conversations', async () => {
    const response = await app.request(
      '/v1/assistant/conversations/cnv_01M3QAEF94RR3KEZJ0GSG3GNKF/stream',
      { headers: { authorization: `Bearer ${personToken}` } },
    );
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe('not_found');
  });

  it('says what to set up when no model is configured', async () => {
    const response = await post('/v1/ops/assistant.ask', { message: 'Hello' });
    expect(response.status).toBe(409);
    expect((await response.json()).message).toContain('No model is set up');
  });
});
