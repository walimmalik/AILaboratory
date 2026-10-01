# 0056: A person's own edits are confirmed

- Status: accepted
- Date: 2026-10-01
- Plan: 004e (step 004e-6, first part; decision R10, as recommended)

## Context

ADR 0021 sends any section whose values change back to review, whoever changed them. A person who corrects a value on a draft then has to press Confirm on what they just typed, and a person who fixes a confirmed record sees their own fix flagged as needing review. Plan 004e R10 calls this the click-heavy pattern to avoid. ADR 0049 made evidence exact per field and per item of a keyed list, which this needs.

## Options

A) Values a person types are confirmed by that person; the section needs review only for agent values left in it. B) Keep ADR 0021: any edit sends the section back to review. Wali chose A.

## Decision

- When a person (not an agent) updates or restores a record, each section whose values change gets a new review by that person, at the new version, with the new values.
- Except when the section still holds an agent's value nobody has confirmed: a field whose evidence is an agent's (any source, `stated` included) and whose value differs from the one last confirmed for the section; for a keyed list, an item with an agent's evidence that is new or differs from the confirmed item. That section keeps its old review and reads as needing review, as before.
- An agent's edit is unchanged: it never confirms anything. Approving an agent's proposal still confirms what it changed, as the approver.
- Editing never activates a draft, even when it confirms the last section. The person presses Confirm once (`records.confirm`), which activates a ready draft with nothing left to confirm.
- Creating a record is unchanged: a person's draft starts unconfirmed, and a person may still create a record active.

## Consequences

- Fixing a value no longer costs a second click, and a person's fix to a confirmed record stays confirmed.
- An operation a person runs that writes a record through the record service (for example `experiments.bind_protocol`) confirms what it changed the same way, because the person ran it.
- A section that mixes the person's edit with an agent's guess still waits, so nothing an agent assumed is confirmed by accident.
