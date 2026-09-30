# 0052: Library mentions wait in Review

- Status: accepted
- Date: 2026-09-30
- Plan: 004e (step 004e-3, last part)

## Context

ADR 0035 kept library mentions off the Review page: a document can have hundreds, and they are checked beside their passages on the document's page. That left them waiting where nobody looks. Plan 004e moves library mentions into Review, so that Review is the one queue (UI rule 4), without putting hundreds of rows there.

## Decision

`review.list` returns one `mentions` item per document with proposed mentions: the document, how many are waiting, when the newest was proposed, and `for` (the person the proposer worked for). Items are in the `to_confirm` tier, left out when `kind` filters drafts, and filtered by `mine` like the rest. `counts.mentions` is the number of mentions waiting, and `counts.total` counts each such document once. Archived documents are left out. Review shows them as a "Library mentions" block: one row per document with a Check button that opens the document, where `library.review_mentions` confirms or rejects them in bulk as before.

The library module owns the query (`mentionsWaiting` in `apps/api/src/library/mentions.ts`); Review only calls it.

## Consequences

- Mentions are counted in Review but not in the nav's "needs you" number, since no one is blocked on them.
- Checking still happens on the document page, next to the passages. Review is only where you find what's left.
