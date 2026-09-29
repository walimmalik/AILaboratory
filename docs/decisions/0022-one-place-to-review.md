# 0022: One place to review

- Status: accepted
- Date: 2026-09-29
- Plan: 004 (step 004d)

## Context

After 004c a person met agent work in two places with two vocabularies: drafts were reviewed and "confirmed" on their record page, while changes to active records were "approved" on a Proposals page. Testing showed it was unclear what needed you where. Confirming every section of a draft left one more Confirm to press, which was easy to miss: a draft whose sections were all confirmed stayed a draft, so a later agent edit applied directly instead of waiting.

## Options

1. One Review page listing everything waiting for you, one verb, and the last section's confirm activates the draft. Fewer places and clicks; activation happens as part of a confirm.
2. Keep Proposals and add a drafts list beside it. Two lists, two verbs.
3. Turn agent edits to drafts into proposals too. Uniform, but click-heavy and loses the section view (rejected in 0021).

## Decision

Option 1 (round 7, R1-R6 all as recommended):

- **Review page.** `/review` lists drafts to review (linking to their record page, with what is left) and changes proposed to active records (confirmed or rejected in place), newest first. The `review.list` operation serves it, so agents read the same list.
- **Agent changes to active records stay proposals**, shown in that list.
- **One count** in the nav: everything waiting for you.
- **"Waiting for you" line.** After an assistant turn that left drafts or proposed changes still waiting, the panel adds a linked line naming them. The app computes it from the turn's tool results and `review.list`; the model does not write it.
- **One verb.** "Confirm" ("Confirm change" for a proposal). Record status reads "draft · needs your review", "active", or "active · change waiting".
- **The last section activates.** `records.confirm_section` on a draft activates it in the same version when, with that section confirmed, the record is ready (every section confirmed, no failing blocker). The button says so: "Confirm volume and activate". `records.activate` remains for kinds without sections.

## Consequences

- Amends 0021's "final confirm": for kinds with sections, the final confirm is the last section's confirm.
- A draft is active as soon as a person has confirmed all of it, so later agent edits become proposals.
- History shows the activation on the confirm version ("confirmed appearance and activated").
- The Proposals page and route are gone; `proposals.*` operations are unchanged.
