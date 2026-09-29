# 0015: One operation registry behind REST, MCP and the client

- Status: accepted
- Date: 2026-09-29
- Plan: 003

## Context

Agents must be able to do everything a person can (product rule 2). If the UI, REST and MCP each had their own handlers, they would drift apart.

## Options

1. One registry of operations; REST routes, MCP tools, OpenAPI and the typed client are all derived from it
2. Hand-written REST routes, with MCP tools wrapping them

## Decision

Option 1. An operation's public half is a contract in `packages/schema` (ID, summary, effect, Zod input and output). `apps/api` implements it with a `run` function and, for writes, an agent policy. Everything calls `OperationRegistry.execute`, which validates input and output, applies the policy, runs writes in one transaction and writes the ledger. Routes are RPC-style: `POST /v1/ops/{operationId}`.

## Consequences

Adding a capability is one contract plus one implementation, and it is immediately available to people and agents. The web app may call the API only through `@ailab/client` (a lint rule forbids `fetch` in `apps/web/src`).
