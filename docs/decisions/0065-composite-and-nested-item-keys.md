# 0065: Keyed lists take composite keys and nest

- Status: accepted
- Date: 2026-10-01
- Plan: 004e (review 2026-10-01 item 18, I19), extends ADR 0049

## Context

ADR 0049 lets a kind key a list by one field (`items: {steps: 'id'}`), so each item keeps its own evidence and confirmation. Plate map hand edits are keyed by plate and well, transfer groups hold transfers keyed by source and destination, and workflow edges by their two ends. With one string key, one level deep, these fall back to whole-list evidence: one moved well marks every hand edit changed.

## Options

1. A key function per list in the kind: flexible, but `records.kinds` can't send a function to the web app or to agents, so they couldn't follow items.
2. A declarative spec kept in the same `Record<string, string>`: `'plate+well'` keys by several fields, and an entry named `'groups/transfers'` keys the list `transfers` inside each item of `groups`.

## Decision

Option 2. A key is the named fields' values joined with "+" (each must be text or a number; items without a full key are not followed). A nested item's evidence path is `/groups/<key>/transfers/<key>`, its readiness key reads "g1 · A1+B1", and the parent item is compared without its keyed lists, so changing one transfer leaves its group and the other transfers confirmed. `@ailab/domain` (`keyed.ts`) owns walking the lists (`keyedEntries`, `entriesByPath`, `evidenceKeyOf`); readiness, the record service's evidence, calculated and copied checks, `records.diff` and the web app's diff all use it.

## Consequences

- Existing single-field keys work as before; key parts in paths are escaped as in JSON pointers.
- Plate maps (`overrides`) and transfer plans (`groups`) adopt the new keys when 014 and 016 are next touched; until then they keep whole-list evidence.
- The review page lists nested items as their own rows of a field's items; naming them in lab words (step and parameter names) comes with the screens that use them.
