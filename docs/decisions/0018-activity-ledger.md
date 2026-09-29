# 0018: An activity ledger of changes, with a live stream

- Status: accepted
- Date: 2026-09-29
- Plan: 003 (round 4, question 6)

## Context

Wali wants to see what agents and people did, live, and click into any entry. Reads are not interesting enough to log.

## Options

1. An `activity` table written by the registry for every write outcome, plus server-sent events for new entries
2. Log every call, reads included
3. Derive activity from record history

## Decision

Option 1. Each entry records the actor, operation, outcome (`succeeded`, `failed`, `proposed`, `approved`, `rejected`), records touched, proposal, input, error and duration. `activity.list` reads it, and `GET /v1/activity/stream` pushes new entries for the caller's lab. Failed writes are logged too, so the ledger shows what agents tried.

## Consequences

The stream uses an in-process bus, which is enough for one API process. Several API replicas will need Postgres `LISTEN/NOTIFY` or similar (to decide when hosting moves to the cluster).
