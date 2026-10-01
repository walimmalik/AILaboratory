# 0053: What changed since you last looked

- Status: accepted
- Date: 2026-09-30
- Plan: 004e (step 004e-4, decision R8, as recommended)

## Context

Design is iterative: after "add a third replicate", the person has to see what that turn changed, and nothing in a draft is confirmed yet, so the confirmed-value comparison of ADR 0021 doesn't help. History said "edited" for every version whatever did the work, the ledger could only be paged by time, and `/` opened the raw ledger.

## Options

A) A per-person seen marker per record, `records.diff` defaulting to "since you last looked", history naming the operation, `activity.list` filters, and a small Today home page. B) Diff against confirmed values only, as now. C) A without the home page. Wali chose A.

## Decision

- **Seen marker.** `record_seen` holds, per person and record, the version they last looked at. `records.mark_seen {id, version}` is for people only and writes no ledger entry, since looking changes nothing in the lab (a new `ledger: false` flag on an implementation). The record page marks the record seen once it has read the comparison. An agent reads the marker of the person it works for.
- **`records.diff {id, from?, to?}`** returns the values that differ between two versions, by path, with `changed`, `added` or `removed` and before and after values. The record's own label and status appear as `/label` and `/status`. Lists a kind keys (ADR 0049) are followed item by item by key, so a changed step reads `/steps/coat/duration` and reordering changes nothing. Quantities and pinned references are one value each, and other lists are compared whole. By default `from` is the version you last saw (`since: "seen"`), or 1 when you never have (`"first_drafted"`, plan 004 C4). The output also lists the versions in between: who, when, why, and through which operation. The comparison is pure domain code (`diffValues` in `packages/domain`).
- **History names the operation.** Every version stores `via`, the operation that wrote it (`sops.draft`, `labware.use_standard_positions`). The registry passes the operation ID in the record context, and a step of a change set is named by its own operation. History rows show the operation's plain words when it isn't a generic `records.*` call.
- **Ledger filters.** `activity.list` takes `since`, `record`, `conversation` (what an assistant conversation did, and the asks that started it), `actor` (`people` or `agents`) and `mine` (what you did, or agents did for you). The Activity page offers Everything, Mine, Agents and People.
- **Today.** `/` is a Today page: what waits for you (changes to decide, your drafts, library mentions), and what you and agents working for you did today, one line per record with what was done. The full ledger stays on Activity.

## Consequences

- A record opened in two tabs shows the same comparison in both, since both read the marker before either sets it.
- Versions written before this have no `via` and read as before.
- Review can later flag drafts that changed since you looked, using the same marker.
