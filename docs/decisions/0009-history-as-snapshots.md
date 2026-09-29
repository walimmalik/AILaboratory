# 0009: Full history as current-state tables plus version snapshots

- Status: accepted
- Date: 2026-09-29
- Plan: 002 (decision T1)

## Context

Wali wants full history for every record: view, compare and restore any past version.

## Options

1. Current-state tables plus an append-only table of full version snapshots
2. Event sourcing, with state rebuilt from events

## Decision

Option 1. Every write increments `version` on the record and appends the full envelope, actor, operation and reason to `record_versions`. A restore writes a new version; history is never rewritten.

## Consequences

Reads stay simple. Storage grows with every edit, which is acceptable at lab scale. Deleting a draft removes its history with it, since drafts are the only records that can be deleted.
