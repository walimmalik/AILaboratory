# 0024: Lab calculators, a toolkit of deterministic tools for agents

- Status: accepted
- Date: 2026-09-29
- Plan: 016 (applies to every plan)

## Context

The designers (014, 016, 017) and the registries before them need exact numbers: volumes with dead volume, droplet counts, dilution schemes, whether an instrument can do a transfer, how many plates and tips a design takes. Language models slip on this kind of arithmetic, and a slip here ruins a plate. While planning the dilution optimizer (016), Wali asked for these deterministic tools to be a kit agents can call, so agents compute instead of guess.

## Options

1. **Calculators as read operations in the operation registry.** Each is a pure function in `packages/domain`, exposed through REST and MCP like any operation, marked as a calculator in its contract, and indexed by one skill. People reach the same calculators from the UI.
2. **A separate library or MCP server of tools outside the registry.** Quick to add, but a second path for agents only, which breaks "human = agent" and skips the registry's contracts, tests and permissions.
3. **Leave calculations to each module's own write operations.** Numbers would only appear inside drafts, and the agent couldn't ask "what if" before drafting.

## Decision

Option 1.

- **Where they live.** The math is pure and unit-tested in `packages/domain`; the operation belongs to the module whose data it reads (`transfers.optimize_dilution` in 016, `liquids.resolve_class` in 009). Its contract carries `calculator: true`, and `operations.list` can filter by it.
- **One skill.** `skills/calculators/` lists every calculator with when to use it, its inputs and an example. It is loaded for every agent, including the in-app agent, whatever else is on the page.
- **What a calculator returns.** The result, the inputs it used with their sources (which labware dead volume, which liquid class), any options ranked with the numbers that ranked them, and a plain-language explanation. It never writes anything.
- **Values that come from a calculator are marked calculated.** When an agent puts a calculator's result into a draft, the value's evidence is "calculated by `<operation>`" with its inputs, not "assumed by <agent>" (0021). A person still confirms the draft.
- **The rule for agents.** Volumes, concentrations, droplet counts, feasibility and totals come from a calculator. If none exists for a number a design needs, the agent says so and marks its own figure assumed, and the gap becomes a calculator in the next plan step.

First calculators, from the plans so far: unit conversion and mass-to-molar (002, 010), mixing and C1V1 (010), plate-to-plate mappings (010), recipe scaling (`reagents.scale_recipe`, 009), liquid class resolution (`liquids.resolve_class`, 009), dead volume lookup (007), SOP expression evaluation (012), series expansion and placement (014), `transfers.options`, `transfers.dilution_options`, `transfers.optimize_dilution`, `transfers.source_volumes`, `transfers.check` (016), design totals and factor expansion (017).

## Consequences

### 2026-10-07 clarification: deterministic planning and generation

For the scientist experiment workspace (004h), Wali explicitly includes dose-response calculations, intermediate dilution planning, optimizers, plate layouts and worklist generators in this boundary. Extend the existing pure domain library and operation registry rather than introducing a second agent-only calculation service. Deterministic serializers/generators remain in their owning implementation modules (including the existing science service where required); exporting/storing files is a write operation, not a read calculator.

The same resolved scientific inputs, ordered identities, pinned definitions, algorithm/writer versions and explicit randomization seed must reproduce the same scientific result and executable payload. Persist a chosen layout seed before preview/acceptance; deliberate re-randomization changes that input explicitly. Optimizers declare their objective, constraints, tie-breaking and actual search scope; deterministic heuristics must not claim proven global optimality. Timestamps, record IDs and receipts are separate from scientific payload reproducibility.

This tightens the earlier missing-calculator fallback for authoritative workspace results: if a required function or scientific input is missing, return an explicit unsupported/missing-input result. An agent may propose an input with its evidence/assumption label, but its own arithmetic or generated worklist text cannot substitute for a calculated design, validated plan or exported instructions. Both UI and agents use the same operation result/evidence. Detailed scope and replay acceptance are in [the workspace spec](../specs/experiment-workspace.md#71-deterministic-scientific-toolkit).

### Existing consequences

- Every plan that adds a calculation adds it as a calculator operation, with tests for valid input, invalid input and permission, and a line in the calculators skill.
- Evidence gains a "calculated" source alongside assumed, stated, imported and measured.
- The in-app agent always has the calculators in its tool list, even when the operation count grows past what it sees for records.
- Agents can explore ("what if we used the 384LDV plate?") before drafting anything, since calculators are reads.
