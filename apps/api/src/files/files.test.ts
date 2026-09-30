import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Actor, FileAttributes, RecordEnvelope } from '@ailab/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { createTenant, issueToken } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { createTestDb } from '../db/testing.ts';
import { ActivityBus, createRegistry, type OperationRegistry } from '../operations/index.ts';
import { KindRegistry } from '../records/kinds.ts';
import type { RecordContext } from '../records/service.ts';
import { fileKinds } from './kinds.ts';
import { LocalFileStore, MemoryFileStore, sha256Of } from './store.ts';

let db: Db;
let close: () => Promise<void>;
let registry: OperationRegistry;
let files: MemoryFileStore;
let person: RecordContext;
let agent: RecordContext;
let otherLab: RecordContext;
let userId: string;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const tenant = await createTenant(db, { orgName: 'Org', labName: 'Lab', userName: 'Wali' });
  const other = await createTenant(db, { orgName: 'Other', labName: 'Other lab', userName: 'Sam' });
  userId = tenant.userId;
  const user: Actor = { type: 'user', userId: tenant.userId };
  person = { actor: user, orgId: tenant.orgId, labId: tenant.labId };
  agent = { ...person, actor: { type: 'agent', agentName: 'Claude', onBehalfOf: tenant.userId } };
  otherLab = {
    actor: { type: 'user', userId: other.userId },
    orgId: other.orgId,
    labId: other.labId,
  };
  files = new MemoryFileStore();
  registry = createRegistry(db, kinds(), new ActivityBus(), undefined, files);
});
afterEach(() => close());

function kinds() {
  const registry = new KindRegistry();
  for (const kind of fileKinds) registry.register(kind);
  return registry;
}

async function run<T>(ctx: RecordContext, id: string, input: unknown) {
  const result = await registry.execute(ctx, id, input);
  if (result.status === 'proposed') throw new Error(`${id} was proposed`);
  return result.output as T;
}

type Uploaded = { file: RecordEnvelope; stored: boolean };
const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0xff, 0x00]);

describe('files', () => {
  it('stores bytes once by their hash and gives each lab its own record', async () => {
    const base64 = Buffer.from(pdf).toString('base64');
    const first = await run<Uploaded>(person, 'files.upload', {
      name: 'DY206 ELISA.pdf',
      mediaType: 'application/pdf',
      base64,
    });
    expect(first.stored).toBe(true);
    expect(first.file).toMatchObject({ kind: 'file', name: 'FIL-0001', status: 'active' });
    expect(first.file.attributes).toEqual({
      sha256: sha256Of(pdf),
      size: pdf.byteLength,
      mediaType: 'application/pdf',
      originalName: 'DY206 ELISA.pdf',
      source: { from: 'upload' },
    } satisfies FileAttributes);

    const again = await run<Uploaded>(agent, 'files.upload', {
      name: 'copy.pdf',
      mediaType: 'application/pdf',
      base64,
    });
    expect(again).toMatchObject({ stored: false, file: { id: first.file.id } });

    const elsewhere = await run<Uploaded>(otherLab, 'files.upload', {
      name: 'DY206 ELISA.pdf',
      mediaType: 'application/pdf',
      base64,
    });
    expect(elsewhere.stored).toBe(true);
    expect(elsewhere.file.id).not.toBe(first.file.id);

    const read = await run<{ base64?: string; text?: string }>(person, 'files.get', {
      id: first.file.id,
    });
    expect(read.base64).toBe(base64);
    expect(read.text).toBeUndefined();
  });

  it('reads text files back as text, and an agent uploads directly', async () => {
    const { file } = await run<Uploaded>(agent, 'files.upload', {
      name: 'coat-plate.md',
      mediaType: 'text/markdown',
      text: '# Coat a plate\n\nAdd 100 µL capture antibody per well.',
      source: { from: 'folder', path: 'seed/sops/own/coat-plate.md' },
    });
    const read = await run<{ text?: string }>(person, 'files.get', { id: file.id });
    expect(read.text).toContain('100 µL');
    expect(file.attributes).toMatchObject({ source: { from: 'folder' } });
  });

  it('refuses content that is both or neither, bad base64, and changed bytes', async () => {
    await expect(
      registry.execute(person, 'files.upload', { name: 'a.txt', mediaType: 'text/plain' }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(
      registry.execute(person, 'files.upload', {
        name: 'a.txt',
        mediaType: 'text/plain',
        text: 'a',
        base64: 'YQ==',
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(
      registry.execute(person, 'files.upload', {
        name: 'a.bin',
        mediaType: 'application/octet-stream',
        base64: 'not base64!',
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(
      registry.execute(person, 'files.upload', { name: 'a.txt', mediaType: 'PDF', text: 'a' }),
    ).rejects.toMatchObject({ code: 'invalid_input' });

    const { file } = await run<Uploaded>(person, 'files.upload', {
      name: 'a.txt',
      mediaType: 'text/plain',
      text: 'a',
    });
    await expect(
      registry.execute(person, 'records.update', {
        id: file.id,
        expectedVersion: file.version,
        attributes: { ...(file.attributes as FileAttributes), size: 2 },
      }),
    ).rejects.toMatchObject({ code: 'invalid_attributes' });
  });

  it("keeps another lab's files out of reach and the content out of the ledger", async () => {
    const { file } = await run<Uploaded>(person, 'files.upload', {
      name: 'a.txt',
      mediaType: 'text/plain',
      text: 'secret protocol',
    });
    await expect(registry.execute(otherLab, 'files.get', { id: file.id })).rejects.toMatchObject({
      code: 'not_found',
    });
    const { entries } = await run<{ entries: { operationId: string; input: unknown }[] }>(
      person,
      'activity.list',
      {},
    );
    const upload = entries.find((e) => e.operationId === 'files.upload');
    expect(JSON.stringify(upload?.input)).not.toContain('secret protocol');
  });

  it('serves the bytes over HTTP to the lab, sandboxing types a browser would run', async () => {
    const app = createApp({ db, kinds: kinds(), files });
    const token = await issueToken(db, { userId, agentName: 'Test' });
    const auth = { Authorization: `Bearer ${token}` };
    const { file } = await run<Uploaded>(person, 'files.upload', {
      name: 'page.html',
      mediaType: 'text/html',
      text: '<script>alert(1)</script>',
    });
    const response = await app.request(`/v1/files/${file.id}`, { headers: auth });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('content-security-policy')).toContain('sandbox');
    expect(await response.text()).toBe('<script>alert(1)</script>');
    expect((await app.request(`/v1/files/${file.id}`)).status).toBe(401);
  });
});

describe('local file store', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ailab-files-'));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('writes bytes under their hash and reads them back', async () => {
    const store = new LocalFileStore(dir);
    const sha = await store.put(pdf);
    expect(sha).toBe(sha256Of(pdf));
    expect(await store.put(pdf)).toBe(sha);
    expect(await store.get(sha)).toEqual(pdf);
    expect(await store.get('0'.repeat(64))).toBeUndefined();
    expect(await store.get('../etc/passwd')).toBeUndefined();
  });
});
