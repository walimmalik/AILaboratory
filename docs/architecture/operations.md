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
   - **Otherwise**: runs in one transaction (all-or-nothing) with its `succeeded` ledger entry, returns `{status: "done", output}`. A refused write is rolled back and logged as `failed` with its error, then the error is returned.
5. Output is checked against the contract before it leaves the server.
6. Activity delivery and an implementation's `after` work wait for the outermost registry transaction to commit. Nested savepoints merge their delivery work into that boundary; a rollback discards it (including previews). Delivery or hook failure is logged without changing the committed result. `assistant.ask` uses `after` to start the assistant in the background.
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

**Approval receipts (004g SG-15a).** The existing proposal row stores `receipt` with the actual validated output, actual touched record IDs, optional calculation handle and receipt time. Applying locks that row and commits the mutation, receipt, approved status and ledger entries together. Retrying an approved proposal returns the same stored proposal and receipt, even after reload or lost stream delivery, without another mutation, ledger entry or hook. The receipt describes the committed output rather than the rolled-back preview. Approved historical rows without a receipt refuse replay with a clear message. Agent restrictions and lab isolation apply to retries too. Beyond the bounded draft-volume and existing experiment input/material-role decisions below, broader question disposition and supporting-record confirmation scopes remain SG-03 work; final SOP confirmation remains separate.

The third selector is strictly typed dilution_final_volume, supplying only the SOP/version, selected method question, proposed quantity, existing passage and reason. The server derives saved associations and exact source-number/calculator facts. Sole person Apply dispatches only its typed resolution/completion to the checkpointed owning authorization; arbitrary resolution remains refused. The resulting plain SOP receipt retains actual acceptor and original proposer/request, with ordinary whole-Values review and final draft status. The same proposed/pause and pending refreshed/stale contracts apply. This checks literal source agreement and arithmetic, never full assay validity. The paired slice remains unreleased pending integrated gates, independent review and browser acceptance.

The optional typed `decision` metadata now supports three strict nonoverlapping `review.prepare_decision` selectors on a never-confirmed draft SOP: an uncited same-unit positive scalar volume default, or acceptance of one existing open experiment question bound to its declared input or no-default material role without changing its method/stage/binding or required explicit experiment choice. Mixed or caller-supplied authority fields refuse. It returns the existing proposed outcome for every caller, so the assistant pauses, and cannot be nested in a change set. `proposals.approve` requires its displayed `expectedPreview` digest, locks/rebuilds/rechecks through commit and applies only unchanged decision meaning. Stale or substantively refreshed previews return the same pending proposal with `previewStatus: stale/refreshed`, without a scientific write or receipt; their ledger outcome is proposed. A fresh volume click applies as original proposer plus actual human approver. The bounded experiment obligation acceptance applies as the actual person through its SOP owner with the exact opaque transaction authorization, preserving original proposer and trusted origin in the proposal. Neither confirms the final SOP. Other scientific decision shapes/scopes remain refused; final SOP confirmation is separate. See the [bounded SOP contract](sops.md#draft-volume-default-decision-preparation-and-apply). The experiment-obligation paired path remains unreleased pending final integrated hosted gates, review and browser acceptance; see its [bounded acceptance contract](sops.md#existing-experiment-input-acceptance).

Direct creates retain trusted creation origin on their record envelopes, including direct change-set results. Ordinary delayed proposal approval stamps new records with unknown origin because this path has no stored preparation-origin contract; it never uses the approver's current request. Existing proposer, approver and receipt semantics are unchanged. See [core records](core-records.md#creation-origin-004g-sg-03-foundation).

Code that composes registry writes must keep their outer boundary in `registry.transaction(db, callback)` and pass its transaction to nested `execute` calls. A supplied transaction not owned by the registry is refused: returning from an unknown savepoint cannot establish that the caller's outer transaction committed. Record-service transactions that do not compose registry calls remain ordinary database transactions.

**Skills** (ADR 0054). `pnpm generate` bundles `skills/<module>/SKILL.md` into `apps/api/src/skills/skills.generated.json`; `skills.list` and `skills.get` serve them, MCP lists each as the resource `skill://<module>`, and a test fails when an operation is named in no skill.

`activity.list` filters the ledger by `since`, `record`, `conversation`, `actor` (`people` or `agents`) and `mine` (ADR 0053).

**Change sets** (ADR 0051). `changes.apply {steps: [{operation, input}], reason?}` runs up to 50 operations in order on one transaction, all or nothing. `"$N.path"` string values read step N's output (`"$1.id"`). A calculator step saves its calculation like a direct call, and `"$N.calculation"` is that handle, so a later step's evidence can cite it (review 2026-10-01 item 17); naming it on a step that is not a calculator is refused. The registry's `runStep` runs a step inside the set's transaction with no ledger entry of its own, `policyFor` asks a step's policy, and `touchedBy` names what it touched, so the set's single ledger entry lists every record. For an agent, the steps are tried in a rolled-back transaction: if any step would be proposed, the whole set is one proposal, which approval applies as one. Steps' `after` work runs once the set commits (`afterStep`).

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
