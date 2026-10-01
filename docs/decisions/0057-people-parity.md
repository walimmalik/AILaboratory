# 0057: People parity: record actions, calculators and a web-caller rule

- Status: accepted
- Date: 2026-10-01
- Plan: 004e (step 004e-6, second part; decision R11, as recommended)

## Context

Rule 2 says a person and an agent can do the same things. Some writes an agent can make had no screen: archiving, unarchiving, restoring a version and discarding a draft from the record page, and every lab calculator. A person had to ask the assistant, which then proposed the change, and the person confirmed their own request.

## Options

A) Archive, Restore this version and Discard draft on the record page, Discard on agent drafts in Review, one generic Calculators page rendered from calculator contracts, and a CI rule that every agent write has a UI caller or an allowlisted reason. B) Only the record actions. C) Leave as is. Wali chose A.

## Decision

- **Record page:** under the heading, Archive (active records), Unarchive (archived) or Discard draft (drafts), each asking once more in place before it acts. Discarding goes back to Review. In History, each earlier version has Restore, also asking once more. Restoring an archived record isn't offered; unarchive it first. Discard on agent drafts in Review already existed.
- **Calculators page** (`/calculators`, in the side bar): a list of every calculator contract, and a form drawn from the input schema `operations.describe` returns, the same schema agents see. Calculate shows the result with the shared value renderer and the raw result under technical details. Nothing is saved.
- **The rule:** `apps/api/src/parity/parity.test.ts` lists every write an agent may call and fails unless the web app imports its contract, or the test's `noScreen` list gives a reason. It also fails when a listed operation gains a web caller, so the list only shrinks.

## Consequences

- The rule starts with 40 agent writes on the list, each with its reason: drafting forms (people ask the assistant to draft, then edit and confirm), the transfer plan screens (016c and 016d, after the morning review), and screens that show something read-only today (instrument status and service, container contents, lots, runs). Those are visible now and each screen PR takes its line out.
- A calculator's form is only as good as its schema's descriptions; a calculator whose input is hard to fill by hand will want its own form later.
