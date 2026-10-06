---
name: ailab-transfers
description: Plan liquid transfers in AILaboratory through its MCP tools - pick the instrument for a volume, check whether dilution targets are reachable, run the dilution optimizer for intermediate plates, and work out what source wells must hold. Use it before drafting any transfer or dilution.
---

# Transfers in AILaboratory

Code works out every volume, droplet count, concentration and total; you pick the instrument and the route and say why (plan 016, ADR 0024). These are read operations: call them freely, compare runs with different settings, and quote their numbers. Never work a volume out yourself. See docs/architecture/transfers.md.

## Which instrument

`transfers.options` `{volume, liquid?, wells?, samples?}` ranks every instrument in the lab whose transfer or dispense limits are recorded: those that can move the volume first, then what lab memory prefers for this work (and what it avoids last among those that fit; each option names the memories in `memory`), then those with a verified liquid class for `liquid` (a liquid type ID), then the smallest error, then no tips. Each option says the volume it really moves (whole droplets on an Echo), its error and how it uses tips. Tips are estimated from the device until methods declare them: say so. Devices without recorded volume limits are listed under `unknown`; `notes` says which instruments are down or skip the plate format.

## Can the targets be reached

`transfers.dilution_options` `{stock, targets, finalVolume, device, maxSolventPercent?, tolerance?}`. `device` is `{instrument, node?}` (its transfer or dispense limits are used; `node` names the pipette or head when it has several) or `{limits: {min?, max?, step?}}`. Each target comes back straight from the stock when that works, else through an intermediate diluted 10, 100 or 1000 fold, else unreachable with why.

## Intermediate plates

`transfers.optimize_dilution` takes every compound `{id, stock, points, wellsPerPoint?}`, the final volume, the device, the solvent limit, the tolerance (±5% by default) and the intermediate plate type (`lwt_…`; its well count, dead volume and working volume are used). It returns per point where it comes from (the source or intermediate wells `I1`, `I2`…), per intermediate well what to put in it, the plates needed and any unreachable points. Run it with different tolerances, solvent limits or plate types when the first answer uses many plates, and explain the trade-off to the person.

## Source volumes

`transfers.source_volumes` `{draws: [{container, well, volume}], overage?}` sums what each source well gives, adds its labware type's dead volume and the overage, and compares with what inventory says the well holds. `short` says how much is missing. Nothing is reserved yet: transfer plans reserve stock when they come (016a-3).

## Transfer plans

A transfer plan (`TFP-0001`) is a design: plates and groups of transfers that code checks and a person confirms.

- `transfers.draft` `{label, experiment?, purpose?, plates, groups}`. Each plate is `{id, role: source | destination | intermediate, labwareType: {id, version}, container?, plateMap?: {map: {id, version}, plate}}`; transfers name plates by that `id`. Each group is `{id, label, method, instrument?: {instrument, node?}, reason, alternatives?, liquid?, liquidClass?, tips?, transfers: [{from: {plate, well}, to: {plate, well}, volume}]}`, in the order they run. Leave `instrument` out for by hand. Put why you chose the method and instrument in `reason`, and what else you considered in `alternatives`. Code copies the instrument's limits into the group.
- `transfers.set_instrument` switches a group (with `why`); `transfers.pick_sources` says which container each source plate is. Both are direct on drafts and proposed on a confirmed plan.
- `records.readiness` shows what code checks from the records: volumes against each group's instrument, wells overfilled, intermediates drawn before they are made, sources not picked, unconfirmed or newer labware and plate maps. `transfers.check` adds what is true today: instruments ready with the limits the plan used, source wells holding enough after other plans' reservations, and totals (transfers, tips estimated, source wells).
- A person confirms the plan section by section. A confirmed plan reserves what it draws from its source containers until it is archived (or, from 016b, its run is recorded). `transfers.reserved {container}` shows reservations; over-committing warns, it does not block.

## From a plate map

`transfers.draft_from_plate_map` drafts the whole plan for a plate map whose wells have concentrations (a dose-response or single-point screen): give `map`, `sourcePlates` (with labware type versions, containers if known), `sources` (per subject: the source plate, well and stock), the `solvent` well, `finalVolume`, `maxSolventPercent`, `tolerance?`, the dispensing `instrument` with `why`, and `intermediatePlate` when some points need intermediates. Code picks for each well the source or an intermediate well (the dilution optimizer), plans the intermediate wells (solvent first, then stock), and backfills every well that isn't empty to the same solvent volume. It refuses, naming them, when points can't be reached: run `transfers.optimize_dilution` with other settings and explain the trade-off. Then read `records.readiness`: when the intermediate volumes are too big for the dispenser, move those groups to another instrument with `transfers.set_instrument` (`transfers.options` ranks them). A dosing well must name both its material and target concentration, including positive and negative controls; missing either is an error naming the well, so an unbound control cannot silently receive only solvent. Neutral-control, blank and buffer wells without either remain solvent-only backfill targets. Transfers without concentration targets (such as ELISA sample additions) use `transfers.draft`. This operation covers compound dosing and solvent backfill; other assay additions remain separate.

## Deck layouts

Each group on an Opentrons Flex gets a deck layout when it is drafted or its instrument is set: the plates it uses in plan order, then enough full racks of the lab's Flex tip rack for the pipette, on the slots the Flex's configuration leaves free, front row first. Layouts live in `decks` and are their own section of the plan ("Deck layouts"), so a person looks at them and confirms them; each group's layout is reviewed on its own.

- `transfers.set_deck {id, expectedVersion, group, sites?, why}` lays a group's deck out again (leave `sites` out) or sets it (`sites: [{slot, plate} | {slot, tipRack: {id, version}}]`), checked against the free slots, the plates the group uses and the tips it takes. Direct on drafts, proposed on a confirmed plan. When code can't lay it out (no trash bin or waste chute, a tip rule of none, no confirmed Flex tip rack for the pipette, too few free slots), the plan has no layout for that group and readiness says so; fix what the refusal names.
- Readiness blocks a Flex group with no layout, a layout that doesn't fit, an unconfirmed tip rack type or an unconfirmed instrument. `transfers.check` warns when the Flex changed since (a slot taken, the trash moved).
- `transfers.loading_list {id, group?}` gives what a person does at the instrument, in order: check the pipette, empty the trash, put each plate and tip rack on its slot, with what each source well must hold (draws plus dead volume). Give it to the person before a run.

## Instrument files

`transfers.export {id, group?}` writes the files for a confirmed plan: an Echo pick list for each group on an Echo, and an Opentrons protocol for each group on an Opentrons Flex, stored as file records (hand them over as files, not pasted). A Flex protocol uses the plan's confirmed deck layout and is run in Opentrons' simulator first; the answer gives its `check` (commands, tips) and `deck` (what goes on each slot). Say it was checked in the simulator, not on the robot, and point to `transfers.loading_list` for setting up. A group with a worklist format pinned gets that CSV (see Worklist formats). Groups done by hand, or on an instrument with no worklist format pinned, come back under `skipped` with why. A draft plan is refused: a person confirms it first. A Flex group is skipped with why when the Flex changed since its deck layout was confirmed (lay it out again with `transfers.set_deck`), or a labware type has no Opentrons load name and not enough geometry for a definition. When the Echo source plate type is ambiguous, set the group's liquid class (`transfers.set_instrument`); when a plate has no Echo type, the labware type needs `echoPlateTypes`.

## Worklist formats

The Hamilton STAR and Vantage, Mantis and PreciseDrop read whatever CSV the lab's own method or software reads, so each is a worklist format record, not code.

- Ask for an example file the lab's method already reads (or exported), upload it with `files.upload`, read it, then `worklists.draft_format {label, instrumentKind, method, layout, volumeUnit, tips, example?, notes?}`. A `rows` layout is a header row and one row per transfer: give each column its header and what fills it (`row_number`, `source_`/`destination_` `name`, `barcode`, `labware` (the Hamilton labware name, else the type's name), `type`, `well`, `volume`, `volume_unit`, `liquid_class` (its platform name), `liquid`, `new_tip` with `yes`/`no`, or `constant` with `text`). Wells read as A1 unless the column says `wells: index_by_column` or `index_by_row`. A `grid` layout is one volume grid per destination plate and source well, after `preamble` lines (header, then one value), with `empty` for wells that get nothing (Mantis).
- `tips` is how the method handles tips: `none`, `new_each`, `per_source`, or `column` when the file has a new tip column the method obeys (then the group's tip rule fills it).
- With `example`, code checks the headers against the file and refuses a mismatch with where it differs. A person confirms the format with `records.confirm`.
- How the method takes tips decides the group's tip count, unless it is `column`. Readiness warns (`worklist_tips`) when a method keeps a tip after it touched liquid already in a well, or ignores the group's tip rule.
- The demo lab has the mock formats from the seed (STAR ELISA samples, Vantage medium addition, Mantis dispense grid, PreciseDrop dispense list), marked assumed until the lab's real files replace them.
- Pin it on a group with `transfers.set_instrument {…, worklist: {id, version}}` (switching instrument drops it unless given again). Readiness blocks a format that isn't confirmed or is for another instrument kind (`worklists_fit`).

## Echo reports

Upload the Echo transfer report or survey with `files.upload`, then `transfers.import_report {id, file, containers?}`. A transfer report returns counts (done, short, failed, not in the report, not in the plan), each problem in lab words, and records what really moved in the inventory; each report is read once. It also records the execution (`execution`, a TRN record listing every transfer that was short, failed or not run, and what is rerun for it), ends the plan's reservations, and, when anything didn't go as planned, drafts a rerun plan (`rerun`) of the same design with only those transfers: failed and missing ones whole, short ones topped up in whole droplets. The rerun waits for the person to confirm; tell them its name and how many transfers it redoes, and which were not rerun and why. When a plate has no container (the assay plate made on the day), nothing is recorded and a note says so: give `containers: [{plate, container}]` and import again. A survey only compares: correct volumes with `inventory.correct` if the survey is right. Tell the person which wells failed or came up short; they may need to be excluded in analysis. Each import also reports to lab memory: Echo transfers that keep failing or coming up short for one instrument, plate type and liquid class, and surveys that keep measuring less than the inventory, become proposed memories after 3 reports on 2 days, and reports where they didn't happen count as quiet evidence.
