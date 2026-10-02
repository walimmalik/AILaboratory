# 017: Experiment designer

- Status: accepted. Round 4 (D1 to D7) accepted by Wali 2026-09-29, all as recommended. Ready to build after 013d, 014 and 016a. Shares round 1 (P1 to P6) with 014 and 016, see `014-plate-map-designer.md`.
- Depends on: 005 (lab memory: 005a and 005b; values filled from memory carry `memory` evidence, 005-M8), 008 (what the lab's instruments can do), 010 (stock on hand, sets), 012 (digital SOPs, roles, input variables), 013 (the experiment record this designer fills; E6 split), 014 (plate maps), 016 (transfer plans)
- Feeds: 018 (workflows), 019 (scheduling), 020 (analysis plan and quality criteria)

## What this plan delivers

"Run an IL-6 ELISA on these 40 supernatants" becomes a complete, checked design in one ask:

- **Assay templates:** the lab's ready-made designers (ELISA, single-point compound screen, dose-response, Dual-Glo, enzyme kinetics, later plasmid assembly), each tying digital SOPs, a layout template, default choices, readouts, controls, quality criteria and analysis together, fitted to this lab's instruments.
- **A custom assay builder:** a new template drafted by the agent from a conversation, SOPs and the lab's past experiments, confirmed like any other design. No block editor, no wizard.
- **The designer:** starts from a question, a template or an earlier experiment, asks only the few things a template marks as essential, fills the rest from lab conventions and memory (marked assumed), and drafts the experiment (013), its plate maps (014) and transfer plans (016) together.
- **Feasibility up front:** instruments that can do each step, stock on hand after reservations, liquid classes present, plate and tip counts, and a rough time estimate, before anything is confirmed.

## Starting point

- `seed/assays.yaml`: six templates in words (SOPs, plate, readout, instruments, layout, analysis, quality, hit rule, next assay).
- 013 E6: the experiment record already has every section (question, subjects, protocol, conditions and controls, layouts and plans, runs, conclusion) and a plain agent that drafts it from a question; this plan adds templates and the guided designer that fill the same record.
- 012: SOPs name roles with requirements and declare input variables; binding happens when an experiment is planned.

## Model

| Layer | Record | Holds |
| --- | --- | --- |
| Kind | **Assay template** (`asy_`, `ASY-0001`) | Name, the digital SOPs it combines, the layout template, default role bindings as capabilities with preferred instruments (D4), essential inputs (D3), factors with levels (D5), controls and replicate rules with reasons (D6), readouts, quality criteria, analysis plan, usual next assay |
| Instance | **Experiment** (013) | Filled by the designer: subjects, protocol bindings, conditions as factors and levels, controls, links to the plate maps and transfer plans drafted with it |

Pure logic in `packages/domain/design`: factor expansion (full factorial, one factor at a time), replicate and control rules, totals (plates, tips, reagent volumes, time). Fractional factorial, response surface and space-filling designs come later through the science service.

## Operations

| Operation | Agents |
| --- | --- |
| `assays.draft_template` (from a conversation, SOPs or past experiments), `assays.save_from_experiment`, `assays.update_template` | direct on drafts, proposed on active |
| `assays.confirm_template` | people, or proposed |
| `designer.start` (from a question, a template or an earlier experiment: drafts the experiment, its plate maps and transfer plans together) | direct |
| `designer.missing` (the essential inputs still open), `designer.feasibility` (instruments per capability, stock after reservations, liquid classes, totals, time) | read |
| `assays.get`, `assays.search` | read |

## Screens

- **Design page:** one page per design with tabs for the experiment, its plate maps and its transfer plans (P1); a readiness panel that rolls up all three; the essential inputs still open at the top; feasibility totals; agent panel.
- **Assay templates:** the lab's templates with where they are used; "new template" and "save as template" open a draft with the agent beside it.

## Round 4 answers

Wali chose A for D1 to D7 on 2026-09-29.

## Round 4 questions (as asked): templates and the designer


Recommended option in bold. Asked 2026-09-29.

| # | Question | Options | Recommendation and why |
| --- | --- | --- | --- |
| D1 | What is an assay template? | A) A record (data): the digital SOPs it combines, the layout template, default role bindings (plate type, liquid, preferred instruments), the few essential inputs, controls, readouts, quality criteria (Z' at least 0.5), the analysis plan and the usual next assay. Versioned and confirmed like any design · B) Templates in code, one per assay · C) No templates: the agent drafts each experiment from SOPs and lab memory | **A.** A lab adds assays all the time and agents must be able to add them (rule 2), which rules out B. C loses the lab's settled conventions and makes every design a fresh guess. |
| D2 | How does the custom assay builder work? | A) It is the same template record, drafted by the agent from a conversation, SOPs and past experiments, shown as a design page with its readiness panel and confirmed by a person. Any experiment can also be saved as a template · B) A visual block builder where people drag SOPs and steps together · C) Both | **A.** Matches "agent drafts, person confirms, no big forms", and a block builder is a second path to the same record. Composition of SOPs into longer runs is the workflow creator's (018). |
| D3 | What does the designer ask you? | A) Only the template's essential inputs (ELISA: which samples, their dilution; compound screen: which compounds, concentration, cell line, readout). The agent fills them from your request and the page you are on, asks only for what is still missing, and everything else comes from the template and lab memory, marked assumed · B) A full form of every option · C) Open-ended questions from the agent | **A.** Most choices have a lab default; the few that don't are the ones worth your time. C gives a different interview every time. |
| D4 | How are templates fitted to this lab's instruments? | A) Templates name capabilities and roles ("reader: luminescence", "dispense nL of DMSO"), with preferred instruments as a default. The designer binds them to the lab's instruments and active workcell using 016's deterministic tools, and says plainly what the lab can't do and what it would use instead · B) Templates name specific instruments | **A.** Instruments go down for service and labs change; a template that names "the Spark" breaks, one that names "luminescence, 384-well" moves to the next reader. Same idea as 012 G4. |
| D5 | How much design of experiments? | A) Conditions are factors with levels (compound, concentration, cell line, time). 017 ships full factorial and one-factor-at-a-time, laid out through 014's placement strategies. Fractional factorial, response surface and space-filling designs come in a later step through the science service (Python) · B) None, conditions are a plain list · C) All designs now | **A.** Factors and levels are the right shape from day one, so nothing migrates later; most assays in the lab are factorial or dose-response. Optimization designs need the statistics that come with 020. |
| D6 | How are replicates, plate count and feasibility decided? | A) Rules with reasons from the template (16 neutral and 16 positive controls per plate for Z', technical replicates, biological repeats as runs), and totals computed before confirm: plates, tips, reagent volume against stock after reservations, instrument time (estimated). Power analysis comes with 020 · B) Power analysis now · C) You set everything | **A.** The totals catch the common failures (not enough detection antibody for 5 plates) at design time. Power analysis needs effect sizes and variance from past data, which 020 provides. |
| D7 | Which templates come first? | A) ELISA first (the first end-to-end target in 000), then single-point compound screen and dose-response, Dual-Glo, pNPP kinetics. Plasmid assembly waits for the workflow creator (018), since it is a chain of SOPs more than a plate · B) Compound screen first · C) All five at once | **A.** ELISA exercises manual steps, a washer, a reader and a standard curve at small scale; the compound screen then adds the Echo, 384 wells and sets. |

## Defaults I'm assuming (say if any is wrong)

- Seed templates are converted from `seed/assays.yaml` and confirmed by a person before use.
- The designer's agent drafts all three documents in one conversation; each is still reviewed and confirmed on its own (P1), and Review lists them together.
- Readouts name the reader capability and settings (mode, wavelengths, kinetic interval); reader protocol files are out of scope until the device gateway (022).
- Hit rules and next-assay links in a template feed sets (013 E10) when analysis (020) exists; until then they are shown, not computed.

## Proposed split

- **017a:** assay template schema, `packages/domain/design`, operations, ELISA template from the seed. Built (017a-1, ADR 0066): `AssayTemplateAttributes` and `packages/domain/src/design.ts` (series levels, full factorial and one-factor-at-a-time conditions, wells, plates and runs). Built (017a-2): the `assay_template` record kind, `assays.draft_template`, `assays.design` and `assays.search`, and the IL-6 ELISA template in `seed/assay-templates.yaml`.
- **017b:** the designer (drafts experiment, plate maps and transfer plans together), feasibility, design page, skill. Built (017b-1, ADR 0067): `designer.start` drafts the experiment, pinned to the confirmed template, and its plate map in one write. Built (017b-2): `designer.feasibility` (instruments per capability and plate format, totals, amounts). Built (017b-3, part): `assays.save_from_experiment`, with part `inputs` on templates for the values an experiment set. Built (017b-3): stock in `designer.feasibility`, from SOP amounts that name the material they are drawn from (`drawsFrom`), less reservations; the design page is the experiment record page, with Design and "Can the lab run it?" blocks and a Transfers tab. Next: starting a design and saving a template on screen.
- **017c:** compound screen and dose-response, Dual-Glo and pNPP templates. Built (017c): the compound single-point and dose-response (CellTiter-Glo; HiBiT swaps the readout part), pNPP kinetic and Dual-Glo templates in `seed/assay-templates.yaml`, each role a material of its SOP and each layout from `seed/layouts.yaml`.
- **017d:** fractional factorial and response-surface designs through the science service.
