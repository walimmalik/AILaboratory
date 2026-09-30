---
name: ailab-transfers
description: Plan liquid transfers in AILaboratory through its MCP tools - pick the instrument for a volume, check whether dilution targets are reachable, run the dilution optimizer for intermediate plates, and work out what source wells must hold. Use it before drafting any transfer or dilution.
---

# Transfers in AILaboratory

Code works out every volume, droplet count, concentration and total; you pick the instrument and the route and say why (plan 016, ADR 0024). These are read operations: call them freely, compare runs with different settings, and quote their numbers. Never work a volume out yourself. See docs/architecture/transfers.md.

## Which instrument

`transfers.options` `{volume, liquid?, wells?}` ranks every instrument in the lab whose transfer or dispense limits are recorded: those that can move the volume first, then those with a verified liquid class for `liquid` (a liquid type ID), then the smallest error, then no tips. Each option says the volume it really moves (whole droplets on an Echo), its error and how it uses tips. Tips are estimated from the device until methods declare them: say so. Devices without recorded volume limits are listed under `unknown`; `notes` says which instruments are down or skip the plate format.

## Can the targets be reached

`transfers.dilution_options` `{stock, targets, finalVolume, device, maxSolventPercent?, tolerance?}`. `device` is `{instrument, node?}` (its transfer or dispense limits are used; `node` names the pipette or head when it has several) or `{limits: {min?, max?, step?}}`. Each target comes back straight from the stock when that works, else through an intermediate diluted 10, 100 or 1000 fold, else unreachable with why.

## Intermediate plates

`transfers.optimize_dilution` takes every compound `{id, stock, points, wellsPerPoint?}`, the final volume, the device, the solvent limit, the tolerance (±5% by default) and the intermediate plate type (`lwt_…`; its well count, dead volume and working volume are used). It returns per point where it comes from (the source or intermediate wells `I1`, `I2`…), per intermediate well what to put in it, the plates needed and any unreachable points. Run it with different tolerances, solvent limits or plate types when the first answer uses many plates, and explain the trade-off to the person.

## Source volumes

`transfers.source_volumes` `{draws: [{container, well, volume}], overage?}` sums what each source well gives, adds its labware type's dead volume and the overage, and compares with what inventory says the well holds. `short` says how much is missing. Nothing is reserved yet: transfer plans reserve stock when they come (016a-3).
