---
name: codex-pr
description: Run Codex code review and browser UI QA on an AILaboratory pull request with the owner's local Codex CLI, or keep watching for new PRs. Use when asked to review or QA a PR with Codex.
---

# Codex review and UI QA on a pull request

The runner is `scripts/codex-pr.mjs`; `.github/codex/README.md` explains what each run checks and its settings. It needs the machine that has the Codex CLI signed in with ChatGPT (the owner's laptop), plus `gh`, Docker and pnpm.

1. From a checkout of the repo: `pnpm codex:pr run <number>`. It makes a detached worktree under `~/ailab-review/pr-<number>`, never touching the lab's own checkouts, then posts or updates two PR comments: "Codex review" and, when the PR touches the app, "UI QA".
2. Add `--only review` or `--only qa` for one run, `--no-post` to keep the reports local (the path is printed).
3. To cover every PR: `pnpm codex:pr watch` in a terminal that stays open. It reviews each open PR and again after each push.
4. The review takes several minutes at high effort; QA also builds the stack. Don't start a second QA while one runs: they share ports 15432, 13001, 18001 and 18080.

When the comments land, read them on the PR. Blocking findings get fixed on the PR or answered there with why not.
