# 001: Repo skeleton

- Status: in review (draft PR)
- Depends on: 000

## Goal

An empty but working monorepo that every later plan builds on: the rules agents follow, the folder layout, one command to run everything, and CI that catches mistakes before review.

## Decisions

| Decision | Choice | Record |
| --- | --- | --- |
| D1 to D7 from plan 000 | As accepted on 2026-09-29 | ADRs 0001 to 0007 |
| Package manager, linter, test runner, HTTP framework, Python tooling | pnpm, Biome, Vitest, Hono, uv + ruff + pytest | ADR 0008 |

## Delivered

- `AGENTS.md` with product, engineering and docs rules; `CLAUDE.md` imports it so Claude Code and other agents read the same rules.
- `apps/api`: Hono service with `GET /health` and tests.
- `apps/web`: React + Vite page that shows whether the API is reachable (dev proxy `/api` → `:3001`).
- `apps/science`: FastAPI service with `GET /health` and tests, managed by uv.
- `compose.yaml`: Postgres with pgvector, api, science, web (nginx). Dockerfiles for each service.
- CI: TypeScript lint/typecheck/test/build, Python ruff/pytest, compose config and image build.
- `docs/decisions` (template and ADRs 0001 to 0008), `docs/plans` (000 and this plan), `docs/architecture`.

## Not in this plan

Database connection and migrations, schemas, IDs and units (plan 002); the operation registry and MCP server (plan 003); any real UI (plan 004).

## Done when

- `pnpm check` and the Python checks pass locally and in CI.
- `docker compose up --build` starts all four services and the web page reports the API as ok.
