# Transfers

Plan [016](../plans/016-transfer-designer.md): how the liquid gets there. Code works out every volume, concentration and total; the agent picks the method and instrument per group of transfers and says why (T1, T2).

## Transfer math (016a-1)

`packages/domain/src/transfers.ts` is pure and exact (decimal arithmetic, units carried):

- **Fitting a volume to a device.** `fitVolume` rounds to whole steps (an Echo's 2.5 nL droplet, half to even), checks the device's minimum and maximum, and gives the relative error. A volume below one step, the minimum or above the maximum is refused with the reason.
- **Straight from the stock.** `directDispense`: volume = target ÷ stock × final volume, fitted to the device, with the concentration the well really gets, its error and the solvent it brings (the stock is taken as all solvent, e.g. DMSO). Problems: a target above the stock, a volume the device can't move, an error over the tolerance, solvent over the limit.
- **Backfill.** `backfill` tops every well up to the fullest well's solvent volume, in whole steps, so every well has the same solvent.
- **Dilution options** (`transfers.dilution_options`). `dilutionOptions` tries each target straight from the stock, then through an intermediate diluted 10, 100 or 1000 fold in the same solvent, and gives the first that works. A target no route reaches is marked unreachable.
- **Source volumes** (`transfers.source_volumes`). `sourceVolumes` sums what is drawn per source and adds its dead volume on the device and an overage fraction.
- **Tips** (T5). `tipChanges` says, transfer by transfer, whether the rule takes a new tip: never (acoustic and non-contact), every transfer, when the source changes, or the lab default (when the source changes, and for every transfer into a well that already holds liquid, since that tip has touched it). One channel carries one tip, so a tip is reused only by the next transfer. `countTips` counts them.
- **Ranking devices** (`transfers.options`). `rankDevices` orders devices for a volume: those that can move it first, then a verified liquid class, then the smaller error, then no tips.

## Dilution optimizer (016a-1, O1)

`optimizeDilution` takes every compound with its stock and curve points (and destination wells per point), the final well volume, the dispensing device, the solvent limit, the tolerance (±5% by default, O2) and the intermediate plate type (wells, dead volume, maximum volume). For each point it dispenses straight from the source when that is within the tolerance and the solvent limit. Otherwise the point comes from an intermediate well of the same compound, diluted 10, 100 or 1000 fold in solvent.

The solvent limit, the tolerance and the intermediate plate's volumes are hard limits. Within them it picks the fewest dilutions per compound that reach every point (so one intermediate serves as many points as it can), then the smallest total error. It fills each dilution's wells with the dispenses in order, opening another well when one would drop below its dead volume, and packs the wells onto the fewest plates in row order.

It reports, per point, where it comes from (the source, or the intermediate wells `I1`, `I2`…), the droplets, the concentration the well gets, its error and its solvent. Per intermediate well it reports the concentration, what the preparation puts in (stock, then solvent up to the volume; the stock is whole steps of the dispensing device, rounded up, and the well grows to keep the factor exact, so each well keeps one factor × step of room for it), what the dispenses draw and the dead volume. A point no route reaches is listed with why.

## Calculator operations (016a-2)

`apps/api/src/transfers/calculators.ts` exposes the math as read operations marked `calculator` (listed by `describe_operations {calculators: true}`); the transfers skill explains them.

- **The device.** `transfers.dilution_options` and `transfers.optimize_dilution` take `{instrument, node?}` or plain limits. An instrument's limits come from `instruments.resolve`: its transfer or dispense capability's volume minimum, maximum and step. An instrument with several such devices needs `node`.
- **`transfers.optimize_dilution`** reads the intermediate plate from a labware type: its grid, dead volume and working (or maximum) volume. A type missing either volume is refused.
- **`transfers.source_volumes`** takes each container's dead volume from its labware type (a note says when there is none) and what each well holds from `inventory.wells`; it reports what is short. It takes other confirmed plans' reservations off what each well holds (`plan` leaves one plan's own out).
- **`transfers.options`** lists every instrument's transfer and dispense capabilities with volume limits and ranks them with `rankDevices`. With a liquid type it asks `liquids.resolve_class` for each device's class and whether it is verified. Tips are estimated until methods declare them: none for dispensers and droplet devices without channels, the lab default otherwise. Devices without volume limits are listed apart; instruments not ready and devices that skip the plate format are noted.

## Transfer plans (016a-3, ADR 0045)

A `transfer_plan` (`tfp_`, `TFP-0001`) has two sections a person confirms: **plates and sources** (experiment, purpose, plates) and **transfers** (groups, notes).

- **Plates** are named in the plan (`src`, `assay1`) with a role (source, destination, intermediate), a pinned labware type, and when known a container (sources are picked on the day, P5) or a plate map plate (pinned, P6).
- **Groups** run in order; each is one method on one instrument (or by hand) with the agent's reason and alternatives, an optional liquid, liquid class and tip rule, and its transfers `{from: {plate, well}, to: {plate, well}, volume}`. `transfers.draft` and `transfers.set_instrument` copy the instrument's limits into the group's `device`.
- **Refused on write:** plates or groups named twice, a container given twice or of another labware type, transfers naming a plate that doesn't exist or a well it doesn't have, drawing from a destination or filling a source, a missing record.
- **Readiness** (`apps/api/src/transfers/rules.ts`): it moves something; every volume fits its group's device and is a whole number of its steps, so what is exported, totalled and reserved is what moves; every well holds what goes in (working or maximum volume); intermediates are filled by an earlier group before they are drawn from; sources are picked; labware and plate maps are confirmed (blockers); newer versions exist (warning).
- **`transfers.check`** runs the same rules plus live ones: instruments ready with the limits the plan used, and each source well's draws plus its dead volume against what it holds less other plans' reservations (warnings, V8). It also totals transfers, tips (estimated from each group's rule) and source wells.
- **Reservations** (`apps/api/src/transfers/reservations.ts`) are derived, not stored: every active plan reserves what it draws from its source containers. Archiving a plan ends them, and so does recording an execution of it (016b-2b, ADR 0060). `transfers.reserved {container}` lists them per well.

## Drafting from a plate map (016a-4)

`transfers.draft_from_plate_map` (`apps/api/src/transfers/from-plate-map.ts`) turns a plate map's concentrations into a transfer plan. It reads the wells at the map's current version, groups each subject's wells by concentration into curve points, and runs `optimizeDilution` with the dispensing instrument's limits (wells per point is the most any point of that subject has). Unreachable points refuse the draft with why. The plan gets the source plates given, one destination plate per map plate (pinned to the map and its plate type) and the intermediate plates the optimizer packs. Groups, in order: solvent into intermediate wells, stock into them, compounds into the map plates (each dispense drawn from the intermediate wells in the optimizer's order until each has given what it planned), and backfill so every well that isn't empty ends with the same solvent volume. All groups start on the dispensing instrument; readiness shows which volumes it can't move (usually the intermediate diluent), and `transfers.set_instrument` moves that group. Wells without concentrations are not drafted here.

## Instrument files (016b-1)

`transfers.export` (`apps/api/src/transfers/export.ts`) writes the files for a confirmed plan only, group by group, and stores each in the file store with `source: {from: 'export', record, version}` so the file names the plan version it came from (the file record links to the plan as `exported_from`). Identical bytes return the file already stored. Groups done by hand and groups on instruments without a writer are returned as skipped with why.

The Echo pick list (`echo.ts`) is code because the vendor fixes it: Source Plate Name, Barcode, Type, Source Well, Transfer Volume (nL), Destination Plate Name, Barcode, Type, Destination Well, one row per transfer in plan order. A group is written as an Echo pick list when its instrument's kind is an `acoustic_dispenser`. Plate names are the plan's labels (or ids), barcodes are the container names (blank for plates not yet made). The source plate type is the group's liquid class `platformName` (`384PP_DMSO2`), which must be among the source labware's `echoPlateTypes`, or that list's only entry; the destination type is the first of its `echoPlateTypes`. Anything missing is refused with what to set. A golden-file test writes `seed/worklists/echo-pick-list-single-point.csv` byte for byte.

## Instrument reports (016b-2)

`transfers.import_report` (`reports.ts`) reads an uploaded Echo report against a confirmed plan. `readEchoReport` (`echo.ts`) finds the column block at the row naming "Source Plate Name", so the run header and footer the instrument writes around it are skipped, and tells a transfer report (Actual Volume) from a survey (Survey Fluid Volume). Report plates are matched to plan plates by barcode (the plan's container, or `containers` given for the day), then by the name the export wrote; a barcode that contradicts the plan's container is refused.

A transfer report is matched row by row, in order, to the plan's Echo transfers: each is done, short (less than planned) or failed (nothing moved); planned transfers missing from the report and rows the plan doesn't have are listed too. What really moved is written to the ledger through `inventory.transfer` with `runLog` set to the report file: a run log is evidence, so an agent records it directly (010 V7), and the ledger refuses a report already recorded (`inventory_events.run_log`, unique per lab). When a plate has no container, nothing is recorded and the note says which. A survey changes nothing: it lists wells with a status or a volume more than 10% off the inventory.

## Executions and reruns (016b-2b, ADR 0060)

Reading a transfer report also records the execution: a `transfer_run` (`TRN-0001`), made only by `transfers.import_report`, active from the start. It pins the plan version that ran, the report file and the containers the plates were on the day. It has the counts, status `complete` or `with_exceptions`, and each exception transfer by transfer (group, place in the group, wells, `short`, `failed` or `not_run`, planned and actual volume). Rows the plan doesn't have are `unplanned`, reported and never rerun. Its outcome is never edited; only the link to its rerun is added. A report is read once: a second import of the same file is refused, naming its execution.

When there are exceptions, the import drafts a rerun plan (`reruns.ts`): a transfer plan with `rerunOf: {plan, run}`, the original's experiment, purpose, plates (with the containers used on the day), groups, methods, instruments, device limits and reasons, and only the transfers to redo. Failed and not-run transfers are redone at the planned volume. A short one gets the rest, rounded to the nearest whole step of its device; if that is under one step or out of range, the execution says it is not rerun and why. An intermediate plate the rerun only draws from was made in the execution, so it is a source in the rerun. The rerun is a draft: a person confirms it like any plan, and only then does it reserve. Its own execution can have exceptions and its own rerun.

Detectors for lab memory (`memory.observe`, plan 005) are not built: lab memory comes before 017, and the report outcomes above are what they will read (repeat failures per source plate type, liquid class or well).

## Opentrons protocols (016b-3, ADR 0058)

A group on an Opentrons Flex (instrument kind model `Opentrons Flex`) is exported as a Python protocol. `apps/api/src/transfers/opentrons.ts` works out its data and the science service writes and checks it (`POST /opentrons/protocol`, `apps/science/src/science/opentrons/`):

- **Pipette:** the group's node, or the instrument's only pipette, by its equipment kind's model (Flex 1- or 8-channel, 50 or 1000 µL) and mount. An 8-channel pipette uses one nozzle.
- **Trash and tip racks:** from the deck layout. Tips follow `tipChanges` with the group's rule over the plan's order (a well filled by an earlier transfer holds liquid).
- **Deck:** the plan's confirmed deck layout for the group (016b-4), refused when the Flex changed since. Labels read as the plan's plate label and the container's barcode. Labware without an Opentrons load name is loaded from its written definition (`toOpentrons`); a type that can't be written is refused with what is missing.
- **Check:** the protocol is run in Opentrons' simulator (opentrons 10.0.0, API 2.20) in its own process. A file is stored only when it passes; the export returns the simulator's command and tip counts and the deck, slot by slot. A group that can't be written or doesn't pass is skipped with why, or refused when it is the `group` asked for.

The request and the protocol it becomes are golden files in `apps/science/tests/fixtures/`, checked from both sides. `seed/worklists/opentrons-flex-elisa-standards.py` stays the hand-written mock of what a person would write.

## Deck layouts (016b-4, ADR 0059)

A plan's `decks` hold one layout per Flex group: `{group, sites: [{slot, plate} | {slot, tipRack: {id, version}}], free, trash}`, where `free` and `trash` are what the Flex had when the layout was set, copied by code (as `device` is for limits). Layouts are the plan's third section, **Deck layouts**, reviewed per group (keyed by `group`), so a person confirms them on their own and a changed layout goes back to review alone.

- **Drafting** (`apps/api/src/transfers/decks.ts`): `flexSetup` reads the Flex as installed: the group's pipette (its node, or the only one; Opentrons pipette names by equipment kind model), the trash bin or waste chute (by equipment kind label), and the free slots (A1 to D3 less what `instruments.resolve` says the deck's equipment claims and the trash). `draftDeck` (`packages/domain`) puts the plates the group uses in plan order, then `racksFor(tips)` racks of the tip rack `tipRackFor` picks, on free slots front row first. `transfers.draft` and `transfers.set_instrument` lay out the groups they touch; when code can't (no trash, a tip rule of none, no confirmed Flex tip rack, too few slots) the group has no layout and readiness says so.
- **`transfers.set_deck`** lays a group out again or takes the sites given, refused with every problem (`deckProblems`: a slot not free or used twice, a plate placed twice, used but missing, or not used, too few tip racks; a tip rack type that isn't a Flex tip rack the pipette takes).
- **Readiness** (`decks_fit`, blocker, Deck layouts section): every Flex group has a layout, `deckProblems` finds nothing, its tip rack types are pinned tip racks (unconfirmed ones join "Labware, plate maps and worklist formats are confirmed"), and the instrument is confirmed. **`transfers.check`** adds `decks_now` (warning): slots taken or the trash moved since.
- **`transfers.loading_list`** reads the layouts as plain steps: check the pipette and mount, empty the trash, then each slot in order with the plate's label, container and type (or "an empty" type for a new destination plate), a full rack of the tip rack type, and what each source well must hold for the group (its draws plus the plate type's dead volume).

## Worklist formats (016c-1, ADR 0061)

- **`worklist_format`** (`wlf_`, WLF-0001, `packages/schema/src/worklists.ts`): the CSV a lab method reads, as typed columns (`rows`) or a volume grid with a preamble (`grid`), with its instrument kind, volume unit and tip behaviour. Sections: Instrument and method, Columns. Every write refuses what the writer can't fill (`formatProblems`).
- **Writer** (`apps/api/src/transfers/worklists.ts`): `writeWorklist(format, transfers)` returns the files; rows give one file, grids one per destination plate and source well. Golden tests against `seed/worklists/` (STAR, Vantage, Mantis, PreciseDrop).
- **`worklists.draft_format`** (direct): drafts a format, checking its headers against the example file when given. Confirmed with `records.confirm`.
- **Plans**: a group pins a format with `transfers.set_instrument {worklist}`. Readiness `worklists_fit` (blocker, Transfers section) checks it is for the group's instrument kind; unconfirmed or newer versions join `inputs_confirmed` and `inputs_current`. `transfers.export` writes it (`format: 'worklist'`); a group on an instrument with no format pinned is skipped with how to add one.
- **Tips (016c-2, T5)**: `groupTips(a, group, method)` follows a format's fixed tip handling, else the group's rule; `transfers.check` totals count tips that way. `worklist_tips` (warning): a per-source method reusing a tip that touched liquid already in a well, or a group rule the method doesn't follow (`tipClashes`).
- **Seed**: `seed/worklist-formats.yaml` (loader `transfers/seed.ts`) drafts the mock formats with their example files, evidence assumed; a format whose instrument kind isn't there yet waits.

## Not yet

Chained intermediates (an intermediate made from another) for points below 1000-fold. Intermediate plates as plate maps (the plan names their wells I1, I2… itself), `transfers.set_method`, deck layouts for other instruments (Hamilton carriers come with 016c), the 2D deck view (016d), configuration changes a layout needs proposed with their time cost (T6), liquid classes in Opentrons protocols, 96-channel and column-wise 8-channel protocols, FeliX worklists, screens (016d).
