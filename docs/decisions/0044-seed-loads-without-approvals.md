# 0044: The seed loads in one run, with no approvals

- Status: accepted
- Date: 2026-09-30
- Plan: 006 (seed lab), with 004e (review v2)

## Context

The seed loaded everything as the agent "Seed loader", so product rule 3 applied to it like any agent: drafts to confirm and proposals to approve. Loading the demo lab took about four rounds of "approve this layer, run the seed again" (rooms, then the freezers in them, then containers and lots, then their contents), and left more than 200 items on Review. Wali (2026-09-30): the seed should be automatic, with no approvals.

## Options

1. Keep drafts and add batch confirm (004e R3). Still a round of clicks, and still several runs for the layers.
2. Load vendor reference data active and keep the lab's own records for review. Two rules to explain, and the layers still need runs.
3. Load everything in one run and settle it as the person who ran the seed: running `pnpm seed` is their decision to take the seed lab as it is.

## Decision

Option 3. The seed still writes through the operations as "Seed loader" on behalf of a user, so every value keeps its evidence (datasheet, imported, the seed file it came from). After each loader, the run settles what it wrote as that user (`settleSeed`, `apps/api/src/seed-settle.ts`): the loader's proposals are approved oldest first, and its drafts have every section confirmed and are activated, with the reason "Imported from seed (pnpm seed)" in history. It repeats the loading and settling passes until a pass changes nothing, so rooms, freezers, containers and contents all land in one command.

A draft with a failing blocker is left untouched for Review. Only those, for example the labware types the seed has no outer size for, reach a person. Other agents' drafts and proposals are never settled by the seed.

## Consequences

- One command loads the demo lab. What is left on Review is what the seed can't settle, and the command lists it.
- Seed records read "confirmed by you" with the seed as the reason. Their field evidence still says where each value came from, so agent ink doesn't hide what the seed guessed: an `assumed` value is confirmed like the rest, by the person who chose to run the seed.
- `library:import` and other agent loaders are unchanged: their drafts still go through Review.
