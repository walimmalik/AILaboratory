import { fileURLToPath } from 'node:url';
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

  await page.getByRole('link', { name: 'All records' }).click();
  await page.getByRole('searchbox', { name: 'Find all records' }).fill(record.name);
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

test('an agent proposes several changes as one, and a person confirms them together', async ({
  page,
  request,
}) => {
  const label = `Rack ${Date.now()}`;
  await signIn(page);
  const rack = await asPerson(page, 'records.create', {
    kind: 'widget',
    label,
    attributes,
    status: 'active',
  });
  const result = await asAgent(request, 'changes.apply', {
    reason: 'Add the reservoir to the rack',
    steps: [
      {
        operation: 'records.create',
        input: { kind: 'widget', label: `${label} reservoir`, attributes },
      },
      {
        operation: 'records.update',
        input: { id: rack.id, expectedVersion: 1, label: `${label} (full)` },
      },
    ],
  });
  expect(result.status).toBe('proposed');

  await page.goto(`/records/${rack.id}`);
  await expect(page.getByText('change waiting')).toBeVisible();
  await page.getByRole('link', { name: 'Review it' }).click();
  const proposal = page
    .getByRole('article', { name: 'Change: make a set of changes' })
    .filter({ hasText: 'Add the reservoir to the rack' });
  await expect(proposal).toContainText('wants to make 2 changes together, all or none');
  await expect(proposal.getByRole('cell', { name: `${label} (full)` })).toBeVisible();
  await proposal.getByRole('button', { name: 'Confirm all 2' }).click();
  await expect(proposal).toHaveCount(0);
  await page.goto(`/records/${rack.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(`${label} (full)`);
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
  const waiting = page.getByRole('row', { name: `Draft ${record.name}` });
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
  // Kinds with sections have no separate final Confirm: the last section's confirm activates.
  await expect(readiness.getByRole('button', { name: `Confirm ${record.name}` })).toHaveCount(0);

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
  // Once active and confirmed, the sections fold into one Details block.
  await expect(
    page.getByRole('region', { name: 'Details' }).getByText('✓ confirmed'),
  ).toBeVisible();
  await expect(page.getByRole('row', { name: /v5/ })).toContainText(
    'confirmed appearance and activated',
  );
});

test('labware has its own page in the library, and the Review page groups drafts by kind', async ({
  page,
  request,
}) => {
  await signIn(page);
  const label = `Deep well plate ${Date.now()}`;
  const drafted = await asAgent(request, 'records.create', {
    kind: 'labware_type',
    label,
    attributes: {
      family: 'plate',
      wells: { layout: 'grid', rows: 8, columns: 12 },
      maxVolume: { value: '2', unit: 'mL' },
    },
  });
  const name = drafted.output.name;

  await page
    .getByRole('navigation', { name: 'Modules' })
    .getByRole('link', { name: /^Labware/ })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Labware');
  await page.getByRole('button', { name: 'Tip racks' }).click();
  await expect(page.getByRole('row', { name: new RegExp(name) })).toHaveCount(0);
  await page.getByRole('button', { name: 'Plates' }).click();
  const row = page.getByRole('row', { name: new RegExp(name) });
  await expect(row).toContainText('plate · 96 wells');
  await expect(row).toContainText('2 mL');
  await row.click();
  await expect(page.locator('.crumbs')).toContainText(`lab / labware / ${name}`);

  await page
    .getByRole('link', { name: /^Review/ })
    .first()
    .click();
  await page.getByRole('button', { name: /^Labware \d+/ }).click();
  await expect(page.getByRole('row', { name: `Draft ${name}` })).toBeVisible();
});

test('a failing check links to its section, where a person fills in the value and says where it came from', async ({
  page,
  request,
}) => {
  await signIn(page);
  const drafted = await asAgent(request, 'records.create', {
    kind: 'labware_type',
    label: `Tip tray ${Date.now()}`,
    attributes: {
      family: 'tip_rack',
      footprint: {
        sbs: true,
        length: { value: '127.76', unit: 'mm' },
        width: { value: '85.48', unit: 'mm' },
      },
      wells: { layout: 'grid', rows: 16, columns: 24 },
      maxVolume: { value: '60', unit: 'uL' },
    },
  });
  await page.goto(`/records/${drafted.output.id}`);
  const readiness = page.getByRole('region', { name: 'Readiness' });
  const geometry = page.getByRole('region', { name: 'Geometry' });

  // Failing checks come first; passing ones are folded away.
  await expect(readiness.getByText('Length, width or height is missing')).toBeVisible();
  await expect(readiness.getByText(/checks pass/)).toBeVisible();
  // The drawing fills in the SBS size and spacing for the picture, and says so.
  const drawing = page.getByRole('region', { name: 'Drawing' });
  await expect(drawing.getByText('127.76 mm × 85.48 mm · wells 4.5 mm apart')).toBeVisible();
  await expect(drawing.getByText(/Wells drawn 4.5 mm apart/)).toBeVisible();

  await readiness.getByRole('button', { name: 'Fix in geometry' }).first().click();
  await geometry.getByRole('textbox', { name: 'height', exact: true }).first().fill('30.5');
  await geometry.getByRole('button', { name: 'Measured' }).click();
  await geometry.getByRole('textbox', { name: 'Note' }).fill('calipers');
  await geometry.getByRole('button', { name: 'Save' }).click();

  await expect(geometry.getByText(/measured · calipers/).first()).toBeVisible();
  await expect(readiness.getByText('Length, width or height is missing')).toHaveCount(0);

  // Positions the standard gives are one click away, cited to the standard.
  await expect(readiness.getByText('Pitch or A1 offset is missing')).toBeVisible();
  await readiness.getByRole('button', { name: 'Use the standard SBS positions' }).click();
  await expect(readiness.getByText('Pitch or A1 offset is missing')).toHaveCount(0);
  await expect(
    geometry.getByText(/calculated · Pitch and A1 offset.*ANSI\/SLAS 4-2004/).first(),
  ).toBeVisible();
  await expect(drawing.getByText(/Wells drawn 4.5 mm apart/)).toHaveCount(0);
});

test("an editor open while an agent changes the record doesn't write over the agent's change", async ({
  page,
  request,
}) => {
  await signIn(page);
  const drafted = await asAgent(request, 'records.create', {
    kind: 'labware_type',
    label: `Deep well ${Date.now()}`,
    attributes: {
      family: 'plate',
      wells: { layout: 'grid', rows: 8, columns: 12 },
      maxVolume: { value: '200', unit: 'uL' },
    },
  });
  const id = drafted.output.id;
  await page.goto(`/records/${id}`);
  const volumes = page.getByRole('region', { name: 'Volumes' });
  await volumes.getByRole('button', { name: 'Edit volumes' }).click();
  const dead = volumes.getByRole('textbox', { name: 'dead volume', exact: true }).first();
  await dead.fill('twenty');
  await expect(volumes.getByRole('button', { name: 'Save' })).toBeDisabled();
  await expect(volumes.getByText('Fix the field marked in red before saving.')).toBeVisible();
  await dead.fill('20');
  await volumes.getByRole('combobox', { name: 'dead volume unit' }).first().selectOption('uL');

  // While the form is open, the agent raises the maximum volume.
  await asAgent(request, 'records.update', {
    id,
    expectedVersion: 1,
    attributes: {
      family: 'plate',
      wells: { layout: 'grid', rows: 8, columns: 12 },
      maxVolume: { value: '300', unit: 'uL' },
    },
  });
  await expect(volumes.getByText(/changed to version 2 while you were editing/)).toBeVisible();
  await expect(volumes.getByRole('button', { name: 'Save' })).toBeDisabled();
  await volumes.getByRole('button', { name: 'Load the new values' }).click();
  await volumes.getByRole('button', { name: 'Save' }).click();
  // The editor closes once the save is written.
  await expect(volumes.getByRole('button', { name: 'Edit volumes' })).toBeVisible();

  // The save is a round trip; read the record once it has landed.
  await expect
    .poll(async () => (await asAgent(request, 'records.get', { id })).output.version)
    .toBe(3);
  const saved = await asAgent(request, 'records.get', { id });
  expect(saved.output.attributes.maxVolume).toEqual({ value: '300', unit: 'uL' });
  expect(saved.output.attributes.deadVolume).toEqual({ value: '20', unit: 'uL' });
});

test('a draft of a kind without sections is confirmed on its own page', async ({
  page,
  request,
}) => {
  await signIn(page);
  const drafted = await asAgent(request, 'records.create', {
    kind: 'vendor',
    label: `Plates Inc ${Date.now()}`,
    attributes: { website: 'https://example.org' },
  });
  await page.goto(`/records/${drafted.output.id}`);
  const readiness = page.getByRole('region', { name: 'Readiness' });
  await readiness.getByRole('button', { name: `Confirm ${drafted.output.name}` }).click();
  await expect(page.getByText('active', { exact: true })).toBeVisible();
  await expect(readiness).toHaveCount(0);
});

test('the wiki is readable in the app, with links between its pages', async ({ page }) => {
  await signIn(page);
  await page
    .getByRole('navigation', { name: 'Modules' })
    .getByRole('link', { name: 'Wiki' })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('AILaboratory wiki');
  await page.getByRole('article').getByRole('link', { name: 'Roadmap and status' }).click();
  await expect(page).toHaveURL(/\/wiki\/roadmap$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Roadmap/);
});

test('an Opentrons definition imports from a file and exports as one, on the page and in the assistant', async ({
  page,
}) => {
  await signIn(page);
  await page.goto('/labware');
  const definition = fileURLToPath(
    new URL('../../../seed/opentrons/nest_12_reservoir_15ml.json', import.meta.url),
  );
  await page.getByLabel('Import Opentrons JSON').setInputFiles(definition);
  await expect(page).toHaveURL(/\/records\/lwt_/);
  const id = page.url().split('/').at(-1) ?? '';

  const block = page.getByRole('region', { name: 'Opentrons' });
  await expect(block.getByText('nest_12_reservoir_15ml.json')).toBeVisible();
  const saving = page.waitForEvent('download');
  await block.getByRole('button', { name: 'Download' }).click();
  expect((await saving).suggestedFilename()).toBe('nest_12_reservoir_15ml.json');

  // The assistant's export shows as the same file, not as text in its reply.
  const ask = page.getByLabel('Ask the assistant');
  await ask.fill(`/op labware.export_opentrons ${JSON.stringify({ id })}`);
  await ask.press('Enter');
  const panel = page.getByRole('complementary', { name: 'Assistant' });
  await expect(panel.getByText('nest_12_reservoir_15ml.json')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Download' })).toBeVisible();
});

test('a file attached in the assistant goes to the tool whole, not through the chat', async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole('button', { name: 'Assistant' }).click();
  const panel = page.getByRole('complementary', { name: 'Assistant' });
  await panel
    .getByLabel('Attach a file to your message')
    .setInputFiles(
      fileURLToPath(
        new URL('../../../seed/opentrons/nest_12_reservoir_15ml.json', import.meta.url),
      ),
    );
  await expect(panel.getByText('nest_12_reservoir_15ml.json')).toBeVisible();
  const reply = panel.getByLabel('Message the assistant');
  await reply.fill('/op labware.import_opentrons {"definition": {"$file": "$attached"}}');
  await reply.press('Enter');
  await expect(panel.getByText(/attached nest_12_reservoir_15ml\.json/)).toBeVisible();
  await expect(panel.getByRole('link', { name: /^LWT-\d+$/ }).first()).toBeVisible();
  await expect(panel.getByText(/^Done:/)).toBeVisible();
});

test('the reagent library shows lots in date and the next expiry, and a product lists its lots', async ({
  page,
  request,
}) => {
  await signIn(page);
  const label = `Tris buffer ${Date.now()}`;
  const drafted = await asAgent(request, 'reagents.draft_product', {
    label,
    attributes: {
      category: 'buffer',
      origin: 'bought',
      form: 'liquid',
      storage: { min: { value: '2', unit: 'degC' }, max: { value: '8', unit: 'degC' } },
    },
  });
  const product = drafted.output.product;
  await asPerson(page, 'reagents.receive_lot', {
    product: product.id,
    lotNumber: 'T-001',
    expiry: '2099-01-31',
  });

  await page
    .getByRole('navigation', { name: 'Modules' })
    .getByRole('link', { name: /^Reagents/ })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Reagents');
  await page.getByRole('button', { name: 'Fridge' }).click();
  const row = page.getByRole('row', { name: new RegExp(product.name) });
  await expect(row).toContainText('fridge');
  await expect(row).toContainText('1 of 1');
  await expect(row).toContainText('2099-01-31');
  await page.getByRole('button', { name: 'Freezer' }).click();
  await expect(page.getByRole('row', { name: new RegExp(product.name) })).toHaveCount(0);
  await page.getByRole('button', { name: 'Fridge' }).click();
  await page.getByRole('row', { name: new RegExp(product.name) }).click();
  const lots = page.getByRole('region', { name: 'Lots' });
  await expect(lots).toContainText('T-001');
  await expect(lots).toContainText('unopened');

  await page
    .getByRole('navigation', { name: 'Modules' })
    .getByRole('link', { name: /^Liquid classes/ })
    .click();
  await expect(
    page.getByRole('region', { name: 'Classes by device and liquid type' }),
  ).toBeVisible();
});

test('a plate shows its wells shaded by volume, the rules it inherits and its ledger, and its place lists it', async ({
  page,
}) => {
  await signIn(page);
  const stamp = Date.now();
  const freezer = await asPerson(page, 'locations.create', {
    label: `Freezer ${stamp}`,
    type: 'freezer',
    setpoint: { value: '-20', unit: 'degC' },
  });
  const plateType = await asPerson(page, 'records.create', {
    kind: 'labware_type',
    label: `96 well plate ${stamp}`,
    attributes: {
      family: 'plate',
      wells: { layout: 'grid', rows: 8, columns: 12 },
      maxVolume: { value: '300', unit: 'uL' },
    },
  });
  const { containers } = await asPerson(page, 'inventory.register_containers', {
    labwareType: plateType.id,
    containers: [{ label: `Glo plate ${stamp}`, place: { location: freezer.id } }],
  });
  const plate = containers[0];
  const { product } = await asPerson(page, 'reagents.draft_product', {
    label: `Glo reagent ${stamp}`,
    attributes: {
      category: 'assay_kit',
      origin: 'bought',
      storage: { min: { value: '-30', unit: 'degC' }, max: { value: '-10', unit: 'degC' } },
      handlingRules: [
        {
          rule: 'protect_from_light',
          text: 'Light-sensitive; keep it dark',
          source: { from: 'vendor' },
          enforced: true,
        },
      ],
    },
  });
  const lot = await asPerson(page, 'reagents.receive_lot', {
    product: product.id,
    lotNumber: 'G-1',
  });
  await asPerson(page, 'inventory.fill', {
    container: plate.id,
    fills: [
      { wells: ['A1:A2'], volume: { value: '100', unit: 'uL' }, components: [{ source: lot.id }] },
      { wells: ['B1'], volume: { value: '25', unit: 'uL' }, components: [{ source: lot.id }] },
    ],
    reason: 'Plated the reagent',
  });

  await page
    .getByRole('navigation', { name: 'Modules' })
    .getByRole('link', { name: /^Containers/ })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Containers');
  await page.getByRole('row', { name: new RegExp(plate.name) }).click();
  const wells = page.getByRole('region', { name: 'Wells' });
  await expect(wells).toContainText('3 of 96 filled');
  // One kind of contents, so the key has one line and the plate is shaded by volume.
  await expect(wells.getByRole('button', { name: /^3 wells/ })).toBeVisible();
  await expect(wells.getByRole('group', { name: 'Plate map, shaded by volume' })).toBeVisible();
  await wells.getByRole('button', { name: /^B1: 25 / }).click();
  await expect(wells).toContainText(`Glo reagent ${stamp}`);
  const handling = page.getByRole('region', { name: 'Handling' });
  await expect(handling).toContainText(/Store at .30 °C to .10 °C/);
  await expect(handling).toContainText('Protect from light');
  await expect(handling).toContainText('scheduler keeps to it');
  await expect(page.getByRole('region', { name: 'Ledger' })).toContainText('Plated the reagent');

  await page
    .getByRole('navigation', { name: 'Modules' })
    .getByRole('link', { name: /^Places/ })
    .click();
  await page.getByRole('button', { name: `Freezer ${stamp}` }).click();
  await expect(page.getByRole('row', { name: new RegExp(plate.name) })).toBeVisible();
});

test('scanning a tube opens it and moves it into a box position', async ({ page }) => {
  await signIn(page);
  const stamp = Date.now();
  const fridge = await asPerson(page, 'locations.create', {
    label: `Fridge ${stamp}`,
    type: 'fridge',
  });
  const tubeType = await asPerson(page, 'records.create', {
    kind: 'labware_type',
    label: `Tube ${stamp}`,
    attributes: { family: 'tube', maxVolume: { value: '1.5', unit: 'mL' } },
  });
  const boxType = await asPerson(page, 'records.create', {
    kind: 'labware_type',
    label: `Box ${stamp}`,
    attributes: { family: 'rack', wells: { layout: 'grid', rows: 9, columns: 9 } },
  });
  const [box] = (
    await asPerson(page, 'inventory.register_containers', {
      labwareType: boxType.id,
      containers: [{ place: { location: fridge.id } }],
    })
  ).containers;
  const [tube] = (
    await asPerson(page, 'inventory.register_containers', {
      labwareType: tubeType.id,
      containers: [{ label: `Primer tube ${stamp}` }],
    })
  ).containers;

  await page
    .getByRole('navigation', { name: 'Modules' })
    .getByRole('link', { name: 'Scan' })
    .click();
  const code = page.getByLabel('Code');
  await expect(code).toBeFocused();
  await code.fill(tube.name.replace('-', '').toLowerCase());
  await code.press('Enter');
  const found = page.getByRole('region', { name: 'Found' });
  await expect(found).toContainText(`Primer tube ${stamp}`);
  await found.getByRole('button', { name: 'Move' }).click();
  const move = found.getByRole('form', { name: 'Move' });
  await move.getByLabel('To').fill(box.name);
  await move.getByLabel('Position').fill('b3');
  await move.getByRole('button', { name: 'Move' }).click();
  await expect(page.getByText(`Moved ${tube.name} to`)).toBeVisible();
  await expect(found).toContainText(`Box ${stamp} › ${tube.name} B3`);
});

test('a file added on the documents page becomes a draft document with its file', async ({
  page,
}) => {
  await signIn(page);
  const stamp = Date.now();
  await page
    .getByRole('navigation', { name: 'Modules' })
    .getByRole('link', { name: 'Documents' })
    .click();
  const add = page.getByRole('region', { name: 'Add documents' });
  await add.getByLabel('Files').setInputFiles({
    name: `Coating ${stamp}.md`,
    mimeType: 'text/markdown',
    buffer: Buffer.from(`# Coating ${stamp}\n\nCoat the plate overnight at 4 °C.\n`),
  });
  await add.getByLabel('License').selectOption({ label: "The lab's own" });
  await add.getByRole('button', { name: 'Add' }).click();
  // Without the science service in this run, the text waits to be read.
  await expect(add.getByText('added as a draft')).toBeVisible();
  await add.getByRole('link', { name: new RegExp(`Coating ${stamp}`) }).click();
  await expect(page).toHaveURL(/\/records\/doc_/);
  await expect(page.getByRole('region', { name: 'Stored files' })).toContainText(
    `Coating ${stamp}.md`,
  );
  await expect(page.getByRole('region', { name: 'Text' })).toContainText('not read yet');
});

test('an SOP reads as a procedure with its run values, and a person settles its open question', async ({
  page,
  request,
}) => {
  const stamp = Date.now();
  const drafted = await asAgent(request, 'sops.draft', {
    label: `Plate coating ${stamp}`,
    materials: [{ role: 'plate', label: 'Coating plate', type: 'labware' }],
    variables: [
      { name: 'wells', label: 'Wells', kind: 'input', value: '96' },
      {
        name: 'well_volume',
        label: 'Well volume',
        kind: 'default',
        value: { value: '100', unit: 'uL' },
      },
      {
        name: 'total',
        label: 'Coating solution',
        kind: 'computed',
        expression: 'wells * well_volume',
        unit: 'mL',
      },
    ],
    steps: [
      {
        id: 'coat',
        action: 'add',
        title: 'Coat',
        text: 'Add coating solution to every well.',
        uses: ['plate'],
        parameters: [{ name: 'volume', variable: 'well_volume' }],
      },
    ],
    questions: [
      {
        id: 'q1',
        question: 'Overnight at 4 °C or at room temperature?',
        suggestion: 'At 4 °C',
        status: 'open',
      },
    ],
  });
  await signIn(page);
  await page
    .getByRole('navigation', { name: 'Modules' })
    .getByRole('link', { name: 'SOPs' })
    .click();
  await page.getByRole('row', { name: new RegExp(`Plate coating ${stamp}`) }).click();
  await expect(page).toHaveURL(new RegExp(`/records/${drafted.output.id}`));
  const procedure = page.getByRole('region', { name: 'At the bench' });
  await expect(procedure).toContainText('Coat.');
  await expect(procedure).toContainText('volume 100 µL');
  // A number that comes from a value reads as that value: hover says which, and Names shows it.
  await procedure.getByRole('button', { name: '100 µL' }).first().hover();
  await expect(page.getByRole('tooltip')).toContainText('Well volume');
  await expect(page.getByRole('tooltip')).toContainText('usual value');
  await procedure.getByRole('button', { name: 'Names' }).click();
  await expect(procedure).toContainText('volume Well volume');
  await procedure.getByRole('button', { name: 'Numbers' }).click();
  await procedure.getByText('Values for a run').click();
  await expect(procedure.getByRole('row', { name: /Coating solution/ })).toContainText(/9\.60* mL/);

  // Edit opens the whole SOP as one form. A value is its name and one box: what is written there
  // decides its kind.
  const readiness = page.getByRole('region', { name: 'Readiness' });
  await readiness.getByRole('button', { name: 'Edit', exact: true }).click();
  const materials = page.getByRole('region', { name: 'Materials' });
  await expect(materials.getByRole('textbox', { name: 'Material' })).toHaveValue('Coating plate');
  const variables = page.getByRole('region', { name: 'Values' });
  await variables.getByRole('textbox', { name: 'Well volume: value or formula' }).fill('150 uL');
  const formula = variables.getByRole('textbox', { name: 'Coating solution: value or formula' });
  await expect(formula).toHaveValue('Wells × Well volume');
  await expect(variables).toContainText('worked out');
  // Names are recognized as they are typed, and picked from a list under the caret.
  await formula.fill('Wells × well vol');
  await variables
    .getByRole('listbox', { name: 'Matching names' })
    .getByRole('option', { name: /Well volume/ })
    .click();
  await expect(formula).toHaveValue('Wells × Well volume');
  await formula.press('End');
  await formula.pressSequentially(' * 1.1');
  await expect(variables).toContainText(/= 15\.840* mL/);
  // A name that is not one is marked, with the likely one offered.
  await formula.fill('Wells × Well vol × 1.1');
  await expect(variables).toContainText('Did you mean Well volume?');
  await variables.getByRole('button', { name: 'Use Well volume' }).click();
  await expect(formula).toHaveValue('Wells × Well volume × 1.1');
  // The assistant fills in a value, shown in agent ink until someone changes it. Its answer is played
  // back here; sops.suggest itself is tested in the API.
  await page.route('**/api/v1/ops/sops.suggest', (route) =>
    route.fulfill({
      json: {
        status: 'done',
        output: {
          variable: {
            name: 'plates',
            label: 'Plates',
            kind: 'computed',
            expression: 'ceil(wells / 96)',
          },
          reason: 'One plate per 96 wells',
          model: 'test/model',
        },
      },
    }),
  );
  await variables.getByRole('button', { name: 'Add value' }).click();
  await variables.getByRole('textbox', { name: 'Called' }).last().fill('Plates');
  await variables.getByRole('button', { name: 'Fill in with the assistant' }).click();
  await expect(variables.getByRole('textbox', { name: 'Plates: value or formula' })).toHaveValue(
    /ceil\(Wells ÷ 96\)/,
  );
  await expect(variables).toContainText('assistant: One plate per 96 wells');

  // A step's words mark its values and materials; what it uses and its settings are read from them.
  const steps = page.getByRole('region', { name: 'Steps' });
  await expect(steps.getByRole('combobox', { name: 'Action' })).toHaveValue('add');
  await steps
    .getByRole('textbox', { name: 'Step 1: what to do' })
    .fill('Add Well volume of coating solution to the Coating plate. Incubate 2 h.');
  const read = steps.locator('.step-read');
  await expect(read).toContainText('Uses Coating plate');
  await expect(read).toContainText('volume = Well volume');
  await expect(read).toContainText('duration = 2 h');
  // One Save for the whole SOP.
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(procedure).toContainText('Add 150 µL of coating solution to the Coating plate.');
  await expect(procedure).toContainText('volume 150 µL');
  await procedure
    .locator('details')
    .filter({ hasText: 'Values for a run' })
    .evaluate((d) => {
      (d as HTMLDetailsElement).open = true;
    });
  await expect(procedure.getByRole('row', { name: /Coating solution/ })).toContainText(
    /15\.840* mL/,
  );

  const questions = page.getByRole('region', { name: 'Questions to settle' });
  await expect(questions).toContainText('1 open');
  await questions.getByRole('button', { name: 'Accept the suggestion' }).click();
  await expect(questions).toContainText('all settled');

  // One Confirm settles every part and makes the SOP active.
  await readiness.getByRole('button', { name: `Confirm ${drafted.output.name}` }).click();
  await expect(readiness).toContainText('✓ confirmed');
  await expect(page.getByRole('region', { name: 'Details' })).toContainText('✓ confirmed');
});

/** A person confirms every section of a draft at once, which activates it. */
async function confirmAll(page: Page, record: { id: string; version: number }) {
  return asPerson(page, 'records.confirm', { id: record.id, expectedVersion: record.version });
}

test('a person plans an experiment, runs it as a checklist and finishes the run', async ({
  page,
}) => {
  const stamp = Date.now();
  await signIn(page);
  const sop = await confirmAll(
    page,
    await asPerson(page, 'sops.draft', {
      label: `Coating ${stamp}`,
      materials: [{ role: 'plate', label: 'Coating plate', type: 'labware' }],
      variables: [
        {
          name: 'well_volume',
          label: 'Well volume',
          kind: 'default',
          value: { value: '100', unit: 'uL' },
        },
      ],
      steps: [
        {
          id: 'coat',
          action: 'add',
          title: 'Coat',
          text: 'Add coating solution to every well.',
          parameters: [{ name: 'volume', variable: 'well_volume' }],
        },
        { id: 'wash', action: 'wash', title: 'Wash', text: 'Wash the plate.', repeat: 3 },
      ],
    }),
  );
  const campaign = await confirmAll(
    page,
    await asPerson(page, 'campaigns.draft', {
      label: `IL-6 panel ${stamp}`,
      goal: 'Find which stimuli raise IL-6',
      aims: [{ id: 'aim_1', text: 'Rank the stimuli' }],
    }),
  );
  const experiment = await confirmAll(
    page,
    await asPerson(page, 'experiments.draft', {
      label: `Stimulus panel ${stamp}`,
      campaign: campaign.id,
      aim: 'aim_1',
      question: 'Which stimuli raise IL-6?',
      protocol: [{ id: 'coating', sop: { id: sop.id, version: sop.version } }],
    }),
  );

  await page.goto(`/records/${campaign.id}`);
  await expect(page.getByRole('region', { name: 'Aims and experiments' })).toContainText(
    `Stimulus panel ${stamp}`,
  );

  await page.goto(`/records/${experiment.id}`);
  const next = page.getByRole('region', { name: 'Next step' });
  await expect(next).toContainText('Every value of the protocol works out');
  await next.getByRole('button', { name: 'Plan it' }).click();
  await expect(next).toContainText('Planned');
  await next.getByRole('button', { name: 'Start a run' }).click();

  const checklist = page.getByRole('region', { name: 'Checklist' });
  await expect(checklist).toContainText('0 of 2 steps');
  await expect(checklist).toContainText('Planned: volume 100 µL');
  await checklist.getByRole('button', { name: 'Done as planned' }).first().click();
  await expect(checklist).toContainText('1 of 2 steps');
  await checklist.getByRole('button', { name: 'Skipped' }).click();
  await checklist.getByPlaceholder('Why').fill('Washer down');
  await checklist.getByRole('button', { name: 'Record' }).click();
  await expect(checklist).toContainText('Skipped Wash. Why: Washer down');
  await checklist.getByRole('button', { name: 'Finish the run' }).click();
  await expect(checklist).toContainText('Done · 2 of 2 steps · 1 went differently');
});

test('a layout previews its plate, and a plate map shows real samples well by well with its CSV', async ({
  page,
  request,
}) => {
  const stamp = Date.now();
  await signIn(page);
  const layout = await confirmAll(
    page,
    (
      await asAgent(request, 'layouts.draft', {
        label: `ELISA 96 ${stamp}`,
        wells: 96,
        subjectRole: 'sample',
        subjectRegion: ['columns 3-12'],
        replicates: 2,
        fixed: [
          {
            id: 'standard',
            role: 'standard',
            label: 'IL-6 standard',
            region: ['A1:G2'],
            series: { top: { value: '600', unit: 'pg/mL' }, factor: '2', points: 7 },
            replicates: 2,
          },
          { id: 'blank', role: 'blank', label: 'Blank', region: ['H1:H2'] },
        ],
      })
    ).output,
  );
  await page.goto(`/records/${layout.id}`);
  const plate = page.getByRole('region', { name: 'Plate', exact: true });
  await expect(plate).toContainText('40 samples per plate');
  await plate.getByRole('spinbutton', { name: 'Number of samples' }).fill('41');
  await expect(plate).toContainText('2 plates');

  const kind = (
    await asAgent(request, 'entities.draft_kind', {
      label: `Supernatant ${stamp}`,
      attributes: {
        base: 'chemical',
        prefix: `S${String(stamp)
          .slice(-4)
          .replace(/\d/g, (d) => 'ABCDEFGHIJ'[Number(d)] ?? 'A')}`,
        fields: [],
      },
    })
  ).output;
  const donors = [];
  for (const n of [1, 2, 3])
    donors.push(
      (await asAgent(request, 'entities.draft', { label: `Donor ${n}`, entityKind: kind.id }))
        .output,
    );
  const map = (
    await asAgent(request, 'platemaps.draft', {
      label: `IL-6, three donors ${stamp}`,
      layout: layout.id,
      subjects: donors.map((d) => ({ record: d.id })),
    })
  ).output;

  await page.goto(`/records/${map.id}`);
  const plates = page.getByRole('region', { name: 'Plates', exact: true });
  await expect(plates).toContainText('3 placed on 1 plate');
  await expect(plates.getByRole('list', { name: 'Key' })).toContainText('Standard');
  await plates.getByRole('button', { name: /^A3: .*Donor 1/ }).click();
  await expect(plates.getByRole('link', { name: /Donor 1/ })).toBeVisible();
  await expect(
    plates.getByRole('button', { name: /^A1: IL-6 standard, standard, point 1 of 7, 600 pg\/mL/ }),
  ).toBeVisible();
  await expect(plates.getByText(`${map.name}.csv`)).toBeVisible();

  // Two spare blanks by hand, then the pattern saved as a layout of its own.
  await plates.getByRole('button', { name: 'Change wells' }).click();
  await plates.getByRole('button', { name: /^H11: / }).click();
  await plates.getByRole('button', { name: /^H12: / }).click();
  const edit = plates.getByRole('form', { name: 'Change wells' });
  await expect(edit).toContainText('2 wells selected');
  await edit.getByLabel('Why').fill('Spare blanks');
  await edit.getByRole('button', { name: 'Change 2 wells' }).click();
  await expect(plates.getByRole('list', { name: 'Key' })).toContainText('Blank 4');
  await expect(plates.getByRole('button', { name: 'H12: Blank, changed by hand' })).toBeVisible();
  await edit.getByRole('button', { name: 'Done' }).click();
  await plates.getByRole('button', { name: 'Save as layout' }).click();
  await plates.getByLabel('Layout name').fill(`ELISA 96 spare blanks ${stamp}`);
  await plates.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('heading', { name: `ELISA 96 spare blanks ${stamp}` })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Plate', exact: true })).toContainText(
    '39 samples per plate',
  );
});
