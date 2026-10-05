# 0070: Explicit Responses transport and bounded model continuation

- Status: accepted
- Date: 2026-10-05
- Plan: 004g, SG-16a follow-up

## Context

The live Sol 6.1 evaluation used Chat Completions and often ended with a promise instead of saved work. The model's documented tool interface is Responses. An external Responses pilot saved a partial SOP and supporting drafts while preserving unresolved science, but does not establish general reliability or a latency improvement. Wali authorized the next small implementation batch after reviewing that evidence.

The existing model interface already persists opaque provider output with conversation history. The loop nevertheless treats every tool-free reply as finished, and can execute calls from a refused or truncated reply. The same interface serves SOP review and suggestion.

## Options

1. Add more prompts or tool-menu changes first, leaving the transport and continuation gap unresolved.
2. Add explicit Responses support to the existing model interface and bounded loops.
3. Replace the harness or automatically switch protocols/models, broadening the demo and making failures less predictable.

## Decision

Use option 2. `AGENT_API_FORMAT=responses` selects Responses for `AGENT_PROVIDER=openai-compatible`; omission means `chat-completions`. Keep the configured base URL, key and model. Invalid formats are reported, with no automatic fallback. This implementation choice stays within the authorized batch and does not change the default provider or scientific authority.

Preserve ordered output, assistant phase, function-call identities and encrypted reasoning in provider raw state. Scope raw replay to protocol, endpoint and model; represent other history through existing normalized messages. Never replay both representations of one assistant turn.

Add one nonterminal `continue` stop reason. Commentary persists and consumes a step in the existing bounded loop. Refused or truncated output cannot execute tools or supply accepted scientific suggestions. Pending proposals still pause the turn; skipped calls retain explicit results so continuation does not replay a mutation.

## Consequences

No new operation, persistence table, workflow engine, protocol fallback or automatic approval. Calculator authority and final human confirmation remain unchanged. SOP model consumers share the continuation and terminal rules. Deterministic adapter and lifecycle tests establish these contracts; disposable live/browser acceptance records observed completion separately from scientific validation. Tool-menu and schema-size optimization remains SG-16d, measured after the transport fix.

References: [Sol 6.1 model contract](https://developers.openai.com/api/docs/models/gpt-6.1-sol), [Responses reasoning and replay](https://developers.openai.com/api/docs/guides/reasoning), [function calling](https://developers.openai.com/api/docs/guides/function-calling).
