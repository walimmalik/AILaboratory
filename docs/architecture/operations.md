# Operations: registry, REST, MCP, proposals and the activity ledger

Every capability is an **operation**. People (through the web app) and agents (through MCP or REST) call the same operations through the same code path, so the UI can do nothing an agent can't. Decisions: ADRs 0015 to 0018.

## Pieces

| Piece | Where |
| --- | --- |
| Contracts: ID, summary, plain words (`verbs.done` and `verbs.intent`, which screens show instead of the ID; ADR 0048), effect (`read` or `write`), Zod input and output, and optionally `file` when the output is a file a person saves (clients offer it as a download; agents don't repeat it) | `packages/schema/src/operations/` |
| Result, error, proposal and activity shapes | `packages/schema/src/operation.ts` |
| Registry and `execute` | `apps/api/src/operations/registry.ts` |
| The catalog: every contract by ID, which screens read words from; a test checks the registry registers exactly these | `packages/schema/src/operations/catalog.ts` |
| Implementations | `apps/api/src/operations/*-operations.ts` |
| REST, OpenAPI and the live stream | `apps/api/src/app.ts`, `operations/describe.ts` |
| MCP server | `apps/api/src/operations/mcp.ts` |
| Typed client | `packages/client` |
| Skills for agents | `skills/` |

## What `execute` does

1. Looks up the operation and validates input against its contract (`invalid_input` with a readable list of problems).
2. Refuses agents on people-only operations (`forbidden`), such as approving proposals.
3. Reads run and return `{status: "done", output}`. They are not logged.
4. Writes:
   - **Preview** (`?preview=true`): runs in a transaction and rolls back. Returns `{status: "preview", output}`; nothing is saved or logged, not even a readable-name counter.
   - **Agent with a `propose` policy**: previews, stores a proposal with that preview, logs `proposed`, and returns `{status: "proposed", proposal}`.
   - **Otherwise**: runs in one transaction (all-or-nothing), logs `succeeded`, returns `{status: "done", output}`. A refused write is rolled back and logged as `failed` with its error, then the error is returned.
5. Output is checked against the contract before it leaves the server.
6. An implementation may declare `after`, which runs once a write is committed and logged (never on previews or proposals). `assistant.ask` uses it to start the assistant in the background.
7. Write listeners (`registry.onWrite`) run after each committed write a person makes at the top level, with the records it touched (a change set counts once, with every record). Lab memory's repeated-override detector is one (plan 005c-1b). A listener's failure is logged and never fails the write.
8. The registry runs each operation with its ID in the record context (`via`), so every version it writes names it (ADR 0053). An implementation with `ledger: false` (only `records.mark_seen`) writes no ledger entry.

## Agent policies

A write declares `agentPolicy`: `direct`, `propose`, or a function deciding per call. People always run directly. Current record policies:

| Operation | Agents |
| --- | --- |
| `records.create` | direct for drafts, proposed when `status: "active"` |
| `records.update`, `records.restore` | direct on drafts, proposed on active records |
| `records.activate`, `records.archive`, `records.unarchive` | proposed |
| `records.delete_draft` | direct for the agent's own draft (it alone wrote every version, for the same person, and nothing is confirmed); proposed otherwise (C5) |
| `labware.import_opentrons` | direct (creates a draft) |
| `labware.use_standard_positions` | direct on drafts, proposed on active records |
| `instruments.register` | direct (creates a draft) |
| `instruments.change_configuration` | direct on drafts, proposed on active records |
| `instruments.set_status`, `instruments.log_service` | proposed |
| `reagents.draft_product` | direct (creates drafts) |
| `reagents.receive_lot`, `reagents.set_lot_status` | proposed |
| `liquids.record_verification` | proposed |
| `entities.draft_kind`, `entities.draft` | direct (create drafts) |
| `locations.create`, `inventory.register_containers`, `inventory.move` | proposed |
| `inventory.fill`, `inventory.transfer`, `inventory.consume`, `inventory.correct`, `inventory.discard`, `inventory.stamp`, `samples.register` | proposed |
| `records.confirm_section`, `records.confirm` | people only |
| `assistant.ask` | people only |

Approving (`proposals.approve`, people only) runs the stored input as the proposing agent inside the approval's transaction, so history credits the agent and the ledger shows `succeeded` (by the agent, with the proposal ID) and `approved` (by the person). If the record changed since the proposal, the proposal becomes `failed` with the error and nothing changes. The preview in a proposal shows what would have happened at proposal time; readable names shown in a create preview may differ from the final ones.

**Skills** (ADR 0054). `pnpm generate` bundles `skills/<module>/SKILL.md` into `apps/api/src/skills/skills.generated.json`; `skills.list` and `skills.get` serve them, MCP lists each as the resource `skill://<module>`, and a test fails when an operation is named in no skill.

`activity.list` filters the ledger by `since`, `record`, `conversation`, `actor` (`people` or `agents`) and `mine` (ADR 0053).

**Change sets** (ADR 0051). `changes.apply {steps: [{operation, input}], reason?}` runs up to 50 operations in order on one transaction, all or nothing. `"$N.path"` string values read step N's output (`"$1.id"`). The registry's `runStep` runs a step inside the set's transaction with no ledger entry of its own, `policyFor` asks a step's policy, and `touchedBy` names what it touched, so the set's single ledger entry lists every record. For an agent, the steps are tried in a rolled-back transaction: if any step would be proposed, the whole set is one proposal, which approval applies as one. Steps' `after` work runs once the set commits (`afterStep`).

## Doors

| Door | How |
| --- | --- |
| REST | `GET /v1/operations` (contracts with JSON Schemas), `POST /v1/ops/{id}` with a JSON body and optional `?preview=true`, `GET /v1/openapi.json` |
| Errors | HTTP 400/401/403/404/409/500 with `{code, message, details?}` |
| Live conversation | `GET /v1/assistant/conversations/{id}/stream`: `ready` and `status` (the conversation's state), `message` (each new message), `ping`. Only the conversation's owner. See [assistant.md](assistant.md). |
| Live ledger | `GET /v1/activity/stream`: server-sent events `ready`, `activity` (one ledger entry) and `ping` every 25 s, for the caller's lab. Each entry carries `recordNames` (readable names at the time of the change) so a ledger line can say "archived WDG-0001" even after a draft is deleted. |
| MCP | `POST /mcp` (Streamable HTTP, stateless, JSON responses). Two tools: `describe_operations` (optionally by namespace or IDs; `schema: false` lists IDs and summaries only, for scanning a large namespace) and `run_operation` (`operation`, `input`, `preview`). Refusals come back as tool errors with `{code, message}`. |
| Web app | `@ailab/client`: `call(contract, input, {preview})` returns the typed result; `run` returns the output or throws. `apps/web/src` may not use `fetch` (lint rule). |

All doors need `Authorization: Bearer <token>`, or the web app's session cookie (ADR 0019; cookie-authenticated writes must be JSON). Agent tokens act on behalf of a person: `pnpm --filter @ailab/api token --agent "Claude Code"`.

## Connecting an agent

Any MCP client works, including bring-your-own-key models. For Claude Code on your machine:

```bash
claude mcp add --transport http ailab http://localhost:3001/mcp --header "Authorization: Bearer <agent token>"
```

## Adding an operation

1. Add the contract to `packages/schema/src/operations/<module>.ts` and export it.
2. Implement it with `implement(contract, {run, agentPolicy})` in `apps/api/src/operations/` and register it in `createRegistry`.
3. Test valid input, invalid input and permission (agent policy or people-only), per AGENTS.md.
4. Explain it in the module's skill in `skills/`.

## Limits for now

- The live stream uses an in-process bus. Several API replicas will need Postgres `LISTEN/NOTIFY`.
- No roles yet: any person in the lab may approve.
- Every ask to the in-app assistant is a write, so it shows in the ledger as "asked the assistant".
