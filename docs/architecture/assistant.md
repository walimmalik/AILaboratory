# In-app assistant

The assistant panel in the web app talks to a model of your choice, which works through the lab's operations. Plan 004b; decision in ADR 0020.

## How it works

1. A person sends a message with `assistant.ask` (people only). It saves the message, marks the conversation `running`, and starts the loop in the background once the write is committed.
2. The loop (`apps/api/src/assistant/assistant.ts`) sends the model a system prompt (which includes the calculators skill in full, ADR 0054), the conversation so far, and its tools (ADR 0055, `apps/api/src/assistant/toolset.ts`): a core set (records reads, `records.create` and `records.update`, `review.list`, `changes.apply`, `proposals.list`, skills, `operations.describe`), every calculator, the operations of the modules the person's page belongs to and of modules the conversation already used, and `run_operation` for the rest. People-only operations and `assistant.*` are never offered. A `run_operation` call is stored under the operation it ran. The page context names the record on screen and its version.
3. Each tool call runs through `OperationRegistry.execute` as an agent: `{type: "agent", agentName, onBehalfOf: <the person>, sessionRef: <conversation id>}`, with a server-owned originating user-message reference in its record context. Agent policies apply as for any outside agent, so changes to active records come back `proposed` and wait on the Review page. After each turn the panel adds a "Waiting for you" line linking the drafts the turn wrote and the changes it proposed that still wait (computed from the turn's tool results and the live `review.list`, not written by the model). The ledger shows each change under the assistant's name, and the ledger line links back to the conversation.
4. Results go back to the model until it answers without calling a tool, until a proposed change needs a person, or until 16 steps. On a proposal the loop saves a terminal review request, records later calls in that batch as unexecuted, and becomes `idle`. Approval of a pending assistant proposal is refused while its conversation is running; a replay of an already approved proposal still returns its stored receipt. Preflight reads, prompt construction and the model/tool loop all share the failure cleanup boundary, so a preflight exception also changes `running` to `failed`. Empty model replies and the step limit produce an explicit continuation/limit message.
5. Each tool result the model sees is cut at 30,000 characters, so the long reads have short forms the prompt names: `review.list` puts its `counts` first and takes a `limit`, `records.get {brief: true}` leaves out section confirmations and per-item evidence, `records.kinds {summary: true}` discovers kinds, sections and keyed lists, and `operations.describe {schema: false}` lists a namespace without its schemas. The assistant uses offered operation schemas directly and requests only missing schemas by ID. Generic `records.create`, including supporting registry creation, requires the named kind's attribute schema; a module operation such as `sops.draft` does not require a full SOP kind-schema read merely to save a draft. The prompt tells the model to put changes that belong together in one `changes.apply` set, that a person confirms a draft with one Confirm, and, for a conversation whose proposals people have decided, which were confirmed, rejected (with the person's reason) or failed, so it doesn't propose a rejected change again (review 2026-10-01 I8, I13).

Page context also names existing skills whose modules match its operation namespaces. Run pages
name the campaigns skill; operation namespaces are not assumed to be skill names. This uses the
existing page/kind mapping and skill metadata, without changing skill lookup or record verification.

## Files

A person can attach up to 5 text files to a message (JSON, CSV, TXT and similar, up to 2 million characters each; attach button or drop on the reply box). They are kept on the user message as `attachments` with a `file_…` ID. The model sees each as a line naming the ID and size, then the first 4,000 characters. To hand a whole file to a tool it writes `{"$file": "file_…"}` where the value goes (e.g. `{"definition": {"$file": "file_…"}}` for `labware.import_opentrons`); the loop swaps in the file before the operation runs (parsed for JSON files), so the model never retypes a file. The ledger records attachments by name and size only. Files an operation returns (contracts with `file`) show under the step with Download and Copy, and the model is told not to repeat them. PDFs and spreadsheets are not attachable yet.

Messages are stored provider-neutrally in `conversation_messages.body` (user, assistant with tool calls, tool results with an outcome). The provider's own reply is kept in `provider_raw` and sent back unchanged while the same provider and model continue the conversation (Claude requires its thinking blocks unchanged). A conversation continues on whichever model is set up now. After an API restart, conversations left `running` are marked `failed`.

The composer retains newer unsent text and attachments while a send completes, including when the first request receives its conversation ID. Explicit conversation switches, New and fresh requests reset the composer; automatic ID assignment does not. Successful sends clear only the text and attachments that were submitted.

## Selected context and request identity

Every new ask gets its own `OriginatingIntent` with the stored conversation and user-message IDs, even when it continues the same conversation. A contextual reply may explicitly name the original user message or a prior contextual reply with `replyTo` and a selected pending proposal or open scientific question. The service verifies ownership, lab, current record version, question stage/state or proposal state, and the stored root request. For a proposal chain it reads the proposal's producing conversation through `sessionRef` and requires the actual producing turn to retain that root intent; it does not search other conversations. An explicitly selected different question is refused even if the turn also read its SOP. It then retains the original intent. Page context and chat text never authorize approval.

`PageContext.activeQuestion` names a question and its scientific stage on the displayed record/version; `PageContext.proposal` names a persisted proposal. Current question responses/dispositions and proposal state are re-read from records/proposals before a model turn. Existing tool results supply proposal identities after reload; a new conversation can recover one through explicit selected context. A missing or stale selection refuses, and unsupported historical question data is reported as unavailable rather than interpreted through a legacy reader. The new question lifecycle uses `ScientificQuestion`; accepted-history reconciliation remains a separate rollout dependency.

When a current SOP has saved question responses, its selected context includes scoped continuation guidance: reuse the responses, including unknowns, avoid repeating an already-answered question, and investigate evidence or suggest a specific way to obtain it. An unknown keeps the scientific issue open and disputed settings unchanged. Ordinary chat or notes are not persisted question responses, and the assistant cannot call the people-only `sops.answer_question` operation or claim prose recorded one. The focused fake-model harness checks authoritative response recovery and this authority boundary; it does not prove live model compliance.

Selected-question chat offers **Record response** beneath the person's message, using `sops.answer_question`; **Continue with assistant** then uses the saved question and current SOP version. The selected question survives navigation and reload through persisted human-message context, with explicit change/clear controls. Sending waits for conversation context to load. Changed versions require reviewing the current question; a failed save reads the SOP before offering a retry. An identical saved response is displayed as an existing answer, not claimed as a receipt for a particular chat message. Generated discussion prompts and attached files are not offered as response text. Validated context points to the chat action even before the first response is saved; the SOP question form remains an alternative. This path adds no decision approval or final confirmation authority.

Earlier recorded chat answers keep their SOP, question and current issue status visible, with old controls under **Revisit response**. Unsaved answers stay actionable; revisiting a changed SOP still requires reviewing the current question before continuing.

This slice exposes originating intent to downstream decision operations; persisting it on ordinary proposals, supporting records and review groups belongs to SG-03. It adds no task store or synthetic intent classification. Safe replay of missing tool messages, stop/resume controls and dedicated Apply decision cards remain separate packages.

## Models

Set in the repo-root `.env`; the API reads it at start.

| `AGENT_PROVIDER` | Needs | `AGENT_MODEL` default | Agent name in the ledger |
| --- | --- | --- | --- |
| `openrouter` | `OPENROUTER_API_KEY` | `deepseek/deepseek-chat` | the model's short name, e.g. `deepseek-chat` |
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-opus-5-5` | `Claude` |
| `openai-compatible` | `AGENT_BASE_URL` (e.g. `http://localhost:11434/v1` for Ollama), optional `AGENT_API_KEY` | none; set it | the model's short name |
| `scripted` | `AILAB_TEST_KINDS=1` (tests only) | | `Test assistant` |

`AGENT_NAME` overrides the name. With OpenRouter, `AGENT_PROVIDER_ORDER` (comma-separated provider tags, e.g. `fireworks,together`) sets which providers to try first; OpenRouter falls back to others if they fail. Without a working setup the app still runs; `assistant.status` and the panel say what is missing. Claude requests use prompt caching and, on models that support it, server-side refusal fallbacks. Model errors are shown to the person; keys never appear in messages or logs.

## Responses transport and continuation

For `openai-compatible`, `AGENT_API_FORMAT=responses` selects the `/responses` endpoint under the configured `AGENT_BASE_URL`; omission selects `chat-completions`. There is no automatic fallback or model substitution. For example, a LiteLLM deployment exposing Sol 6.1 uses the existing base URL and key with `AGENT_MODEL=gpt-6.1-sol` and `AGENT_API_FORMAT=responses`. Restart the API after changing configuration. See [ADR 0070](../decisions/0070-responses-agent-continuation.md).

The Responses adapter stores ordered output with its protocol, endpoint and model identity. It replays original phases, reasoning and call IDs exactly once when that identity matches; otherwise it translates normalized conversation messages. An explicit commentary-only reply continues within the existing step limit. Refused or truncated replies never execute their tool calls; each skipped call receives an explicit result. Pending proposals retain the same pause boundary and do not execute deferred calls on approval. SOP review and suggestions obey the same terminal-output boundary.

Live evaluation establishes observed saved work, not scientific validation or a reliability guarantee. Tool exposure and context-size optimization are a separate measured step in plan 004g.

## Operations and doors

| Operation | |
| --- | --- |
| `assistant.status` | Which model is set up, or why none is |
| `assistant.ask` | Send a new request (new conversation, or `conversationId` to continue), optionally with `attachments` and typed page selection; `replyTo` retains an originating request only for validated pending context; refused while the conversation is still running |
| `assistant.list_conversations`, `assistant.get_conversation` | Your conversations; other people's are not found. Agents acting for you can read them. |

`GET /v1/assistant/conversations/{id}/stream` streams one conversation's new messages and status changes (server-sent events). The web panel keeps the shown conversation live over it.

## Tests

`apps/api/src/assistant/*.test.ts`: the loop against a fake model (operations as an agent, proposals, history, refused tool calls, model failure, the step limit, running conflicts, people-only and ownership), and each adapter's request and response mapping against a fake `fetch`. End-to-end, the scripted model runs an operation from the ask bar.

## Limits for now

- No token streaming: the panel shows each step and reply as it is saved, not word by word.
- No way to stop a run from the panel yet; the step limit and a 180 s model timeout bound it.
- One process: the conversation stream uses an in-process bus, like the ledger.
