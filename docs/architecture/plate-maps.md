# Plate maps

Plan [014](../plans/014-plate-map-designer.md): what goes in which well. A layout template is the lab's reusable pattern (roles by region, replicates, fill order, placement strategy, edges, leftovers); a plate map applies one to real subjects across as many plates as needed.

## Placement rules (014a-1)

`packages/domain/src/platemap.ts` is pure and deterministic: the same layout, subjects and seed always give the same map.

- **Formats and regions.** `plateFormat(96)` gives the grid. `parseRegion` reads regions in lab words: `A1`, `A1:H2`, `column 1`, `columns 1-2, 23`, `row H`, `rows A-B`, `edge`, `all`. A well outside the format is refused with the reason.
- **Series** (M2). `seriesConcentrations` expands top concentration, fold and points (down from the top, or up), to 6 significant digits in the top's unit.
- **Replicates.** `replicateCells` groups a region into cells of n wells, side by side in a row or down a column; wells that don't make a whole cell are left over. `another_plate` puts each replicate on its own set of plates.
- **Fixed regions** (M3) repeat on every plate: neutral and positive controls, blanks, a standard curve (a series in its own region, in its own replicates). Two regions sharing a well is refused.
- **Paging.** Subjects fill the subject region in fill order (row or column), one cell per subject or series point, onto as many plates as needed. What's left on a plate gets the layout's leftover role (empty, neutral control or buffer).
- **Strategies** (M1). In order; randomized within each plate (each plate keeps the subjects it has in order, shuffled across its cells); balanced across plates (round-robin). Randomized and balanced need a seed, and `seededRandom` (mulberry32) makes the map rebuildable.
- **Edges.** `edge: empty` or `buffer` keeps subjects off the outer ring, which gets that role. Fixed regions are explicit and may sit on the edge.
- **Overrides** (P4). Hand edits are applied last and marked `override`; one that no longer lands on a plate after regeneration is returned in `staleOverrides`.

Each planned well carries its role, subject, label, replicate, series point and concentration, which is what analysis (020) groups by and what a transfer plan (016) makes.

## Layout templates (014a-2)

A `layout` record (`lyt_`, `LYT-0001`, [ADR 0043](../decisions/0043-layout-templates.md)) is the lab's reusable plate pattern for one format. It holds what the placement rules read, in lab words:

| Section | Fields |
| --- | --- |
| What goes where | `wells` (6 to 1536), `subjectRole`, `subjectRegion` (default every well not fixed), `subjectConcentration` or `subjectSeries`, `fixed` regions (id, role, label, region, optional standing control record, concentration or series, replicates) |
| Replicates and placement | `replicates`, `arrangement`, `fillOrder`, `strategy`, `edge`, `leftover` |
| Analysis and notes | `wellVolume`, `groups` (M6: which roles, grouped per subject, per subject and point, or per plate), `assays`, `notes` |

Every write runs the rules with one subject (`apps/api/src/platemaps/spec.ts` turns the record into the rules' input), so a region off the plate, overlapping regions or a series that can't fit is refused with the reason. A layout without a control or standard region gets a warning. A standing control record in a fixed region is linked as `control`.

| Operation | What it does | Agents |
| --- | --- | --- |
| `layouts.draft` | Drafts a layout | direct |
| `layouts.preview` | Calculator: per plate, plates and every planned well for a saved layout (or attributes to try) and a number of subjects | read |

Changes and confirmation use the record operations (`records.update`, `records.confirm_section`) like every design. The seed drafts five layouts from `seed/layouts.yaml`: IL-6 ELISA 96 (40 samples in duplicate), single-point 384 (320 compounds), dose-response 384 (16 compounds, 10 points in duplicate), pNPP 96 and Dual-Glo 384.

## Not yet

The plate map record and its operations with CSV export (014a-3); the plate editor and layout library (014b).
