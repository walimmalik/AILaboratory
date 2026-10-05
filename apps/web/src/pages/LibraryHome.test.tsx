import type { AssistantSetup } from '@ailab/schema';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { areas } from '../lib/kinds.ts';
import { assistantSetupQuery, reviewQuery } from '../queries.ts';
import { Head, page } from './AreaHead.tsx';
import { LibraryHome, startMethodDraft } from './LibraryHome.tsx';

const assistant = vi.hoisted(() => ({
  send: vi.fn().mockResolvedValue(true),
  show: vi.fn(),
  sending: false,
  running: false,
  sendError: undefined as string | undefined,
}));
vi.mock('../assistant.tsx', () => ({ useAssistant: () => assistant }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, ...props }: Omit<ComponentProps<'a'>, 'href'> & { to: string }) => (
    <a href={to} {...props} />
  ),
}));

function html({ configured = true, loading = false } = {}) {
  const client = new QueryClient();
  const setup: AssistantSetup = configured
    ? { configured: true, provider: 'scripted', model: 'test/model', agentName: 'Test assistant' }
    : { configured: false, reason: 'No assistant is configured.' };
  if (!loading) client.setQueryData<AssistantSetup>(assistantSetupQuery.queryKey, () => setup);
  client.setQueryData(reviewQuery.queryKey, {
    items: [],
    counts: {
      total: 11,
      changes: 0,
      mentions: 0,
      notices: 0,
      needsYou: 11,
      drafts: { sop: 2, document: 3, memory: 1, layout: 1, plate_map: 4 },
    },
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <LibraryHome />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  assistant.sending = false;
  assistant.running = false;
  assistant.sendError = undefined;
  vi.clearAllMocks();
});

describe('Library task entry', () => {
  it('starts with three lab tasks and folds specialist browsing', () => {
    const markup = html();
    expect(markup).toContain('<h1>Library</h1>');
    expect(markup).toContain('>Draft a method</button>');
    expect(markup).toContain('href="/documents" class="btn">Find instructions</a>');
    expect(markup).toContain('href="/memory" class="btn">Find a lab convention</a>');
    expect(markup).toContain(
      '<details class="library-browse"><summary>Browse the library</summary>',
    );
    expect(markup).not.toContain('open=""');
    const library = areas.find((a) => a.area === 'Library');
    expect(library?.tabs).toHaveLength(9);
    for (const tab of library?.tabs ?? []) expect(markup).toContain(`href="${tab.path}"`);
    expect(markup).toContain('title="2 drafts to review">2</span>');
    expect(markup).toContain('title="3 drafts to review">3</span>');
    // Plate maps keep contributing to the existing Plate layouts review count.
    expect(markup).toContain('title="5 drafts to review">5</span>');
  });

  it('starts a fresh intake instead of reusing a conversation or inventing a method', async () => {
    const send = vi.fn().mockResolvedValue(true);
    expect(await startMethodDraft(send)).toBe(true);
    expect(send).toHaveBeenCalledOnce();
    const [message, options] = send.mock.calls[0] ?? [];
    expect(options).toEqual({ fresh: true });
    expect(message).toContain('what I want it to achieve');
    expect(message).toContain('whether I have a protocol or source document');
    expect(message).toContain(
      'Wait for my answers before choosing scientific settings or creating a method draft',
    );
  });

  it('retains the intake for a failed send and retry', async () => {
    const send = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    expect(await startMethodDraft(send)).toBe(false);
    expect(await startMethodDraft(send)).toBe(true);
    expect(send.mock.calls[1]).toEqual(send.mock.calls[0]);
  });

  it('explains disabled drafting while sending, working, checking setup or unavailable', () => {
    assistant.sending = true;
    expect(html()).toContain('disabled="">Draft a method</button>');
    expect(html()).toContain('The assistant is working.');
    assistant.sending = false;
    assistant.running = true;
    expect(html()).toContain('disabled="">Draft a method</button>');
    assistant.running = false;
    expect(html({ loading: true })).toContain('Checking assistant availability');
    expect(html({ loading: true })).toContain('disabled="">Draft a method</button>');
    expect(html({ configured: false })).toContain('The assistant is unavailable.');
    expect(html({ configured: false })).toContain('disabled="">Draft a method</button>');
    expect(html({ configured: false })).toContain('>Find instructions</a>');
    expect(html({ configured: false })).toContain('>Find a lab convention</a>');
  });

  it('keeps specialist tabs active and gives Library specialists a route back to tasks', () => {
    const renderHead = (kind: string) =>
      renderToStaticMarkup(
        <QueryClientProvider client={new QueryClient()}>
          <Head page={page(kind)} lede="Browse records" />
        </QueryClientProvider>,
      );
    const library = renderHead('sop');
    expect(library).toContain('href="/library" class="tab">Start here</a>');
    expect(library).toContain('href="/sops" class="tab on" aria-current="page"');
    const inventory = renderHead('container');
    expect(inventory).not.toContain('Start here');
    expect(inventory).toContain('href="/containers" class="tab on" aria-current="page"');
  });
});
