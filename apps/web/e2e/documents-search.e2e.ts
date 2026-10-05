import type { libraryRead, librarySearch, OperationErrorBody } from '@ailab/schema';
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
  // CI has no document converter. Search and parsed text responses are fixtures here; title browsing,
  // record navigation, assistant requests and persistence use the real API. Live acceptance
  // separately searches a genuinely parsed illustrative document with the actual operation.
  const hit = {
    hits: [
      {
        document: { id: source.id, name: source.name, label: source.label, type: 'sop' },
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
    parse: {
      file: source.id.replace('doc_', 'fil_'),
      sha256: 'illustrative-search-fixture',
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
    if (input.document !== source.id) return route.continue();
    const output = {
      ...parsed,
      ...(input.section === undefined
        ? {}
        : {
            passages:
              input.section === 1
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
  await expect(passages.getByRole('link', { name: source.label, exact: true })).toHaveAttribute(
    'href',
    `/records/${source.id}?section=1#document-text`,
  );

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
  await words.fill('absentphrase');
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
  await expect(page).toHaveURL(new RegExp(`/records/${source.id}\\?section=1#document-text$`));
  await expect(page.getByRole('heading', { level: 1 })).toContainText(source.label);
  const text = page.getByRole('region', { name: 'Text', exact: true });
  await expect(text.getByRole('button', { name: 'Readout', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(text).toContainText('Read absorbance at 450 nm.');
  await expect(text.getByText('Read absorbance at 450 nm.', { exact: true })).toBeInViewport();
  await expect(text.getByText('Illustrative only.', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(text.getByRole('button', { name: 'Readout', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.goBack();
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
  const started = page.waitForRequest('**/api/v1/ops/assistant.ask');
  await page
    .getByLabel('Ask the assistant')
    .fill('Help me understand this source before drafting a method.');
  await page.getByLabel('Ask the assistant').press('Enter');
  const request = (await started).postDataJSON();
  expect(request.page.record).toEqual({
    id: source.id,
    name: source.name,
    version: source.version,
  });
  await expect(
    page.getByRole('complementary', { name: 'Assistant' }).getByText(/^You said:/),
  ).toBeVisible();
});
