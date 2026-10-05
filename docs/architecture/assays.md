# Assay templates and the experiment designer

Plan [017](../plans/017-experiment-designer.md). ADR [0066](../decisions/0066-assay-templates-and-design-math.md).

## Assay template (017a-1)

The assistant's default scientific intake (004g SG-04) distinguishes hypothetical planning, reusable methods/templates, experiment design and physical preparation. It reads current sources, confirmed methods, registry definitions and lab memory first, drafts source-settled content and necessary supporting definitions through operations, and asks the next consequential decision rather than a broad questionnaire. It never fabricates physical inventory to satisfy feasibility. Unknown responses retain uncertainty; ordinary pending proposals and people-only question answers/confirmation keep their existing authority boundaries. The dedicated Apply decision flow remains SG-03 work, not a tool supplied by these instructions.

Procedure text contains purpose/applicability, materials and roles, sequential instructions, quantities/units, timing/constraints and acceptance criteria. Scientific uncertainty is separate from procedure; provenance, assumptions and draft state belong in evidence/review. Preparation facts are late-bound where supported; existing server checks remain authoritative. Calculator results supply scientific numbers. The system instructions live in `apps/api/src/assistant/scientific-intake.ts`, with module details in `skills/assays/SKILL.md` and supporting registry skills.

`packages/schema/src/assays.ts`, `AssayTemplateAttributes` (`asy_`, `ASY-0001`):

| Field | Holds |
| --- | --- |
| `purpose`, `assays` | What it measures; assay names such as ELISA |
| `parts` | Each a digital SOP pinned at a confirmed version, with the id the template calls it, and `inputs`: values for the SOP's input and default variables that every experiment from the template uses (017b-3). An input the template also asks for is refused |
| `layout` | The layout template (014) its plates follow, pinned |
| `roles` | For a part's role: the capability it needs and the instruments the lab prefers (D4), or a default record and version for a material |
| `essentials` | What the designer asks for and nothing else (D3): `subjects` (record kinds, at most n) or a `variable` (a part's input variable) |
| `factors`, `design` | What varies (D5): levels listed, taken from an essential input, or a concentration series; full factorial (default) or one factor at a time, with a baseline level |
| `controls` | Wells of a well role per plate or per run, with the subject when fixed and a reason (D6) |
| `replicates` | Technical wells per condition and biological runs, with a reason (D6) |
| `readouts` | A capability and settings: mode (endpoint, kinetic, sequential), wavelengths by use, interval and duration, a read sequence |
| `quality`, `analysis`, `hitRule`, `next` | Criteria 020 computes (measure, comparison, threshold, per); the analysis plan and hit rule in words; the usual follow-up template |

## Design math (017a-1)

`packages/domain/src/design.ts`, no I/O:

- `seriesLevels({top, factor, points})` gives levels `p1`…`pn`, top first, with 6 significant digits, using the same series as plate maps.
- `designConditions(factors, kind)`:
  - **Full factorial:** every combination, the first factor varying slowest. More than 20,000 conditions is refused with a pointer to one factor at a time.
  - **One factor at a time:** every factor at its baseline (default its first level), then each other level of each factor in turn.
  - **No factors:** one condition.
  - Each condition has an id (level ids joined by dots), its levels and a label in lab words.
- `designTotals({conditions, technical, biological?, controls, wellsPerPlate})`:
  - Subject wells are conditions × technical replicates.
  - Per-plate controls repeat on every plate, and per-run controls appear once.
  - Plates per run are as few as fit, and spare wells are counted.
  - Runs are the biological replicates.
  - The result includes lines such as "40 conditions × 2 wells = 80 wells".

## The record (017a-2)

`apps/api/src/assays/kinds.ts`, kind `assay_template`:

- **Links:** `follows` each part's SOP, `layout`, `prefers` each preferred instrument or instrument kind, `uses` a role's default record, `control` a fixed control subject, `next_assay` the follow-up template.
- **Sections** a person confirms: what it measures; SOPs, layout and instruments; what the designer asks and what varies; controls and replicates; readouts and analysis.
- **Refused on save:** names used twice; a pin to a version that doesn't exist; a role or readout naming a part the template doesn't have; a role that isn't a material role of its SOP; a preferred record that isn't an instrument or instrument kind; a variable input naming no input or default variable of its SOP; a factor `from` something that isn't a subjects input; a baseline that isn't a level; a `next` that isn't another template.
- **Overview** (`apps/api/src/assays/overview.ts`, ADR 0063): "Assay template · for ELISA", then what it measures, the SOPs it follows, the layout, what it asks for, what varies, replicates, controls per plate or run, and what it reads.
- **Readiness:** its SOPs and layout confirmed (blockers); newer confirmed SOP or layout versions (warnings, pinned versions never move silently); a subjects input and controls (warnings).

## Operations (017a-2)

`apps/api/src/assays/operations.ts`, skill `skills/assays/SKILL.md`:

| Operation | Does |
| --- | --- |
| `assays.draft_template` | Drafts a template (agents directly); a person edits it with `records.update` and confirms it with `records.confirm` |
| `assays.design` | Calculator: for a saved template (any version) or attributes to try, and the answers given so far, the essential inputs still missing, the conditions (the first 50 listed), and wells, plates and runs from `designTotals`. Subjects answers are a count or record ids (each record a level, by its label); plates take the layout's well count unless `wellsPerPlate` is given. While a factor waits for its input, conditions are 0 and totals are left out |
| `assays.search` | The lab's templates, confirmed first, by words, assay name or readout capability |

## The designer (017b-1)

`apps/api/src/assays/designer.ts`, ADR [0067](../decisions/0067-designer-drafts-from-a-confirmed-template.md). `designer.start` takes a confirmed template version, the campaign and aim, and an answer for every essential input; anything missing is refused with "Still needed: …". In one write it drafts:

- **The experiment** (013), pinned to the template (`template`, linked `from_template`). It holds:
  - the template's SOP parts, with default records bound (definitions by version, physical things by id) and the answered variables as inputs;
  - the subjects;
  - one condition per factor, listing its levels;
  - the controls an experiment can name (standard, blank, neutral, positive, negative, vehicle), with wells and reason;
  - the readouts;
  - the quality criteria as success criteria.
- **The plate map** (014), when the template has a layout and the only factor is the subjects, given as records. It uses the layout's control regions where a control names its subject, and the template's default plate type.

`designer.feasibility` (017b-2) checks a drafted experiment against the lab, for the template version it pins:

- **Instruments.** For every role with a capability, and every readout no role covers, it lists the registered instruments whose resolved configuration offers that capability on the layout's plate format. Preferred instruments or kinds come first. Each need is ready, `not_ready` (only instruments in maintenance or out of service) or missing.
- **Totals.** Plates and wells come from `workOut`, with the experiment's subjects and inputs as the answers. They wait for subjects given as records.
- **Amounts.** `experiments.calculate` supplies its problems.

- **Stock.** For every variable of a pinned SOP that names the material it is drawn from (`drawsFrom`), it takes the worked-out amount and the record bound to that role. When that record is a product, lot or sample, it adds up the wells holding it (`inventory.where_is`), less what confirmed transfer plans reserve from them (`transfers.reserved`). The arithmetic is `checkStock` in `packages/domain/src/stock.ts`, volumes only. The verdict is enough or short. It is unknown when no record is bound, the amount isn't worked out, or wells hold it with no volume recorded.

It is feasible when every need is ready, every amount works out and no material is short.

Values copied from the template, and the `template` pin itself, carry `template` evidence from the confirmed version; a question defaulted from the purpose is marked assumed. The plate map's `layout` carries `template` evidence (`/layout`), and its `experiment` carries `record` evidence citing the experiment it was drafted with, so nothing the designer set reads as an agent's guess. `assays.design` and `designer.start` share `workOut` (in `operations.ts`), so both count the same way. `workOut` refuses an answer that is not a number or a quantity by the input's label; a ratio such as "1:4" is answered with "give the fold". The ledger names the template first, so it reads "designed an experiment from IL-6 ELISA".

## Saving an experiment as a template (017b-3)

`assays.save_from_experiment` drafts a template from a confirmed experiment version:

- **Parts.** The experiment's protocol steps become the parts, with the same SOP versions and the values the experiment set. Values for variables the template asks for are left out, since the designer asks for them each time.
- **Roles.** Each record the experiment bound becomes the role's default record (and version). An instrument it bound goes first in that role's preferred list instead.
- **Everything else.** When the experiment was designed from a template, the layout, essentials, factors, design, controls, replicates, readouts, quality, analysis, hit rule and notes are copied from that template version, with `template` evidence. Otherwise the caller gives at least the essentials, replicates and readouts. Anything given replaces the copy.

The parts (and roles, when bound) carry `record` evidence from the experiment version. A draft experiment is refused, because copied evidence must come from a confirmed version. `designer.start` puts a part's inputs into the experiment's protocol before the answers to the essential inputs. On screen, the Design block of a confirmed experiment designed from a template offers **Save as a template** (a name, then the new draft template's page); an experiment drafted another way is saved by asking the assistant, which can give what the call needs.

## The design page (017b-3)

The design page is the experiment's own record page, agreed with the redesign (004f-5). Its Overview, after the stage steps, adds two blocks (`apps/web/src/pages/DesignBlocks.tsx`):

- **Design.** The experiment, its plate maps and its transfer plans, one line each, with how many are confirmed. Each line says confirmed, change waiting, ready to confirm or how many things are left to fix. It shows once a plate map or transfer plan names the experiment.
- **Can the lab run it?** For an experiment designed from a template, it shows `designer.feasibility`. It leads with the plates and wells, then what is in the way ("Required before running": instruments, amounts that don't work out, short stock). Instruments and stock are folded, with counts.

A confirmed assay template's page has **Design an experiment** (`apps/web/src/pages/AssayDesign.tsx`, 017b-4). It asks for the campaign (and aim) and each essential input: subjects picked as records of the kinds the input allows (samples, entities and containers by default) or given as a count, and variable values as typed (a number with a unit becomes a quantity). As you answer, `assays.design` shows what is still to answer and the conditions, plates and wells. **Draft the experiment** calls `designer.start` and opens the new experiment.

Planning waits on the design (UX review 2026-10-02, #1). `experiments.plan_check` lists what stands in the way besides readiness and the amounts: no subjects, no plate map when the template has a layout, and plate maps still in draft (each linked). The experiment's Next step shows these under "Required before planning" and offers **Plan it** only when the list is empty and the protocol works out. `experiments.set_stage` refuses `planned` on the same grounds.

The **Transfers** tab lists the experiment's transfer plans, each with its plates, transfers and groups. The Plates tab is the redesign's.

## Seed

`seed/assay-templates.yaml` holds the IL-6 ELISA, compound single-point and dose-response, pNPP kinetic and Dual-Glo templates. A test checks that every role is a material of its part's SOP and every variable asked for is one of the SOP's inputs or defaults. The follow-up link (`next`) is not seeded, since it names a template the seed has not drafted yet. SOPs, the layout, instrument kinds and labware are named by seed keys and found by label (`apps/api/src/assays/seed.ts`); the seed drafts it after everything it names exists, then settles it like every other seed record (ADR 0044). Running the seed again updates a template it drafted when a field still carries the seed's evidence and differs from the seed file, or pins an older SOP or layout version than the lab has: a draft at once, a confirmed template as a proposal the seed settles. SOP pins use the latest confirmed historical version when one exists, including for a pre-existing working draft. Templates whose SOP seed refresh is blocked by confirmed history stay unchanged and are reported as waiting for a separate method draft; operation validation also reports incompatible templates as waiting without aborting other seed work. The IL-6 ELISA seed SOP includes `sample_dilution` (default 1); previously confirmed SOPs that lack it must adopt it through a separate draft before the corresponding template can refresh.

## Not yet

Fractional factorial and response-surface designs (017d). Template screens come with the designer. Confirmed experiments started from a template offer **Save as a template**, including when no plate maps or transfer plans have been drafted; the saved template starts as a draft with the experiment's pinned methods, values and bindings.
