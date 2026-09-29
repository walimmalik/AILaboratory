# Web app

React + Vite (`apps/web`). Plan 004: the shell, sign-in, the live activity ledger, the proposals inbox and the records pages (004a), and the assistant panel and ask bar (004b). The draft-and-confirm framework (004c) extends it.

## Rules

- **Data only through operations.** Pages call `api` from `src/api.ts` (`@ailab/client`). A lint rule forbids `fetch`, `XMLHttpRequest`, `WebSocket` and `EventSource` in `apps/web/src`, so the UI can do nothing an agent can't.
- **Bench console design system.** Colors are tokens in `src/styles/tokens.css` with day and night values; the theme switch sets `data-theme` on `<html>` (or follows the system). Teal accent for actions and selection, violet agent ink for anything an agent did or proposed that nobody has confirmed, semantic colors only for state. Fonts are self-hosted (IBM Plex Mono and Sans, Martian Mono for headings), so the app works offline.
- **Containers.** One outline per top-level block (`.block`). No boxes inside boxes, no colored side stripes, no tinted header bands. State is said in words ("waiting for review", "● live").
- **Plain lab language.** Operation IDs, record IDs and JSON go under "technical details". Helpers in `src/lib/format.ts` turn operations and actors into words ("Claude for you edited WDG-0001", "proposed to edit WDG-0001; waits for your review").

## Pieces

| Piece | Where |
| --- | --- |
| Routes (TanStack Router; everything but sign-in requires a session) | `src/router.tsx` |
| Server state (TanStack Query) | `src/queries.ts`, `src/session.ts` |
| Live updates: one activity stream per tab, which prepends ledger entries and refreshes the review list, proposals and records | `src/live.tsx` |
| Shell: top bar, module nav with lamps, status bar | `src/pages/Shell.tsx` |
| Activity (the live ledger; select a line for details) | `src/pages/Activity.tsx` |
| Review (everything waiting for you, from `review.list`: drafts with what is left, linking to their review; changes to active records, before and after, Confirm change or Reject with a note; decided changes). The nav shows one count | `src/pages/ReviewInbox.tsx` |
| Record status in plain words ("draft · needs your review", "active · change waiting") | `src/pages/StatusChip.tsx` |
| Records list and record detail (fields, history, links) | `src/pages/Records.tsx`, `src/pages/Record.tsx` |
| Review (kinds with sections): a readiness block (what is missing, the agent's estimates, checks with their source and fix, Confirm for kinds without sections), then one block per section with each value, where it came from ("assumed by …" in agent ink, "from a datasheet", "entered by you"), changed values highlighted with the confirmed value struck through, and Confirm section; the last one reads "Confirm … and activate" | `src/pages/RecordReview.tsx` |
| Assistant state: open or closed, the shown conversation (kept live over its stream), sending | `src/assistant.tsx` |
| Ask bar (top bar; `/` focuses it; starts a new conversation) and the assistant panel (right column; replies continue the shown conversation; each step it took as a plain line with the record or the proposal to review, and technical details; after a turn, a linked "Waiting for you" line for the drafts and changes it left) | `src/pages/Shell.tsx`, `src/pages/AssistantPanel.tsx` |

## Sign-in

Email and password (ADR 0019). `POST /auth/login` sets an HttpOnly, SameSite=Strict session cookie for 30 days; `POST /auth/logout` ends it. The API accepts either a bearer token (agents, scripts) or the cookie (the web app); cookie-authenticated writes must be JSON. `bootstrap` sets the first password; `password` resets it.

## Live stream through proxies

`GET /v1/activity/stream` sends `Cache-Control: no-transform` and `X-Accel-Buffering: no`, and the container's nginx turns buffering off for it, so entries arrive as they happen in dev (Vite proxy) and in containers.

## Tests

- Unit tests for the plain-language and diff helpers: `pnpm --filter @ailab/web test`.
- End-to-end (Playwright, `e2e/*.e2e.ts`): sign-in, an agent proposal confirmed on the Review page with history and ledger checks, a draft opened from the Review page and confirmed section by section (the last confirm activates it), live ledger updates, and the assistant running an operation from the ask bar with the ledger linking back to the conversation. The API runs with `AGENT_PROVIDER=scripted`, a test-only model with no network. CI runs them in the `postgres` job against a real API and Postgres. The API runs with `AILAB_TEST_KINDS=1`, which registers the test-only `widget` kind until real kinds arrive (plan 007).
