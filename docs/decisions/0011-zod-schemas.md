# 0011: Zod 4 as the schema source

- Status: accepted
- Date: 2026-09-29
- Plan: 002 (decision T3)

## Context

One source must produce TypeScript types, runtime validation, JSON Schema for MCP tools and agent output, and Python models.

## Options

1. Zod 4
2. TypeBox
3. Hand-written JSON Schema

## Decision

Option 1. Schemas live in `packages/schema`. JSON Schema is generated into `packages/schema/generated/` and CI fails if it is stale.

## Consequences

Python models are generated from the JSON Schema when the science service first needs them.
