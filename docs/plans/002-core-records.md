# 002: Core records

- Status: in review (T1 to T6 accepted 2026-09-29 as recommended; ADRs 0009 to 0014)
- Depends on: 001
- Round 2 answers (Wali, 2026-09-29): full history for everything; archive only, real deletes limited to drafts; readable IDs with a prefix and counter per kind; units include cells/mL, OD600, %v/v, U/mL, CFU and ng/µL; record agent attribution now, roles later.

## Goal

The shared foundation every registry and design document sits on: what a record is, how it is identified and named, how its history is kept, how it links to other records, how quantities carry units, and who did what. No lab features yet. At the end of this plan, a test "widget" kind can be created, edited, linked, archived and restored, and its full history can be read back.

## What a record is

Every record, whether it is a labware type, a plate, a plasmid, an SOP or a plate map, has the same envelope:

| Field | Meaning | Example |
| --- | --- | --- |
| `id` | Internal ID: type prefix plus a ULID. Never shown to people by default. | `lw_01J9Z3K8Q4…` |
| `kind` | What sort of record this is | `labware` |
| `name` | Readable ID: the kind's prefix plus a per-lab counter. Unique in the lab, never reused, even after archiving. | `PLT-000345`, `PLS-0012` |
| `label` | Free display name | "Assay plate for ELISA run 3" |
| `org_id`, `lab_id` | Tenancy (ADR 0006) | |
| `status` | `draft`, `active`, `archived` | |
| `version` | Increases by one on every change | 7 |
| `created_at/by`, `updated_at/by` | Time (UTC) and actor | |
| `attributes` | The kind-specific fields, validated against that kind's schema | |

## Your answers, turned into rules

1. **Full history.** Every change writes a new version with the full record as it was and the actor, operation and reason. Any past version can be viewed, compared with another version, or restored. A restore creates a new version, so history is never rewritten.
2. **Archive, don't delete.** Active records can only be archived, which hides them from pickers but keeps every link working. Archived records can be unarchived. Real deletion is allowed only for drafts that nothing links to.
3. **Readable IDs.** Each kind declares a prefix (PLT, PLS, SMP, SOP…), and counters run per lab. Changing a prefix later affects new records only.
4. **Units.** A `Quantity` is `{value, unit}` everywhere. The unit registry covers volume, mass, amount (mol), molar concentration, mass concentration (including ng/µL), time, temperature, cell density (cells/mL), optical density (OD with a wavelength, e.g. OD600), percent (%v/v, %w/v, %w/w), enzyme activity (U, U/mL) and colony counts (CFU, CFU/mL). Conversions only happen within a dimension. Converting mass concentration to molar concentration requires a molecular weight, which comes from the record.
5. **Actors.** Every change records an actor: a person, or an agent acting on behalf of a person ("Claude on behalf of Wali", including which session or tool). Roles and permissions come later; the actor shape leaves room for them.

## Decisions to choose (T1 to T6)

Recommended option in bold. These are more technical than the last round, so "go" is a fine answer.

| # | Decision | Options | Recommendation and why |
| --- | --- | --- | --- |
| T1 | How history is stored | A) Current-state tables plus an append-only table of full version snapshots · B) Full event sourcing (state rebuilt from events) | **A.** It gives full history and restore without the complexity of rebuilding state from events. The snapshot table also feeds the lab notebook timeline. |
| T2 | Number precision for quantities | A) Exact decimals (Postgres `numeric`, a decimal library in TypeScript and Python) · B) Floating point | **A.** Volume tracking subtracts small amounts many times, and floating point drifts (0.1 + 0.2 is not 0.3). Labs notice when 50 µL minus 10 dispenses of 5 µL isn't 0. |
| T3 | Schema library (the single source for types, JSON Schema, MCP tool schemas and Python models) | A) Zod 4 · B) TypeBox · C) Hand-written JSON Schema, as echo650-twin does | **A.** It has native JSON Schema export, works directly with Hono and MCP SDKs, and agents know it well. |
| T4 | Database toolkit | A) Drizzle (schema in TypeScript, generated SQL migrations) · B) Kysely (typed query builder, hand-written migrations) · C) Raw SQL | **A.** Typed queries and reviewable SQL migration files with the least boilerplate. |
| T5 | Readable ID format | A) `PREFIX-` plus a zero-padded counter (`PLT-000345`), per lab and kind · B) Include the year (`PLT-26-0345`) · C) Free-form names only | **A.** Short, sortable, barcode-friendly. The barcode format itself is decided in plan 010. |
| T6 | How links between records are tracked | A) A links table (from, to, relation) maintained by operations, so "where is this used" is one query · B) References only inside each record's attributes | **A.** Deep linking in both directions is central: which SOPs use this labware type, which plates hold this lot. |

## Delivered

- `packages/schema`: the record envelope, `Quantity`, the actor type and the ID and name formats, all as Zod schemas with JSON Schema export.
- `packages/domain`: the unit registry and conversions (exact decimals), ID and name generation, with unit tests covering every unit family above.
- `apps/api`: database connection, migrations, and tables for records, versions, links, counters and events. There's a record service (create, update, archive, unarchive, restore version, delete draft, list history, list links) exercised by a test-only `widget` kind.
- An actor on every write, with local single-user authentication (Wali) and agent tokens that act on behalf of a user.
- `docs/architecture/core-records.md`, plus ADRs for T1 to T6.

## Not in this plan

The operation registry, REST and MCP exposure (plan 003). No UI (plan 004). No real lab kinds (plan 007 onward).

## Done when

- Tests show: create, edit, archive, unarchive, restore and draft deletion work; deleting an active or linked record is refused with a clear message; every version is readable with its actor; readable IDs are never reused.
- Unit tests cover conversions within every family, refuse conversions across dimensions, and show that decimal volume math is exact.
- Migrations run from empty in CI against the compose Postgres.
