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
| Overviews (identity line and key facts, `records.overview`) | `apps/api/src/records/overview.ts`, one `overview.ts` per module, joined in `apps/api/src/operations/overview.ts` |
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

ID and name prefixes are unique across kinds; a kind that names records with more than one prefix lists the others in `otherNamePrefixes` (containers: `PLT`, `TUB`, `BOX`…) so they are reserved too. A kind may also declare `related` (ADR 0029): rules that read other records in the lab, run inside every write and readiness read. They see the record as it was (`current`) and who is writing (`actor`), and can read a record as it was at a version (`getVersion`), which is how designs check the versions they pin (ADR 0039, `records/pins.ts`). They return problems that refuse the write, extra readiness checks, and optionally the readable name prefix for a new record (an entity is named with its entity kind's prefix, which must not be one a code kind holds). A kind whose records only one operation may make declares `createdBy` (files: `files.upload`), and `records.create` refuses it. A kind that people review may also declare `sections` and `checks`; see "Draft and confirm" below. `links` reads references out of the attributes; the service keeps `record_links` in sync on every write.

## Overviews

`records.overview {id}` returns what a record's page shows first (plan 004f N4, ADR 0063): an `identity` line (what it is, where, its physical state) and a few `facts`, each with the attribute `field` it comes from, a link to another record when it names one, and a `tone` (`warn`, `crit`) when it needs attention. Each module writes the builders for its own kinds in its `overview.ts` and reads other modules only through their read operations (`OverviewReader.run`), so a container's overview asks inventory for its wells and place, and a lot's asks inventory where it is. Nothing is stored; the overview is worked out on every read. Kinds without a builder use `fallbackOverview` (the kind, its one-line summary and its simple top-level values); `FALLBACK_KINDS` in `operations/overview.ts` lists them and a test fails when a new kind is in neither list.

## Rules the service enforces

- **Tenancy.** Every call runs in a `RecordContext` (actor, org, lab). Records in another lab are "not found".
- **Optimistic concurrency.** Every change passes the `expectedVersion` it last saw. A stale version is refused with `version_conflict` and the current version, so an agent and a person can't overwrite each other.
- **History.** Every change increments `version` and appends the full record, actor, operation and reason to `record_versions`. `restore` writes a new version from an earlier one. Each version also stores `via`, the operation that wrote it (ADR 0053).
- **What changed.** `records.diff {id, from?, to?}` compares two versions value by value (keyed list items by key); by default since the caller (or the person an agent works for) last looked, kept in `record_seen` by `records.mark_seen` (people only, not in the ledger), or since first drafted (ADR 0053).
- **Lifecycle.** `draft → active → archived`. Archived records can't be edited, only unarchived (back to their earlier status). Only drafts with no inbound links can be deleted, and their history goes with them.
- **Links.** New links must point to an existing, non-archived record in the same lab, and not to the record itself. Existing links survive their target being archived.
- **Names.** `PREFIX-000123`, counted per lab and prefix, never reused.

Errors are `RecordError` with a `code` (`not_found`, `unknown_kind`, `invalid_attributes`, `invalid_input`, `invalid_state`, `version_conflict`, `invalid_link`, `linked`, `not_ready`) and a message written for a person or an agent to act on.

## Draft and confirm

Agents draft, people confirm (ADR 0021). Every record carries:

- `evidence`: where each attribute's current value came from (`assumed`, `stated`, `person`, `datasheet`, `imported`, `measured`, `calculated`; `stated` is a value the person told the agent, and only agents can name it), who set it and when, with an optional note and reference. When a value changes, the service replaces its evidence: what the caller named, else `assumed` for an agent and `person` for a person. Nobody can name `person`. `record`, `template` and `memory` name the confirmed record a value was copied from in `from: {id, version, path?}`; `calculated` names the `calculation` handle a lab calculator returned (and optionally `output`, a pointer into its result), and the service refuses a value the calculation did not give (ADR 0049). A kind may key lists by item (`items: {steps: 'id'}`): each item keeps its own evidence at `/steps/<key>`, and only the items a write changes get new evidence.
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

Nothing about confirmation is stored beyond the review: `readiness()` in `@ailab/domain` compares each field with its section's confirmed values. Equal is confirmed, different is changed (the confirmed value is reported beside the new one), no review is unconfirmed. A value is assumed while its evidence says so and it is not confirmed. For a keyed list, each item is compared by key with the confirmed list (`confirmed`, `changed`, `added`, `unconfirmed`), with `removed` items and `reordered` on the field; `assumed` then lists item paths. `records.readiness` returns sections, fields, check results, `missing` (in plain words), `ready`, and `notApplicable`. A check may declare `applies(attributes)`; a check that doesn't apply to the current values is left out rather than passed. A check may also offer `options(attributes)`: ways to fix the failure in one step, best first, each with a label, its consequence in lab words, an operation and its input; readiness reports them only while the check fails, adding the record's `{id, expectedVersion}` to each input (related checks may offer them too). The review page shows each as a button with its consequence, the first as the recommended one (review 2026-10-01 item 19). A kind may declare `notApplicable(attributes)`, the dotted attribute paths that mean nothing for these values (an A1 offset on a tube); forms leave them out unless they hold a value. `records.confirm_section` is for people only, and so is `records.confirm`, which confirms every section waiting for review in one version, as it stands, leaving out sections with a failing blocker check of their own (each confirmed section still gets its own review); it activates a draft that is then ready, and is refused when nothing can be confirmed (ADR 0046). Confirming the last section of a draft activates it in the same version when nothing else blocks it (ADR 0022). For kinds with sections, `records.activate` is refused with `not_ready` until every section is confirmed and no blocker fails. Every write stores the kind's `summarize(attributes)` line and a readiness summary (`ready`, `blockers`, `warnings`, `assumed`, `sectionsLeft`, `changed`, with checks that read other records) on the record (ADR 0050). `records.confirm_many` (people only) confirms a batch with `records.confirm` one by one, refusing the whole batch when any draft fails a blocker check; Review offers it for the drafts that hold no assumed value, no unchecked value (an agent's unconfirmed `datasheet`, `measured` or `imported` value: readiness lists them as `unchecked`, since only calculations and copies are checked), no failing blocker and no changed confirmed value, and counts their warnings (C4, Wali 2026-10-01). `review.list` returns everything waiting for a person, each item with a `tier` (`needs_you` for proposed changes, `to_confirm` for drafts and for documents with library mentions to check, `fyi` for notices) and `for` (its addressee; none for a notice to the whole lab), filtered to the caller's with `mine`, and `counts.needsYou`: drafts (with the sections left to confirm, what is missing and how many values are assumed), pending proposals and notices, most urgent first (tier, then the earliest `due`, then drafts other records wait on, listed as `blocking`, then the newest). A kind's `review.due(attributes)` gives a draft's due date (a campaign's start) and `review.notice(attributes, today)` a notice on its confirmed records (a memory past its check-again date, plan 005 M6). Items one agent made in one conversation (two or more, by the actor's `sessionRef`) carry `group {id, title}` with the conversation's title (review 2026-10-01 item 16). It lists at most 200 drafts (and at most `limit` items); `counts`, first in the output so a cut view keeps them, totals everything waiting (changes, and drafts per kind), and `kind` lists one kind's drafts on its own, so nothing past the limit is hidden. A person may create such a record active, which confirms every section as written; an agent may not. Approving an agent's proposal confirms the sections the change touches, as the approver (the record context carries `approvedBy`). A person's own edit (an update or a restore) confirms each section it changes, as that person, unless the section still holds an agent's value nobody has confirmed: a field, or an item of a keyed list, with an agent's evidence, or `assumed` evidence whoever saved it (an assistant's suggestion the person saved untouched), and a value other than the one last confirmed (ADR 0056). Editing never activates a draft; one `records.confirm` does.

## Units

`Quantity` is `{ value: "12.5", unit: "uL" }`. Values are decimal strings (ADR 0010); unit codes are ASCII, with display symbols (`uL` shows as µL). Families: volume, mass, amount, molar concentration, mass concentration (including ng/µL), molar mass (g/mol, Da, kDa), time, temperature (K, °C), cells and cell density, optical density per wavelength (`OD600`), %v/v, %w/v, %w/w, enzyme activity and activity concentration (U, U/mL), CFU and CFU density. Conversion only happens within a family. `massToMolar` and `molarToMass` need a molar mass. Temperatures can be converted but not added.

## Actors and tokens

Changes are made by a person (`{type: 'user'}`) or an agent on behalf of a person (`{type: 'agent', agentName, onBehalfOf}`). API tokens are stored hashed; a token issued with an agent name acts as that agent. `pnpm --filter @ailab/api bootstrap` creates the org, lab and first user on an empty database and prints a token once.
