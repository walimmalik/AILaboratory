# 0071: One experiment workspace over shared scientific records

- Status: accepted by Wali, 2026-10-07; implementation pending
- Date: 2026-10-07
- Plan: [004h](../plans/004h-scientist-experiment-workspace.md), D2

## Context

The reviewed mockup keeps Design, Plates and Transfers inside one experiment. Current record links take the scientist to source pages; existing scientific inputs, maps and transfer plans already have separate authorities. Large plate sets and multiple additions need explicit coverage, version/freshness and source-demand relationships. A second editable workspace document would duplicate those authorities. A new workflow engine would overlap plan 018.

## Options

1. Keep independent record pages and improve links. Small implementation, but the scientist still loses experiment/selection context.
2. Store a new workspace document containing copies of the design, plates and transfer settings. Easy to render, but introduces competing values and diverging agent/UI paths.
3. Project an experiment workspace from the existing records, adding only missing scientific intent/lineage to its owning module.

## Decision

Choose option 3. The experiment owns scientific inputs, selections and typed addition intent linked to pinned protocol steps and target maps. Plate maps own placement; transfer plans own concrete liquid movements; registries own definitions/configuration; inventory owns physical container facts; transfers owns generated-output associations. One read projection provides contextual navigation and summaries. No authoritative workspace record or duplicated quantities.

Addition intent supplies the missing relationship between the scientific targets and generated plan groups/batches. It records explicit coverage and dependencies, allowing composition to be checked only where all necessary additions/removals are known. It is not a scheduler or execution graph. Reuse SOP variables/materials/domain calculations rather than inventing a general mixture subsystem.

Required intermediate compound dilutions belong to this experiment's preparation, including dose-response points that cannot be reached directly from stock. Retain intermediate identity as preparation destination and later dosing source, with explicit preparation/consumption lineage and calculated demand. W0's technical direction uses generation-scoped intermediate identities with one preparation owner and explicit consumer references across plan partitions. A plan/file limit does not justify duplicating physical preparation; distinct physical preparation scopes or capacity constraints may. Compute exact consumer demand and intended solvent endpoints before software partitioning. Finish the detailed C3 contract before dependent implementation. This does not introduce the separate material-production journey, claim current cross-plan support or assert physical preparation.

Experiment-specific replicate/control/layout choices have typed experiment-owned fields and explicit precedence over pinned defaults. Design totals and map generation consume the same resolved design. Recalculation preserves these choices and does not modify the reusable template/layout; labels and notes are not an alternate authority for scientific quantities.

Large selections use stable server paging and explicit snapshot membership. Partition large transfer workloads into bounded plans/batches with complete coverage and joint source checks; the current 200-container limit includes sources and intermediates. Generated plans carry exact dependencies and candidate/accepted generation membership. Draft regeneration does not release accepted reservations. A person's version-bound replacement acceptance atomically switches the complete scope and its reservations, with no partially accepted mixed generation eligible for export. Rejection, interruption and conflict preserve the prior accepted membership. Superseded outputs remain historical; routine export requires the selected accepted generation. This explicitly extends the current active-plan reservation contract; it is not a sequence of UI-only confirm/archive calls.

Keep output associations separate from content-addressed file identity: the same bytes may be generated for several plan versions or groups. Historical associations remain readable; freshness is derived against the selected scientific scope. Under accepted 004h D4, preserve people-only confirmation and soft reservations; add explicit instructions eligibility for unconfirmed/stale inputs, invalid science, unsupported required setup/format and incomplete claimed coverage. Stock/live availability remain separate preparation facts under the current policy. This is accepted target behavior, not evidence that the new export check is implemented.

For 004h, deliver compound screening/Echo first, including dose-response and required intermediate dilutions, then ELISA and cell assays. Wali accepted this ordering on 7 October 2026; it amends the earlier ELISA-first delivery sequence in plans 000/017 for this workspace rollout. Material production remains separate.

Authoritative calculations, optimization, plate allocation and worklist payload generation use the deterministic library and typed operations in ADR 0024. Agents propose inputs and call those functions; they do not supply replacement arithmetic or executable transfer rows when a required function is unavailable.

## Consequences

- Scientists stay inside the experiment while viewing or fixing related information; existing registry routes still work independently.
- Agents and people read and mutate the same scientific records through operations. Definitions remain pinned; physical stock/configuration is rechecked as appropriate.
- Some work is backend/domain work: saved incomplete-design continuation, selection resolution, addition lineage/coverage, bounded projections and durable export receipts. UI composition alone cannot deliver the mockup honestly.
- This decision does not accept every assay, device or source-assignment strategy. Unsupported scientific transformations remain explicit gaps. Detailed contracts and acceptance are in the [spec](../specs/experiment-workspace.md).
