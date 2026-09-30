# 0041: A record's rules live on its kind, so every write path checks them

- Status: accepted
- Date: 2026-09-30
- Plan: none (architecture review of 2026-09-30, PR #62)

## Context

The architecture review found rules that only one dedicated operation enforced, while the generic record operations (`records.create`, `records.update`, an approved proposal) wrote the same records without them:

- `files.upload` proves the caller holds the bytes, but `records.create` could make a `file` record for any sha256, and `files.get` then served another lab's bytes.
- `instruments.register` and `instruments.change_configuration` resolve an instrument's configuration against its kind (mounts, sites, equipment), but a generic edit could store a configuration that doesn't fit and confirmation never checked it.
- Inventory corrections accept negative or dimensionally wrong quantities, because the checks sit in the fill and transfer paths.

Agents use the generic operations as much as the dedicated ones, so a rule that isn't on every path isn't a rule.

## Options

1. **Rules on the kind.** Invariants go in the kind's `related` hook and `checks`, which the record service runs inside every write and readiness read. A kind whose records only one operation may create says so with `createdBy`, and `records.create` refuses it.
2. **Rules in each operation, with generic writes locked down per kind.** Every kind lists which operations may write it. The rules stay scattered, and each new operation has to remember them.
3. **Leave it.** Every generic write path stays a way round the rules.

## Decision

Option 1 (Wali, 2026-09-30).

Instrument-specific knowledge stays data on instrument kinds (the capability catalog, mounts and sites of ADR 0025 and 0026). The code has one generic rule, "a configuration must resolve", which the instrument kind's `related` hook runs through the same resolver the dedicated operations use. A new instrument needs data, not code.

`createdBy` is for kinds whose creation needs something the record alone can't show, such as holding the bytes. It isn't a way to hide a kind from agents; the named operation is in the registry like any other.

## Consequences

- `file` declares `createdBy: 'files.upload'` (PR #65). The instrument kind's `related` hook resolves the configuration on every write, refusing a changed configuration that doesn't resolve and showing a blocker when an unchanged one stops resolving. Inventory corrections check quantity sign and dimension where every correction is written.
- Dedicated operations can still do more (convenience, bulk work, better messages), but they no longer add rules that only they enforce.
- Rules run on every write, so they must stay cheap: `related` reads a few records, not whole tables.
