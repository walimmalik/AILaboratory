import type {
  Conversation,
  ConversationSummary,
  ExactSourceReference,
  libraryRead,
  librarySearch,
  OperationErrorBody,
} from '@ailab/schema';
import { expect, test } from '@playwright/test';

test('document text search separates browsing, recovers from failure and carries source context', async ({
  page,
}) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(process.env.E2E_EMAIL ?? '');
  await page.getByLabel('Password').fill(process.env.E2E_PASSWORD ?? '');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/:5173\/$/);
  const added = await page.request.post('/api/v1/ops/library.add', {
    data: {
      label: `Search walkthrough ${Date.now()}`,
      type: 'sop',
      license: { name: "The lab's own", sharePolicy: 'lab_private' },
      files: [],
    },
  });
  expect(added.ok()).toBe(true);
  const source = (await added.json()).output;
  // CI has no document converter. Search/parsed reads and the final assistant echo are UI fixtures;
  // title browsing and record navigation use the real API. This case checks exact context binding,
  // not server validation or persistence of this fabricated pin. Actual-API source/replay tests and
  // separate live acceptance cover genuine retained sources and persisted assistant context.
  const fixtureSource: ExactSourceReference = {
    document: source.id,
    version: source.version,
    file: source.id.replace('doc_', 'fil_'),
    sha256: 'a'.repeat(64),
    parse: { status: 'parsed', snapshot: 'b'.repeat(64) },
    title: source.label,
  };
  const hit = {
    hits: [
      {
        document: { id: source.id, name: source.name, label: source.label, type: 'sop' },
        source: fixtureSource,
        passage: {
          id: 'illustrative-search-passage',
          section: 1,
          heading: ['Readout'],
          page: 1,
          text: 'Read absorbance at 450 nm.',
        },
        snippet: 'Read absorbance at [[450]] nm.',
        rank: 1,
      },
    ],
  } satisfies ReturnType<typeof librarySearch.output.parse>;
  const parsed = {
    document: source,
    source: fixtureSource,
    parse: {
      file: fixtureSource.file,
      sha256: fixtureSource.sha256,
      snapshot: 'b'.repeat(64),
      converter: 'test-fixture',
      sections: 2,
      passages: 2,
      warnings: [],
      parsedAt: new Date().toISOString(),
    },
    outline: [
      { index: 0, heading: ['Introduction'], passages: 1 },
      { index: 1, heading: ['Readout'], pageFrom: 1, passages: 1 },
    ],
  } satisfies ReturnType<typeof libraryRead.output.parse>;
  await page.route('**/api/v1/ops/library.read', async (route) => {
    const input = route.request().postDataJSON();
    if (input.source?.document !== source.id) return route.continue();
    expect(input.source).toMatchObject({
      document: fixtureSource.document,
      version: fixtureSource.version,
      file: fixtureSource.file,
      sha256: fixtureSource.sha256,
      parse: fixtureSource.parse,
    });
    expect(input.document).toBeUndefined();
    const output = {
      ...parsed,
      ...(input.section === undefined && input.passages === undefined
        ? {}
        : {
            passages:
              input.section === 1 || input.passages?.includes('illustrative-search-passage')
                ? hit.hits.map((entry) => entry.passage)
                : [
                    {
                      id: 'intro',
                      section: 0,
                      heading: ['Introduction'],
                      text: 'Illustrative only.',
                    },
                  ],
          }),
    } satisfies ReturnType<typeof libraryRead.output.parse>;
    await route.fulfill({ json: { status: 'done', output } });
  });
  const submitted: string[] = [];
  let releaseFirst: (() => void) | undefined;
  const firstReply = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let holdFirst = true;
  let fail = true;
  await page.route('**/api/v1/ops/library.search', async (route) => {
    const text = route.request().postDataJSON().text;
    submitted.push(text);
    if (holdFirst) {
      holdFirst = false;
      await firstReply;
    }
    if (text === 'wavelength' && fail) {
      const error = {
        code: 'unavailable',
        message: 'Search temporarily unavailable',
      } satisfies OperationErrorBody;
      await route.fulfill({ status: 503, json: error });
      return;
    }
    await route.fulfill({
      json: { status: 'done', output: text === 'absentphrase' ? { hits: [] } : hit },
    });
  });
  await page.goto('/documents');
  const words = page.getByRole('searchbox', { name: 'Words or phrase', exact: true });
  await expect(page.getByRole('button', { name: 'Document text', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('group', { name: 'Status', exact: true })).toBeHidden();
  await words.fill('  450  ');
  await words.press('Enter');
  const passages = page.getByRole('region', { name: 'Passages found' });
  await expect(passages).toContainText('Searching for “450”');
  await words.fill('650');
  releaseFirst?.();
  await expect(passages).toHaveCount(0);
  expect(submitted[0]).toBe('450');
  await words.fill('450');
  await words.press('Enter');
  await expect(passages).toContainText('1 passage with “450”');
  await expect(passages).toContainText('Readout, page 1');
  await expect(passages.locator('mark')).toHaveText('450');
  await expect(page.getByText('No title has those words.', { exact: true })).toBeHidden();
  const sourceLink = passages.getByRole('link', { name: source.label, exact: true });
  const href = await sourceLink.getAttribute('href');
  if (!href) throw new Error('Expected exact instructions link');
  const linked = new URL(href, page.url());
  expect(linked.pathname).toBe('/library/instructions');
  expect(JSON.parse(linked.searchParams.get('source') ?? 'null')).toEqual(fixtureSource);
  expect(linked.searchParams.get('passage')).toBe('illustrative-search-passage');
  expect(linked.searchParams.has('section')).toBe(false);

  await page.getByRole('button', { name: 'Titles', exact: true }).click();
  const titles = page.getByRole('searchbox', { name: 'Find documents', exact: true });
  await titles.fill(source.label);
  await page.getByRole('button', { name: 'Drafts', exact: true }).click();
  await expect(page.getByRole('row', { name: new RegExp(source.name) })).toBeVisible();
  await page.getByRole('button', { name: 'Confirmed', exact: true }).click();
  await expect(page.getByRole('row', { name: new RegExp(source.name) })).toHaveCount(0);
  await page.getByRole('button', { name: 'Document text', exact: true }).click();
  await expect(passages).toContainText('1 passage with “450”');
  await expect(page.getByRole('group', { name: 'Status', exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Titles', exact: true }).click();
  await expect(titles).toHaveValue(source.label);
  await expect(page.getByRole('button', { name: 'Confirmed', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Document text', exact: true }).click();
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(words).toHaveValue('');
  await expect(passages).toHaveCount(0);
  // URL state changes must not pull a focused mobile input toward the page header.
  // No result list changes during this edit, so a jump cannot be attributed to shrinking content.
  await page.setViewportSize({ width: 390, height: 600 });
  await words.fill('absent');
  await words.click();
  const scrollBeforeEdit = await page.evaluate(() => window.scrollY);
  expect(scrollBeforeEdit).toBeGreaterThan(0);
  await words.press('End');
  await words.pressSequentially('phrase');
  await expect(page).toHaveURL(/words=absentphrase/);
  await expect(words).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBeforeEdit);
  await page.setViewportSize({ width: 1280, height: 720 });
  await words.press('Enter');
  await expect(passages).toContainText('No passage has all those words');
  await words.fill('wavelength');
  await words.press('Enter');
  await expect(passages).toContainText('Search failed for “wavelength”');
  await expect(passages).toContainText('Search temporarily unavailable');
  fail = false;
  await passages.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(passages).toContainText('1 passage with “wavelength”');
  await passages.getByRole('link', { name: source.label, exact: true }).click();
  await expect(page).toHaveURL(/\/library\/instructions\?/);
  const selected = new URL(page.url());
  expect(JSON.parse(selected.searchParams.get('source') ?? 'null')).toEqual(fixtureSource);
  expect(selected.searchParams.get('passage')).toBe('illustrative-search-passage');
  expect(JSON.parse(selected.searchParams.get('back') ?? 'null')).toMatchObject({
    mode: 'text',
    q: 'wavelength',
    words: 'wavelength',
    title: source.label,
    status: 'active',
  });
  await expect(page.getByRole('heading', { level: 1 })).toContainText(source.label);
  const text = page.getByRole('region', { name: 'Selected source text', exact: true });
  const sections = page.getByRole('navigation', { name: 'Source sections' });
  await expect(
    sections.getByRole('link', { name: 'Readout, page 1', exact: true }),
  ).toHaveAttribute('aria-current', 'location');
  await expect(text).toContainText('Read absorbance at 450 nm.');
  await expect(text.getByText('Read absorbance at 450 nm.', { exact: true })).toBeInViewport();
  await expect(text.getByText('Illustrative only.', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(
    sections.getByRole('link', { name: 'Readout, page 1', exact: true }),
  ).toHaveAttribute('aria-current', 'location');
  await sections.getByRole('link', { name: 'Introduction', exact: true }).click();
  await expect(page).toHaveURL(/section=0/);
  const sectionUrl = new URL(page.url());
  expect(JSON.parse(sectionUrl.searchParams.get('source') ?? 'null')).toEqual(fixtureSource);
  expect(sectionUrl.searchParams.get('section')).toBe('0');
  expect(sectionUrl.searchParams.has('passage')).toBe(false);
  await expect(text).toContainText('Illustrative only.');
  await expect(text.getByText('Read absorbance at 450 nm.', { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Back to document search', exact: true }).click();
  await expect(words).toHaveValue('wavelength');
  await expect(passages).toContainText('1 passage with “wavelength”');
  await page.reload();
  await expect(words).toHaveValue('wavelength');
  await expect(passages).toContainText('1 passage with “wavelength”');
  await page.getByRole('button', { name: 'Titles', exact: true }).click();
  await expect(titles).toHaveValue(source.label);
  await expect(page.getByRole('button', { name: 'Confirmed', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Drafts', exact: true }).click();
  await page.getByRole('row', { name: new RegExp(source.name) }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(source.label);
  await page.goBack();
  await expect(titles).toHaveValue(source.label);
  await expect(page.getByRole('button', { name: 'Drafts', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Document text', exact: true }).click();
  await expect(words).toHaveValue('wavelength');
  await passages.getByRole('link', { name: source.label, exact: true }).click();
  // A UI-only echo lets this synthetic parsed source test the submitted binding. It must not
  // bypass or impersonate the real API's exact-source preflight/persistence acceptance.
  const at = new Date().toISOString();
  const summary: ConversationSummary = {
    id: 'cnv_01J9Z3K8Q4ABCDEFGHJKMNPQRS',
    title: 'Exact source UI binding',
    status: 'idle',
    agentName: 'UI fixture',
    provider: 'scripted',
    model: 'UI fixture',
    createdAt: at,
    updatedAt: at,
  };
  let displayed: Conversation | undefined;
  await page.route('**/api/v1/ops/assistant.ask', async (route) => {
    const input = route.request().postDataJSON();
    displayed = {
      ...summary,
      messages: [
        { id: 'ui-user', role: 'user', at, text: input.message, page: input.page },
        {
          id: 'ui-echo',
          role: 'assistant',
          at,
          text: `You said: ${input.message}`,
          toolCalls: [],
          model: 'UI fixture',
        },
      ],
    };
    await route.fulfill({ json: { status: 'done', output: summary } });
  });
  await page.route('**/api/v1/ops/assistant.get_conversation', async (route) => {
    if (route.request().postDataJSON().id !== summary.id) return route.continue();
    await route.fulfill({ json: { status: 'done', output: displayed } });
  });
  await page.route(`**/api/v1/assistant/conversations/${summary.id}/stream`, async (route) => {
    await route.fulfill({
      contentType: 'text/event-stream',
      body: `event: ready\ndata: ${JSON.stringify({ conversation: summary })}\n\n`,
    });
  });
  const started = page.waitForRequest('**/api/v1/ops/assistant.ask');
  await page
    .getByLabel('Ask the assistant')
    .fill('Help me understand this source before drafting a method.');
  await page.getByLabel('Ask the assistant').press('Enter');
  const request = (await started).postDataJSON();
  expect(request.page.path).toBe('/library/instructions');
  expect(request.page.selectedSource).toEqual({
    source: fixtureSource,
    passage: 'illustrative-search-passage',
  });
  expect(request.page.record).toBeUndefined();
  expect(request.page.activeQuestion).toBeUndefined();
  expect(request.page.proposal).toBeUndefined();
  expect(request.replyTo).toBeUndefined();
  await expect(
    page.getByRole('complementary', { name: 'Assistant' }).getByText(/^You said:/),
  ).toBeVisible();
});
