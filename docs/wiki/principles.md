# Principles and working rules

The rules every plan and every PR follows. The authoritative list is [AGENTS.md](../../AGENTS.md); this page adds the reasons and the working habits that grew around them.

## What the project is

An AI-driven lab management system for wet and dry labs: registries (labware, instruments, reagents, inventory), SOPs, experiment and plate-map design, transfers, workflows, scheduling on digital twins, analysis and a lab notebook. It starts as Wali's personal project, runs on Wali's Windows laptop, and is meant to be adopted later by the academic lab Wali works in (an internal Docker cluster). No GxP or 21 CFR Part 11 requirements. Real instruments will be driven later through the Hamilton Python SDK, Opentrons and a hand-off to Cellario ([plan 000, section 3.1](../plans/000-foundation-architecture.md)).

## Product rules

| # | Rule | What it means in practice |
| --- | --- | --- |
| 1 | **Greenfield** | One current contract and one execution path. No legacy readers, converters, compatibility aliases or fallbacks. Unsupported input is refused with a clear message. |
| 2 | **Human = agent** | Every capability is an operation in the registry, reachable through REST and MCP, with a skill that explains it. The UI changes data only by calling operations, and a lint rule enforces it. No UI-only features. |
| 3 | **Agent drafts, person confirms** | Designs are schema'd documents. Agents fill them in, the UI shows a readiness panel (done, missing, assumed), a person adjusts and confirms. Downstream work uses confirmed versions only. See [Agents, drafts and review](agents-and-review.md). |
| 4 | **Kind, Instance, State** | Kept separate in every registry: labware type, barcoded plate, its well contents. See [Data model](data-model.md). |
| 5 | **Units and IDs** | Every quantity carries a unit, as an exact decimal. Every ID is prefixed and typed. No free-text `options` blobs for parameters that matter. |
| 6 | **Mark what is assumed** | Agent-filled values, estimates and unknowns are labeled in data and in the UI. An unknown stays unknown; nothing is filled with a silent guess. |
| 7 | **Constraints come from the science** | Handling rules (time out of the incubator, temperature, light, stability) live on entity kinds and products, flow into containers through inventory, and bind the scheduler. Every constraint shows its source. |
| 8 | **Lab memory is reviewed** | Agents may propose memories (conventions, quirks, lessons); a person confirms. Derived memories link to their evidence. |
| 9 | **Plain lab language in the UI** | IDs, schema names and internals go under expandable technical details. |
| 10 | **Simulation and hardware share one interface** | Twins and the device gateway implement the same capability contracts. Never claim physical accuracy or hardware behavior that hasn't been validated. This is why we store full parameters only where we can check them (Opentrons) and only names for Venus and Echo (decisions L6, R5). |

## Engineering rules

- **Schemas first**, in `packages/schema` (Zod 4). JSON Schema and migrations are generated with `pnpm generate`; CI fails on stale files.
- **Operations** are the only way to change data: contract in `packages/schema/src/operations`, implementation in `apps/api/src/operations`. Every operation has tests for valid input, invalid input and permission.
- **Records go through the record service**, never raw inserts. It enforces versions, history, links and names.
- **A registry is a record kind first** ([ADR 0023](../decisions/0023-labware-types.md)). Drafting, editing, finding and confirming go through `records.*` with the kind's sections and checks; a module adds operations only for what records can't express (imports, exports, computed views). One attribute per source, so evidence stays accurate.
- **Pure domain logic** (units, volume math, plate geometry, expressions, liquid-class resolution, mixing) lives in `packages/domain` with unit tests and no I/O.
- **Agents take numbers from calculators** ([ADR 0024](../decisions/0024-lab-calculators.md)). Volumes, concentrations, dilutions, droplet counts, feasibility and totals come from calculator operations backed by `packages/domain`, never from the model's own arithmetic. Where no calculator exists yet, the agent marks its figure assumed and the gap becomes a calculator in the next plan step.
- **Each module owns its tables.** Other modules go through operations.
- **Every record carries `org_id` and `lab_id`.**
- **Tests use PGlite**, so `pnpm test` needs no Docker.
- **Seed data lives in `seed/`**, so every agent and developer works against the same Demo Lab.
- **Cross-platform.** Development happens on Windows too: no bash-only npm scripts, LF line endings.
- **Small PRs, one plan step each, CI green before review.**

## How work is organized

- **Small numbered plans.** Each module is planned on its own in `docs/plans/NNN-name.md`, not as one giant plan. A plan lists its decisions up front; nothing is built until they are chosen.
- **Question rounds.** Wali wants to be grilled on each plan: rounds of about six consequential questions, each with full options, a recommendation and the reason. Answers are recorded in the plan (as "Round N answers") and later as ADRs. Routine implementation choices are not asked; they are listed under "Defaults I'm assuming" so Wali can object.
- **Defaults while building.** Choices made during a build are listed in the plan ("defaults chosen while building") and can be changed after Wali tries them. Several features changed this way after first use (the `stated` evidence source, approval confirming sections, one Review page).
- **ADRs.** Every design decision gets an ADR in `docs/decisions/` from `0000-template.md`.
- **Living docs.** One doc per module in `docs/architecture/`, updated in the same PR as the code.
- **No ticket files in the tree.** Handoff, verification and review notes belong in PR descriptions.
- **Wali merges PRs.** Agents open them, drive CI green, and hand them over.
- **Builders are Wali plus agents.** Skills and docs in the repo carry the conventions, because agents are the main developers.

## Things never committed

- `.env` files, API keys or tokens (the in-app assistant's keys live in the repo-root `.env`, ADR 0020).
- The three Promega manuals (All Rights Reserved). They stay on Wali's laptop and load into the library from there (plan 011).
- Anything with a non-commercial or All Rights Reserved license into `seed/` or an export. The Assay Guidance Manual chapter in `docs/sop-library` is CC BY-NC-SA and must come out if the repo ever goes public.
- Real serial numbers, rooms or people. The seed uses the fictional Demo Lab.
