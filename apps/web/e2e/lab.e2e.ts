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

test('an agent proposes a change, a person confirms it on the Review page, and the ledger shows it live', async ({
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

  // The record says a change is waiting; the Review page holds it.
  await page.goto(`/records/${record.id}`);
  await expect(page.getByText('change waiting')).toBeVisible();
  await page.getByRole('link', { name: 'Review it' }).click();
  const proposal = page
    .getByRole('article', { name: 'Change: edit' })
    .filter({ hasText: record.name });
  await expect(proposal.getByText('“Match the ELISA SOP”')).toBeVisible();
  await expect(proposal.getByRole('cell', { name: `${label} (ELISA)` })).toBeVisible();
  await proposal.getByRole('button', { name: 'Confirm change' }).click();
  await expect(proposal).toHaveCount(0);

  await page.getByRole('link', { name: 'Records' }).click();
  await page.getByRole('searchbox', { name: 'Find records' }).fill(record.name);
  await page.getByRole('row', { name: new RegExp(record.name) }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(`${label} (ELISA)`);
  const history = page.getByRole('row', { name: /v2/ });
  await expect(history).toContainText('E2E agent for you');
  await expect(history).toContainText('“Match the ELISA SOP”');

  await page.getByRole('link', { name: 'Activity' }).click();
  await expect(
    page.getByRole('row', { name: /confirmed a proposed change/ }).first(),
  ).toBeVisible();
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

test('the assistant runs an operation for you, and the ledger links back to the conversation', async ({
  page,
}) => {
  await signIn(page);
  const label = `Reservoir ${Date.now()}`;
  const ask = page.getByLabel('Ask the assistant');
  await ask.fill(`/op records.create ${JSON.stringify({ kind: 'widget', label, attributes })}`);
  await ask.press('Enter');

  const panel = page.getByRole('complementary', { name: 'Assistant' });
  const created = panel.getByRole('link', { name: /^WDG-\d+$/ }).first();
  await expect(created).toBeVisible();
  await expect(panel.getByText(/^Done:/)).toBeVisible();
  const name = (await created.textContent()) ?? '';
  // The turn ends with what it left for you: the draft to confirm, linked.
  await expect(panel.getByText('Waiting for you:')).toBeVisible();
  await expect(panel.locator('.waiting').getByRole('link', { name })).toBeVisible();

  // Replies continue the same conversation.
  const reply = panel.getByLabel('Message the assistant');
  await reply.fill('thanks');
  await reply.press('Enter');
  await expect(panel.getByText('You said: thanks')).toBeVisible();

  // The change is in the ledger under the assistant's name, and opens the conversation.
  await panel.getByRole('button', { name: 'New' }).click();
  await expect(panel.getByText('You said: thanks')).toBeHidden();
  await page
    .getByRole('row', { name: new RegExp(`Test assistant for you created ${name}`) })
    .click();
  await page.getByRole('button', { name: 'open in the assistant' }).click();
  await expect(panel.getByText('You said: thanks')).toBeVisible();
});

test('an agent drafts a record, a person reviews it section by section, and the last confirm activates it', async ({
  page,
  request,
}) => {
  await signIn(page);
  const drafted = await asAgent(request, 'records.create', {
    kind: 'widget',
    label: `Reservoir ${Date.now()}`,
    attributes,
    evidence: { volume: { source: 'datasheet', note: 'Vendor sheet, p. 2' } },
  });
  const record = drafted.output;

  // The draft waits on the Review page, which opens it.
  await page.getByRole('link', { name: /^Review/ }).click();
  const waiting = page.getByRole('article', { name: `Draft ${record.name}` });
  await expect(waiting).toContainText('Confirm appearance and volume');
  await waiting.getByRole('link', { name: `Review ${record.name}` }).click();
  await expect(page.getByText('needs your review').first()).toBeVisible();

  const readiness = page.getByRole('region', { name: 'Readiness' });
  const appearance = page.getByRole('region', { name: 'Appearance' });
  const volume = page.getByRole('region', { name: 'Volume' });

  // What the agent assumed is marked; what it took from a datasheet says so.
  await expect(appearance.getByText('assumed by E2E agent')).toBeVisible();
  await expect(
    volume.getByText(/from a datasheet by E2E agent · Vendor sheet, p\. 2/),
  ).toBeVisible();
  await expect(readiness.getByText('Appearance is not confirmed')).toBeVisible();

  await volume.getByRole('button', { name: 'Confirm volume' }).click();
  await expect(volume.getByText(/confirmed by you/)).toBeVisible();

  // The agent changes a confirmed value: the section goes back to review, showing the change.
  await asAgent(request, 'records.update', {
    id: record.id,
    expectedVersion: 2,
    attributes: { ...attributes, volume: { value: '250', unit: 'uL' } },
  });
  await expect(volume.getByText('changed, needs review')).toBeVisible();
  await expect(volume.locator('.was')).toHaveText('200 µL');
  await expect(volume.locator('.now')).toHaveText('250 µL');
  await expect(readiness.getByText('Volume changed since it was confirmed')).toBeVisible();

  await volume.getByRole('button', { name: 'Confirm volume' }).click();
  await expect(volume.getByText(/confirmed by you/)).toBeVisible();
  // The last section's button says it activates the record, and it does.
  await appearance.getByRole('button', { name: 'Confirm appearance and activate' }).click();
  await expect(page.locator('.chip.active')).toBeVisible();
  await expect(readiness.getByText('✓ confirmed')).toBeVisible();
  await expect(page.getByRole('row', { name: /v5/ })).toContainText(
    'confirmed appearance and activated',
  );
});
