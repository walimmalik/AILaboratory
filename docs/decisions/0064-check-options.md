# 0064: A failing check offers ranked options

- Status: accepted
- Date: 2026-10-01
- Plan: 004e (review 2026-10-01 item 19, UI rule 12)

## Context

A check that fails could offer one fix, `quickFix: {operation, label}`, run with the record and its version. Plans 013a, 016, 018 and 019 need more than that: switching instruments is a choice between several fixes, each with a different consequence, and a person or an agent picks one. The review page also only knew how to run one fix, so `experiments.adopt_versions`, offered by experiments, never showed.

## Options

1. Keep `quickFix` and let each plan add its own options: every plan invents a shape, and the UI renders each one differently.
2. One `options` list on every check result, best first, each with a label, its consequence in lab words, an operation and its complete input: one shape for agents and the UI.

## Decision

Option 2. `KindCheck.options(attributes)` returns the ways to fix the failure for these values, best first; checks that read other records may return `options` on their results too. Readiness reports them only while the check fails and adds the record's `{id, expectedVersion}` to each input, so an option is a whole call an agent can run as it stands. `quickFix` is gone.

## Consequences

- Agents read `options` from `records.readiness` and run or recommend one; people see each option as a button with its consequence, the first marked as recommended.
- The review page runs an option only when it knows the operation's contract (a map in `RecordReview.tsx`); a plan that adds an option operation adds it there.
- Options are worked out from the record as it stands, so a stale option fails with `version_conflict`, like any edit.
