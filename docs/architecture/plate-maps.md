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
| `layouts.save_from_map` | A new layout draft from a plate map: its layout with the map's strategy, and plate 1's hand edits that change what wells are for (controls, blanks, empty) as fixed regions; wells they take leave the regions that held them. Hand edits naming samples are left out | direct |

Changes and confirmation use the record operations (`records.update`, `records.confirm_section`) like every design. The seed drafts five layouts from `seed/layouts.yaml`: IL-6 ELISA 96 (40 samples in duplicate), single-point 384 (320 compounds), dose-response 384 (16 compounds, 10 points in duplicate), pNPP 96 and Dual-Glo 384.

## Plate maps (014a-3)

A `plate_map` record (`pmp_`, `PMP-0001`) applies a layout to real subjects (P1, M3):

| Section | Fields |
| --- | --- |
| What goes on the plates | `layout` pinned as `{id, version}` (ADR 0039), `experiment` or `purpose`, `labware` (a pinned labware type whose well count must match the layout), `subjects` in placement order (entities, samples, lots or containers), `controls` (a record for each of the layout's fixed regions) |
| Placement and hand edits | `strategy` (instead of the layout's), `seed`, `overrides` (plate, well, role, subject, note), `notes` |

The wells are never stored. `apps/api/src/platemaps/generate.ts` works them out from the pinned layout version, the subjects, the seed and the overrides every time, so they always match the record and a map rebuilds exactly (M1). Every write does the same, so a map the layout can't place is refused. `platemaps.draft` pins the layout's current version unless given one, and sets a seed for randomized or balanced placement.

Readiness: it places something, and its layout version and any pinned plate type version are confirmed (blockers); a newer confirmed layout or plate type version, control regions that name nothing, and hand edits that no longer land on a plate (warnings).

| Operation | What it does | Agents |
| --- | --- | --- |
| `platemaps.draft` | Drafts a plate map from a layout and subjects | direct |
| `platemaps.wells` | Every planned well, plate by plate, with each subject's name; hand edits that no longer land | read |
| `platemaps.override` | Hand edits to wells (P4, M5), or clears them | direct on drafts, proposed on confirmed maps |
| `platemaps.export` | CSV: plate, well, role, subject, name, replicate, point, concentration, unit | read |

Subjects, controls and strategy change through `records.update`; confirming is `records.confirm_section`, like every design.

## Screens (014b)

Plate layouts are a tab in Library (plan 004f N5). A plate map has no tab of its own: it shows on its experiment's **Plates** tab (each map with its plates) and on its layout's **Plates made from it** tab (what each is for, what it places, the layout version it follows); maps outside experiments are listed from Plate layouts. A plate map's crumb goes through its layout ("plate layouts / IL-6 ELISA, 96 wells → for EXP-0004"). A layout's record page shows its plate full, with how many subjects fit per plate and a count to try ("41 samples → 2 plates"), from `layouts.preview`. A plate map's page shows its plates (a strip moves between them), a key by role with well counts ("Blank 4 wells") and "Changed by hand" for the dot that marks hand edits, "Where each sample is" listing each subject with its wells (open when there are 8 or fewer), the wells by role, a series shaded from its top point (its lightest points ringed so they read at night), a well's details on select with why it was changed by hand, and the CSV to save. Counts name what is placed, in the subjects' own word: "3 samples on 1 plate", "Plate 1 · 3 samples"; `layouts.preview` names its stand-ins the same way ("Sample 14"). **Change wells** lets a person select wells (or a whole row or column by its label), give them a role and optionally one of the map's subjects or control records, with why; each becomes a hand edit (`platemaps.override`), and hand edits on selected wells can be undone. **Save as layout** runs `layouts.save_from_map` and opens the new draft. See [web-app.md](web-app.md). Wells name what they hold by label, with its code after it ("Donor 1 (SUA-0001)"). At phone width a 96-well grid shrinks its wells to fit; a denser grid scrolls inside its block, under "Scroll sideways for all 24 columns.", while the key and tools stay in view.

## Not yet

Dragging a selection to move it (M5) goes through the agent for now. Real barcoded plates come with the transfer plan (016).
