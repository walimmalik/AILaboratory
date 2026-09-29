# 004: Agent shell and UI foundation

- Status: accepted (round 5 answered by Wali 2026-09-29, all as recommended); 004a merged, building 004b. Direction and design system accepted by Wali on 2026-09-29 (mockup v3: console layer, single outlines, no side stripes, no nested containers)
- Depends on: 003 (operation registry)
- Mockup: https://claude.ai/artifact/4ECfKnRveEYembEY1ToNJs

## Round 3 answers

| Question | Answer |
| --- | --- |
| Look | Day and night themes. Terminal-inspired, with a restrained palette, not rainbow. Claude proposes the design system (below). |
| Layout | Module nav on the left, page in the middle, agent panel docked on the right and collapsible |
| Starting work | Both: a global ask bar routes to the right design page with a draft, and the agent panel continues the conversation there |
| Confirming | Section by section, then one final confirm. Downstream work uses the confirmed version only. |
| Showing agent changes | Highlight on the page, like track changes, plus a short list of what changed |
| Devices | Desktop first; bench views (loading instructions, plate setup) must work on a tablet |

## Proposed design system ("bench console")

- **Type:** IBM Plex Mono for anything you would read off an instrument or a label: IDs, quantities, well positions, section headings, the ask bar. IBM Plex Sans for prose and controls. That gives the terminal feel without making paragraphs hard to read.
- **Color, by role:**
  - Neutrals with a slight green-grey bias, on a paper-like day ground and a near-black night ground.
  - One accent (teal) for actions and the current selection.
  - **Agent ink (violet):** anything Claude drafted or assumed that nobody has confirmed yet. It turns into normal ink once the section is confirmed, so "what did the AI decide for me" is always visible at a glance.
  - Semantic colors (green ok, amber attention, red problem) only for state, never decoration.
  - Muted data colors for plate maps (standards, controls, samples, blanks) that stay readable in both themes.
- **Shape:** 4 px corners, hairline rules, dense tables with tabular numbers, and few boxes. Sections are bordered, and nothing else is.
- **Tokens:** every color is a token, with day and night values. The web app keeps one token source in the same way echo650-twin does.

### Console layer (added after Wali found v1 a little plain; compare with the Plain/Console switch in the mockup)

Character that carries information, with no gradients or glow:
- **Display face:** Martian Mono (a variable-width monospace) for the brand, page titles and section headings. Plex Mono and Plex Sans stay for data and prose.
- **Bottom status bar, like a terminal statusline:** lab, live instrument states with lamps ("FLX-01 running", "RDR-02 reading, 04:12 left"), and what the agent is doing ("draft v1, 3 assumptions").
- **Lamps:** small status dots in the nav and status bar (green running or ready, amber busy, grey idle), in the spirit of echo650-twin's mimic board.
- **State in words, not stripes:** each section's header says "needs review" in agent ink or "✓ confirmed" in green.
- **Containers (Wali, 2026-09-29):** one outline per top-level block and no boxes inside boxes. No colored side stripes on containers, no tinted header bands, and no outlined tracks inside sections.
- **Data-driven color:** plate wells take their tint from the data, for example standards shading with concentration.
- **Small terminal touches:** a path-style breadcrumb (`experiments / cytokine-panel-b / EXP-0042`), a blinking block caret in the empty ask bar (off with reduced motion), a faint 24 px graph-paper grid on the background, and Claude's name in agent ink on its messages.

## Models

The in-app agent uses a provider interface: Claude by default, plus any OpenAI-compatible endpoint with the user's own key. Wali will use an OpenRouter key (2026-09-29), so OpenRouter (base URL plus model name, e.g. a DeepSeek model) is the first non-Claude provider to support.

## Scope (to finalize before building)

App shell and routing, theme tokens, the ask bar, the agent panel (on our own tool loop, round 5 question 1, ADR 0020), the draft document framework (sections, per-section confirm, final confirm, version on confirm), the readiness panel (checks with a source and a fix action), change highlighting and a changes list, and "assumed" markers wired to the schema's assumed-value flag.

## Round 5: scope decisions

Wali chose the recommended option (bold) for all six on 2026-09-29. Keys: `OPENROUTER_API_KEY` in the repo-root `.env`.

| # | Question | Options | Recommendation and why |
| --- | --- | --- | --- |
| 1 | How the in-app agent runs | A) Claude Agent SDK for Claude plus a separate loop for OpenRouter · B) One small tool loop of our own in the API, with two model adapters (Anthropic and OpenAI-compatible) | **B.** The Agent SDK only drives Claude models. One loop over our operation registry behaves the same whatever the model, so OpenRouter models get a fair test. Claude Code and other outside agents still use MCP. This amends D5 again. |
| 2 | Where API keys live | A) `.env` on your machine · B) A settings page that stores them encrypted in the database | **A for now.** Nothing to build and nothing stored in the database; a settings page can come with hosting. |
| 3 | How you sign in to the web app | A) A simple password login with a session cookie · B) Paste an API token · C) No sign-in on localhost | **A.** It is small, and the hosted cluster will need it anyway. SSO can replace it later. |
| 4 | Saving agent conversations | A) Save every conversation, linked to the page and records it touched, and openable from the ledger · B) Keep them only in the browser | **A.** It feeds the ledger view, lab memory (plan 005) and the notebook later. |
| 5 | What the first screens are | A) Real data now: live activity ledger, proposals inbox (approve or reject with a before-and-after preview), record list and detail with history, plus the agent panel · B) Start with a mock experiment design page | **A.** Everything shown is real and testable today. The draft-and-confirm framework is built next and first used for real by labware in plan 007. |
| 6 | How to split the work | A) Three PRs: 004a shell, sign-in, ledger, proposals and records · 004b agent panel and model adapters · 004c draft-and-confirm framework · B) One PR | **A.** Small PRs, each usable on its own. |

Routine choices (not asking): TanStack Router and TanStack Query, Radix primitives styled with our own CSS tokens (no Tailwind, to keep the console look), Playwright for end-to-end tests.

## 004b: defaults chosen while building (routine; say if any should change)

| Choice | Default | Why |
| --- | --- | --- |
| Tools the assistant sees | One tool per operation an agent may call (`records_create`…), not MCP's describe-then-run pair | Cheaper models call named tools with schemas far more reliably. Revisit when there are more than a few dozen operations. |
| Who the assistant is in the ledger | An agent on behalf of the signed-in person, named after the model (`deepseek-chat`, `Claude`), with the conversation as its session | You can tell which model did what, and every ledger line opens its conversation. Same proposals as outside agents. |
| Asking | `assistant.ask` is an operation (people only), so each ask is a ledger line; the answer runs in the background and streams to the panel | Human = agent, and a long model run should not hold a request or a transaction open. |
| Ask bar vs panel | The ask bar always starts a new conversation; the panel's box continues the shown one; `/` focuses the ask bar | Matches round 3 ("both"); routing to design pages comes with 004c. |
| Conversations | Private to the person who started them; agents acting for that person can read them | Personal by default; sharing can come with lab memory (005). |
| Streaming | Step by step (each reply and each operation as it is saved), not word by word | Much simpler across providers; token streaming can come later. |
| Limits | 16 model turns per message, 180 s per model call | Bounds cost and stuck runs until there is a stop button. |
| Models | `openrouter` (default `deepseek/deepseek-chat`), `anthropic` (default `claude-opus-5-5`), `openai-compatible` (e.g. Ollama) | Your key first; local models for free testing. |
| New read operation | `records.kinds` lists kinds with their attribute schemas | The assistant (and any agent) needs it before creating records. |
