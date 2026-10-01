# Assay templates and the experiment designer

Plan [017](../plans/017-experiment-designer.md). ADR [0066](../decisions/0066-assay-templates-and-design-math.md).

## Assay template (017a-1)

`packages/schema/src/assays.ts`, `AssayTemplateAttributes` (`asy_`, `ASY-0001`):

| Field | Holds |
| --- | --- |
| `purpose`, `assays` | What it measures; assay names such as ELISA |
| `parts` | Each a digital SOP pinned at a confirmed version, with the id the template calls it |
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

## Seed

`seed/assay-templates.yaml` holds the IL-6 ELISA template. SOPs, the layout, instrument kinds and labware are named by seed keys and found by label (`apps/api/src/assays/seed.ts`); the seed drafts it after everything it names exists, then settles it like every other seed record (ADR 0044). The IL-6 ELISA SOP gained the input `sample_dilution` (default 1) that the template asks for.

## Not yet

`assays.save_from_experiment`, the designer and feasibility (017b); the other seed templates (017c); fractional factorial and response-surface designs (017d). Template screens come with the designer.
