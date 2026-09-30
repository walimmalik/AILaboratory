# Web app and design system

The "bench console" design system, accepted by Wali on 2026-09-29 as mockup v3 (https://claude.ai/artifact/4ECfKnRveEYembEY1ToNJs). Rules for building it are in [web-app.md](../architecture/web-app.md); screenshots in [docs/screens](../screens).

## Layout

- Module nav on the left, the page in the middle, the agent panel docked on the right and collapsible.
- A global ask bar in the top bar (`/` focuses it) starts a new conversation; the panel continues the one shown.
- A status bar at the bottom like a terminal statusline: the lab, instrument lamps, and what the agent is doing.
- Two modes per page: **explore** (browse registries, read-only, rich views) and **design** (a draft with the agent beside it and a readiness panel).
- Desktop first. Bench views (loading instructions, plate setup, the run checklist) must work on a tablet.

## Look

- **Day and night themes.** Terminal-inspired but restrained: no rainbow, no gradients, no glow.
- **Type:** IBM Plex Mono for anything read off an instrument or a label (IDs, quantities, wells, headings, the ask bar); IBM Plex Sans for prose and controls; Martian Mono for the brand, page titles and section headings. Fonts are self-hosted so the app works offline.
- **Color by role:** green-grey neutrals on a paper day ground and a near-black night ground; one teal accent for actions and selection; **agent ink (violet)** for anything an agent drafted or assumed that nobody has confirmed, which turns to normal ink once confirmed; green, amber and red only for state; muted data colors for plate maps, tinted from the data (standards shade with concentration). Every color is a token in `src/styles/tokens.css` with day and night values.
- **Shape:** 4 px corners, hairline rules, dense tables with tabular numbers.
- **Small terminal touches:** lamps (status dots), a path-style breadcrumb (`experiments / cytokine-panel-b / EXP-0042`), a blinking caret in the empty ask bar (off with reduced motion), a faint graph-paper grid.

## What Wali does not want

These read as "AI tells" and are not allowed:

- **Colored side stripes** on cards, sections or containers.
- **Containers inside containers**: boxes in boxes, tinted header bands inside an outlined box, outlined tracks inside sections.

Instead: **one outline per top-level block**, and state said in words, lamps or icons ("needs review" in agent ink, "✓ confirmed" in green, "● live").

## Human interaction rules

Added 2026-09-30 with [plan 004e](../plans/004e-review-v2-and-agent-context.md), after the human interaction review. The rule behind them is Wali's: keep all information available, but design what shows first.

1. **What you confirm is what you read.** Each kind renders a section in its lab form (steps, plate, table, graph), never as a field dump, and any ID at any depth shows as a linked name.
2. **Up front: blockers, guesses and what changed since you last looked.** Everything confirmed or derived folds to one line, and empty fields hide.
3. **Agent ink is rare.** Only values an agent guessed or was told show in agent ink; values from confirmed records, templates, memory or calculators say where they came from in normal ink.
4. **One queue, one count.** Everything waiting for a person is a Review item with an addressee; only what blocks something is counted, and a truncated list always says its total.
5. **One intent, one confirm.** What an agent does for one ask is confirmed or rejected as one; a group with no guesses and no failing checks can be confirmed together.
6. **Confirm rules, not rows.** Derived content (wells generated from a layout) is marked calculated and not reviewed item by item.
7. **A person's own edit is their confirmation** of the values they typed.
8. **People are never slower than agents.** Anything an agent can propose, a person can do on the page it concerns.
9. **Plain words are part of the contract.** No screen shows an operation ID, and a failure shows its reason on the row.
10. **A person never edits JSON** for a value whose shape the schema knows.
11. **Every record answers "where is it" and "what's in it"** on its own page; a grid of wells has a contents legend and a search.
12. **Every fix is a choice with a consequence**, and a "Fix in…" link goes where the fix is made.
13. **Show state only when it isn't the default**, and a check's source is the reason in lab words, with plan numbers under technical details.
14. **Laptop width is the normal case:** tables scroll rather than clip, with the assistant open.
15. **Agents discover, then load:** a small core toolset plus calculators, with skills and module tools served on demand.

## Language

- Plain lab language on screen. Record IDs, operation IDs and JSON sit under "technical details".
- One verb for agreeing to agent work: **Confirm** ("Confirm change" for a proposal; "Confirm volume and activate" on the last section).
- Record status in words: "draft · needs your review", "active", "active · change waiting".
- Where a value came from, in words: "assumed by deepseek-chat", "you told Claude", "from a datasheet", "entered by you".

## Pages so far

- **Nav:** Lab (Activity, Review) and Library (one page per registry, each with its draft count), with All records at the foot.
- **Library pages:** Labware (family filter; type, manufacturer, catalog number, maximum volume), Vendors, Documents and SOPs. More registries get a page as they land. An SOP's page reads as a procedure at the bench first (steps with run values, questions to settle, checks against the source), with the editable sections below.
- **Review:** everything waiting for you, grouped by kind.
- **Record review:** a readiness block with failing checks first, each with its source, its fix and a "Fix in …" link; passing checks fold under "N checks pass". Then one block per section with each value and where it came from, and Edit to change values in place.
- **Labware drawings:** a labware type drawn to scale from above with named wells, and one well cut through its centre filled to the maximum volume. Values the record doesn't give are drawn dashed and listed, so a draft has a picture without the picture claiming values nobody entered.

## Interaction

- No 100-option forms or wizards. The agent fills the options; the page shows the result; a person adjusts. Small fixes by hand (select wells and pick a role), bigger ones by asking.
- Agent changes are highlighted like track changes against the last confirmed values, with the confirmed value struck through, plus a list of what changed.
- Confirm section by section; the last section activates.
- The run view is a checklist with "all done as planned".
