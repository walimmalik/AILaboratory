# 0001: TypeScript core with a Python science service

- Status: accepted
- Date: 2026-09-29
- Plan: 000 (decision D1)

## Context

The app needs one type system across API, UI and MCP tools, and it reuses echo650-twin's twin, scheduler and schema code, which are TypeScript/JavaScript. The analysis module (statistics, curve fitting), compound handling and sequence tools are far better served by Python (scipy, statsmodels, RDKit, Biopython), and the hardware SDKs we will drive later (Hamilton, Opentrons) are Python.

## Options

1. TypeScript core + Python science service
2. Python core (FastAPI) + TypeScript frontend
3. All TypeScript

## Decision

Option 1. `apps/api` and `apps/web` are TypeScript. `apps/science` is a Python service for computation only; it owns no records and is called by the API. The future device gateway (plan 022) is also Python.

## Consequences

Schemas must be shareable across languages: the TypeScript schema source generates JSON Schema, from which Python models are generated. Two toolchains in CI (pnpm and uv).
