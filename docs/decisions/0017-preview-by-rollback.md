# 0017: Preview by running and rolling back

- Status: accepted
- Date: 2026-09-29
- Plan: 003 (round 4, questions 4 and 5)

## Context

People and agents need to see what a change would do before making it, and batches must be all-or-nothing.

## Options

1. Every write runs in one transaction; a preview runs the real code and rolls back
2. Each operation implements a separate "plan" function

## Decision

Option 1. `?preview=true` (REST) or `preview: true` (MCP) returns `{status: "preview", output}` with exactly what the real call would have returned. Nothing is saved or logged, and readable-name counters are rolled back too.

## Consequences

Previews can never disagree with the real run. Operations with effects outside the database (instruments, email) will need an explicit preview mode when they arrive (plan 022).
