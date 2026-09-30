---
name: codex-pr
description: Run Codex code review and browser UI QA on an AILaboratory pull request with the owner's local Codex CLI. Use right after opening or pushing to a PR, or when asked to review or QA a PR with Codex.
---

# Codex review and UI QA on a pull request

Every PR gets both runs, started by whoever opens or pushes to it; the owner does not start them. The runner is `scripts/codex-pr.mjs`; `.github/codex/README.md` explains what each run checks and its settings. It runs on the machine where the Codex CLI is signed in with ChatGPT (the owner's laptop), with `gh`, Docker and pnpm.

## From a cloud or project thread

Right after you open a PR or push commits to one, start a Remote Control session on the owner's preapproved device (`list_devices`, then `start_rc_session`) with instructions to:

1. `git pull` in the runner checkout `C:\dev\ailab-codex-watch` (clone the repo there if missing; never use the lab's own checkouts).
2. Run `node scripts/codex-pr.mjs run <number>` there. It makes a detached worktree under `~/ailab-review/pr-<number>` and posts or updates two PR comments: "Codex review" and, when the PR touches the app, "UI QA".
3. Report back only if it failed, and why.

Then treat blocking findings in those comments like review comments on your PR: fix them or answer why not. If the device is offline, say so once and carry on. Only one QA run at a time: they share ports 15432, 13001, 18001 and 18080.

## On the laptop directly

- `pnpm codex:pr run <number>`; add `--only review` or `--only qa` for one run, `--no-post` to keep the reports local.
- `pnpm codex:pr watch` covers every open PR and each push while its terminal stays open, for PRs nobody's thread will start (for example ones opened by hand).
