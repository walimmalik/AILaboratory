# AILaboratory

An AI-driven lab management system for wet and dry labs. Agents draft the work (digital SOPs, experiment designs, plate maps, transfers, schedules, analyses) and people review and confirm it visually. Everything a person can do in the app, an agent can do through the same API and MCP tools.

Status: foundation. The architecture, rules and plan sequence are in [docs/plans/000-foundation-architecture.md](docs/plans/000-foundation-architecture.md).

## Run locally

Requirements: Node.js 22 or newer with pnpm, Python 3.12 with [uv](https://docs.astral.sh/uv/), Docker.

```sh
pnpm install
cp .env.example .env
docker compose up -d db
pnpm --filter @ailab/api bootstrap
pnpm dev
```

The API reads `.env` from the repo root. `bootstrap` creates your org, lab and user, and prints your web sign-in (email and a generated password, unless you set `BOOTSTRAP_PASSWORD`) and an API token once; keep them private. If you bootstrapped before web sign-in existed, or forgot the password, run `pnpm --filter @ailab/api password --email you@example.org`.

The web app is at http://localhost:5173 and the API at http://localhost:3001. To run everything in containers instead: `docker compose up --build` (web on http://localhost:8080).

Contributor and agent rules: [AGENTS.md](AGENTS.md).
