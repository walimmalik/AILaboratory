# AILaboratory wiki

The short version of everything decided so far: the rules, the decisions, the data model and what each module will do. It is a map, not the source of truth. Each page links to the plan, ADR or architecture doc that holds the full reasoning, and where the two disagree, those win.

Last brought up to date: 2026-09-29, after labware types (007a) landed, the lab calculators rule (ADR 0024) and the workflow creator plan (018) were locked.

## Pages

| Page | What it answers |
| --- | --- |
| [Principles and working rules](principles.md) | The product rules, engineering rules, and how Wali and the agents work together |
| [Roadmap and status](roadmap.md) | Every plan, what it delivers, and whether it is built, locked or still being asked |
| [Decision log](decisions.md) | Every decision in one list: the ADRs, then each plan's lettered questions and what was chosen |
| [Data model](data-model.md) | Kind, Instance, State across every registry; the record envelope; IDs and names; units; links |
| [Agents, drafts and review](agents-and-review.md) | What agents may do on their own, proposals, evidence, sections, readiness and the Review page |
| [Architecture](architecture.md) | Services, packages, the operation registry and its doors, the in-app assistant |
| [Registries](registries.md) | Labware (007), instruments (008), reagents and liquid classes (009), inventory (010) |
| [SOPs and the library](sops.md) | The SOP and literature library (011) and digital SOPs (012) |
| [Experiments and designers](experiments.md) | Campaigns, experiments and runs (013); plate maps, transfers and the experiment designer (014, 016, 017); workflows (018) |
| [Web app and design system](ui.md) | The bench console look, layout rules and what Wali does not want to see |
| [Glossary](glossary.md) | Lab and app words as this project uses them |

## Where things live

| What | Where |
| --- | --- |
| Repo rules for agents | [AGENTS.md](../../AGENTS.md) (`CLAUDE.md` imports it) |
| Plans, one per step | [docs/plans](../plans) |
| Decisions (ADRs) | [docs/decisions](../decisions) |
| Living docs per built module | [docs/architecture](../architecture) |
| Seed lab data | [seed/](../../seed) |
| Mock worklists and instrument reports (golden files for 016) | [seed/worklists](../../seed/worklists) |
| SOP and literature test set | [docs/sop-library](../sop-library) |
| UI screenshots | [docs/screens](../screens) |

## Keeping it current

When a plan is locked or a module lands, update the pages it touches in the same PR: the roadmap row, the decision log, and the data model if new kinds or prefixes appear. Keep each page a summary with links; the detail stays in the plan or ADR.
