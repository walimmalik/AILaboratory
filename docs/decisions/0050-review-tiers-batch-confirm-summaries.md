# 0050: Review in tiers, batch confirm, stored summaries

- Status: accepted
- Date: 2026-09-30
- Plan: 004e (step 004e-3, first part; decisions R1, R3 and R9, all as recommended)

## Context

Review was one flat list of every draft and change, and the nav count included everything, so after the seed it read 300 and meant nothing. 133 vendor liquid classes with no guess in them each needed their own confirm. Review's "ready" skipped checks that read other records, so it could disagree with the record page. R1, R3 and R9 were chosen in plan 004e; R2 (change sets) and moving library mentions into Review are separate steps.

## Options

R1: A) three tiers (needs you, to confirm, for your information), addressed items, only "needs you" counted in the nav; B) one flat list with totals; C) A without addressees. R3: A) "Confirm all N" when every item has no assumed value, no failing check and no changed confirmed value, people only, each record confirmed on its own; B) none; C) anything, with a warning. R9: A) kinds declare `summarize`; the summary and a readiness summary are stored at write time; B) computed on read; C) web only. Wali chose A for all three.

## Decision

**Tiers and addressees.** Every Review item has a `tier` and `for` (the user an agent worked for, or who made the draft). A proposed change is `needs_you`: an agent is waiting on it. A draft is `to_confirm`. `fyi` is reserved for 019 re-plans and 020 drift notes. `review.list` takes `mine` and returns `counts.needsYou` for the caller. The nav's Review count and the status bar show only that number; library pages keep their own draft counts. Review shows "Needs you" first, then "To confirm" as one dense row per draft (name and summary, what is left, estimates, who changed it and when, Review, and Discard on drafts an agent made, confirmed in place).

**Batch confirm.** `records.confirm_many {records: [{id, expectedVersion}]}` is for people only. It re-reads each record's readiness, including checks against other records. If any record is at another version, holds an assumed value, fails any check, or has values changed since a person confirmed them, nothing is confirmed and the refusal names which to open. Otherwise each record is confirmed with `records.confirm`, so each gets its own confirmation in its history. Review offers "Confirm all N" on a list only when every draft in it qualifies and the whole list is in view.

**Stored summaries.** A kind may declare `summarize(attributes)`: labware types ("96 wells, 360 µL, sterile") and SOPs (the purpose's first sentence and the step count) do now. Every write stores the summary and a readiness summary on the record (`ready`, `blockers`, `warnings`, `assumed`, `sectionsLeft`, `changed`), computed with the checks that read other records. Records return both, and Review reads them. Rows written before this fall back to computing without related checks until their next write.

## Consequences

- The nav count means "someone is waiting on you" and stays small.
- A readiness summary goes stale when a record it depends on changes (a workcell whose member joins another). It refreshes on the record's next write, and batch confirm always re-reads, so a stale summary can't confirm anything it shouldn't.
- Other kinds add `summarize` when their screens are next touched.
