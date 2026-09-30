# Transfers

Plan [016](../plans/016-transfer-designer.md): how the liquid gets there. Code works out every volume, concentration and total; the agent picks the method and instrument per group of transfers and says why (T1, T2).

## Transfer math (016a-1)

`packages/domain/src/transfers.ts` is pure and exact (decimal arithmetic, units carried):

- **Fitting a volume to a device.** `fitVolume` rounds to whole steps (an Echo's 2.5 nL droplet, half to even), checks the device's minimum and maximum, and gives the relative error. A volume below one step, the minimum or above the maximum is refused with the reason.
- **Straight from the stock.** `directDispense`: volume = target ÷ stock × final volume, fitted to the device, with the concentration the well really gets, its error and the solvent it brings (the stock is taken as all solvent, e.g. DMSO). Problems: a target above the stock, a volume the device can't move, an error over the tolerance, solvent over the limit.
- **Backfill.** `backfill` tops every well up to the fullest well's solvent volume, in whole steps, so every well has the same solvent.
- **Dilution options** (`transfers.dilution_options`). `dilutionOptions` tries each target straight from the stock, then through an intermediate diluted 10, 100 or 1000 fold in the same solvent, and gives the first that works. A target no route reaches is marked unreachable.
- **Source volumes** (`transfers.source_volumes`). `sourceVolumes` sums what is drawn per source and adds its dead volume on the device and an overage fraction.
- **Tips** (T5). `countTips` follows the method's tip rule: none (acoustic and non-contact), a new tip each transfer, one per source, or the lab default (one per source into dry wells, a new tip for every transfer into liquid).
- **Ranking devices** (`transfers.options`). `rankDevices` orders devices for a volume: those that can move it first, then a verified liquid class, then the smaller error, then no tips.

## Dilution optimizer (016a-1, O1)

`optimizeDilution` takes every compound with its stock and curve points (and destination wells per point), the final well volume, the dispensing device, the solvent limit, the tolerance (±5% by default, O2) and the intermediate plate type (wells, dead volume, maximum volume). For each point it dispenses straight from the source when that is within the tolerance and the solvent limit. Otherwise the point comes from an intermediate well of the same compound, diluted 10, 100 or 1000 fold in solvent.

The solvent limit, the tolerance and the intermediate plate's volumes are hard limits. Within them it picks the fewest dilutions per compound that reach every point (so one intermediate serves as many points as it can), then the smallest total error. It fills each dilution's wells with the dispenses in order, opening another well when one would drop below its dead volume, and packs the wells onto the fewest plates in row order.

It reports, per point, where it comes from (the source, or the intermediate wells `I1`, `I2`…), the droplets, the concentration the well gets, its error and its solvent. Per intermediate well it reports the concentration, what the preparation puts in (stock, then solvent up to the volume), what the dispenses draw and the dead volume. A point no route reaches is listed with why.

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
- **Readiness** (`apps/api/src/transfers/rules.ts`): it moves something; every volume fits its group's device; every well holds what goes in (working or maximum volume); intermediates are filled by an earlier group before they are drawn from; sources are picked; labware and plate maps are confirmed (blockers); newer versions exist (warning).
- **`transfers.check`** runs the same rules plus live ones: instruments ready with the limits the plan used, and each source well's draws plus its dead volume against what it holds less other plans' reservations (warnings, V8). It also totals transfers, tips (estimated from each group's rule) and source wells.
- **Reservations** (`apps/api/src/transfers/reservations.ts`) are derived, not stored: every active plan reserves what it draws from its source containers. Archiving a plan ends them; recording its run will too (016b). `transfers.reserved {container}` lists them per well.

## Not yet

Chained intermediates (an intermediate made from another) for points below 1000-fold. Drafting plans from plate maps (016a-4), worklists and reports (016b, 016c), screens (016d).
