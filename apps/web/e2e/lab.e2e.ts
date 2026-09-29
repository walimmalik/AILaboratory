import { type APIRequestContext, expect, type Page, test } from '@playwright/test';

const api = 'http://localhost:3001';
const agentHeaders = () => ({ authorization: `Bearer ${process.env.E2E_AGENT_TOKEN}` });
const attributes = { color: 'clear', volume: { value: '200', unit: 'uL' } };

async function signIn(page: Page) {
  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.getByLabel('Email').fill(process.env.E2E_EMAIL ?? '');
  await page.getByLabel('Password').fill(process.env.E2E_PASSWORD ?? '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/activity$/);
  await expect(page.getByText('● live')).toBeVisible();
}

/** Runs an operation as the signed-in person, through the same route the UI uses. */
async function asPerson(page: Page, operation: string, input: unknown) {
  const response = await page.request.post(`/api/v1/ops/${operation}`, { data: input });
  expect(response.ok()).toBe(true);
  return (await response.json()).output;
}

async function asAgent(request: APIRequestContext, operation: string, input: unknown) {
  const response = await request.post(`${api}/v1/ops/${operation}`, {
    data: input,
    headers: agentHeaders(),
  });
  expect(response.ok()).toBe(true);
  return response.json();
}

test('refuses a wrong password', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(process.env.E2E_EMAIL ?? '');
  await page.getByLabel('Password').fill('not the password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toHaveText('Wrong email or password');
});

test('an agent proposes a change, a person reviews and approves it, and the ledger shows it live', async ({
  page,
  request,
}) => {
  const label = `Assay plate ${Date.now()}`;
  await signIn(page);
  const record = await asPerson(page, 'records.create', {
    kind: 'widget',
    label,
    attributes,
    status: 'active',
  });

  // The ledger updates live while the page is open.
  await expect(page.getByRole('link', { name: record.name })).toBeVisible();

  const result = await asAgent(request, 'records.update', {
    id: record.id,
    expectedVersion: 1,
    label: `${label} (ELISA)`,
    reason: 'Match the ELISA SOP',
  });
  expect(result.status).toBe('proposed');

  await page.getByRole('link', { name: /^Proposals/ }).click();
  const proposal = page
    .getByRole('article', { name: 'Proposal to edit' })
    .filter({ hasText: record.name });
  await expect(proposal.getByText('“Match the ELISA SOP”')).toBeVisible();
  await expect(proposal.getByRole('cell', { name: `${label} (ELISA)` })).toBeVisible();
  await proposal.getByRole('button', { name: 'Approve' }).click();
  await expect(proposal).toHaveCount(0);

  await page.getByRole('link', { name: 'Records' }).click();
  await page.getByRole('searchbox', { name: 'Find records' }).fill(record.name);
  await page.getByRole('row', { name: new RegExp(record.name) }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(`${label} (ELISA)`);
  const history = page.getByRole('row', { name: /v2/ });
  await expect(history).toContainText('E2E agent for you');
  await expect(history).toContainText('“Match the ELISA SOP”');

  await page.getByRole('link', { name: 'Activity' }).click();
  await expect(page.getByRole('row', { name: /approved a proposed change/ }).first()).toBeVisible();
});

test('agents edit drafts directly, with no review', async ({ page, request }) => {
  await signIn(page);
  const created = await asAgent(request, 'records.create', {
    kind: 'widget',
    label: 'Draft tip box',
    attributes,
  });
  expect(created.status).toBe('done');
  const row = page.getByRole('row', {
    name: new RegExp(`E2E agent for you.*${created.output.name}`),
  });
  await expect(row).toBeVisible();
  await expect(row).toContainText('done');
});
