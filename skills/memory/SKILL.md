---
name: ailab-memory
description: Read and add to the lab's memory in AILaboratory (conventions, preferences, quirks, lessons and facts no registry has a field for), so agents use what the lab knows and people confirm what agents learn, through its MCP tools.
---

# Lab memory in AILaboratory

A **lab memory** (`memory`, `MEM-0001`) is what a good lab manager knows but no registry has a field for, in one plain sentence. Agents read the memories that matter to what they are doing, without being asked, and propose new ones; a person confirms them (rule 8).

## Kinds and strengths

- **Kinds:** `convention` (how the lab does something: "we block with 2% BSA in PBS"), `preference` (a choice the lab or a person favours: "use the Flex for under 96 samples"), `quirk` (how an instrument or material misbehaves: "STAR channel 3 drips below 5 uL with the default water class"), `lesson` (learned from results: "edge wells evaporate at 37 C after 48 h"), `fact` (anything else with no home: "Priya owns the FlexPod").
- **Strengths:** `rule` (followed, or a design that breaks it shows a readiness warning a person accepts with a reason), `default` (fills a value no confirmed record decides), `note` (only informs, never fills a value). Left out, a memory is a note. Propose a rule only when the person said it must always hold.
- **Effect** (optional, one): `prefer {record}` ranks a record first, `avoid {record}` ranks it last (as a rule, a design using it is flagged), `set {slot, value}` fills a slot a tool declares (e.g. `replicates`). A note has none; a rule may avoid or set, not prefer. Code applies effects; you read statements.
- **Who:** `appliesTo: {to: "lab"}` (the default) or `{to: "person", user}` for one person's own preference.

## Reading

The in-app assistant gets the memories for the page it is on without asking: memories about the record on the page and the records it links to, plus every lab-wide rule, one line each, at most 15. Outside agents get the same with `memory.for {records, nearby: true}`.

`memory.for {records?, facts?, nearby?, person?, limit?}` lists the memories that apply to one piece of work, most specific first: rules, then defaults, then notes; a person's own before the lab's; more matching conditions, then more matching records, then more evidence for than against, then newer. Give the records the work is about or uses (the instrument kind, the SOP, the liquid type) and the facts you know: `capability`, `instrumentKind`, `instrument`, `device`, `tip`, `labware` (a list), `mode`, `volume`, `liquidType`, `temperature`, `sop`, `layout`, `samples`, `roles`, `weekday`. A memory whose conditions you didn't give comes back with `applies: false` and the keys in `unknown`; give them to know. `conflicts` names memories whose effects clash; code applies neither, so ask the person. `lines` is the list as one line each. A memory with `evidence` shows what detectors and agents reported: records for and against, quiet runs since it was last seen, and a line like "seen in 7 runs, last 2026-10-12, 1 against".

The calculators already apply memory: `liquids.resolve_class` takes a class lab memory prefers (`how: "lab_memory"`) and passes over one it avoids, and `transfers.options` puts an instrument memory prefers first and one it avoids last among those that fit (give `samples` when you know it). Each names the memories in `memory`; say which memory shaped your choice.

`memory.search {text?, about?, kind?, strength?, person?, status?}` finds memories, rules first. Check it before designing (an ELISA, a transfer plan) and before proposing a new memory, so the lab doesn't keep the same thing twice. `due: true` means it is due for a check: past its check-again date, more evidence against than for, or quiet for too many matching runs. It is still used, but say so and give the reason. Each result also names the records it is about (`aboutRecords`) and what detectors reported (`seen`, e.g. "seen in 7 runs, 1 against"). When you fill a value from a memory, mark it with `memory` evidence: `{source: "memory", from: {id, version}}` of the confirmed memory.

## Writing

- `memory.propose {statement, kind, strength?, about?, when?, conditions?, effect?, appliesTo?, source, checkAgain?}` drafts a memory for a person to confirm. You never make one active. Propose when a person states something general or corrects you in a way that generalizes ("no, we always block with BSA"): ask once in the chat, then propose; never file memories silently, and ask at most once per topic in a conversation.
  - `about`: the records it is about (an instrument, instrument kind, product, entity kind, labware type, liquid class, SOP, person's records); none for lab-wide.
  - `conditions`: when code should apply it, as typed keys only: `capability`, `instrumentKind`, `instrument`, `device`, `tip`, `labware`, `mode`, `volume {min?, max?}`, `liquidType`, `temperature {min?, max?}`, `sop`, `layout`, `samples {min?, max?}`, `roles`, `weekdays`. Anything else goes in the `when` line, in words.
  - `source`: `{from: "stated" | "conversation" | "experiment" | "run" | "analysis", evidence?: [record ids], note?}`.
  - `checkAgain` is set from the kind when left out: quirks and lessons in 6 months, conventions and facts in 12, preferences never.
- `memory.remember` is a person's own "remember that…", active at once. People only; when a person asks you to remember something, call `memory.propose` and they confirm it.
- `memory.update {id, expectedVersion, …changes}` changes a memory: direct on drafts, proposed on an active one.
- `memory.retire {id, expectedVersion, why}` retires a memory that no longer holds (proposed when you ask). `memory.replace {id, expectedVersion, with, why}` retires an active memory in favour of a new one and links them (proposed when you ask).

`memory.used_in {id}` lists the records with a value copied from the memory (its `memory` evidence) and the fields it filled.

A memory with an effect can't be confirmed beside a confirmed one whose effect clashes (prefer and avoid the same record, set one slot to different values, prefer two records of the same kind) for the same people and records, under conditions that overlap, at equal strength and number of conditions: readiness shows `no_clashing_memory`. Narrow the conditions, or `memory.replace` the old one.

## Observations and candidates

Lab memory also learns from results (M13, M14). Code detects patterns; a person confirms them.

- `memory.observe {detector, key, source, evidence, day?, note?, draft, bar?}` reports one record that shows a pattern: a run, an analysis, an experiment. `key` names the pattern the same way every time (e.g. `sop|version|step|field|higher`), `draft` is the memory it would become (`statement`, `kind`, `strength` note or default, `about?`, `when?`, `conditions?`), `source` is `run`, `experiment`, `analysis` or `edits`. Observations collect on a hidden candidate until they pass the bar (default: 3 different records on 2 different days, or the `bar` you give); then code proposes one draft memory with the evidence and a line like "seen in 3 runs on 2 days since 2026-10-01". Reporting the same record again replaces its observation. A discarded proposal comes back only once the records seen since are twice those it was proposed with. When you find a pattern in an analysis, report it with `detector: "agent"` rather than proposing a memory from one result.
- Report what results show about a memory too, with `finding`: `for` (the default) when a record shows the pattern, `against` when it shows the opposite, `quiet` when the pattern could have shown (same instrument, conditions and action) and didn't. Only `for` records count towards the bar. Detectors that can see absence report quiet records, with `quietLimit` (default 10): that many quiet records in a row since the memory was last seen make it due for a check, as does more evidence against than for. Code never retires a memory; a person decides. To report on a memory that already exists, such as one a person stated, give `memory` instead of `key` and `draft`.
- `memory.candidates {detector?, status?}` lists candidates with their observations and status: `collecting`, `proposed`, `confirmed` or `rejected`.
- The runs module reports itself (`runs.recurring_deviation`): when a run finishes, each value recorded differently from the plan is observed under its SOP version, step, field and direction (higher, lower, or the value it was set to), never its free-text reason.
- Records report themselves too (`records.repeated_override`): when a person changes a value that was filled in for them (assumed, from a template or from lab memory) to the same value on 3 records in a day, a convention is proposed.
- When a person changes a value you filled in, or rejects a proposal with a reason that says how the lab always does it, that is a possible lab memory: ask once whether to remember it for the lab, then `memory.propose`. Don't ask again for the same thing in the conversation.
- In Review (`review.list`), proposed memories carry `memory {group, strength, evidence}` so they show grouped by where they came from. A rule is never confirmed in a batch.

## Rules and timing from memory

A handling rule (products, entity kinds, entities) or an SOP timing window that comes from lab memory has `source: {from: "lab_memory", memory}` or `source: "lab_memory", memory` and must name the memory; a lab convention may name its memory too. When a memory implies a typed value ("our HeLa tolerate 20 min out of the incubator"), propose the typed change on the record, citing the memory, rather than keeping the value only in memory.
