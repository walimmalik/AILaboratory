# 021: Lab notebook

- Status: in planning. Round 1 (N1 to N6) asked 2026-09-30.
- Depends on: 002 (records, versions, links), 003 (operations, activity ledger, ADR 0018), 004 (saved conversations, draft and confirm, Review, 004e change sets and page context), 005 (lab memory: entries as evidence, memories proposed from entries), 010 (containers, lots, samples, the volume ledger), 011 (file store, text search, the deterministic mention matcher of ADR 0035), 013 (campaigns, experiments, runs with steps, deviations and data files, conclusions, sets), 014 (plate maps), 020 (analyses and Vega-Lite graphs to embed)
- Feeds: 005 (entries are evidence for memories, and a person's "remember this" from an entry), 013 (values written in a note become run records), 020 (entries cite analyses and graphs)

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
- The web app renders Markdown with `react-markdown` (`apps/web/src/lib/RichText.tsx`, the wiki and documents).
- AGENTS.md: a module that owns outcome data ships detectors to `memory.observe`. The notebook owns free text, not outcome data; see "Detectors".

## Proposed model (assuming the recommended answers)

| Layer | Record or table | Holds |
| --- | --- | --- |
| Instance | **Notebook entry** (`nbe_`, `NB-0001`) | Author, the day it is about, title, body (N2), what it is about (links to experiments, runs, campaigns and any other records), attachments (files through 011), status (draft, active, archived), who wrote it (person, or agent with the conversation) |
| Computed | **Timeline** (no table) | Notable events for a day, a person, an experiment or a campaign, computed from the activity ledger and record history (N3) |

## Operations (first cut)

| Operation | Agents |
| --- | --- |
| `notebook.write` (a person's entry, active at once), `notebook.draft` (an agent's entry, a draft), `notebook.update`, `notebook.confirm` | people write; agents draft, a person confirms |
| `notebook.summarize` (draft a day, run or experiment summary from the timeline) | direct: makes a draft |
| `notebook.timeline` (by day, person, experiment, campaign, record) | read |
| `notebook.get`, `notebook.search`, `notebook.for` (entries about a record) | read |
| `notebook.export` (an experiment, a campaign or a date range as PDF or HTML) | read |

## Screens (first cut)

- **Notebook page:** today first, one column: your entries and the timeline for the day, summarized ("3 runs finished, 1 deviation, 2 analyses to confirm"), each expandable. Filters for person, experiment and campaign.
- **Writing:** one box, type and go; `@` or `[[` to link a record; paste or drop a photo; nothing else required.
- **On record pages:** a "Notes" line on experiments, runs, campaigns, containers and lots, with the count and the latest note.

## Detectors

None. The notebook owns written text, not outcome data (runs, ledgers, schedules and results stay with their modules, which ship their own detectors). Lessons in notes reach lab memory through a person's "remember this" or an agent's `memory.propose` citing the entry.

---

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

## Round 2 (to ask after round 1): capture, search, sharing, export

- N7 Values written in a note (an OD, a temperature, "incubated 45 min, not 30") and the run: stay text, or become run records (proposed with the words cited).
- N8 Search: entries in the same search as the library, and how agents use entries as context.
- N9 Who sees what: lab-wide once active, private drafts, personal-only entries.
- N10 Bench capture: photos, a tablet quick note on the run view, voice.
- N11 Export and archive: per experiment or campaign, what embeds become in a PDF, a yearly archive.
- N12 Entry templates (meeting, troubleshooting, literature note) or none.

## Defaults I'm assuming (say if any is wrong)

- Readable name `NB-0001`; an entry's day defaults to today and can be set back (writing up yesterday).
- Attachments go through the 011 file store and show inline; images are shown, other files as a line with Download.
- An entry about a run is shown on the run page under the checklist, and on its experiment's page.
- Entries by a person are active as soon as they are written (like `memory.remember`); they don't go through Review.
- Built after 020 in plan order; 021a (entries and links) could start earlier since 011 and 013 exist.

## Proposed split (after decisions)

- **021a:** the entry record, write, draft, confirm, update, lock and addenda, links and mention suggestions, attachments, skill.
- **021b:** the computed timeline and `notebook.summarize`.
- **021c:** screens: notebook page, the editor, "Notes" on record pages, embeds.
- **021d:** search, export and whatever round 2 adds.
