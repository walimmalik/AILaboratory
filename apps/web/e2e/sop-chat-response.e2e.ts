import type { RecordEnvelope, ScientificQuestion } from '@ailab/schema';
import { expect, type Page, test } from '@playwright/test';

async function operation<T>(page: Page, id: string, input: unknown): Promise<T> {
  const response = await page.request.post(`/api/v1/ops/${id}`, { data: input });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).output;
}

test('chat records an unknown answer once, preserves its question across navigation and continues from saved state', async ({
  page,
}) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(process.env.E2E_EMAIL ?? '');
  await page.getByLabel('Password').fill(process.env.E2E_PASSWORD ?? '');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/:5173\/$/);
  const question = 'Which wash instructions are compatible with the plate?';
  const sop = await operation<RecordEnvelope>(page, 'sops.draft', {
    label: `Chat response fixture ${Date.now()}`,
    materials: [],
    variables: [],
    steps: [{ id: 'wash', action: 'wash', text: 'Washing conditions need clarification.' }],
    questions: [
      {
        id: 'wash',
        question,
        about: { step: 'wash' },
        stage: { stage: 'method', reason: 'The source and plate capacity conflict.' },
      },
    ],
  });
  await page.goto(`/records/${sop.id}`);
  const bench = page.getByRole('region', { name: 'At the bench' });
  await bench.getByText('1 question to clarify', { exact: true }).click();
  await bench
    .getByRole('button', { name: `Discuss with assistant: ${question}`, exact: true })
    .click();
  const chat = page.getByRole('complementary', { name: 'Assistant', exact: true });
  await expect(
    chat.getByText(`You said: Help me clarify this question in ${sop.label}: ${question}`, {
      exact: true,
    }),
  ).toBeVisible();
  // Navigation changes the main page, not the explicitly selected scientific question.
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page
    .getByRole('navigation', { name: 'Modules' })
    .getByRole('link', { name: /^Library/ })
    .click();
  const answer =
    'I do not know yet. Keep the wash settings unchanged until we have compatible instructions.';
  let releaseConversation: (() => void) | undefined;
  const restoreConversation = new Promise<void>((resolve) => {
    releaseConversation = resolve;
  });
  await page.route('**/api/v1/ops/assistant.get_conversation', async (route) => {
    await restoreConversation;
    await route.continue();
  });
  await page.reload();
  await chat.getByRole('textbox', { name: 'Message the assistant', exact: true }).fill(answer);
  // A quick reply during reload must not silently drop the selected question.
  await expect(chat.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  releaseConversation?.();
  await expect(
    chat.getByRole('region', { name: 'Selected SOP question', exact: true }),
  ).toContainText(question);
  await expect(chat.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  await chat.getByRole('textbox', { name: 'Message the assistant', exact: true }).press('Enter');
  await expect(chat.getByText(`You said: ${answer}`, { exact: true })).toBeVisible();
  // Ordinary conversation has no authority to write an answer or resolve the issue.
  let saved = await operation<RecordEnvelope>(page, 'records.get', { id: sop.id });
  expect(saved.version).toBe(sop.version);
  expect((saved.attributes.questions as ScientificQuestion[])[0]?.responses).toEqual([]);
  let responseWrites = 0;
  await page.route('**/api/v1/ops/sops.answer_question', async (route) => {
    responseWrites += 1;
    const committed = await route.fetch();
    expect(committed.ok()).toBe(true);
    // The server commits, but its success response is lost. Recovery must read the SOP,
    // not automatically replay the write or call conversation text a receipt.
    await route.fulfill({
      status: 503,
      json: { code: 'unavailable', message: 'The connection dropped after saving.' },
    });
  });
  await chat.getByRole('button', { name: 'Record response', exact: true }).click();
  await expect(chat.getByText('This answer is already recorded', { exact: false })).toBeVisible();
  saved = await operation<RecordEnvelope>(page, 'records.get', { id: sop.id });
  const response = (saved.attributes.questions as ScientificQuestion[])[0];
  expect(response).toMatchObject({
    disposition: { status: 'open' },
    responses: [{ text: answer, by: { type: 'user' }, version: saved.version }],
  });
  expect(response?.responses).toHaveLength(1);
  expect(saved.attributes.steps).toEqual(sop.attributes.steps);
  expect(saved.attributes.variables).toEqual(sop.attributes.variables);
  expect(saved.status).toBe('draft');
  await page.reload();
  await expect(chat.getByText('This answer is already recorded', { exact: false })).toBeVisible();
  await expect(chat.getByRole('button', { name: 'Record response', exact: true })).toHaveCount(0);
  await chat.getByRole('button', { name: 'Review current question', exact: true }).click();
  await chat.getByRole('button', { name: 'Continue with assistant', exact: true }).click();
  await expect(
    chat.getByText(
      'You said: Continue helping me clarify this question using its recorded responses.',
      { exact: true },
    ),
  ).toBeVisible();
  const after = await operation<RecordEnvelope>(page, 'records.get', { id: sop.id });
  expect(after.version).toBe(saved.version);
  expect(after.attributes).toEqual(saved.attributes);
  expect(responseWrites).toBe(1);
  const ready = await operation<{ checks: { id: string; passed: boolean }[] }>(
    page,
    'records.readiness',
    { id: sop.id },
  );
  expect(ready.checks.find((check) => check.id === 'questions_answered')?.passed).toBe(false);

  // A later question edit makes the original response preview stale. The UI must show
  // the changed question and wait for a new explicit action before recording against it.
  await page.unroute('**/api/v1/ops/sops.answer_question');
  const laterAnswer = 'I am waiting for the protocol owner to provide the missing instructions.';
  await chat.getByRole('textbox', { name: 'Message the assistant', exact: true }).fill(laterAnswer);
  await chat.getByRole('textbox', { name: 'Message the assistant', exact: true }).press('Enter');
  await expect(chat.getByText(`You said: ${laterAnswer}`, { exact: true })).toBeVisible();
  const changedQuestion =
    'Which manufacturer instruction establishes the compatible wash conditions?';
  const corrected = await operation<RecordEnvelope>(page, 'sops.answer_question', {
    sop: sop.id,
    expectedVersion: saved.version,
    question: 'wash',
    action: { type: 'correct', text: changedQuestion, reason: 'Clarify the evidence needed.' },
  });
  const laterCard = chat
    .locator('.msg')
    .filter({ has: page.getByText(laterAnswer, { exact: true }) });
  await laterCard.getByRole('button', { name: 'Record response', exact: true }).click();
  await expect(laterCard).toContainText(changedQuestion);
  await expect(laterCard.getByRole('button', { name: 'Record response', exact: true })).toHaveCount(
    0,
  );
  const refused = await operation<RecordEnvelope>(page, 'records.get', { id: sop.id });
  expect(refused.version).toBe(corrected.version);
  expect((refused.attributes.questions as ScientificQuestion[])[0]?.responses).toHaveLength(1);
  await laterCard.getByRole('button', { name: 'Review current question', exact: true }).click();
  await laterCard.getByRole('button', { name: 'Record response', exact: true }).click();
  await expect(laterCard).toContainText('Response recorded.');
  const reconciled = await operation<RecordEnvelope>(page, 'records.get', { id: sop.id });
  expect((reconciled.attributes.questions as ScientificQuestion[])[0]).toMatchObject({
    question: changedQuestion,
    disposition: { status: 'open' },
    responses: [{ text: answer }, { text: laterAnswer }],
  });
  expect(reconciled.attributes.steps).toEqual(sop.attributes.steps);
});
