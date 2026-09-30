# 005: Lab memory

- Status: accepted. Rounds 1 to 4 (M1 to M22) accepted by Wali 2026-09-30, all as recommended, with the notes under each round's answers. Seven changes from the adversarial review (`reviews/005-lab-memory-adversarial.md` in the project files) accepted by Wali the same day; see "Changes after the adversarial review", which wins where it differs from a round's text. Ready to build after 004e's R5 evidence source (005a) and page context (005b); 005a and 005b before 017; 005c-1 after 004e-3 and once 014 or 017 produce designs; 005c-2 once a detector that reports negatives exists (016 survey import or 020 control charts).
- Depends on: 002 (records, links, history), 003 (operations, proposals), 004c/004d (draft and confirm, one Review page), 004e (plan in PR #72: R1 tiers and addressees, R5 `memory` evidence source, R6/R7 skills and core toolset, page context with record and selection), 011 (search over text, 011b-2 embeddings)
- Feeds: 009 and 010 (handling rules with source `lab_memory`), 012 (timing windows with source `lab_memory`), 013 (lessons proposed from concluded experiments), 016 (quirks beside a chosen liquid class or instrument), 017 (the designer fills open choices from conventions, D3), 018 (W7 durations, W8 handling rules researched by agents), 019 (S17 standing preferences, S13 drift notes), 020 (A16 drift turned into memory proposals), 021 (notebook)
- Must land before 017 (Wali, 2026-09-30).

## What this plan delivers

What a good lab manager knows but no registry has a field for, written down so agents use it and people can check it:

- **Conventions:** "we block with 2% BSA in PBS, not milk", "standards go in columns 1 and 2".
- **Preferences:** "use the Flex for anything under 96 samples", "Jordan prefers to seed on Mondays".
- **Quirks:** "STAR channel 3 drips below 5 uL with the default water class", "the Spark's top-left well reads 5% high".
- **Lessons:** "edge wells evaporate in the 37 C incubator after 48 h", "HEK293 lift if dispensed faster than 100 uL/s".
- **Facts with no home:** "Priya owns the FlexPod", "the cold room door alarm goes off after 2 min".

Agents read the memories that matter to what they are doing, without being asked. Agents propose new ones; a person confirms (rule 8). Values an agent fills from a memory say so ("from lab memory MEM-0004") instead of showing as a guess (004e R5).

## Starting point

- Plan 000 section 1.6 sketched the record: statement, kind, scope, links, source, confidence and a review date; `memory.search` plus a context bundle for the page the person is on.
- Handling rules (009 R6, `packages/schema/src/reagents.ts`) and SOP timing windows (`packages/schema/src/sops.ts`) already accept source `lab_memory`, but nothing it can point to exists; `reference` is a free URL.
- 004e R5 adds a `memory` evidence source (a confirmed memory's id), and 004e-5 widens the page context to record, version and selection.
- 011 search is keyword search over passages (ADR 0034); embeddings come in 011b-2.
- 019 already keeps **measured durations** as duration statistics and timing models, recomputed from logs and never typed. 018 W7 calls these "lab memory derived from past runs"; M1 below settles which it is.
- `seed/assays.yaml`, `seed/entities.yaml` and `seed/reagent-library.yaml` hold rules marked `lab_convention`, which are the first real conventions to seed.

## Model

| Layer | Record | Holds |
| --- | --- | --- |
| Instance | **Memory** (`mem_`, `MEM-0001`) | Statement in plain words; kind (M3); strength (M4); what it is about (links to records); when it applies (a closed condition object, M2 and change 4); an optional typed effect (`prefer`, `avoid`, `set`, change 1); who it applies to (M5); source (said by a person, a conversation, an experiment, a run, an analysis) with evidence links; check-again date (M6); evidence counts for and against, quiet opportunities, last seen, and the weight code works out from them (M9, M17); status (draft, active, due for a check, retired, replaced by) |
| Hidden | **Memory candidate** (owned by the memory module, not a record) | Observations collected from a detector until they pass its bar (M14), and rejected candidates with their evidence at rejection |

Memories are ordinary records through the record service: versions, history, links, draft and confirm, Review. Matching (`memory.for`: links, conditions, specificity, strength, weight, person) and weight and decay are pure functions in `packages/domain/memory` with unit tests.

## Split

| Step | Delivers |
| --- | --- |
| 005a | Memory record with the closed condition object and the typed effect, `memory.remember/propose/update/retire/replace/search`, `memory` evidence, handling rules and timing windows referencing a memory, `seed/memory.yaml`, the memory skill |
| 005b | `memory.for` with the total specificity order and effect conflicts, the page context bundle for the assistant and MCP, "used in", effects applied in the existing resolvers (liquid class, instrument) |
| 005c-1 | `memory.observe`, candidates with counts and bars, Review's Lab memory section with one change set per memory and its typed change, the "possible lab memory" hint, the repeated-override detector and the 013 recurring-deviation detector over structured deviations |
| 005c-2 | Weights ordering, contradiction counts and decay by quiet opportunities, only for detectors that report negatives; built when 016's survey import or 020's control charts exist |
| 005d | Screens: Lab memory page, "Lab notes" line on record pages, the "from lab memory" tag on designs, the assistant's "Using N lab notes" line and Remember card; then a UX pass |

## Changes after the adversarial review

Wali accepted all seven on 2026-09-30. They sharpen accepted answers where the text asked code to do something code can't do from a sentence.

1. **A typed effect (M4, M8).** A memory has one optional, closed `effect`: `prefer {record}` (rank this record first among options when the conditions match), `avoid {record}` (rank it last; as a rule, refuse it, and a design that uses it anyway shows the readiness warning), `set {slot, value}` (fill a slot the consumer declares, such as replicates or the blocking buffer role), or none (inform only). The list grows only when a consumer needs a new effect. A default may carry `prefer`, `avoid` or `set`; a rule may carry `avoid` or `set`, and readiness enforces it; a note carries none. **Code applies effects; agents read statements.** A memory without an effect is shown to the agent whatever its strength, and the agent says whether it followed it. An effect ranks or fills an open choice; anything that names a record's own field still goes to the record (M1).
2. **Conflicts and a total order (M6).** Code blocks confirming a memory only on conflicting effects: two `set` on one slot with different values, `prefer` and `avoid` on the same record, or two `prefer` for one slot, under overlapping conditions and equal specificity. Conflicting statements are flagged by the agent that reads them ("MEM-0004 and MEM-0011 seem to disagree"). Specificity is one order code sorts by, with tests: strength (rule, then default, then note), then a personal memory of the person the agent acts for, then the number of matching conditions, then the number of matching links, then weight, then newest.
3. **An agent never activates a memory (M12, M15).** An agent's call creates a draft with the fields filled; only a person's confirm (the chat card's Confirm, or Review) makes it active. Only a person's own `memory.remember` is active at once. The card defaults to strength note or default; "rule" is a visible choice on the card, never an agent's default. Active memories reach every future agent prompt, so this also closes the path for instructions planted in attached files or library documents.
4. **A closed condition object (M2).** Conditions are a closed schema in 005a whose keys map onto the consumers' own requests (the liquid class resolver's instrument kind, device, tip, labware, dispense mode, volume and liquid type; 017's template, sample count and roles; 019's instrument and time). Each consumer states which keys it can evaluate. A memory with a condition a consumer can't evaluate is not matched by that consumer and stays visible to the agent. The free "when" line is for people and agents only.
5. **005c split, and decay only where absence is observed (M13, M14, M17).** 005c-1 builds the intake, candidates with counts, the bar, the Review section and the repeated-override detector; the 013 deviation detector groups on structured deviations (SOP version, step, field, planned and actual, direction), never the free-text reason. 005c-2 adds weights ordering, contradiction counts and decay, when a detector that reports negatives exists. Each detector declares whether it can report a negative (a control chart point inside limits, a survey with no short well); only memories from those decay by quiet opportunities. Memories from positive-only detectors, and those stated by people, go stale through their check-again date, which is the real decay for most quirks. The dead-volume detector moves out of 005 to the plan that imports instrument reports (016's Echo survey import, later 022).
6. **One confirm for a memory and its typed change (M1, M16).** A memory that implies a typed change on a record (a handling rule on an entity kind) is one change set (004e R2) with that change: previewed and confirmed together from the memory card.
7. **Acceptance scenarios.** Each is a test or an end-to-end run:
   - 017 designs the seed ELISA, and the blocking buffer and standards columns come from memory with `memory` evidence; turning the memory off changes the design.
   - 016 `transfers.options` ranks the STAR last for a 3 uL water transfer because of the seeded quirk, and leaves the ranking unchanged for 20 uL.
   - A scripted series of runs with the same structured deviation produces exactly one proposal after the third run on the second day, and none before. Rejecting it and adding three more runs produces nothing; six more produce one.
   - A scripted assistant conversation: a correction ("no, we always block with BSA") yields one Remember card, a typo fix yields none, and the card's Confirm is the only way the memory becomes active.
   - The bundle for a plate map page in the seed lab contains every lab-wide rule and at most 15 lines.

## Operations

| Operation | Agents |
| --- | --- |
| `memory.propose` (statement, kind, about, applies-when, source, evidence) | direct: creates a draft in Review |
| `memory.remember` (a person's own "remember that…"; active at once) | people only; an agent on the person's ask calls `memory.propose`, and the person's Confirm activates it (change 3) |
| `memory.update`, `memory.retire`, `memory.replace` | drafts direct, active proposed |
| `memory.search` (text plus filters: about, kind, strength, applies-when) | read |
| `memory.for` (records and a task: the memories that apply, ranked, with conflicts) | read, deterministic |
| `memory.used_in` (where a memory was applied) | read |
| `memory.observe` (a detector's or agent's observation for or against a candidate or memory, with evidence links) | direct; code decides when a candidate becomes a proposal (M14) |

## Round 1 questions: what a memory is

Recommended option in bold. Asked 2026-09-30.

| # | Question | Options | Recommendation and why |
| --- | --- | --- | --- |
| M1 | Where is the line between memory and the registries? | A) **Memory holds only what has no typed home. When a memory implies a typed value ("our HeLa tolerate 20 min out of the incubator"), confirming it proposes the typed change on the record (a handling rule on the entity kind) with source `lab_memory` pointing at the memory; the record stays the one place code reads. Measured durations stay 019's duration statistics, not memories (fixing 018 W7's wording)** · B) Memories can carry typed overrides (a rule, a duration, a class) that consumers read from memory at use time · C) Memory is free text only; typed values are never linked to it | **A.** Rule 7 wants constraints on the kinds, where the scheduler already reads them; B makes every consumer check two places and the same fact can disagree with itself. C loses why a rule exists. |
| M2 | How precisely does a memory say when it applies? | A) **Links to the records it is about (instrument, instrument kind, product, entity kind, labware type, liquid class, SOP, assay template, campaign, person) plus optional typed conditions: action or capability, volume range, temperature, liquid type, plate format, and a free "when" line for the rest** · B) Links only; the agent reads the statement and judges · C) Tags only | **A.** "Drips below 5 uL with the water class" should come back only for small water transfers on that STAR, by code, not by the model reading 200 statements. Conditions reuse the units and IDs already in the registries. |
| M3 | Which kinds of memory? | A) **Convention, preference, quirk, lesson, fact (a closed list, each with a one-line meaning in the skill)** · B) Add "warning" and "tip" · C) No kinds, only strength | **A.** The five from plan 000 cover the examples in the lab; a warning is a quirk or lesson with strength "rule" (M4). Kinds drive the filters and the check-again default (M6). |
| M4 | How strongly does a memory bind an agent? | A) **Three strengths: rule (agents follow it or say why they didn't, and a design that breaks it shows a readiness warning), default (agents use it unless the person or a confirmed record says otherwise), note (context only, never fills a value)** · B) Every memory is advice; agents decide · C) Every memory is a rule | **A.** 017 D3 fills open choices from memory, so code must know which memories may fill a value and which only inform. B puts the judgement back in the model; C turns every passing remark into a blocker. |
| M5 | Whose memory is it? | A) **Lab memories for everyone, plus personal ones (a person's preferences) that apply only when that person asked, owns the experiment or is the operator. All are visible to the whole lab; a personal one is confirmed by that person, a lab one by any lab member for now (a lab manager role can come with SSO)** · B) Lab memories only · C) Private personal memories too | **A.** "Jordan seeds on Mondays" and "Sam wants 3 replicates" are real and shouldn't bind Priya's work. Private memory hides why an agent behaved differently for one person. |
| M6 | When a memory disagrees with a confirmed record or another memory, what happens? | A) **A memory never silently overrides a confirmed record. If it disagrees with a confirmed SOP or template ("block with BSA" versus an SOP that says milk), the agent shows the conflict and proposes changing the SOP or template, or uses the record and says so. Between memories, the more specific one wins (instrument over lab-wide, personal over lab), and two of the same specificity that disagree block confirming the newer until one replaces the other. Every memory has a check-again date by kind (quirks and lessons 6 months, conventions and facts 12, preferences none); past it, it stays in use and shows as due for a check in Review's "for your information" tier** · B) The newest memory wins everywhere · C) No dates; memories live until retired | **A.** Confirmed records are what downstream work trusts (rule 3), so a lesson that should change the SOP must change the SOP. Quirks go stale after service; a date is cheaper than wrong advice. |

## Round 1 answers

Wali, 2026-09-30: A for all six. M4 after this explanation: a rule is followed or a design that breaks it shows a readiness warning accepted with a reason ("never block with milk in phospho assays"); a default fills a value no confirmed record decides, in normal ink with its source ("Flex for under 96 samples"); a note only informs ("Spark A1 reads about 5% high").

- **M1 note: learn rules automatically where it makes sense.** Wali asked how rules get generated and documented in an automated way, for example insights an agent finds in analyses. Round 3 is built around this: deterministic detectors over analyses, run logs and instrument reports find candidates with their statistics, an agent writes them up with evidence, a person confirms, and new data keeps re-checking them.
- **Learning loop, agreed by Wali 2026-09-30** (input to round 3): (1) code detects candidates; (2) only findings that recur across runs or pass an effect-size bar become candidates, single odd runs stay notes on the run; memories carry a **weight** that grows as supporting evidence accumulates, a signal to agents (Wali); (3) when an agent thinks a memory should be written it becomes a task for a person to confirm, grouped so Review is not overloaded, with a **memory section** in Review (Wali); (4) new data keeps re-checking each memory.

## Round 2 questions: how agents read memory

Recommended option in bold. Asked 2026-09-30.

| # | Question | Options | Recommendation and why |
| --- | --- | --- | --- |
| M7 | What memory does the in-app agent get without asking? | A) **A context bundle picked by code for the page: memories about the record on the page, its selection (wells, steps) and the records it links to one step out, plus the lab-wide rules; rules first, then defaults, then notes, each one line with its ID; capped at about 15 lines with "N more: memory.search"; outside agents get the same bundle from `memory.for`** · B) Nothing automatic; the agent searches when it thinks of it · C) Every active memory in every prompt | **A.** Cheap models forget to search, and B means the ELISA gets designed without the lab's ELISA conventions. C grows with the lab and drowns the real ones; the cap keeps prompts small (004e R6). |
| M8 | Do the design tools apply memory themselves, or only the agent? | A) **The deterministic tools call `memory.for {records, action, conditions}` and apply it: 016's instrument options flag quirks and put a default preference first, 017 fills open choices from defaults with `memory` evidence, 018 and 019 read rules and preferences. The agent sees what was applied and why, and can argue against it** · B) Only the agent reads memory and passes values in · C) A for rules only | **A.** "Deterministic tools over guessing": whether a memory matches a 3 uL water transfer on the STAR is a lookup, not a judgement. B makes the same design come out differently depending on which model ran it. |
| M9 | Wali's weights: how does a memory's weight work? | A) **Each memory counts its evidence: supporting and contradicting observations (runs, analyses, detector hits, a person re-confirming it), and when it was last seen. Code turns that into a weight (more support and more recent is higher, contradictions lower it) shown as "seen in 7 runs, last 12 Oct, 1 against". Weight orders memories in the bundle and in `memory.for`, and a note or default that gains enough weight is suggested for promotion; strength changes only when a person confirms it** · B) Weight changes strength automatically once it passes a threshold · C) No weights; strength only | **A.** Your signal to the agent, made from counts code can check, not a number the model invents. B lets data turn a note into a rule nobody agreed to (rule 8). Being used in a design is not evidence, so use counts are kept separately (M11). |
| M10 | How is memory searched? | A) **The same machinery as the library (011): keyword search over statement and "when" line now, meaning-based search when 011b-2 adds embeddings, with filters for about, kind, strength, person and status** · B) Its own search | **A.** One search stack to keep good; memories are short, so keyword search works well until embeddings land. |
| M11 | How is using a memory recorded? | A) **A value filled from a memory carries `memory` evidence (id and version, 004e R5); agent replies cite memories as links; each memory page lists where it was used; if a memory is retired or replaced, drafts that used it get a "for your information" notice, confirmed designs are left alone** · B) Evidence only, no "used in" list · C) Agents mention memories in prose only | **A.** "Why did it pick the Flex?" gets a link, and retiring a wrong memory shows what it touched without reopening confirmed work (rule 3). |

## Round 2 answers

Wali, 2026-09-30: A for M7 to M11, with two notes.

- **M8 note: one place on the page shows the memory used.** Wherever memory shaped a design, the page carries one "from lab memory" tag in one place that lists the memories applied, each linking to the memory; values themselves don't each get a chip. Settled in round 4's screens.
- **M11 note: people enter memories too.** Yes; how is M12.

## Round 3 questions: writing and learning

Recommended option in bold. Asked 2026-09-30.

| # | Question | Options | Recommendation and why |
| --- | --- | --- | --- |
| M12 | How does a person add a memory? | A) **Three ways, all one operation (`memory.remember`): "Add a lab note" on the Lab memory page, "Add a note about this" on any record page (links pre-filled), or telling the assistant "remember that…", where the agent fills links, conditions, kind and strength and shows it in the chat with one Confirm. What a person enters is active at once (004e R10: your own entry is your confirmation)** · B) A person's memories also wait in Review · C) Only through the assistant | **A.** People are never slower than agents (004e rule 8), and confirming your own sentence is the click-heavy pattern to avoid. The assistant route saves you filling in links and conditions. |
| M13 | Who builds the detectors? | A) **Each module detects on its own data and hands candidates to one intake, `memory.observe`: 013 recurring run deviations, 016 short wells and failed transfers from run logs, 019 duration and drift shifts, 020 control chart breaks and plate position effects (edges, rows, columns), lot and operator effects. 005 builds the intake, candidate grouping, thresholds, weights and the first detector (recurring deviations, since 013c exists); the rest ship with their plans** · B) 005 builds every detector up front · C) Agents mine the data themselves, no detectors | **A.** Detectors need the data their module owns, and most of it doesn't exist yet. One intake means every detector gets weights, grouping and the Review section for free. Agents mining an analysis also report through `memory.observe` with links, so C is included, not replaced. |
| M14 | When does a candidate become something you see? | A) **Observations collect on a hidden candidate until it passes its detector's bar (default: seen in at least 3 runs on at least 2 different days, or a statistical test the detector names, such as an edge effect at p < 0.01 with at least a 10% shift); only then is it proposed. The bar and the numbers behind it show on the proposal. A rejected candidate is not proposed again unless its evidence doubles** · B) Every observation is proposed · C) Agents decide when | **A.** A single odd run is noise and would fill Review. Code-set bars keep it checkable; remembering rejections stops the same suggestion coming back every week. |
| M15 | When does an agent propose a memory from a conversation? | A) **Only when you state something general or correct it in a way that generalizes ("no, we always block with BSA"). It asks once, inline in the chat ("Remember for the lab: block with 2% BSA in PBS for ELISAs?"), and your yes makes it active as your statement. It never files conversation memories silently, and asks at most once per topic per conversation** · B) It drafts them silently into Review · C) Only when you say "remember" | **A.** You're right there, so one tap in the chat beats a Review item later; C misses the corrections that are exactly what memory is for. |
| M16 | How does Review show memory proposals? | A) **A Lab memory section in Review's "to confirm" tier, never counted in the nav. Proposals are grouped by where they came from (one group per detector run, concluded experiment or analysis) and then by what they're about. Each card shows the statement, kind and strength, the evidence in one line ("seen in 4 runs since 2 Oct, 0 against", linked), and the typed change it would make (M1). Actions: Confirm, Edit, Reject with a reason, Not now. "Confirm all" works on a group only when none is a rule and none makes a typed change. A weekly line in the "since you last looked" digest says how many are waiting** · B) Mixed into Review like any draft · C) A separate memory inbox outside Review | **A.** Your memory section, inside the one queue (004e R1). Grouping by source means one analysis that found five things is one item, not five, and rules and typed changes still get their own look. |
| M17 | What happens when new data contradicts a memory? | A) **Contradicting observations count against it and lower its weight. When evidence against outweighs evidence for, or a detector says the effect is gone, the memory shows as "due for a check" with that evidence, in "for your information". It is never retired automatically; you retire, edit or keep it** · B) Auto-retire past a threshold · C) Only show the counts | **A.** Instruments get serviced and quirks disappear, so the lab needs telling. But retiring a memory changes what designs do, so a person decides (rule 8). |
| M18 | What goes in the seed? | A) **`seed/memory.yaml` with about 25 fictional Demo Lab memories across all kinds, strengths and people (ELISA blocking, Flex under 96 samples, STAR low-volume water drip, edge evaporation at 48 h, Priya owns the FlexPod), loaded active per the seed rule. The seed's handling rules marked `lab_convention` link to their memory. Derived memories are left out of the seed, since there is no real evidence to link** · B) No seed memories · C) Seed derived ones with made-up evidence | **A.** Agents and the designer need memories to exercise before real ones exist. Faking evidence would teach agents to trust made-up statistics. |

## Round 3 answers

Wali, 2026-09-30: A for M12 to M18, with three notes.

- **M13 note: every module builds its detectors.** A new engineering rule for AGENTS.md: a module that owns outcome data (runs, run logs, ledgers, schedules, results) ships its detectors with it, or its plan says why it has none. Backfill in 005: 013 recurring run deviations, 010 real dead volume against the labware type's stated one (from the consumption ledger), and repeated overrides (the same default changed by people in 3 designs becomes a proposed convention). Registries 007 to 009, 011 and 012 hold no outcome data and need none.
- **M15 note: how the agent knows to ask.** Three triggers, two of them from code: the memory skill and the assistant's system prompt describe general statements ("we always…", "never…", "our reader…") and corrections; when a person edits a value an agent filled, or rejects a proposal with a reason, the next tool result tells the agent "possible lab memory: …" (004e's feedback loop); and the repeated-override detector catches what a conversation missed.
- **M17 note: decay, for memories that stop happening once a process improves.** Weight decays by **opportunities, not calendar time**: a run where the memory could have shown (same instrument, conditions and action) and didn't counts as a quiet opportunity. After enough quiet opportunities (default 10, set per detector) the memory is due for a check ("hasn't happened in the last 12 matching runs since 3 Nov; process change?"). A new SOP version or a service record on a linked instrument also flags it. If nothing matching ran, nothing decays. Memories stated by people with no detector decay only through their check-again date (M6).

## Round 4 questions: screens and slices

Recommended option in bold. Asked 2026-09-30.

| # | Question | Options | Recommendation and why |
| --- | --- | --- | --- |
| M19 | The Lab memory page | A) **One page in the Library group: memories grouped by what they're about (lab-wide, assays and SOPs, instruments, reagents and cells, people), rules first; a filter row (kind, strength, status, person); each row is the statement plus one grey line (strength, weight, "seen in 7 runs"); "due for a check" folded at the top when there is any; "Add a lab note" at the top right. A memory's own page shows the statement, when it applies, evidence, where it was used and history, with technical details folded** · B) A flat searchable table | **A.** Grouped by what it's about is how people look ("what do we know about the STAR?"); one line per memory keeps 200 of them scannable. |
| M20 | Memory on record and design pages | A) **Record pages (an instrument, a product, an SOP): one folded "Lab notes (3)" line near the top, saying "1 rule" when there is one; it opens to one-liners with "Add a note about this". Design pages carry your one "from lab memory" tag in the readiness panel, listing the memories applied, each linked; values keep their source in the field details, not a chip each** · B) A lab notes panel always open · C) Chips beside every value | **A.** Your tag in one place, and the notes stay out of the way until wanted (progressive disclosure). A rule is the only thing named up front, because it changes what's allowed. |
| M21 | Does the assistant show which memories it's using? | A) **Yes: each turn shows one small line "Using 4 lab notes", which opens to the list with links; the chat "Remember this for the lab?" (M15) is a card with Confirm and Edit** · B) Hidden; only cited when it matters | **A.** You can see why it did something without asking, at the cost of one grey line. |
| M22 | How is 005 split? | A) **005a** memory record, `memory.remember/propose/update/retire/replace/search`, `memory` evidence and handling rules and timing windows referencing a memory, seed memories, skill · **005b** `memory.for`, the page context bundle in the assistant and MCP, "used in", wiring into the existing resolvers (liquid class, instrument) · **005c** `memory.observe` intake, candidates and bars, weights with decay by opportunities, the Review memory section, the backfilled detectors (013 deviations and repeated overrides; dead volume moved out, change 5) · **005d** screens (M19 to M21), then a UX pass · B) One PR · C) Screens with each step | **A.** Small PRs, one step each, and 005a to 005b are what 017 needs; 005c can follow alongside 014. Screens last, as in 010 and 011, so they are built on settled operations. |

## Round 4 answers

Wali, 2026-09-30: A for M19 to M22.

- **M19 note: the page's groups.** Worked out by code from each memory's links, never tagged by hand: **Lab-wide** (no links), **Assays and SOPs** (assay templates, SOPs, campaigns), **Instruments** (instruments, instrument kinds, workcells), **Labware**, **Reagents and liquids** (products, lots, liquid types and classes), **Cells and samples** (entity kinds, entities), **Places** (rooms, storage, incubators), **People** (personal memories and who owns what). Inside a group, memories sit under their record ("Hamilton STAR (3)"), rules first. A memory with several links shows once, under its most specific link, with the others as tags. Empty groups are hidden.

## Amendments this implies for other plans and docs

- **018 W7:** "measured (lab memory derived from past runs)" reads "measured (019's duration statistics from past runs)" (M1).
- **017 D3:** values filled from memory carry `memory` evidence, not `assumed` (004e R5, M8); depends on 005a and 005b.
- **009 and 012:** a handling rule or timing window with source `lab_memory` references a memory ID instead of a free URL (M1, built in 005a).
- **013, 016, 019, 020:** each ships its detectors through `memory.observe` (M13): recurring deviations (013, backfilled in 005c), short wells and failed transfers (016), duration shifts (019 S13), control chart breaks and plate position, lot and operator effects (020 A16).
- **016 (or 022):** owns the real dead-volume detector from Echo survey reports (change 5).
- **013 E7:** a deviation records the step, field, planned and actual values as structure, so recurring deviations can be grouped (change 5).
- **AGENTS.md engineering rule (M13 note):** a module that owns outcome data ships its detectors, or its plan says why it has none.
