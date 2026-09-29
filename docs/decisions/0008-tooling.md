# 0008: Repository tooling

- Status: accepted
- Date: 2026-09-29
- Plan: 001

## Context

Plan 001 needs a package manager, formatter/linter, test runner and HTTP framework. These are routine choices, recorded so agents don't reopen them.

## Options

Considered: pnpm vs npm workspaces; Biome vs ESLint + Prettier; Vitest vs node:test; Hono vs Fastify vs Express; uv + ruff + pytest vs pip + black + flake8.

## Decision

- **pnpm workspaces**, matching echo650-twin.
- **Biome** for formatting and linting TypeScript: one fast tool, one config.
- **Vitest** for TypeScript tests (works for both Node and React code).
- **Hono** for the API: small, typed routes, and a Zod/OpenAPI integration that fits the operation registry in plan 003.
- **uv, ruff and pytest** for Python.
- **TypeScript 7** in strict mode with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- Node 24 LTS in containers and CI; Node 22+ works locally.

## Consequences

`pnpm check` runs lint, typecheck and tests for TypeScript; Python has its own uv commands. CI runs both plus a container build.
