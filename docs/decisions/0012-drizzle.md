# 0012: Drizzle for database access and migrations

- Status: accepted
- Date: 2026-09-29
- Plan: 002 (decision T4)

## Context

Typed queries and reviewable migrations for Postgres, with tests that run without Docker.

## Options

1. Drizzle
2. Kysely
3. Raw SQL

## Decision

Option 1. Table definitions live in `apps/api/src/db/schema.ts`; `drizzle-kit generate` writes SQL migrations to `apps/api/drizzle/`. Tests run the same migrations on PGlite (Postgres compiled to WebAssembly), so they need no Docker; CI also migrates a real Postgres.

## Consequences

CI fails if migrations are stale relative to the table definitions.
