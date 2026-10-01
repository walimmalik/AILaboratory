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
2. **Up front: blockers, guesses and what changed since you last looked.** Derived content folds to one line and empty fields are named in one line; confirmed content stays open (rule 27).
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

Added 2026-10-01 after the second human interaction review (reviews/ux-2026-10-01 in the project files):

16. **A diff is rows of what changed.** A proposal, a change set step and "changed since you last looked" render from item paths, one row per changed value or list item, never two copies of a list; unchanged items fold to a count.
17. **Done means applied.** Today lists only what ran; what waits is under Waiting; no link points at a record that does not exist.
18. **Looking includes acting.** Saving, confirming or approving marks the record seen for that person.
19. **Unverified values are marked where they are edited and read,** not only on the readiness line, and parts are named by their label ("step 2 Wash", "Wash volume").
20. **One Confirm per record, for every kind.** Which parts are confirmed sits under technical details; a part can still be confirmed on its own from its block.
21. **A batch action never errors on what it offered.** When some drafts in a list can't be confirmed together, the button confirms the ones that can and names how many are left; warnings are counted, not refused.
22. **An agent never destroys a person's work directly.** Deleting a draft a person wrote or confirmed any of is a proposal.
23. **Evidence that names a source is checked against it.**
24. **A person starts a common record from its registry page.** Products, lots, places, labware types and vendors have a "New …" form drawn from the kind's schema (required fields first, the rest folded); it saves a draft through the same `records.create` an agent calls. Other kinds are drafted by asking the assistant.

Added 2026-10-01 with [plan 004f](../plans/004f-navigation-and-record-pages.md), after Wali asked for fewer, linked views (ADR 0063):

25. **An area per kind of work, a tab per kind of thing.** Eight menu entries; a kind and its items are one view. A new capability's plan says whether it is a menu entry, a tab in an area, a tab on a record page, or a fact on the Overview.
26. **Every record leads with what it is and where.** An identity line and a few key facts chosen per kind, then its picture, then the tabs Overview · the kind's tabs · History · Connections · All fields.
27. **Confirmed content is open.** Nothing folds to bookkeeping; nothing filled reads "none" or "not chosen yet", never "empty · confirmed".
28. **A source is said once.** Sources per section in All fields; a value nobody sourced is marked wherever it shows.
29. **Three state vocabularies, never mixed:** the record's review state in the header, the physical thing's state in the identity line, a value's source beside values.

## Language

- Plain lab language on screen. Record IDs, operation IDs and JSON sit under "technical details".
- One verb for agreeing to agent work: **Confirm** ("Confirm change" for a proposal; "Confirm LWT-0032" on a draft, which confirms every part nothing blocks).
- Record status in words: "draft · needs your review", "confirmed", "confirmed · change waiting", "archived" (the stored status "active" reads "confirmed", 004f N8).
- Where a value came from, in words: "unverified · entered by deepseek-chat, no source", "stated by you to Claude", "from a datasheet", "entered by you". An agent's value without a source is **unverified**, never an "estimate" or a "guess", and confirming it is verifying it; on a confirmed record it reads "no source given" (004f N8).
- An SOP value's type, in words: **protocol default** (fixed by the SOP, may be overridden for a run), **set per run**, **calculated** (from a formula), **from <material>** (read from the selected lot or record; a **nominal value** stands in until one is selected).

## Pages so far

- **Nav:** Lab (Today, Activity, Review) and Library (one page per registry, each with its draft count), with All records at the foot.
- **Library pages:** Labware (family filter; type, manufacturer, catalog number, maximum volume), Vendors, Documents and SOPs. More registries get a page as they land. An SOP's page reads as a procedure at the bench first (steps with run values, questions to settle, checks against the source), with the editable sections below.
- **Review:** "Needs you" (changes agents proposed) first, each as rows of what would change with the agent's estimates marked and counted ("Confirming accepts 2 estimates of the agent's"), then drafts to confirm as dense rows with kind chips, Discard, and "Confirm all" or "Confirm the N ready ones" for the drafts that hold no guess and nothing blocks (ADR 0050). The nav counts only what needs you.
- **Record pages (004f-1):** the name with its code as a tag, an identity line and key facts from `records.overview`, then the tabs Overview · History · Connections · All fields. The Overview holds the readiness block when something is left to do (the agent's unsourced values by name, failing checks with their fix and a "Fix in …" link that opens the part on All fields, one Confirm), the key facts, and the kind's own picture and blocks. All fields is one block, a heading per part, its sources said once ("Confirmed by you on 1 Oct. Volume from the datasheet per Claude (p. 2); color entered by Claude with no source given (marked ◦)"), its values, "Not filled: …", Edit and "confirm only this part". Connections lists "Based on" and "Used in"; History lists every version with Restore. A missing record says so and links to All records.
- **Labware drawings:** a labware type drawn to scale from above with named wells, and one well cut through its centre filled to the maximum volume. Values the record doesn't give are drawn dashed and listed, so a draft has a picture without the picture claiming values nobody entered.

## Interaction

- No 100-option forms or wizards. The agent fills the options; the page shows the result; a person adjusts. Small fixes by hand (select wells and pick a role), bigger ones by asking.
- Agent changes are highlighted like track changes against the last confirmed values, with the confirmed value struck through, plus a list of what changed.
- One Confirm confirms every part nothing blocks; a draft left with nothing to do becomes active. The SOP editor marks each box still holding an agent's estimate in agent ink.
- The run view is a checklist with "all done as planned".
