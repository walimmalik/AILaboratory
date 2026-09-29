# 0016: Agents propose consequential changes; people approve

- Status: accepted
- Date: 2026-09-29
- Plan: 003 (round 4, question 1)

## Context

Agents should work freely on drafts, but changes to records other work already depends on need a person's eye. Later, Wali wants autonomous agent execution, so the rule must be adjustable in one place.

## Options

1. A policy per operation (`direct` or `propose`, possibly decided per call), resolved centrally in the registry
2. Every agent write is proposed
3. No review; rely on history and restore

## Decision

Option 1. Record policies: agents create and edit drafts directly; creating active records, editing or restoring active records, and activating, archiving or unarchiving are proposed. A proposal stores the input and a preview (the operation run and rolled back). Only people may call `proposals.approve` and `proposals.reject`. Approval runs the operation as the proposing agent, so history credits the agent and the ledger records who approved. If the record changed since the proposal (version conflict), the proposal is marked failed and nothing changes.

## Consequences

Per-agent autonomy levels can later be added in `execute` without touching operations.
