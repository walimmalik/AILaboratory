# 0048: Plain words on every operation contract, one value renderer

- Status: accepted
- Date: 2026-09-30
- Plan: 004e (step 004e-1)

## Context

The human interaction review found 61 of 81 operations shown on screens by their ID (`transfers.draft_from_plate_map`), because the plain words lived in a hand-kept map in the web app that stopped growing after plan 004. Structured values rendered as "key value · key value" walls, and a record ID nested inside one (a recipe's product, a liquid class's type) showed raw. Plan 004e UI rules 1 and 9 say what you confirm is what you read and plain words are part of the contract. Review totals and per-kind counts ("showing 200 of 335") were already built by the UX fixes, so this step does not repeat them.

## Options

1. Words on the contract: every contract carries `verbs: {done, intent}`; screens read them from one catalog of contracts; a test fails when the API registers an operation the catalog lacks. Consequence: a new operation can't ship without its words, and the web app keeps no list.
2. Keep the web app's map and add a lint that every registered ID has an entry. Consequence: two places to change per operation, and the words are invisible to agents and MCP clients.

## Decision

Option 1. `OperationContract.verbs` is required: `done` reads after who did it ("Claude drafted a transfer plan from PLM-0003"), `intent` after "wants to". `defineContract` refuses words that look like an ID (a dot or underscore, or a capital first letter). `operationContracts` in `@ailab/schema` is every contract by ID; the API test checks the registry registers exactly those. Screens show "did something" for an ID no contract has, never the ID.

Values go through one renderer (`apps/web/src/pages/Value.tsx`): a record ID at any depth is its linked name; a list of objects is a table; a nested object is one named value per line (two plain values stay on one line); a choice like `tip_rack` reads as words except under keys that hold given names (`name`, `id`, `role`, `variable`, …). A kind may give a field its lab form instead (`fieldViews` on the record page): an instrument's configuration as its installed equipment by name and position. Proposal diffs in Review use the same renderer.

## Consequences

- Adding an operation means writing its two phrases; typecheck and the catalog test enforce it.
- The assistant's step lines, the activity ledger and Review read the same words agents could read from the contract.
- Kinds that need more than a table (plate maps, transfer plans, schedules) add a field view in one place rather than a page of their own.
