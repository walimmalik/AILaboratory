# 0036: A small expression language for SOP variables, with units and exact decimals

- Status: accepted
- Date: 2026-09-30
- Plan: 012 (G3, G5)

## Context

Digital SOPs compute values from other values: diluent volume from the number of samples, replicates, well volume and dead volume; a stock volume from two concentrations. Plan 012 G3 chose our own spreadsheet-like language over mathjs (floating point), code snippets (can't be checked or explained) and agent recomputation. Units and exact decimals are rules already (002 T2, ADR 0010), and numbers agents rely on come from calculators (ADR 0024).

## Options

1. Our own grammar in `packages/domain`, evaluated over the unit registry with exact decimals, exposed as a calculator.
2. mathjs with its unit system.
3. JavaScript or Python snippets.

## Decision

Option 1, as chosen in G3.

- **Grammar.** Numbers, numbers with a unit (`50 uL`, `50 µL`, `1.5 mg/mL`, `37 °C`, `0.5 OD600`), variable names (letters, digits and `_`, dotted for values read from records such as `plate.dead_volume`), `+ - * /`, unary minus, parentheses and function calls. A unit after a number is the longest unit code or symbol that ends at a word boundary, so `2 minutes` is an error naming "minutes" as not a unit.
- **Units.** Each value carries exponents of the unit registry's dimensions. `+` and `-` need equal dimensions; `*` and `/` combine them, so `final_conc * final_volume / stock_conc` is a volume and a concentration over a concentration is a plain number. A result must be a plain number or a single dimension; it keeps the unit of the value it came from, or the unit asked for, or the dimension's base unit. Offset units (°C) can be read, compared and passed through min and max, never added or multiplied.
- **Functions.** `ceil`, `floor`, `round` on plain numbers; `roundup(x, step)` and `rounddown(x, step)` to a multiple of a step of the same kind; `min`, `max`, `sum`, `count`, with lists spread into them.
- **Sets of variables.** `evaluateVariables` evaluates given values and formulas in dependency order, in any written order; a formula reading a variable with no value says what it waits for; a cycle is named (`a → b → a`); the rest still evaluate.
- **Calculator.** `sops.evaluate` (a read, `calculator: true`) takes variables with values or formulas and returns each result or why there is none. Errors are plain sentences, with the position for syntax errors.

## Consequences

- SOP variables (012a), binding to records (012b) and the digitizer (012c) all evaluate through one function; the web app shows the same results through the same operation.
- Products of different kinds that don't reduce (a mass concentration times a volume) are refused rather than guessed; conversions between mass and molar go through `massToMolar` calculators.
- No comparison or conditional operators yet; a formula that needs "if" waits for a case that needs it.
