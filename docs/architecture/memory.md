# Lab memory

Plan [005](../plans/005-lab-memory.md): what a good lab manager knows but no registry has a field for, as records a person confirms (rule 8). Agents read the memories that matter and propose new ones.

## Memory record (005a, ADR 0062)

- **`memory`** (`mem_`, `MEM-0001`, `packages/schema/src/memory.ts`): one plain sentence (`statement`, also the label, cut near 80 characters), `kind` (convention, preference, quirk, lesson, fact), `strength` (rule, default, note), `about` (the records it is about; none for lab-wide), `when` (words), `conditions` (a closed object of keys the consumers evaluate: capability, instrument kind, instrument, device, tip, labware, dispense mode, volume range, liquid type, temperature range, SOP, layout, sample count range, well roles, weekdays), an optional `effect` (`prefer` or `avoid` a record, `set` a slot to a value), `appliesTo` (the lab, or one person), `source` (stated, conversation, experiment, run, analysis, with evidence records), `checkAgain`, and `retired` (why, and the memory that replaced it).
- The schema refuses a note with an effect and a rule that prefers. Sections: Statement; What and when. Every record a memory names is linked (`about`, `applies_with`, `prefer`, `avoid`, `sets`, `learned_from`, `replaced_by`), so it must exist in the lab and not be archived.
- `packages/domain/src/memory.ts`: `checkAgainFor(kind, today)` (quirks and lessons 6 months, conventions and facts 12, preferences never), `addMonths`, `isDue`.

## Operations (005a)

| Operation | Agents | Does |
| --- | --- | --- |
| `memory.propose` | direct | A draft memory; strength note and the whole lab when left out; check-again date from the kind |
| `memory.remember` | people only | A person's own memory, active at once; a personal memory only by its person |
| `memory.update` | direct on drafts, proposed on active | Changes given fields |
| `memory.retire` | proposed | Marks `retired.why`, then archives |
| `memory.replace` | proposed | Creates the new memory active (as the approver when an agent asked) and retires the old with `replacedBy` |
| `memory.search` | read | Words in the statement and "when" line, about, kind, strength, person, status; rules first; `due` past the check-again date |

`memory.search` and `memory.propose` are in the assistant's core toolset (ADR 0055); a memory page offers the `memory` tools.

## What applies to a piece of work (005b, M7, M8, changes 2 and 4)

- `packages/domain/src/memory.ts`: `matchMemory` and `memoriesFor` take active memories and a request (`records`, `facts` keyed like the conditions with one value per range, and the person). A memory is relevant when it is about one of the records, or is lab-wide with a condition that held, or is a lab-wide rule; a personal memory only for its person; a condition the facts contradict drops it. A condition the facts leave out keeps it with `applies: false` and the key in `unknown`; code applies only memories whose every condition held. `compareMatches` is the total order: strength, personal, conditions held, matching links, newer, name.
- `appliedEffects` takes the most specific `prefer`, `avoid` and `set` per record or slot from memories that apply; two that clash at equal specificity (`matchConflicts`, `effectClash`) apply neither.
- `memoryConflicts` blocks confirming a memory whose effect clashes with an active one for the same people, about the same records (or both lab-wide), under overlapping conditions (`conditionsOverlap`), at equal strength and numbers of conditions and links: the kind's `no_clashing_memory` blocker.
- `apps/api/src/memory/match.ts`: `activeMemories`, `lookup` (matches and effects for one piece of work), `nearby` (the records a page links to, one step out) and `bundle` (one line each, capped, with "N more: memory.search" and the conflicts). Every consumer reads memory through it.

| Operation | Agents | Does |
| --- | --- | --- |
| `memory.for` | read | The memories for records and facts (and, with `nearby`, the records they link to), ranked, with conflicts and lines; default limit 15 |
| `memory.used_in` | read | The records whose current evidence copies a value from the memory, and the fields (`RecordService.citing`) |

Consumers:

- **The assistant** (M7): the system prompt carries the bundle for the record on the page the latest message came from and the records it links to, plus every lab-wide rule, at most 15 lines. `memory.for` is in the core toolset.
- **`liquids.resolve_class`**: after an explicit class and the product's own, a class lab memory prefers for the work (`how: "lab_memory"`); among lab defaults, one memory avoids goes last, and a rule that avoids a class refuses it. The choice names the memories (`memory`).
- **`transfers.options`**: per device, facts from the instrument, its kind, the device, capability, volume, liquid and `samples`; a preferred instrument ranks first and an avoided one last among those that fit (`rankDevices`), and each option names its memories. An avoiding rule also adds a note.

## Candidates and detectors (005c-1, M13, M14, change 5)

- **`memory_candidates`** (table owned by the memory module, migration 0014): one row per lab, detector and key, with the draft memory, the source (`run`, `experiment`, `analysis`, `edits`), the bar, the observations (record, day, note; one per record), the status (`collecting`, `proposed`, `confirmed`, `rejected`), the proposed memory and how many records it was proposed with. Candidates are not records; people see only the proposal.
- `packages/domain/src/memory.ts`: `DEFAULT_BAR` (3 records on 2 days), `coverage`, `passesBar` (a rejected candidate also needs the records since to be twice those it was proposed with), `evidenceLine`.
- `memory.observe` (agents direct): upserts the observation. A proposed candidate's memory decides its status: still a draft, confirmed (active, or archived after being active), or rejected (discarded, or archived without ever being active). Past the bar it creates a draft memory as the agent "Lab memory detector (detector)" working for the person, with `source {from, evidence, note: the evidence line}`, strength note unless the draft says default (never a rule, change 3), lab-wide. `memory.candidates` lists them.
- **Detector `runs.recurring_deviation`** (`apps/api/src/campaigns/detectors.ts`): when `runs.finish` finishes a run that wasn't aborted, each step value recorded differently from the plan is observed under `sop|version|step|field|direction`, where direction is higher or lower for numbers and quantities and the value itself otherwise. The draft is a lesson about the SOP (`conditions: {sop}`), for example "Runs of Plate coating record volume in "Coat" lower than the planned 100 µL". Free-text deviations are not grouped.
- **Evidence (005c-2, M9, M17):** each observation says what its record showed: `for` (the default), `against`, or `quiet` (the pattern could have shown and didn't; only detectors that can see absence report these). Only `for` records count towards the bar. `memoryEvidence` (domain) counts different records for and against, quiet records since the memory was last seen, and the weight (for minus against). A memory is due for a check when more records are against than for, or after the candidate's `quiet_limit` quiet records (migration 0015; default 10, set by the detector). `memory.observe {memory}` reports on an existing memory, such as a stated one, under the key `memory:<id>`, and never proposes. `activeMemories` reads every candidate that names a memory and attaches its evidence; weight orders memories of equal specificity, after links and before newer (change 2), and clashes are judged without it. `memory.for` and the assistant's bundle show the evidence line and "due for a check". Code never retires a memory (M17).
- **Detectors `transfers.echo_exceptions` and `transfers.survey_low`** (`apps/api/src/transfers/detectors.ts`): failed or short Echo transfers per instrument, source labware type and liquid class, and surveys measuring less than the inventory per labware type, counted when a report shows 2 or more and 5% or more (`showsPattern`); reports where a collected pattern didn't show are quiet, with a limit of 10. See [transfers.md](transfers.md).
- **Detector `records.repeated_override`** (`apps/api/src/memory/overrides.ts`, 005c-1b): the registry calls write listeners (`registry.onWrite`) after each write a person makes at the top level, with the records it touched; a listener's failure never fails the write. For each touched record past version 1 (memories aside), a field whose previous value was filled in (evidence `assumed`, `template` or `memory`) and is now set by this person to a different value is observed under `kind|field|value`, source `edits`, bar 3 records on 1 day. The draft is a convention, for example "People set volume to 50 µL on a plate map when another value was filled in".
- **The "possible lab memory" hint** (M15, `assistant.ts`): the assistant's system prompt lists the values a person changed after this conversation's agent filled them ("you filled X; a person changed it to Y"), and a rejected proposal's reason that says how the lab always does something; the agent asks once whether to remember it for the lab, then uses `memory.propose`.
- **Review** (M16): `review.list` gives a proposed memory a `memory` block: its group (the detector that proposed it, or its source in words), strength and evidence line. A memory with strength rule is never confirmed in a batch.

## Memory in other records (005a, M1)

- A handling rule (`RuleSource`) or SOP timing window from `lab_memory` must name its memory (`memory: mem_…`); a lab convention may. Products, entity kinds, entities and SOPs link to it as `from_memory`.
- `memory` evidence (004e R5) cites a memory confirmed at that version, like copied record evidence (ADR 0049); citing another kind as memory, or a memory as a record, is refused.

## Seed

`seed/memory.yaml`: 25 fictional Demo Lab memories across every kind and strength, records named by kind and label (`{sop: …}`, `{instrument_kind: …}`, `{liquid_type: …}`); the loader (`memory/seed.ts`) drafts each once its records exist and the seed settles them. No derived memories and no personal ones (people are not records yet).

## Screens (005d)

- **The Lab memory tab** (Library, `/memory`, `apps/web/src/pages/Memory.tsx`). It shows memories grouped by what they are about, worked out from their links by `groupMemories` (`apps/web/src/lib/memory.ts`), never tagged by hand. The groups are Lab-wide, Assays and SOPs, Instruments, Labware, Reagents and liquids, Cells and samples, Places, People and Other records. Inside a group, memories sit under their record, rules first. A memory with several links shows once, under its most specific link (a physical thing before its kind), and the other links are tags.
- **Each row** is the statement, then one grey line with the strength, kind, evidence line, "when" words and "due for a check".
- **The filter row** has words, kind, strength and current, drafts or retired.
- **Due memories** are folded at the top.
- **"Add a lab note"** calls `memory.remember`. A note is the default, and "Rule: designs follow it" is a visible choice. An optional record it is about, a "when" line, and "only me" make it personal.
- **`memory.search`** returns each memory's records as `aboutRecords` (named) and its evidence as `seen`. `due` now also counts evidence against and quiet runs, as `memory.for` does.

## Not yet

Review's Lab memory screen (005d), with memories due for a check in "for your information"; suggesting promotion of a note or default that gains weight; flagging a memory when a linked SOP gets a new version or a linked instrument is serviced (M17 note); 020's control charts as a detector that reports quiet records. A run corrected after it finished is not observed again, so a corrected value keeps its old observation. The "for your information" notice on drafts that used a retired or replaced memory comes with the Review screen (005d). A readiness warning on designs that use what a rule avoids comes with the designers that apply rules (017, 018, 019); the transfer plan only shows it in `transfers.options` for now. A personal memory drafted by an agent can still be confirmed by anyone in the lab through `records.confirm`; ownership on confirm comes with the Review screen (005d). Seed handling rules marked `lab_convention` don't name a memory yet: they load before the memories that describe them.
