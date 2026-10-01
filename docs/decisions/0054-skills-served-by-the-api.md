# 0054: Skills served by the API and MCP

- Status: accepted
- Date: 2026-10-01
- Plan: 004e (step 004e-5, first part; decision R7, as recommended)

## Context

Each module has a skill (`skills/<module>/SKILL.md`) explaining its operations to agents, but only agents with the repo checked out could read them. The in-app assistant got none, although ADR 0024 says the calculators skill belongs in its prompt. Nothing checked that a new operation was explained anywhere.

## Options

A) `skills.list` and `skills.get` operations, the same skills as MCP resources, the calculators skill in the assistant's system prompt, and a CI check that every operation and calculator appears in a skill. B) Put all skills into the system prompt. C) Leave skills in the repo for outside agents only. Wali chose A.

## Decision

- `pnpm generate` bundles the skills into `apps/api/src/skills/skills.generated.json` (module, name, description and Markdown text), so the API serves them from its container too. The Markdown files stay the one source, and CI fails when the bundle is stale, as for JSON Schema and migrations.
- `skills.list` lists the skills (module, name, description). `skills.get {name}` reads one by module (`sops`) or name (`ailab-sops`). Both are reads anyone can call.
- MCP serves each skill as a resource at `skill://<module>`, and its instructions say to read a module's skill before first working in it.
- The in-app assistant's system prompt includes the calculators skill in full and tells it to read other skills with `skills_get`.
- A test fails when any operation in the catalog is not named in backticks in some skill.

## Consequences

- A new operation needs a line in its module's skill before CI passes.
- The assistant's prompt grows by the calculators skill (about 1k tokens). The rest load on demand.
