# Core records

Every registry and design document is stored as a **record**. This module defines what a record is and how it changes. Decisions: ADRs 0009 to 0014 and 0021. Plans: [002](../plans/002-core-records.md), [004c](../plans/004-agent-shell.md) (draft and confirm).

## Where things live

| Concern | Code |
| --- | --- |
| Record envelope, `Quantity`, `Actor`, ID and name formats, kind definitions | `packages/schema/src` |
| Published JSON Schema (generated, do not edit) | `packages/schema/generated` (`pnpm generate`) |
| Units, conversions, exact decimal arithmetic, ID and name generation, readiness | `packages/domain/src` |
| Tables | `apps/api/src/db/schema.ts`; migrations in `apps/api/drizzle` (`pnpm generate`) |
| Record service | `apps/api/src/records/service.ts` |
| Tokens, actors, tenants | `apps/api/src/auth.ts` |

## Kinds

A kind is declared once with `defineKind` and registered in a `KindRegistry`:

```ts
const labwareType = defineKind({
  kind: 'labware_type',
  idPrefix: 'lwt',          // internal IDs: lwt_01J9…
  namePrefix: 'LWT',        // readable names: LWT-0001
  nameWidth: 4,
  attributes: z.object({ ... }),
  links: (a) => [{ toId: a.manufacturer, relation: 'made_by' }],
});
```

ID and name prefixes are unique across kinds. A kind that people review may also declare `sections` and `checks`; see "Draft and confirm" below. `links` reads references out of the attributes; the service keeps `record_links` in sync on every write.

## Rules the service enforces

- **Tenancy.** Every call runs in a `RecordContext` (actor, org, lab). Records in another lab are "not found".
- **Optimistic concurrency.** Every change passes the `expectedVersion` it last saw. A stale version is refused with `version_conflict` and the current version, so an agent and a person can't overwrite each other.
- **History.** Every change increments `version` and appends the full record, actor, operation and reason to `record_versions`. `restore` writes a new version from an earlier one.
- **Lifecycle.** `draft → active → archived`. Archived records can't be edited, only unarchived (back to their earlier status). Only drafts with no inbound links can be deleted, and their history goes with them.
- **Links.** New links must point to an existing, non-archived record in the same lab, and not to the record itself. Existing links survive their target being archived.
- **Names.** `PREFIX-000123`, counted per lab and prefix, never reused.

Errors are `RecordError` with a `code` (`not_found`, `unknown_kind`, `invalid_attributes`, `invalid_input`, `invalid_state`, `version_conflict`, `invalid_link`, `linked`, `not_ready`) and a message written for a person or an agent to act on.

## Draft and confirm

Agents draft, people confirm (ADR 0021). Every record carries:

- `evidence`: where each attribute's current value came from (`assumed`, `person`, `datasheet`, `imported`, `measured`, `calculated`), who set it and when, with an optional note and reference. When a value changes, the service replaces its evidence: what the caller named, else `assumed` for an agent and `person` for a person. Nobody can name `person`.
- `reviews`: for kinds with `sections`, which person confirmed each section, when, at which version, and the values they saw.

```ts
sections: [
  { id: 'geometry', title: 'Geometry', fields: ['rows', 'columns', 'wellSpacing'] },
],
checks: [
  { id: 'fits_sbs', label: 'Footprint fits an SBS position', severity: 'blocker',
    source: 'ANSI/SLAS 1-2004', section: 'geometry', fix: 'Check the outer dimensions',
    test: (a) => ... || 'Footprint is 130 mm long; SBS is 127.76 mm' },
],
```

Nothing about confirmation is stored beyond the review: `readiness()` in `@ailab/domain` compares each field with its section's confirmed values. Equal is confirmed, different is changed (the confirmed value is reported beside the new one), no review is unconfirmed. A value is assumed while its evidence says so and it is not confirmed. `records.readiness` returns sections, fields, check results, `missing` (in plain words) and `ready`. `records.confirm_section` is for people only. For kinds with sections, `records.activate` is the final confirm and is refused with `not_ready` until every section is confirmed and no blocker fails. A person may create such a record active, which confirms every section as written; an agent may not.

## Units

`Quantity` is `{ value: "12.5", unit: "uL" }`. Values are decimal strings (ADR 0010); unit codes are ASCII, with display symbols (`uL` shows as µL). Families: volume, mass, amount, molar concentration, mass concentration (including ng/µL), molar mass (g/mol, Da, kDa), time, temperature (K, °C), cells and cell density, optical density per wavelength (`OD600`), %v/v, %w/v, %w/w, enzyme activity and activity concentration (U, U/mL), CFU and CFU density. Conversion only happens within a family. `massToMolar` and `molarToMass` need a molar mass. Temperatures can be converted but not added.

## Actors and tokens

Changes are made by a person (`{type: 'user'}`) or an agent on behalf of a person (`{type: 'agent', agentName, onBehalfOf}`). API tokens are stored hashed; a token issued with an agent name acts as that agent. `pnpm --filter @ailab/api bootstrap` creates the org, lab and first user on an empty database and prints a token once.
