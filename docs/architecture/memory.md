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

## Memory in other records (005a, M1)

- A handling rule (`RuleSource`) or SOP timing window from `lab_memory` must name its memory (`memory: mem_…`); a lab convention may. Products, entity kinds, entities and SOPs link to it as `from_memory`.
- `memory` evidence (004e R5) cites a memory confirmed at that version, like copied record evidence (ADR 0049); citing another kind as memory, or a memory as a record, is refused.

## Seed

`seed/memory.yaml`: 25 fictional Demo Lab memories across every kind and strength, records named by kind and label (`{sop: …}`, `{instrument_kind: …}`, `{liquid_type: …}`); the loader (`memory/seed.ts`) drafts each once its records exist and the seed settles them. No derived memories and no personal ones (people are not records yet).

## Not yet

`memory.for`, the page bundle, "used in" and effects applied in the resolvers (005b); `memory.observe`, candidates, Review's Lab memory section and detectors (005c-1); weights and decay (005c-2); screens (005d). A personal memory drafted by an agent can still be confirmed by anyone in the lab through `records.confirm`; ownership on confirm comes with 005c-1's Review section. Seed handling rules marked `lab_convention` don't name a memory yet: they load before the memories that describe them.
