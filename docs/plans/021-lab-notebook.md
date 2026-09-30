# 021: Lab notebook

- Status: accepted. Rounds 1 and 2 (N1 to N12) accepted by Wali 2026-09-30, all as recommended. Eight changes from the adversarial review (`reviews/021-lab-notebook-adversarial.md` in the project files) accepted by Wali the same day; see "Changes after the adversarial review", which wins where it differs from a round's text. Builds after 020 in plan order; 021a can start earlier, since 011 and 013 exist. Embedding analyses and graphs waits for 020.
- Depends on: 002 (records, versions, links), 003 (operations, activity ledger, ADR 0018), 004 (saved conversations, draft and confirm, Review, 004e change sets and page context), 005 (lab memory: entries as evidence, memories proposed from entries), 010 (containers, lots, samples, the volume ledger), 011 (file store, text search, the deterministic mention matcher of ADR 0035), 013 (campaigns, experiments, runs with steps, deviations and data files, conclusions, sets), 014 (plate maps), 020 (analyses and Vega-Lite graphs to embed)
- Needs from other modules (owned there, built before the 021 step that uses them):
  - **002:** `tags` on the record envelope (change 1) and the `Locator` type in `packages/schema` (change 1), before 021a.
  - **013:** `runs.correct` for a late actual or deviation on a finished run (change 4), before N7 in 021b. Until then N7 works only on runs in progress.
  - **003 (ADR 0018 amendment):** ledger rows record the records they wrote as `{id, version}`, with an index over record ids (change 5), in or before 021b.
  - **011:** a shared text index with one `search.all` that any module registers into (change 6), before 021d; image previews, thumbnails, HEIC and EXIF handling for photos (change 7), before 021c's run-view photos.
  - **One PDF renderer for 020 and 021** (headless Chromium over a print view of the web app, change 6), decided as an ADR by whichever of 020b or 021d is built first.
  - **Lab setting:** a lab time zone (change 1), in 021a; 019 needs it too.
- Feeds: 005 (entries are evidence for memories, and a person's "remember this" from an entry), 013 (values written in a note become run records through `runs.correct`), 020 (entries cite analyses and graphs)

## What this plan delivers

The one place a person (or an agent) writes down what happened, what they saw and what they think, and the one place to read back what the lab did on a day, for an experiment or across a campaign:

- **Free writing:** observations ("cells looked patchy in column 12"), troubleshooting, ideas, meeting and literature notes, bench photos and gel images, written fast and linked to the records they are about.
- **The timeline:** what the lab actually did, built by code from what is already recorded (runs, deviations, data, analyses, conclusions, sets, stock used, schedules, lab memory), so nobody retypes it.
- **Agents write too:** an agent drafts a day summary, a run write-up or a transcription of a photographed paper page; a person confirms. Numbers in an agent's text come from records and calculators (ADR 0024), never from the model.
- **Everything links:** a note that names `RUN-0012` or LOT-0017 appears on those records' pages, and an entry can show a plate map, a run or a graph as it was when it was written.

## What it does not duplicate

The records below already hold the facts. The notebook points at them and shows them; it never keeps a second copy that can drift.

| Already recorded | Where | The notebook |
| --- | --- | --- |
| Step actuals, deviations, data files of a run | 013 run | Shows them in the timeline; a value typed in a note can become a run record (round 2) |
| Hypotheses, verdicts, conclusions, sets | 013 experiment and set | Timeline and embeds |
| Numbers, fits, quality, graphs | 020 analysis | Embeds pinned by version |
| Who changed what, when | 003 activity ledger, 002 record history | The raw source the timeline is computed from |
| What the agent was asked and did | 004 conversations | Linked from the timeline and entries |
| Conventions, quirks, lessons | 005 lab memory | Entries are evidence; entries can propose memories |
| Protocols and papers | 011 library, 012 SOPs | Linked and searchable together with entries |

## Starting point

- Plan 000 promised "entries built on the event log plus free-form writing, linked to everything", and ADR 0018's activity ledger and 002 T1's version snapshots were both chosen partly to feed the notebook timeline.
- 012 G9 and 013 put bench recording on the run (a checklist with done as planned, deviations with a reason). 013 E7 note: people are lazy at the bench, so type only what differed.
- 019 S11: a loosened constraint is carried into the run and the notebook.
- 004 saves every assistant conversation, linked to the records it touched.
- 011 (ADR 0035) already has a deterministic matcher for the lab's names, catalog numbers, models and synonyms, and keyword search over passages.
- The web app has two Markdown renderers, neither of which knows embeds: `apps/web/src/lib/RichText.tsx` is a small hand-written renderer for what models write (paragraphs, lists, bold, code), and the wiki uses `react-markdown`. 021c adds the notebook's pipeline (react-markdown with a remark plugin for the closed syntax of change 3).
- AGENTS.md: a module that owns outcome data ships detectors to `memory.observe`. The notebook owns free text, not outcome data; see "Detectors".

## Model

| Layer | Record or table | Holds |
| --- | --- | --- |
| Instance | **Notebook entry** (`nbe_`, `NB-0001`) | Author (always a person), `at` (when it was written, set by the server) and `day` (the day it is about, in the lab's time zone, settable backward), title, body in the closed syntax (N2, change 3), what it is about (links with locators, change 1), tags (on the record envelope), `people` mentioned with `@`, `for` (an addressee: a person or `agent`), `replies_to`, attachments (files through 011), `conversation` (the assistant conversation id when an agent drafted it; optional), locked and addenda, status (draft, active, archived) |
| Computed | **Timeline** (no table) | Notable events for a day, a person, an experiment or a campaign, computed from the activity ledger and record history (N3); each event's id is its ledger row id |

## Operations

| Operation | Agents |
| --- | --- |
| `notebook.write` (a person's entry, active at once), `notebook.draft` (an agent's entry, a draft), `notebook.update`, `notebook.confirm` | people write; agents draft, a person confirms |
| `notebook.summarize` (draft a day, run or experiment summary from the timeline) | direct: makes a draft |
| `notebook.timeline` (by day, person, experiment, campaign, record) | read |
| `notebook.lock`, `notebook.unlock` (with a reason, a version shown like a late edit), `notebook.add_addendum` (N4) | people |
| `notebook.request_review` (asks a person to review an entry; their Reviewed is a section confirmation) | direct |
| `notebook.save_reply` (save an assistant reply as a draft entry with the conversation linked) | direct: makes a draft |
| `notebook.get`, `notebook.search` (text, tags, people, `for`, open follow-ups), `notebook.for` (entries about a record), `notebook.tags` (tags in use with counts), `notebook.inbox` (entries addressed to agents) | read |
| `notebook.export` (an experiment, a campaign or a date range as PDF or HTML) | read |

## Screens

- **Notebook page:** today first, one column: your entries and the timeline for the day, summarized ("3 runs finished, 1 deviation, 2 analyses to confirm"), each expandable. Filters for person, experiment and campaign.
- **Writing:** one box, type and go; `[[` to link a record or a place in it, `@` to mention a person, `#` for a tag; paste or drop a photo; nothing else required. Saves on Save, on leaving the box, and at most once a minute while typing (change 7).
- **For you:** a line at the top of the notebook page with entries that mention you or ask you to review, and follow-ups (unticked `- [ ]` boxes) in your entries.
- **Replies:** shown threaded under the entry they answer.
- **On record pages:** a "Notes" line on every record page (it is one link query), with the count and the latest note.
- **Run view:** a note box per step and for the whole run, with the tablet camera for photos and the device's own dictation (N10). Each note is its own entry, linked to the run with a step locator, and the run page groups them by step.

## Detectors

None. The notebook owns written text, not outcome data (runs, ledgers, schedules and results stay with their modules, which ship their own detectors). Lessons in notes reach lab memory through a person's "remember this" or an agent's `memory.propose` citing the entry.

## How the timeline is computed (N3)

Wali asked how this works. Nothing new is stored; the timeline is a query plus pure rules.

1. **Each module declares its notable operations.** Next to an operation's definition (`packages/schema/src/operations`), a module can add a `timeline` entry: the event it stands for (`run_finished`, `deviation_recorded`, `analysis_confirmed`...), which record it is about, and which outcome counts (`succeeded`, or `approved` for a proposal a person confirmed). Everything not declared (edits to drafts, readiness reads, failed calls) stays out. The list is closed and grows only by PR, like the memory effects in 005.
2. **The query.** `notebook.timeline` reads the activity ledger (ADR 0018) for the lab and the window (a day in the lab's time zone, or an experiment's life), keeps rows whose operation is declared, and reads the exact version each row wrote with `getVersion` (the ledger records `{id, version}` after change 5) for what it needs to say ("finished as failed", "2 files", "IC50 0.8 uM" from the analysis's own result, never recomputed). Run-to-experiment links are read in one batch per query. An index over record ids serves per-record timelines. Rows written by the seed are not events. An approved proposal is one event, done by the agent and confirmed by the person.
3. **Grouping and summary lines are pure code** in `packages/domain/notebook`, with unit tests: events are placed under their experiment (a run, a deviation or a data file through its run, an analysis through its runs; anything else under the day), then grouped by day, and each group becomes one line from fixed wording ("RUN-0012 done, 1 deviation, 2 files"). Opening a line lists its events, and each event opens its ledger entry and record.
4. **Agents read the same thing.** `notebook.timeline` is an operation, so an agent's write-up (N5) is built from these events and cites them as record references.

If it ever gets slow, the same rules can fill a cache table without changing what anyone sees.

## Changes after the adversarial review

Wali accepted all eight on 2026-09-30. They settle the entry schema before 021a, move work that belongs to other modules to those modules, and add the tagging, addressing and deep-link layer the rounds left out.

1. **The entry schema is settled before 021a.**
   - `at` and `day`: `at` is when it was written (for a photo, the capture time from EXIF), `day` the day it is about, in a new lab time zone setting (bootstrap and seed set it; grouping by day is tested across midnight).
   - **Tags** are lowercase strings (`[a-z0-9-]`, no registry), typed as `#tag` or picked with autocomplete from `notebook.tags`. They go on the record envelope (002), not only on entries, because experiments, campaigns and memories will want the same tags and moving them later is a migration; renaming a tag is one operation. The write-up shapes of N12 (observation, troubleshooting, meeting, literature) become suggested tags, not templates.
   - **People and addressees:** `@Name` resolves to user ids in `people`; a mention puts the entry in that person's Review in the "for your information" tier (004e R1). `notebook.request_review` adds a "needs you" item; the person's Reviewed is a section confirmation on the entry's one `body` section, so a later edit shows "changed since Jordan reviewed". An entry `for: agent` is listed by `notebook.inbox` for an outside agent to answer as a reply draft; in the app, "Ask the agent" opens a conversation with the entry as page context. A standing agent that watches the inbox is a later plan, not 021.
   - **Locators:** one `Locator` type in `packages/schema` (`{id, version?, path?}`, with a closed set of paths per kind: `steps/<id>`, `wells/<A1>`, `passages/<id>`, `sections/<id>`), used by entry links, the URL router (`/records/RUN-0012?at=steps/s3` scrolls to it; entry headings get stable anchors) and timeline events (the ledger row id). It is core, because 005 memories and 020 conclusions will cite places too.
   - **Replies** are entries with `replies_to`; agents reply as drafts. **Follow-ups** are `- [ ]` checkboxes that toggle in place; `notebook.search {openTasks}` lists them. No task record.
   - **Author and conversation:** the author is always a person (the one the agent acts for); the agent, model and conversation are provenance. `conversation` is an optional attribute, because conversations aren't records and outside agents have none.
   - "Notes" shows on every record page.
2. **Addressed drafts, not private drafts (replaces N9's author-only drafts).** The record service has no per-record visibility, and adding it would be a core decision. An agent's draft is addressed to its author, so it lands in that person's Review and nobody else's, and everywhere else it shows in agent ink as "draft for Jordan". Real privacy, if ever wanted, is asked as a 002 decision covering entries, conversations and personal memories together.
3. **A closed body syntax, checked on write.** `[[RUN-0012]]` links by readable name (an unknown name renders as plain text, "not found"); `[[RUN-0012/steps/s3]]` links a place; `![[PLT-0003@4]]` embeds a record card at a version, which is required and filled in by the editor (a missing version refuses the write, like `checkPin`); `![[FIL-0021]]` shows a stored image or file; GitHub-style Markdown tables, headings, lists, bold, code and checkboxes as usual. Raw HTML, scripts and external images are refused on write, not only stripped on render, because an external image in a note everyone opens is a tracking or exfiltration channel. External links are fine.
4. **N7 targets `runs.correct` in 013.** 013's run writes refuse a finished run, and notes are mostly written after the run. 013 adds `runs.correct`: a late actual or deviation on a finished run with a reason, recorded as a new run version with evidence `stated` citing the entry; people direct, agents proposed. N7 always proposes the structured step form (step, field, planned, actual) when the note names a step and a value, so lab memory's deviation detector can group it (005 change 5), and a free-text deviation only for what isn't a step's value. Until `runs.correct` exists, N7 works only on runs in progress.
5. **ADR 0018 amended in 021b.** A ledger row records the records it wrote as `{id, version}`, and gets an index over record ids. The timeline reads exact versions, never matching by timestamp, and each event's stable id is its ledger row id, which is what deep links to an event use. Inventory events in the timeline are limited to opening a lot, finishing a lot and discards; until 016 links consumption to experiments, they sit under the day.
6. **Search and PDF are decided once, outside 021.** Notes join search through a shared text index owned by 011 (a table keyed by record id and kind that any module registers into, one `search.all` returning hits by kind; embeddings land once for everything), not by writing into `library_passages`. Export uses one renderer shared with 020's reports: headless Chromium in the API over a print view of the web app, so every React renderer (plate maps, graphs, cards) is reused as is. Whichever of 020b or 021d is built first writes the ADR both cite.
7. **Editing, bench notes, photos and context.**
   - The editor keeps a local draft and saves on Save, on blur, and at most once a minute while typing; a save with no change makes no version. The ledger row for `notebook.write` and `notebook.update` keeps the body's length and the linked records, not the body. "Edited" means a version written after the entry's day. A version conflict shows the other person's text instead of retrying.
   - One entry per bench note, linked to the run with a step locator; "write it up" folds them into one summary draft that links each.
   - Photos (assigned to 011): JPEG, PNG, WebP and HEIC accepted; a JPEG preview and a thumbnail derived as `derived` files; capture time from EXIF into `at`; GPS stripped before storing; gel and microscope images kept unconverted beside the preview.
   - Only active entries go into the page context bundle, never drafts, each line with its author and day ("Jordan, 12 Oct: edge wells dried again"). An entry addressed to an agent is delivered as an ask, not in the bundle.
   - Locking is a kind rule: a locked entry takes only addenda and refuses `records.update` as well as `notebook.update`. Anyone in the lab may lock or unlock for now (no roles yet); unlocking needs a reason and shows like a late edit. Archiving a locked entry is allowed.
8. **Acceptance scenarios.** Each is a test or an end-to-end run:
   - A person writes "RUN-0012 cells looked patchy in column 12" on the run's page; the entry is active at once, appears under Notes on RUN-0012 and its experiment, and `notebook.for RUN-0012` returns it.
   - In the seed lab's demo campaign, `notebook.timeline` for the ELISA experiment shows one line per run day with the run status, deviation count and file count, and nothing for draft edits, readiness reads or seed loads.
   - An agent's `notebook.draft` for Jordan appears in Jordan's Review and nowhere else as a normal entry; confirming it activates it; the run page's context bundle never contains it before that.
   - An entry embedding `![[PLT-0003@4]]` still shows version 4 after the plate map is edited to version 5, with the "newer version" line; the update moves it to 5.
   - A locked entry refuses `records.update` and `notebook.update` from anyone, accepts an addendum, and the export shows the addendum dated.
   - A note saying "incubated 45 min, not 30" about a finished run yields exactly one proposal (`runs.correct` with step, field, planned and actual), and confirming it links the entry to the run version it made.
   - `@Jordan` puts the entry in Jordan's "for your information" tier, a review request puts it in "needs you", and `#edge-effect` makes it findable by tag.

---

## Round 1 answers

Wali chose A for N1 to N6 on 2026-09-30, and asked how N3 is done (answered above).

## Round 1 questions: what an entry is and how it is written

Recommended option in bold. Asked 2026-09-30.

| # | Question | Options | Recommendation and why |
| --- | --- | --- | --- |
| N1 | How is the notebook organized? | A) **One stream of dated entries. Each entry has an author and links to what it is about (any number of experiments, runs, campaigns, containers, lots, instruments), or to nothing (an idea, a meeting). The same entries are read as "my notebook" (by person and day), on an experiment or run page, on a campaign page, or lab-wide** · B) One notebook per experiment; entries live inside it, and notes that aren't about an experiment go to a general experiment · C) One notebook per person like the paper one, with links out | **A.** One note is often about two experiments (a shared plate, a reagent problem) or none, and B forces a choice or a fake experiment. A gives the paper-notebook view (C) as one filter without making it the only one. |
| N2 | What is the body of an entry? | A) **Markdown with a small closed set of embeds: record references (`[[RUN-0012]]`), a record shown as a card (a plate map, a run's checklist, an analysis graph, a set), files and images, and tables. People edit in a what-you-see editor that writes the same Markdown; agents write the Markdown directly** · B) A rich block editor with its own JSON document format (Notion-like) · C) Plain text plus attachments | **A.** Agents write Markdown natively and without mistakes, history diffs stay readable, and search and the mention matcher work on it as-is. B is nicer for layout tricks but every agent write goes through a block schema, and diffs of JSON are unreadable. C can't show a plate map or a graph in a note. |
| N3 | What is the timeline, and how much of the event log does it show? | A) **Computed by code, never stored: a closed list of notable events (a run started, finished or failed, deviations, data attached, an analysis confirmed, a conclusion, a set made, stock opened or used up, a schedule loosened, a lab memory confirmed, an experiment's stage change), grouped by day and experiment, shown as one summary line per group ("RUN-0012 done, 1 deviation, 2 files") that opens to the events and then to the ledger** · B) The whole activity ledger for the day, filtered by person or record · C) An agent writes a narrative of the day as an entry; no computed timeline | **A.** The ledger logs every edit, which is far too much for a person to read (your rule on overload). Computing it means it can never disagree with the records. C puts the model between the facts and the reader; a written summary can come on top of A (N5). |
| N4 | Can an entry be changed after the fact? | A) **Yes, with full history (every version is kept by the record service). A change made after the entry's day shows "edited 3 Oct" beside it, and the diff is one click away. A person can lock an entry (for a paper, a thesis or a hand-over); a locked entry takes only dated addenda** · B) Entries lock automatically at the end of their day; later changes are addenda · C) Freely editable, history only in the ledger | **A.** No GxP here, and B makes fixing a typo tomorrow a ceremony. The history is kept either way, so A is honest about late edits without getting in the way, and locking is there when it matters. |
| N5 | What do agents write, and when? | A) **Agents draft only: a day or run summary on request or when a person finishes a run ("write it up"), a transcription of a photographed paper page, and notes in a conversation ("add to my notebook that..."). Every number and name in a draft is a record reference or an embed, not typed text. A draft waits for its author's confirm and shows in agent ink until then. No automatic daily summaries** · B) A, plus an automatic end-of-day summary draft per person with activity that day · C) Agents write active entries directly, marked as by an agent | **A.** Automatic drafts pile up unread (another thing waiting for you each evening); summaries on request cost nothing to ask for. C lets a model's reading of the day become the record. B can be switched on later per person if you find you always ask. |
| N6 | How do links and embeds behave? | A) **Readable names (`RUN-0012`, `LOT-0017`) and `[[...]]` references link at once; other names the 011 matcher finds (a product name, "DY206", "HEK293") are suggested inline for the writer to accept with one click. Links are record links (`mentions`), so every linked record lists the note under "Notes". Embeds show the record at the version it had when it was embedded, with a "newer version" line and a one-click update** · B) Links only by explicit `[[...]]`; nothing suggested; embeds always live · C) Everything the matcher finds links automatically | **A.** Readable names are unambiguous, so linking them costs nothing; names can be ambiguous ("IL-6" the protein or the kit), so they are suggested, not linked. Pinning embeds matches ADR 0039: a note from May must still show the plate map as it was in May. |

## Round 2 questions: capture, search, sharing, export

Recommended option in bold. Asked 2026-09-30.

| # | Question | Options | Recommendation and why |
| --- | --- | --- | --- |
| N7 | A note says "incubated 45 min, not 30" or "OD600 was 0.62". Does that become part of the run? | A) **The note stays as written. When an entry is about a run and states something a step or a deviation should hold, the agent proposes the run record (the changed value, or a deviation with the reason), citing the words; one click confirms it and the note links to it. The agent does this when it drafts or when asked, never silently** · B) Code parses quantities in notes and records them on the run · C) Never; only the run checklist records values | **A.** Scientists write things down in the notebook first, so C loses facts the analysis and lab memory's deviation detector need. B guesses which step a number belongs to. A keeps the run as the one place for values, with a person saying yes. |
| N8 | How are entries searched, and do agents read them without being asked? | A) **Entries join the library search (keyword now, embeddings with 011b-2), filterable to notes only. The page context bundle for agents (005b) gets the two or three latest entries about the records on the page, as titles and first lines, marked as notes people wrote (data, never instructions); the agent opens more with `notebook.for`** · B) A separate notebook search; agents read entries only when asked · C) A, with every entry about the page's records in the context | **A.** "What did we see last time with edge wells" should find notes and SOPs together. A short, capped context keeps agents aware of recent trouble without flooding them, and treating notes as data closes the same prompt-injection path 005 closed. |
| N9 | Who sees an entry? | A) **Everyone in the lab sees active entries (like campaigns, 013 E12). Drafts, including an agent's draft for you, are seen only by their author until confirmed. No private entries for now** · B) A, plus private entries only the author sees · C) Visible per campaign membership | **A.** An academic lab works in the open, and private notes in a shared system tend to hide the useful part. B can be added later without changing entries. |
| N10 | How do notes get written at the bench? | A) **A note box on the run view, per step and for the whole run, which writes an entry about that run (and step); the tablet camera attaches photos to it; voice uses the device's own dictation into the box. A photographed paper page becomes an agent's transcription draft (N5)** · B) A, plus recording voice in the app and transcribing it with a model · C) Notes only from the notebook page | **A.** The run view is where people are at the bench, so a note there needs no navigating. Tablets and phones already dictate well; in-app voice adds a model, storage and a second transcript to check. |
| N11 | How does the notebook leave the app? | A) **`notebook.export` turns an experiment, a campaign, a person or a date range into PDF and HTML: entries in order with the computed timeline, embeds drawn at their pinned version (plate maps as images, graphs through vl-convert, record cards as tables), marks for late edits, locks and addenda, and readable names instead of links. On request only** · B) A zip of the Markdown and files · C) A, plus an automatic yearly archive per person | **A.** A thesis chapter, a paper's methods or a hand-over needs something readable outside the app; Markdown alone loses the plate maps and graphs. A yearly archive can come with hosting, when backups are decided. |
| N12 | Are there entry templates (meeting, troubleshooting, literature note)? | A) **No. An entry is one box. The notebook skill describes a few useful shapes, so an agent asked to "write up this troubleshooting" structures it, and a person just writes** · B) A few built-in templates to pick when writing · C) Lab-defined templates as records | **A.** Templates are forms, and a form is what stops people from writing anything. The shape matters most when an agent writes, and the skill covers that. |

## Round 2 answers

Wali chose A for N7 to N12 on 2026-09-30.

## Defaults (not questioned)

- Readable name `NB-0001`; an entry's day defaults to today and can be set back (writing up yesterday).
- Attachments go through the 011 file store and show inline; images are shown, other files as a line with Download.
- An entry about a run is shown on the run page under the checklist, and on its experiment's page.
- Entries by a person are active as soon as they are written (like `memory.remember`); they don't go through Review unless they ask someone to review them.
- Built after 020 in plan order; 021a (entries and links) could start earlier since 011 and 013 exist.

## Split

- **Before 021a (002):** `tags` on the record envelope, the `Locator` type, the lab time zone setting.
- **021a:** the entry record with the schema of change 1 and the closed syntax checked on write, write, draft (addressed to the author), confirm, update, lock, unlock and addenda, links with locators and mention suggestions, tags, `@` mentions and review requests, replies, attachments, `notebook.for`, `notebook.tags`, `notebook.inbox`, `notebook.save_reply`, the notebook skill (with the suggested tags of N12).
- **021b:** the ADR 0018 amendment (`{id, version}` on ledger rows, index over record ids), the `timeline` declarations on operations, `notebook.timeline` with grouping in `packages/domain/notebook` by the lab's time zone, `notebook.summarize`, and proposing run records from a note (N7, through 013's `runs.correct` once it exists).
- **021c:** screens: the notebook page with For you and follow-ups, the editor and its save rules, the notebook Markdown pipeline, "Notes" on every record page, replies, the note box on the run view (one entry per note), embeds pinned by version, locator deep links.
- **021d:** entries registered in 011's shared text index and in the page context bundle (N8, after 005b; active entries only), and `notebook.export` to PDF and HTML through the shared renderer (N11).
