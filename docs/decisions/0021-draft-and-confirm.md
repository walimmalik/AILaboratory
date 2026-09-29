# 0021: Draft and confirm: evidence, section confirmations and readiness checks

- Status: accepted
- Date: 2026-09-29
- Plan: 004c (round 6, questions C1 to C6)

## Context

Product rule 3 says agents draft and people confirm, and rule 6 says what an agent assumed is marked as such. Plan 003 gave us proposals, which review one change at a time. Designs (labware types, SOPs, plate maps, schedules) need something else: an agent fills in many values at once, and a person reviews them in sections, sees what is still an estimate and what changed since they last looked, and confirms the whole. Every later registry and designer is built on this, so it has to live in the record service, not in each module.

## Options

1. **Draft record plus per-field evidence and section confirmations; the final confirm is activation (C1).** One record, one history, one lifecycle.
2. A separate "design document" table with its own versions. Two lifecycles to keep in step.
3. Proposals for every agent write, reviewed one by one. Click-heavy and loses the section view.

For marking assumptions (C2): mark everything an agent sets unless it names a source; mark nothing and rely on history; or ask agents to flag assumptions explicitly. For edits after confirmation (C3, C4): send the section back to review and compare against the values confirmed; keep it confirmed; or reset the whole record.

## Decision

Option 1, with C2 to C6 as recommended:

- **Evidence per attribute.** Records carry `evidence: {field: {source, by, at, note?, reference?}}`. Sources are `assumed`, `stated`, `person`, `datasheet`, `imported`, `measured`, `calculated`. `stated` (added after Wali tried it, 2026-09-29) is a value the person told the agent: shown as "you told <agent>" rather than as a guess, and still confirmed with its section; only agents can name it. When an attribute's value changes, its evidence is replaced: an agent that names no source gets `assumed`; a person gets `person`. A caller may name a source (`evidence` on `records.create` and `records.update`) but nobody can claim `person`. Unchanged values keep their evidence. Restoring a version restores that version's evidence.
- **Sections.** A kind may declare `sections` (groups of top-level attributes). A person confirms one with `records.confirm_section` (people only), which stores `reviews[section] = {confirmedBy, confirmedAt, version, values}`.
- **Confirmation is derived, not stored.** A field is confirmed while it equals the value in its section's review; otherwise it is "changed" (with the confirmed value shown beside it) or "unconfirmed". A value is shown as assumed while its evidence is `assumed` and it is not confirmed. So any edit, by anyone, sends that section back to review, and the comparison is always against what was last confirmed.
- **Readiness checks** live on the kind in code (`checks`): a plain label, `blocker` or `warning`, the source of the rule, the section, a suggested fix, and a test that returns true or a message. The pure logic is `readiness()` in `@ailab/domain`.
- **Final confirm.** For kinds with sections, `records.activate` requires every section confirmed and no failing blocker. An agent may ask for it (proposed, as before) only when the draft is ready. A person may create a record active directly, which confirms every section as they wrote it; an agent may not.
- **Approval confirms (added 2026-09-29 after Wali tried it).** When a person approves an agent's proposal, the sections the change touches are confirmed by that person, since they reviewed exactly that change. An active record therefore stays fully confirmed after an approved agent edit.
- **Built on the widget test kind (C6)**; labware (plan 007) is the first real user.

## Consequences

- Every design module gets the review screen, assumed markers, change highlighting and readiness panel by declaring `sections` and `checks` on its kind.
- Evidence and reviews are in every history snapshot, so "who confirmed what, when, seeing which values" is auditable.
- Kinds without sections behave as before.
- Readiness checks run in the API process; checks that need other records or the science service will need an async form later.
- Evidence is per top-level attribute. Kinds with deep structures (well maps, step lists) will need finer-grained evidence or sections over sub-documents; decide that with the first such kind.
