# 0020: The in-app assistant runs our own tool loop, with one adapter per model provider

- Status: accepted
- Date: 2026-09-29
- Plan: 004 (round 5, question 1); amends 0005

## Context

ADR 0005 put the in-app agent on the Claude Agent SDK over our MCP server. Wali also wants to run cheap models (DeepSeek and others through OpenRouter) with his own key, and to compare them fairly with Claude. The Agent SDK only drives Claude.

## Options

1. The Claude Agent SDK for Claude, plus a separate loop for other models
2. One small tool loop of our own in the API, with a model adapter per provider (Anthropic, and anything that speaks the OpenAI chat-completions format)

## Decision

Option 2. The loop lives in `apps/api/src/assistant/` and calls operations through the registry directly, not over MCP: each operation an agent may call is one tool, named after its ID (`records.create` becomes `records_create`). The assistant acts as an agent on behalf of the signed-in person, with the conversation ID as its session, so it follows the same agent policies and proposals as any outside agent and every change it makes is in the ledger. Providers: `openrouter`, `openai-compatible` (any base URL, e.g. Ollama) and `anthropic`, chosen with `AGENT_PROVIDER` in `.env`. Claude replies are stored in their original form and sent back unchanged, as Claude's thinking requires.

## Consequences

Any model gets the same prompt, tools and conversation, so behavior differences are the model's. We own a small loop (step limit, timeouts, failure states) instead of the SDK's. Outside agents (Claude Code and others) still use MCP. Sending every operation as a tool is fine while there are a few dozen; when the list grows, switch to the MCP pattern (describe, then run) or tool search.
