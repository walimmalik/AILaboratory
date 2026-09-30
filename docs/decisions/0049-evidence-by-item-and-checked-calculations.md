# 0049: Evidence by item, copied-from sources, checked calculations

- Status: accepted
- Date: 2026-09-30
- Plan: 004e (step 004e-2; decisions R4, R5 and R12, all as recommended)

## Context

ADR 0021 kept evidence and confirmation per top-level attribute and deferred finer evidence "to the first deep kind". SOPs were that kind: one edited step marked the whole procedure changed and assumed, and 014 plate maps would mark whole plates. Values copied from confirmed records (012b bindings, 017 template fills) had no source but `imported`, so they would show as guesses. "Numbers come from calculators" (ADR 0024) could not be checked: `calculated` was a word anyone could write.

## Options

R4 (granularity): A) evidence and confirmation keyed by path for kinds that declare it, by stable item ids; B) sections over sub-documents only; C) keep per attribute. R5 (copied values): A) new sources `record`, `template`, `memory` naming where the value came from; B) reuse `imported`; C) decide in 017. R12: A) calculator outputs carry a handle, `calculated` evidence must name one and the record service checks the value; B) the handle optional; C) leave to 016a. Wali chose A for all three.

## Decision

**Keyed lists.** A kind declares `items: { steps: 'id', variables: 'name', … }`. Evidence for one item is stored at `/steps/<key>` beside the list's own. When a write changes the list, only the items that changed get new evidence (named for the item, else named for the list, else `assumed` for an agent and `person` for a person); the others keep theirs, and items from before item evidence existed inherit the list's. Readiness compares each item with the confirmed list by key: `confirmed`, `changed`, `added` (not in the confirmed list) or `unconfirmed`, with `removed` items and `reordered` reported on the field. A reordered list needs its order looked at, but each item keeps its confirmation. `assumed` lists item paths (`/steps/wash`), so the count is of guessed steps, not lists. Confirmation stays per section (the SOP's one Confirm, ADR 0046, is unchanged): a person still confirms the section, and what they are shown is which items changed. SOPs key steps and questions by `id`, variables by `name`, materials and solutions by `role`. Plate maps (014) adopt the same when they are next touched; derived wells stay `calculated`, confirmed through their rules.

**Copied values.** `record`, `template` and `memory` are evidence sources that must carry `from: {id, version, path?}`; the review shows "from SOP-0003 v2" in normal ink. Only `assumed` and `stated` are shown in agent ink.

**Calculation handles.** Every lab calculator's result is stored in `calculations` under a handle (`calc_…`, a hash of lab, operation, input and output, so the same result is stored once) and returned beside the output (`{status, output, calculation}`). `calculated` evidence must name `calculation`, and optionally `output`, a JSON pointer into the result. The record service refuses the write when the value is not at that pointer, or, without one, nowhere in the output. Server code that computes a value itself (standard well positions, a transfer plan drafted from a plate map) stores its result the same way. People no longer choose "Calculated" in the editor: a person's own arithmetic is entered by them.

## Consequences

- One edited SOP step is the only thing a reviewer is pointed at; the rest reads as still confirmed.
- Agents must pass the handle a calculator gave them; a number they worked out themselves can't be labelled calculated.
- Calculation rows grow with calculator use; they are small JSON and deduplicated. Pruning is left until it matters.
- R10 (a person's own edit confirms what they typed) builds on item evidence in 004e-6.
