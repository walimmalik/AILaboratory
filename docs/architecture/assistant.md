# In-app assistant

The assistant panel in the web app talks to a model of your choice, which works through the lab's operations. Plan 004b; decision in ADR 0020.

## How it works

1. A person sends a message with `assistant.ask` (people only). It saves the message, marks the conversation `running`, and starts the loop in the background once the write is committed.
2. The loop (`apps/api/src/assistant/assistant.ts`) sends the model a system prompt, the conversation so far, and one tool per operation an agent may call (people-only operations and `assistant.*` are left out).
3. Each tool call runs through `OperationRegistry.execute` as an agent: `{type: "agent", agentName, onBehalfOf: <the person>, sessionRef: <conversation id>}`. Agent policies apply as for any outside agent, so changes to active records come back `proposed` and wait on the Proposals page. The ledger shows each change under the assistant's name, and the ledger line links back to the conversation.
4. Results go back to the model until it answers without calling a tool, or until 16 steps; the conversation then becomes `idle` or `failed` with a message that says what happened.

Messages are stored provider-neutrally in `conversation_messages.body` (user, assistant with tool calls, tool results with an outcome). The provider's own reply is kept in `provider_raw` and sent back unchanged while the same provider and model continue the conversation (Claude requires its thinking blocks unchanged). A conversation continues on whichever model is set up now. After an API restart, conversations left `running` are marked `failed`.

## Models

Set in the repo-root `.env`; the API reads it at start.

| `AGENT_PROVIDER` | Needs | `AGENT_MODEL` default | Agent name in the ledger |
| --- | --- | --- | --- |
| `openrouter` | `OPENROUTER_API_KEY` | `deepseek/deepseek-chat` | the model's short name, e.g. `deepseek-chat` |
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-opus-5-5` | `Claude` |
| `openai-compatible` | `AGENT_BASE_URL` (e.g. `http://localhost:11434/v1` for Ollama), optional `AGENT_API_KEY` | none; set it | the model's short name |
| `scripted` | `AILAB_TEST_KINDS=1` (tests only) | | `Test assistant` |

`AGENT_NAME` overrides the name. Without a working setup the app still runs; `assistant.status` and the panel say what is missing. Claude requests use prompt caching and, on models that support it, server-side refusal fallbacks. Model errors are shown to the person; keys never appear in messages or logs.

## Operations and doors

| Operation | |
| --- | --- |
| `assistant.status` | Which model is set up, or why none is |
| `assistant.ask` | Send a message (new conversation, or `conversationId` to continue); refused while the conversation is still running |
| `assistant.list_conversations`, `assistant.get_conversation` | Your conversations; other people's are not found. Agents acting for you can read them. |

`GET /v1/assistant/conversations/{id}/stream` streams one conversation's new messages and status changes (server-sent events). The web panel keeps the shown conversation live over it.

## Tests

`apps/api/src/assistant/*.test.ts`: the loop against a fake model (operations as an agent, proposals, history, refused tool calls, model failure, the step limit, running conflicts, people-only and ownership), and each adapter's request and response mapping against a fake `fetch`. End-to-end, the scripted model runs an operation from the ask bar.

## Limits for now

- No token streaming: the panel shows each step and reply as it is saved, not word by word.
- No way to stop a run from the panel yet; the step limit and a 180 s model timeout bound it.
- One process: the conversation stream uses an in-process bus, like the ledger.
