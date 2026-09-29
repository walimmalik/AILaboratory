# Architecture

A modular monolith: one TypeScript API with clear module boundaries, a Python service for science, a React app, and Postgres. Full picture in [plan 000, section 2](../plans/000-foundation-architecture.md); module docs in [docs/architecture](../architecture).

## Services

| Service | Stack | Role |
| --- | --- | --- |
| `apps/api` | TypeScript, Hono, Drizzle | Operation registry, REST, MCP, auth, record service, activity ledger, in-app assistant |
| `apps/web` | React, Vite, TanStack Router and Query, Radix primitives, own CSS tokens | The UI; talks to the API only through `@ailab/client` |
| `apps/science` | Python, FastAPI, uv | Computation only, owns no records: statistics and curve fits, RDKit, Biopython, Docling document conversion, local embeddings |
| `apps/gateway` (plan 022) | Python | Runs next to instruments; implements the same capability contracts as the twins |
| Postgres | `pgvector/pgvector:pg17` | The one database: relational tables for identity and links, JSONB attributes validated per kind, full-text search plus pgvector |

## Packages

| Package | Holds |
| --- | --- |
| `packages/schema` | The single source: record envelope, quantities, actors, kinds, operation contracts, all in Zod 4; JSON Schema generated into `generated/` |
| `packages/domain` | Pure logic with unit tests and no I/O: units and exact decimal math, IDs and names, readiness, labware geometry (well names, computed wells, SBS rules, liquid height for flat wells), Opentrons import and export; later liquid-class resolution, mixing math, plate-map placement, transfer solving, the SOP expression language |
| `packages/client` | The typed API client used by the web app and tests |
| `packages/twin` | Ported from echo650-twin in plan 015 |
| `packages/scheduler` | Plan 019: echo650-twin's dispatch and exposure kernel, adapted, plus people, calendars, carries and stress cases |

## The operation registry

An operation's public half is a contract in `packages/schema/src/operations` (ID, summary, read or write, Zod input and output). `apps/api/src/operations` implements it with a `run` function and, for writes, an agent policy. `execute` validates input, refuses agents on people-only operations, previews or proposes as the policy says, runs writes in one transaction, logs them, and checks output before it leaves the server. Details: [operations.md](../architecture/operations.md).

| Door | How |
| --- | --- |
| REST | `POST /v1/ops/{operationId}` (optional `?preview=true`), `GET /v1/operations`, `GET /v1/openapi.json` |
| MCP | `POST /mcp`, Streamable HTTP, stateless; tools `describe_operations` and `run_operation` |
| Live streams | `GET /v1/activity/stream` (ledger), `GET /v1/assistant/conversations/{id}/stream` |
| Web app | `@ailab/client` with the session cookie |

Adding a capability: a contract, an implementation registered in `createRegistry`, tests for valid input, invalid input and permission, and a line in the module's skill. A new registry is first a record kind with sections and checks (ADR 0023); a calculation is a calculator operation with a line in the calculators skill (ADR 0024).

## Modules built so far

| Module | Doc |
| --- | --- |
| Core records, draft and confirm | [core-records.md](../architecture/core-records.md) |
| Operations, REST, MCP, proposals, ledger | [operations.md](../architecture/operations.md) |
| Web app | [web-app.md](../architecture/web-app.md) |
| In-app assistant | [assistant.md](../architecture/assistant.md) |
| Labware types and vendors, Opentrons import and export, seed loader | [labware.md](../architecture/labware.md) |

`pnpm --filter @ailab/api seed` loads the seed lab through the operations as the agent "Seed loader", as drafts to review (labware so far). Verified values carry datasheet evidence with the source URL, estimated values are assumed, and unknown values are left out so readiness lists them. It is safe to run again.

## The in-app assistant

Our own tool loop in `apps/api/src/assistant/` with adapters for `openrouter`, `anthropic` and `openai-compatible` (for example Ollama), chosen in `.env` with `AGENT_PROVIDER`. Wali runs it on an OpenRouter key; Claude replies are stored and sent back unchanged. Each ask is an operation; the loop runs in the background up to 16 steps and 180 s per model call, and conversations are saved and linked from the ledger. Details: [assistant.md](../architecture/assistant.md).

## Auth and tenancy

Email and password sign-in with an HttpOnly session cookie for the web app; hashed bearer tokens for agents and scripts, issued with `pnpm --filter @ailab/api token --agent "<name>"`. Every call runs in a context of actor, org and lab. SSO can replace the password step later.

## Where it runs

Local Docker Compose now (`docker compose up --build`: web on :8080), dev servers with `pnpm dev` (API :3001, web :5173), science on :8001. Wali's laptop (Windows) is the running copy. An internal lab Docker cluster comes later; the live streams will then need Postgres `LISTEN/NOTIFY` across replicas.

## Carried over from echo650-twin

Wali's earlier app (walimmalik/echo650-twin) is the reference for instruments, twins and scheduling. Taken so far: the instrument type, instance and capability model; the configuration graph with mounts, sites and resolver (plan 008); operation-first runbooks, bound to instruments late; readiness checks with a corrective action; one command interface for UI and scripts, generalized into the operation registry; the no-shim rule and verified, estimated or unknown labels; the reviewed labware catalog with field-level provenance (plan 007); the exposure kernel for the scheduler (plan 019).
