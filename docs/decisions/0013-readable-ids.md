# 0013: Readable IDs as prefix plus counter

- Status: accepted
- Date: 2026-09-29
- Plan: 002 (decision T5)

## Context

People need short names for records (Benchling style). Internal IDs stay ULIDs.

## Options

1. `PREFIX-` plus a zero-padded counter per lab and prefix (`PLT-000345`)
2. With a year (`PLT-26-0345`)
3. Free-form names only

## Decision

Option 1. Each kind declares a name prefix and pad width. Counters live in `name_counters` keyed by lab and prefix, and a name is never reused, even after its record is archived or deleted.

## Consequences

Names are unique per lab. The counter grows past the pad width if needed (`PLS-10000`).
