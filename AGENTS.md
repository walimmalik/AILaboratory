# AILaboratory working agreements

AILaboratory is an AI-driven lab management system for wet and dry labs: registries (labware, instruments, reagents, inventory), SOPs, experiment and plate-map design, transfers, workflows, scheduling on digital twins, analysis and a lab notebook. Agents can do everything a person can. The architecture and the plan sequence are in [docs/plans/000-foundation-architecture.md](docs/plans/000-foundation-architecture.md); read it before starting any plan.

## How work is organized

- Work happens in small numbered plans (`docs/plans/NNN-name.md`). Each plan lists its design decisions up front; the owner (Wali) chooses them before implementation starts. Do not start a plan whose decisions are open.
- Every design decision is recorded as an ADR in `docs/decisions/` (use `0000-template.md`).
- One living doc per module in `docs/architecture/`, updated in the same PR as the code it describes.
- No per-ticket handoff, verification or review files in the tree. That history belongs in PR descriptions.
- Ask about consequential choices; don't ask about routine implementation details.

## Product rules

1. **Greenfield.** One current contract and one execution path. No legacy readers, converters, compatibility aliases or fallback paths. Reject unsupported input with a clear message.
2. **Human = agent.** Every capability is an operation in the operation registry, exposed through REST and MCP, with a skill that explains it. The UI changes data only by calling operations. No UI-only features.
3. **Agent drafts, person confirms.** Designs (experiment designs, plate maps, transfer plans, digital SOPs, workflows, schedules, analyses) are schema'd documents. Agents fill them in; the UI renders them with a readiness panel (what's done, what's missing, what was assumed); a person adjusts and confirms. Downstream work uses confirmed versions only.
4. **Kind, Instance, State** stay separate in every registry (e.g. labware type, barcoded plate, its well contents).
5. **Units and IDs.** Every quantity carries a unit. Every ID is prefixed and typed (`lw_`, `ins_`, `smp_`…). No free-text `options` blobs for parameters that matter.
6. **Mark what is assumed.** Agent-filled values, estimates and unknowns are labeled as such in data and in the UI.
7. **Constraints come from the science.** Handling rules (time out of incubator, temperature, light, stability) live on entity kinds and products, flow into containers through inventory, and bind the scheduler. Every constraint shows its source.
8. **Lab memory is reviewed.** Agents may propose lab memories (conventions, quirks, lessons); a person confirms them. Derived memories link to their evidence.
9. **Plain lab language in the UI.** IDs, schema names and internals go in expandable technical details.
10. **Simulation and hardware share one interface.** Digital twins and the device gateway implement the same capability contracts. Never claim physical accuracy or hardware behavior that hasn't been validated.

## Engineering rules

- Schemas change first (in `packages/schema`, from plan 002); code is generated from them, and CI fails on stale generated code.
- Pure domain logic (units, volume math, plate geometry, variable evaluation) lives in `packages/domain` with unit tests, no I/O.
- Each module owns its tables. Other modules go through operations.
- Every operation has tests for valid input, invalid input and permission.
- Every record carries `org_id` and `lab_id`.
- Small PRs, one plan step each. CI green before review.
- Seed data lives in `seed/` (from plan 006) so every agent and developer works against the same realistic lab.

## Layout

```
apps/api       TypeScript API (Hono): operations, REST, MCP, event log
apps/web       React + Vite UI
apps/science   Python service (FastAPI): statistics, curve fits, chemistry, sequences
packages/      shared TypeScript packages (see packages/README.md)
docs/          architecture, decisions (ADRs), plans
compose.yaml   local stack: Postgres (pgvector), api, science, web
```

## Commands

Run from the repo root unless noted.

| Task | Command |
| --- | --- |
| Install | `pnpm install` and `cd apps/science && uv sync` |
| Database only | `docker compose up db` |
| Dev servers (api :3001, web :5173) | `pnpm dev` |
| Science service (:8001) | `cd apps/science && uv run uvicorn science.main:app --reload --port 8001` |
| Full stack in containers (web on :8080) | `docker compose up --build` |
| All TypeScript checks | `pnpm check` (lint, typecheck, test) |
| Format | `pnpm format` |
| Python checks | `cd apps/science && uv run ruff check . && uv run ruff format --check . && uv run pytest` |

Development happens on Windows as well as Linux: keep scripts cross-platform (no bash-only npm scripts) and keep line endings LF (`.gitattributes`).
