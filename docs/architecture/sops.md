# Digital SOPs

Plan: [012](../plans/012-digital-sops.md). A lab SOP as a structured, versioned design document the app and agents compute with. Built so far: the expression language and its calculator (012a, [ADR 0036](../decisions/0036-sop-expressions.md)).

## Where things live

| Concern | Code |
| --- | --- |
| Expression language: parsing, units, evaluation, sets of variables | `packages/domain/src/expressions.ts` |
| Operation contracts | `packages/schema/src/operations/sops.ts` |
| Operations | `apps/api/src/sops/operations.ts` |
| Agent skill | `skills/sops/SKILL.md`, and a row in `skills/calculators/SKILL.md` |

## Formulas (012a, ADR 0036)

A formula reads named variables and numbers with units: `n_samples * replicates * well_volume + dead_volume`, `roundup(total * 1.1, 0.5 mL)`, `final_conc * final_volume / stock_conc`. Units are checked (a volume plus a time is refused), arithmetic is exact, and `+`/`-` convert to the left side's unit. Functions: `ceil`, `floor`, `round`, `roundup(x, step)`, `rounddown(x, step)`, `min`, `max`, `sum`, `count`.

`sops.evaluate` takes a set of variables, each with a value (a decimal string, a quantity or a list) or a formula, and an optional unit for a formula's result. It evaluates them in dependency order and returns each value, or why it has none: an error, the variables it waits for, or the circle it is in.

| Operation | Does | Agents |
| --- | --- | --- |
| `sops.evaluate` | Works out formulas over named values (calculator) | read |

## Not yet

The SOP record (sections, steps, roles, variables), the loader for `seed/sops/own/` (012a); binding roles and reading values from records (012b); the digitizer and review loop (012c); the SOP page (012d).
