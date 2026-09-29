# 0002: Postgres as the single database

- Status: accepted
- Date: 2026-09-29
- Plan: 000 (decision D2)

## Context

Multi-user lab data, concurrent agents writing through operations, per-kind flexible attributes, and semantic search over SOPs, literature and lab memory.

## Options

1. Postgres (with pgvector)
2. SQLite, as echo650-twin uses

## Decision

Option 1, using the `pgvector/pgvector` image. Relational tables hold identity and links; JSONB holds per-kind attributes validated against the kind's schema; full-text search plus pgvector serve search.

## Consequences

One database to back up and migrate. Local development needs Docker for Postgres (`docker compose up db`). The migration tool is chosen in plan 002.
