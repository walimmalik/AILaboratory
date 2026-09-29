# 0005: In-app agent on the Claude Agent SDK over our MCP server

- Status: amended by [0020](0020-own-agent-loop.md): the in-app assistant runs our own tool loop with model adapters; the MCP server stays the contract for outside agents
- Date: 2026-09-29
- Plan: 000 (decision D5)

## Context

Agents must be able to do everything a person can, inside the app and from outside it (Claude Code, the Claude app, other agents).

## Options

1. Claude via the Claude Agent SDK, using our own MCP server as its tools
2. Model-agnostic via OpenRouter, as echo650-twin does

## Decision

Option 1. The MCP server generated from the operation registry is the contract; the in-app agent is one client of it, plus a small set of UI tools (navigate, open a draft, highlight).

## Consequences

Any MCP-capable agent can drive the app. The in-app agent needs an API key configured on the server; the app still works without one.
