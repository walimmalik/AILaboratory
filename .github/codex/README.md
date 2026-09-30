# Codex on pull requests

Two Codex runs on each pull request, using the owner's own Codex CLI and ChatGPT sign-in (no API key). Each posts one comment on the PR that is updated on every new push. Neither is a required check; their findings are advice, and AGENTS.md asks PR authors to fix the blocking ones or say why not.

| Run | Prompt | What it does |
| --- | --- | --- |
| Code review | `review.md` | Reads the diff and the code around it against `AGENTS.md`, the plans and the ADRs, and reports blocking and non-blocking issues with file and line. Read-only sandbox, high effort. |
| UI QA | `ui-qa.md` | Starts the PR's app as its own Docker Compose project on ports 15432, 13001, 18001 and 18080 (`compose.qa.yaml`), so it runs beside the lab's own app; creates a lab and loads the seed; then drives it in headless Chrome through Playwright's MCP server: the PR's screens end to end, a smoke pass over the rest, console and network errors, both themes, a narrower window, and information overload. Only for PRs that touch `apps/`, `packages/`, `seed/`, `compose.yaml` or the lockfile. Screenshots and the stack log stay on the machine that ran it, under the PR's worktree in `qa-shots/`. The stack is removed afterwards. |

## Running it

From any checkout of the repo, on a machine with the Codex CLI signed in, `gh` signed in, Docker and pnpm:

```
pnpm codex:pr run 63               # review and QA one PR
pnpm codex:pr run 63 --only review # or --only qa
pnpm codex:pr run 63 --no-post     # keep the reports local
pnpm codex:pr watch                # every open PR, again on each new push (polls every 5 minutes)
```

Each PR gets a detached worktree under `~/ailab-review/pr-<number>`, so the lab's own checkouts are never touched. `watch` remembers what it reviewed in `~/ailab-review/state.json`, runs one PR at a time, and skips PRs from forks and PRs labelled `skip-codex`.

## Settings (environment variables, all optional)

| Name | Default | What |
| --- | --- | --- |
| `CODEX_MODEL` | `gpt-6.1-sol` | Model for both runs (the ChatGPT-account slug). |
| `CODEX_REVIEW_EFFORT` | `high` | Reasoning effort for the review. |
| `CODEX_QA_EFFORT` | `medium` | Reasoning effort for the QA run. |
| `CODEX_BIN` | found | Path to the Codex CLI. Without it the script uses `codex` on PATH, then the CLI inside the Windows Codex app. |
| `CODEX_PR_DIR` | `~/ailab-review` | Where worktrees, state and local reports go. |
| `QA_OPENROUTER_API_KEY` | none | Turns on the in-app assistant in the QA lab so its flows get tested. `QA_AGENT_MODEL` picks its model. |

## Changing what they check

Edit the prompts here. Both read `AGENTS.md` and the architecture docs at run time, so new rules there reach the reviewers without a prompt change.
