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

## Not yet

Chained intermediates (an intermediate made from another) for points below 1000-fold. The calculator operations and the transfer plan record (016a-3, 016a-4), worklists and reports (016b, 016c), screens (016d).
