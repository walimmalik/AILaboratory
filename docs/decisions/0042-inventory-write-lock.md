# 0042: Inventory writes in a lab run one at a time

- Status: accepted
- Date: 2026-09-30
- Plan: 010c (volume ledger)

## Context

Every inventory write reads the wells' current state, works out the new state and writes it back (ADR 0031). Under read committed, two writes to the same well could both read the same state. The review reproduced this on Postgres: twelve simultaneous 5 µL consumes from 100 µL all succeeded and left 90 µL, with ledger lines that disagree. People and agents act at the same time, and the scheduler will run steps in parallel, so the ledger has to hold under concurrency.

## Options

1. **One transaction-scoped advisory lock per lab**, taken before any well is read. Covers empty wells, which have no row to lock. It can't deadlock on lock order, and it's released at commit or rollback. It serializes inventory writes across the whole lab.
2. **Row locks on the wells touched** (`SELECT … FOR UPDATE`). This allows more concurrency, but empty wells have no row, and a transfer between two plates in opposite order can deadlock unless every operation sorts its locks.
3. **Optimistic versions on well state.** Retry on conflict. This needs a version column and retry logic in every operation.
4. **Serializable isolation for inventory operations.** Postgres aborts conflicting transactions, so every caller needs retry handling.

## Decision

Option 1 (Wali, 2026-09-30). A lab's inventory writes are a few per second at most, and each takes milliseconds, so a per-lab lock costs nothing noticeable and is the simplest thing that is correct. `lockInventory` takes `pg_advisory_xact_lock(hashtext('inventory:' || lab_id))` on a ledger's first container, and in discard before it reads the wells.

## Consequences

- Inventory writes in one lab wait for each other; different labs don't.
- PGlite uses one connection, so the race can't show in unit tests. `apps/api/src/inventory/concurrency.pg.test.ts` runs against real Postgres in the CI Postgres job (`TEST_DATABASE_URL`) and fails without the lock.
- If a lab ever needs more inventory throughput, move to option 2 with sorted lock order. The lock is taken in one place, so the change is local.
