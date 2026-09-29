# 0004: Port echo650-twin's twins and scheduler into this repo

- Status: accepted
- Date: 2026-09-29
- Plan: 000 (decision D4)

## Context

echo650-twin already has evidence-backed instrument twins, a workcell simulation, an operation-first scheduler and an exposure kernel. The goal is one data model and one clock.

## Options

1. Port twins and scheduler into `packages/twin` and `packages/scheduler`, preserving behavior
2. Keep echo650-twin as a separate app and call its API
3. Rewrite

## Decision

Option 1, in plans 015 (twins) and 019 (scheduler). Twins are ported, not rebuilt; defects get their own bounded fixes.

## Consequences

echo650-twin stays the reference until the port lands. Its instrument definitions seed plan 008.
