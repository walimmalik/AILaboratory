# Assay templates and the experiment designer

Plan [017](../plans/017-experiment-designer.md). ADR [0066](../decisions/0066-assay-templates-and-design-math.md).

## Assay template (017a-1)

`packages/schema/src/assays.ts`, `AssayTemplateAttributes` (`asy_`, `ASY-0001` once the record kind lands in 017a-2):

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

## Not yet

The `assay_template` record kind and its operations (`assays.draft_template`, `assays.update_template`, `assays.save_from_experiment`, `assays.get`, `assays.search`) and the ELISA template from `seed/assays.yaml` (017a-2); the designer and feasibility (017b); the other seed templates (017c); fractional factorial and response-surface designs (017d).
