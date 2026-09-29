# 003: Operation registry, REST and MCP

- Status: in review (round 4 answered by Wali 2026-09-29; ADRs 0015 to 0018)
- Depends on: 002 (core records)

## Goal

Make "if a person can do it, an agent can do it" true by construction. Every capability is declared once as an **operation**, and the same declaration produces the REST endpoint (which the UI uses), the MCP tool (which agents use), the typed client and the docs. At the end of this plan, record operations (create, update, activate, archive, unarchive, restore, delete draft, history, links) are available through both doors, and CI proves the UI has no other way to change data.

## An operation

```ts
defineOperation({
  id: 'records.update',             // stable, namespaced
  summary: 'Change a record's label or attributes',
  input: z.object({ ... }),          // Zod (ADR 0011) → JSON Schema for MCP and OpenAPI
  output: z.object({ ... }),
  effect: 'write',                   // read | write | physical (touches inventory or instruments)
  agentPolicy: 'direct',             // direct | propose (see question 1)
  preview: true,                     // supports a dry run that returns the diff without writing
  run: async (ctx, input) => { ... },
});
```

Every call runs with a `RecordContext` (actor, org, lab) from the token. Errors share one shape: `{ code, message, details }`, where the message is written for a person or an agent to act on (the same codes as `RecordError`).

## Round 4 answers and decisions

| # | Question | Answer | Consequence |
| --- | --- | --- | --- |
| 1 | What may agents do without asking? | As proposed. Wali eventually wants autonomous agent experiment execution, and a live view of what agents are doing. | Each operation declares an agent policy (`direct` or `propose`, decided per call, e.g. editing a draft is direct and editing an active record is proposed). The policy is resolved in one place, so autonomy levels per agent can be added later without touching operations. Proposals are stored with a preview and approved or rejected by a person. |
| 2 | How many MCP tools? | Few; add as needed | Two MCP tools: `describe_operations` and `run_operation` (with `preview`). |
| 3 | Outside agents | Yes, on Wali's machine, including bring-your-own-key models such as DeepSeek | The MCP server is the contract for any model. A `token` command issues agent tokens. The in-app agent (plan 004) gets a provider interface: Claude by default, plus any OpenAI-compatible endpoint with your own key (amends D5). |
| 4 | Preview | Yes | Every write runs inside one transaction; a preview runs it and rolls back, returning what would have happened. |
| 5 | Bulk | Yes | The same transaction makes every operation all-or-nothing, batches included. |
| 6 | Logging | Only changes, plus a live ledger of what recently happened | An `activity` table records every write, proposal, approval, rejection and failure with actor, operation, records touched and duration. `GET /v1/activity` lists it and `/v1/activity/stream` pushes new entries live (server-sent events) for the ledger view in plan 004. |

Routine choice: operations are called RPC-style (`POST /v1/ops/{operationId}`, `?preview=true`), which maps one-to-one onto MCP and keeps OpenAPI simple.

## Delivered (once decided)

- `packages/schema`: operation contracts (ID, summary, input and output schemas, effect), shared by server and client, and the error shape.
- `apps/api`: the operation registry, generated REST routes and OpenAPI, an MCP server (Streamable HTTP) generated from the same registry, preview support, a proposals table for agent-proposed changes, the activity ledger with a live stream, a `token` command, and record operations wired to the record service.
- `packages/client`: a typed client generated for the web app and tests.
- CI check: the web app may change data only through the generated client.
- A first skill (`skills/records/SKILL.md`) explaining record operations to agents.

## As built

- MCP is stateless Streamable HTTP at `/mcp`; any MCP client, including bring-your-own-key models (Wali will use OpenRouter), connects with an agent token from `pnpm --filter @ailab/api token --agent "<name>"`.
- Agent approvals run the change as the proposing agent; a proposal whose record changed meanwhile is marked failed.
- Details: `docs/architecture/operations.md`.
