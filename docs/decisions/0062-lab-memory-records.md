# 0062: Lab memory records

- Status: accepted
- Date: 2026-10-01
- Plan: 005 (005a)

## Context

Plan 005 (M1 to M22 and the seven changes after the adversarial review, accepted by Wali 2026-09-30) defines a memory record with a closed condition object and a typed effect, `memory.remember/propose/update/retire/replace/search`, `memory` evidence, handling rules and timing windows that reference a memory, and seed memories. This ADR records how 005a builds them.

## Decision

- A memory is an ordinary record (`memory`, `mem_`) through the record service, with two sections so an agent can never create one active (change 3). `memory.remember` is people only and creates it active; `memory.propose` drafts.
- Statement, kind, strength, about, when, conditions, effect, appliesTo, source, checkAgain and retired are its attributes. Conditions are a closed object (change 4); effects are `prefer`, `avoid` and `set` (change 1), and the schema refuses a note with an effect and a rule that prefers.
- The check-again date is set by code from the kind when left out (M6). Past it, search marks a memory `due`; it stays in use.
- Retiring archives the memory with `retired.why`; replacing creates the new memory and retires the old with `replacedBy`, so history links them. Both are proposals when an agent asks; a replacement approved by a person is created as theirs.
- Every record a memory names is a link, so links check that it exists in the lab and is not archived. A rule or timing window from lab memory names the memory and links to it as `from_memory`.
- `memory` evidence is checked like copied record evidence: a memory, at a version that was confirmed.
- Seed memories are stated Demo Lab conventions, drafted by the loader and settled with the rest of the seed.

## Consequences

- 005b can match memories by their typed conditions and apply effects without reading statements.
- A personal memory's ownership is enforced on `memory.remember`, `memory.update` and `memory.replace`; confirming an agent's draft of one through `records.confirm` is not yet limited to its person (005c-1's Review section).
- Seed rules marked `lab_convention` don't yet name their memory, because rules load before memories in the seed.
