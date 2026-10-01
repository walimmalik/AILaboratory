# Assay templates and the experiment designer

Plan [017](../plans/017-experiment-designer.md). ADR [0066](../decisions/0066-assay-templates-and-design-math.md).

## Assay template (017a-1)

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

Values copied from the template carry `template` evidence from the confirmed version; a question defaulted from the purpose is marked assumed. `assays.design` and `designer.start` share `workOut` (in `operations.ts`), so both count the same way.

## Saving an experiment as a template (017b-3)

`assays.save_from_experiment` drafts a template from a confirmed experiment version:

- **Parts.** The experiment's protocol steps become the parts, with the same SOP versions and the values the experiment set. Values for variables the template asks for are left out, since the designer asks for them each time.
- **Roles.** Each record the experiment bound becomes the role's default record (and version). An instrument it bound goes first in that role's preferred list instead.
- **Everything else.** When the experiment was designed from a template, the layout, essentials, factors, design, controls, replicates, readouts, quality, analysis, hit rule and notes are copied from that template version, with `template` evidence. Otherwise the caller gives at least the essentials, replicates and readouts. Anything given replaces the copy.

The parts (and roles, when bound) carry `record` evidence from the experiment version. A draft experiment is refused, because copied evidence must come from a confirmed version. `designer.start` puts a part's inputs into the experiment's protocol before the answers to the essential inputs.

## Seed

`seed/assay-templates.yaml` holds the IL-6 ELISA, compound single-point and dose-response, pNPP kinetic and Dual-Glo templates. A test checks that every role is a material of its part's SOP and every variable asked for is one of the SOP's inputs or defaults. The follow-up link (`next`) is not seeded, since it names a template the seed has not drafted yet. SOPs, the layout, instrument kinds and labware are named by seed keys and found by label (`apps/api/src/assays/seed.ts`); the seed drafts it after everything it names exists, then settles it like every other seed record (ADR 0044). The IL-6 ELISA SOP gained the input `sample_dilution` (default 1) that the template asks for.

## Not yet

The design page (017b-3); fractional factorial and response-surface designs (017d). Template screens come with the designer.
