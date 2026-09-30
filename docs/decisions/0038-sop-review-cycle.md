# 0038: The SOP review cycle

- Status: accepted
- Date: 2026-09-30
- Plan: 012 (G6, G11)

## Context

Plan 012 G11 has a reviewer model check a digitized draft against its source before a person sees it. Wali asked that the reviewer edit the draft directly, each fix a tracked change with a one-line reason and the passage it relied on, and ask an open question (G6) wherever the source is ambiguous. Every round is kept with the draft. This ADR records how that is built.

## Options

1. The reviewer returns a whole revised SOP: simple, but its changes are hard to see and one bad field spoils the round.
2. The reviewer calls small tools, one change each, checked as it goes: every change is visible and a refused change doesn't cost the rest.

## Decision

Option 2. `sops.review` runs up to `rounds` (default 2, at most 3) rounds on a draft. Each round:

- **Input:** the reviewer model gets the SOP as JSON, the failing readiness checks, the citations whose quote isn't in the cited passage (`sops.check_citations`) and the source document's passages with their ids.
- **Tools:** it has three.
  - `sop_fix`: a JSON pointer into the attributes, a value (or `remove`), a reason and an optional citation. It can't touch `questions`, `source` or `derivedFrom`.
  - `sop_ask`: adds an open question with a suggestion and passages.
  - `sop_finish`: a summary.
- **Checking each change:** a change is kept only if the SOP still parses and its references hold (the kind's `related` check). A refused change goes back to the model as a tool error, and is kept with the round as `refused`.
- **Saving the round:** the round's accepted changes land as one record update by the reviewer (an agent acting for the person). The evidence of each touched field says `stated` when a fix cites the source, `assumed` otherwise, with the reason as its note. So the SOP's history holds every change, and section reviews reset as usual.
- **Keeping the round:** the round is stored in `sop_reviews`, a table the SOP module owns. It records the model, the version before and after, and each finding (`fix` or `question`, path, before, after, reason, cite). `sops.reviews` lists the rounds.
- **Stopping:** a round with no findings ends the cycle (`clean`). A model failure ends it (`failed`), keeping earlier rounds.

The reviewer is the assistant's configured model (`AGENT_PROVIDER`, `AGENT_MODEL`), named "<agent> (reviewer)". The review never confirms anything.

## Consequences

- The SOP page (012d) can list reviewer fixes separately from the draft, with before and after, reason and passage, and let a person keep or revert each one.
- A separate, cheaper reviewer model needs its own setting. That is left for when the benchmark shows it pays.
- The review runs inside the operation's transaction, including the model calls, so a long review holds a database transaction open. That is acceptable for one lab. It would move to a background job if reviews become slow or frequent.
- A reviewer that keeps being refused wastes its steps. The step limit per round (8 model turns) bounds the cost.
