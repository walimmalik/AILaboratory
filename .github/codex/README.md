# Codex on pull requests

Two advisory GPT runs on every pull request, each posting one comment that is updated on every push. Neither is a required check; their findings are advice.

| Run | Workflow | Prompt | What it does |
| --- | --- | --- | --- |
| Code review | `.github/workflows/codex-review.yml` | `review.md` | Reads the diff and the code around it against `AGENTS.md`, the plans and the ADRs, and reports blocking and non-blocking issues with file and line. |
| UI QA | `.github/workflows/ui-qa.yml` | `ui-qa.md` | Starts the full stack with Docker Compose, creates a lab and loads the seed, then drives the app in headless Chrome through Playwright's MCP server: the PR's screens end to end, a smoke pass over the rest, console and network errors, both themes, and information overload. Screenshots and stack logs are uploaded as the `ui-qa-screenshots` artifact. Runs only when the PR touches `apps/`, `packages/`, `seed/` or `compose.yaml`. |

Both use [openai/codex-action](https://github.com/openai/codex-action) with Codex in a read-only sandbox. Label a PR `skip-codex` to skip both. PRs from forks are skipped (they get no secrets).

## Setup (repository settings, Secrets and variables, Actions)

| Name | Kind | Needed | What |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | secret | yes | OpenAI API key with access to the model below. |
| `CODEX_MODEL` | variable | no | Model for both runs. Default `gpt-sol-6.1`. |
| `CODEX_REVIEW_EFFORT` | variable | no | Reasoning effort for the review. Default `high`. |
| `CODEX_QA_EFFORT` | variable | no | Reasoning effort for the QA run. Default `medium`. |
| `QA_OPENROUTER_API_KEY` | secret | no | Turns on the in-app assistant in the QA lab so its flows get tested. Without it the assistant reports that no model is set. |
| `QA_AGENT_MODEL` | variable | no | Assistant model for the QA lab (OpenRouter id). Default: the app's OpenRouter default. |

## Changing what they check

Edit the prompts here. Both read `AGENTS.md` and the architecture docs at run time, so new rules there reach the reviewers without a prompt change.
