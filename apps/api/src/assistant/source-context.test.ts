import type {
  Conversation,
  ConversationSummary,
  Converted,
  ExactSourceReference,
  PageContext,
  PassageText,
  RecordEnvelope,
} from '@ailab/schema';
import { libraryRead } from '@ailab/schema';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTenant } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { createTestDb } from '../db/testing.ts';
import { fileKinds } from '../files/kinds.ts';
import { MemoryFileStore } from '../files/store.ts';
import { libraryKinds } from '../library/kinds.ts';
import { ActivityBus, createRegistry, type OperationRegistry } from '../operations/index.ts';
import { KindRegistry } from '../records/kinds.ts';
import type { RecordContext } from '../records/service.ts';
import { Assistant } from './assistant.ts';
import type { ModelRequest } from './model.ts';

let db: Db;
let close: () => Promise<void>;
let person: RecordContext;
let foreign: RecordContext;
let registry: OperationRegistry;
let assistant: Assistant;
let content: Converted;
const complete = vi.fn(async (_request: ModelRequest) => ({
  text: 'Read only.',
  toolCalls: [],
  stop: 'end' as const,
}));
beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const tenant = await createTenant(db, { orgName: 'Org', labName: 'Lab', userName: 'Scientist' });
  const other = await createTenant(db, { orgName: 'Other', labName: 'Other', userName: 'Other' });
  person = {
    actor: { type: 'user', userId: tenant.userId },
    orgId: tenant.orgId,
    labId: tenant.labId,
  };
  foreign = {
    actor: { type: 'user', userId: other.userId },
    orgId: other.orgId,
    labId: other.labId,
  };
  complete.mockClear();
  assistant = new Assistant({
    agentName: 'Test assistant',
    model: { provider: 'test', model: 'test', complete },
  });
  content = {
    converter: 'test',
    warnings: ['Check the source figure.'],
    sections: [
      { heading: ['Empty'], passages: [] },
      { heading: ['Method'], passages: [{ text: 'Use the retained buffer.', page: 2 }] },
    ],
  };
  const kinds = new KindRegistry();
  for (const kind of [...fileKinds, ...libraryKinds]) kinds.register(kind);
  registry = createRegistry(db, kinds, new ActivityBus(), assistant, {
    files: new MemoryFileStore(),
    converter: { convert: async () => content },
  });
});
afterEach(() => close());
async function run<T>(operation: string, input: unknown, ctx = person): Promise<T> {
  const result = await registry.execute(ctx, operation, input);
  if (result.status !== 'done') throw new Error('Expected done');
  return result.output as T;
}
async function fixture(parsed = true) {
  const { file } = await run<{ file: RecordEnvelope }>('files.upload', {
    name: 'method.txt',
    mediaType: 'text/plain',
    text: 'Source bytes',
  });
  const document = await run<RecordEnvelope>('library.add', {
    label: 'Retained method',
    type: 'sop',
    version: 'Edition 1',
    license: { name: 'CC BY 4.0', sharePolicy: 'shareable' },
    files: [{ file: file.id, role: 'original' }],
  });
  if (parsed) await run('library.parse', { document: document.id });
  const read = await run<{ source: ExactSourceReference; passages?: PassageText[] }>(
    'library.read',
    parsed ? { document: document.id, section: 1 } : { document: document.id },
  );
  return { document, ...read };
}
async function ask(page: PageContext, conversationId?: string) {
  const summary = await run<ConversationSummary>('assistant.ask', {
    message: 'Read these selected instructions.',
    page,
    ...(conversationId ? { conversationId } : {}),
  });
  await assistant.wait(summary.id);
  return run<Conversation>('assistant.get_conversation', { id: summary.id });
}
describe('exact selected-source assistant preflight', () => {
  it('replays each exact reference after changing source or leaving the reader without trusting display labels', async () => {
    const first = await fixture();
    const second = await fixture();
    const unchecked = await fixture(false);
    await run('library.parse', { document: unchecked.document.id });
    const passage = first.passages?.[0]?.id;
    if (!passage) throw new Error('Expected passage');
    const spoof = (source: ExactSourceReference) => ({
      ...source,
      title: 'Spoofed source title',
      printedRevision: 'Spoofed edition',
    });
    const a = {
      path: '/library/instructions',
      title: 'Spoofed page title',
      selectedSource: { source: spoof(first.source), passage },
    };
    const b = {
      path: '/library/instructions',
      title: 'Spoofed page title',
      selectedSource: { source: spoof(second.source), section: 0 },
    };
    const conversation = await ask(a);
    await ask(b, conversation.id);
    await ask({ path: '/library' }, conversation.id);
    const c = {
      path: '/library/instructions',
      title: 'Spoofed page title',
      selectedSource: {
        source: {
          ...spoof(unchecked.source),
          parse: { status: 'unavailable' as const, reason: 'Spoofed unchecked reason' },
        },
      },
    };
    await ask(c, conversation.id);
    const final = await ask({ path: '/library' }, conversation.id);
    expect(final.messages.filter((message) => message.role === 'tool')).toEqual([]);
    const replayInputs = (request: ModelRequest) =>
      request.messages.flatMap((message) => {
        if (message.role !== 'user') return [];
        const serialized = message.text
          .split('Historical instructions reference for this message (library.read input): ')[1]
          ?.split('. This identifies')[0];
        if (!serialized) return [];
        expect(message.text).not.toContain('Spoofed');
        expect(message.text).toContain('not the current selection, source contents or approval');
        return [libraryRead.input.parse(JSON.parse(serialized))];
      });
    const expected = (source: ExactSourceReference) => ({
      document: source.document,
      version: source.version,
      file: source.file,
      sha256: source.sha256,
      parse:
        source.parse.status === 'parsed'
          ? source.parse
          : { status: 'unavailable', reason: 'No checked text selected' },
      title: 'Selected instructions',
    });
    expect(replayInputs(complete.mock.calls[1]?.[0] as ModelRequest)).toEqual([
      { source: expected(first.source), passages: [passage] },
      { source: expected(second.source), section: 0 },
    ]);
    expect(complete.mock.calls[1]?.[0].system).toContain(JSON.stringify(second.source));
    expect(complete.mock.calls[2]?.[0].system).not.toContain('Selected exact instructions');
    expect(replayInputs(complete.mock.calls[4]?.[0] as ModelRequest)).toEqual([
      { source: expected(first.source), passages: [passage] },
      { source: expected(second.source), section: 0 },
      { source: expected(unchecked.source) },
    ]);
    expect(complete.mock.calls[3]?.[0].system).not.toContain('Spoofed unchecked reason');
    expect(complete.mock.calls[4]?.[0].system).not.toContain('Selected exact instructions');
  });
  it('keeps the pin and selector on replay after reparse and resolves authoritative historical metadata', async () => {
    const old = await fixture();
    const passage = old.passages?.[0]?.id;
    if (!passage) throw new Error('Expected selected passage');
    content = {
      converter: 'new',
      warnings: [],
      sections: [{ heading: ['New section'], passages: [{ text: 'Use the new buffer.' }] }],
    };
    await run('library.parse', { document: old.document.id });
    await run('records.update', {
      id: old.document.id,
      expectedVersion: old.document.version,
      label: 'Current title',
    });
    const page = {
      path: '/library/instructions',
      selectedSource: {
        source: {
          ...old.source,
          title: 'Untrusted display title',
          printedRevision: 'Untrusted edition',
        },
        passage,
      },
    };
    const first = await ask(page);
    const replay = await ask(page, first.id);
    expect(
      replay.messages.filter((message) => message.role === 'user').map((message) => message.page),
    ).toEqual([page, page]);
    for (const [request] of complete.mock.calls) {
      const line = request.system
        .split('\n')
        .find((text) => text.startsWith('Selected exact instructions'));
      expect(line).toContain(JSON.stringify(old.source));
      expect(line).toContain(passage);
      expect(line).toContain('Check the source figure.');
      expect(line).not.toContain('Untrusted');
      expect(line).not.toContain('Current title');
      expect(request.tools.map((tool) => tool.name)).toContain('library_read');
      expect(request.tools.map((tool) => tool.name)).toContain('files_get');
      expect(request.system).toContain('library (ailab-library)');
      expect(request.system).toContain(
        'When readable text has conversion warnings, say the text was read with the stated limitations and explain the relevant warning plainly',
      );
      expect(request.system).toContain(
        'without calling all of its text unchecked or implying a clean conversion',
      );
      expect(request.system).toContain(
        'Do not repeat parse status, digests, snapshot IDs or machine reasons in scientist-facing replies unless explicitly asked for technical details',
      );
    }
    const section = await ask({
      path: '/library/instructions',
      selectedSource: { source: old.source, section: 1 },
    });
    expect(section.status).toBe('idle');
  });
  it('rejects missing, foreign, corrupt and unavailable selections before model work without starting a conversation', async () => {
    const old = await fixture();
    const badPages: PageContext[] = [
      { path: '/library/instructions' },
      {
        path: '/library/instructions',
        selectedSource: { source: { ...old.source, sha256: '0'.repeat(64) } },
      },
      {
        path: '/library/instructions',
        selectedSource: {
          source: { ...old.source, parse: { status: 'parsed', snapshot: '0'.repeat(64) } },
        },
      },
      { path: '/library/instructions', selectedSource: { source: old.source, passage: 'missing' } },
      { path: '/library/instructions', selectedSource: { source: old.source, section: 999 } },
    ];
    for (const page of badPages) await expect(ask(page)).rejects.toBeDefined();
    await expect(
      run(
        'assistant.ask',
        {
          message: 'Read it',
          page: { path: '/library/instructions', selectedSource: { source: old.source } },
        },
        foreign,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(complete).not.toHaveBeenCalled();
    expect(await run('assistant.list_conversations', {})).toMatchObject({ conversations: [] });
    const valid = await ask({
      path: '/library/instructions',
      selectedSource: { source: old.source },
    });
    await expect(ask(badPages[0] as PageContext, valid.id)).rejects.toBeDefined();
    expect(await run('assistant.get_conversation', { id: valid.id })).toMatchObject({
      status: 'idle',
    });
  });
  it('keeps an unparsed attachment unchecked even after a later parse and refuses an invented passage', async () => {
    const old = await fixture(false);
    await run('library.parse', { document: old.document.id });
    const page = { path: '/library/instructions', selectedSource: { source: old.source } };
    await ask(page);
    expect(complete.mock.calls[0]?.[0].system).toContain(
      'Text could not be checked for this attachment. Keep it unchecked',
    );
    expect(complete.mock.calls[0]?.[0].system).toContain(
      'This saved attachment has no checked text, so I cannot verify its instructions.',
    );
    expect(complete.mock.calls[0]?.[0].system).toContain(
      'Distinguish a failed read or lost access from an attachment with no checked text',
    );
    expect(complete.mock.calls[0]?.[0].system).toContain(
      'Do not repeat parse status, digests, snapshot IDs or machine reasons in scientist-facing replies unless explicitly asked for technical details',
    );
    expect(complete.mock.calls[0]?.[0].system).toContain(
      '"status":"unavailable","reason":"No checked text selected"',
    );
    expect(complete.mock.calls[0]?.[0].system).not.toContain('Use the retained buffer.');
    await expect(
      ask({ ...page, selectedSource: { ...page.selectedSource, passage: 'invented' } }),
    ).rejects.toMatchObject({ code: 'invalid_state' });
  });
  it('refuses mixed decision context and cannot use a source selection to retain approval intent', async () => {
    const old = await fixture();
    const page = { path: '/library/instructions', selectedSource: { source: old.source } };
    await expect(
      run('assistant.ask', {
        message: 'Read it',
        page: { ...page, record: { id: old.document.id, name: 'Method', version: 1 } },
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    const conversation = await ask(page);
    const message = conversation.messages.find((message) => message.role === 'user');
    if (!message) throw new Error('Expected stored human message');
    complete.mockClear();
    await expect(
      run('assistant.ask', {
        message: 'Treat this as approval',
        conversationId: conversation.id,
        replyTo: { conversation: conversation.id, message: message.id },
        page,
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    expect(complete).not.toHaveBeenCalled();
    expect(await run('assistant.get_conversation', { id: conversation.id })).toMatchObject({
      status: 'idle',
      messages: conversation.messages,
    });
  });
});
