# Decision log

Every decision made so far, one line each. Links go to the full reasoning.

Question codes repeat across plans (002 and 016 both have T1 to T6; round 7 of 004 and plan 009 both start at R1), so this page writes them with the plan number: `002-T1`, `009-R1`.

Plans 006 to 019 record their decisions in the plan files; their ADRs are written when each plan is built (0023 for 007a, 0025 and 0026 for 008a and 008b, 0027 for 009a, 0028 for 009b, 0029 for 010a, 0030 for 010b, 0031 for 010c, 0032 for 010d, 0033 for 011a, 0034 for 011b, 0035 for 011c, 0036 and 0037 for 012a, 0038 for 012c, 0039 for 013a, 0043 for 014a, 0045 for 016a, 0046 for the SOP editors and one Confirm, 0047 for 008d, 0048 for 004e-1, 0049 for 004e-2, 0050 to 0052 for 004e-3, 0053 for 004e-4, 0054 and 0055 for 004e-5, 0056 and 0057 for 004e-6, 0058 for 016b-3, 0059 for 016b-4, 0060 for 016b-2b, 0061 for 016c-1, 0062 for 005a, 0063 for 004f, 0064 for review 2026-10-01 item 19, 0065 for item 18, 0066 for 017a-1, 0067 for 017b-1). ADR 0024 applies to every plan.

## Architecture Decision Records

| ADR | Decision |
| --- | --- |
| [0001](../decisions/0001-typescript-core-python-science.md) | TypeScript core (API, web) plus a Python science service for statistics, curve fits, chemistry and sequences |
| [0002](../decisions/0002-postgres.md) | Postgres with pgvector as the one database |
| [0003](../decisions/0003-react-vite.md) | React and Vite for the web app; static SPA, no server rendering |
| [0004](../decisions/0004-port-echo650-twin.md) | Port echo650-twin's scheduler into this repo (plan 019); its twin half is superseded by plan 015 (twins are uploaded as standard packages) |
| [0005](../decisions/0005-agent-runtime.md) | In-app agent over our MCP server; amended by 0020 |
| [0006](../decisions/0006-tenancy.md) | `org_id` and `lab_id` on every record from day one |
| [0007](../decisions/0007-local-compose-first.md) | Local Docker Compose first, internal Docker cluster later |
| [0008](../decisions/0008-tooling.md) | pnpm, Biome, Vitest, Hono, uv + ruff + pytest, strict TypeScript, Node 24 |
| [0009](../decisions/0009-history-as-snapshots.md) | History as current-state tables plus full version snapshots; restore writes a new version |
| [0010](../decisions/0010-exact-decimals.md) | Quantities are exact decimals, sent as strings |
| [0011](../decisions/0011-zod-schemas.md) | Zod 4 is the schema source; JSON Schema generated from it |
| [0012](../decisions/0012-drizzle.md) | Drizzle for tables and migrations; tests on PGlite |
| [0013](../decisions/0013-readable-ids.md) | Readable names are `PREFIX-000123`, per lab, never reused |
| [0014](../decisions/0014-links-table.md) | A `record_links` table kept in sync by the record service |
| [0015](../decisions/0015-operation-registry.md) | One operation registry behind REST, MCP and the typed client |
| [0016](../decisions/0016-agent-proposals.md) | Agents act directly on drafts and propose changes to active records; people approve |
| [0017](../decisions/0017-preview-by-rollback.md) | Preview runs the real write and rolls it back |
| [0018](../decisions/0018-activity-ledger.md) | An activity ledger of every write outcome, with a live stream |
| [0019](../decisions/0019-web-sign-in.md) | Email and password sign-in with an HttpOnly session cookie; bearer tokens for agents |
| [0020](../decisions/0020-own-agent-loop.md) | The in-app assistant runs our own tool loop with adapters for Anthropic, OpenRouter and OpenAI-compatible models |
| [0021](../decisions/0021-draft-and-confirm.md) | Draft and confirm: per-field evidence, section confirmations, derived confirmation, readiness checks |
| [0022](../decisions/0022-one-place-to-review.md) | One Review page, one verb ("Confirm"), and the last section's confirm activates the draft |
| [0023](../decisions/0023-labware-types.md) | Labware types are a record kind with sections and checks; drafting, editing and confirming go through `records.*`, with labware operations only for Opentrons import and export and the well list |
| [0024](../decisions/0024-lab-calculators.md) | Lab calculators: deterministic read operations every agent calls for volumes, dilutions, feasibility and totals, indexed by one skill |
| [0025](../decisions/0025-instrument-kinds-and-configurations.md) | Instrument and equipment kinds as records; capability catalog in code; mounts, sites, fit tags and claims; one resolver for every configuration |
| [0026](../decisions/0026-registered-instruments.md) | Registered instruments and equipment items; typed configuration changes checked as a whole; status and service as attributes with history as the log |
| [0027](../decisions/0027-products-lots-and-handling-rules.md) | One product kind for bought, kit and lab-made; lot fields and certificate values; lots as proposals; liquid types; handling rules as a closed typed list with source and enforced or advice |
| [0028](../decisions/0028-liquid-classes.md) | Liquid classes per device, tip and volume with settings per platform; one resolver (explicit, product, lab default, verified first); mixture rule; verification runs, demo never verifies |
| [0029](../decisions/0029-entity-kinds-as-records.md) | Entity kinds as records on a base class with typed fields; entities checked against their kind on every write through the record service's related rules; names from the kind's prefix |
| [0030](../decisions/0030-locations-and-containers.md) | Locations as a tree; containers named by their labware family (`PLT-000001`), held in a location or a rack position, with external barcodes that also scan |
| [0031](../decisions/0031-well-contents.md) | Well contents as components (samples, lots) with concentrations, or amounts when dry; exact mixing math; unknowns stay unknown |
| [0032](../decisions/0032-inherited-handling-rules.md) | A container inherits the handling rules of its contents; per rule type the strictest wins, enforced if any source is, every source listed |
| [0033](../decisions/0033-file-store.md) | Files: bytes in a content-addressed store (a folder now, S3-compatible later), one `fil_` record per lab per hash, bytes never change, risky types served sandboxed |
| [0034](../decisions/0034-library-text-and-search.md) | Library text as sections and passages in Postgres with a generated full-text vector; plain readers now, Docling and embeddings once checked on the laptop |
| [0039](../decisions/0039-designs-pin-inputs.md) | Designs pin their inputs by `{id, version}` of a confirmed version; a newer confirmed version is shown and adopted on request, never followed silently; physical state is checked live |
| [0041](../decisions/0041-invariants-on-the-kind.md) | A record's rules live on its kind (`related`, `checks`, `createdBy`), so generic writes can't skip them; instrument rules stay data with one generic resolver |
| [0042](../decisions/0042-inventory-write-lock.md) | Inventory writes in a lab run one at a time (a per-lab transaction lock), so simultaneous changes can't lose volume |
| [0043](../decisions/0043-layout-templates.md) | A layout template is a record in lab words that the placement rules check on every write; `layouts.preview` is the calculator for plates and wells |
| [0044](../decisions/0044-seed-loads-without-approvals.md) | The seed loads in one run with no approvals: it confirms what it wrote as the person running it, and only records with a failing blocker are left for Review |
| [0045](../decisions/0045-transfer-plans.md) | Transfer plans name their own plates, copy each instrument's limits into its group, and soft-reserve what confirmed plans draw, derived rather than stored |
| [0046](../decisions/0046-sop-text-and-one-confirm.md) | An SOP value's kind comes from its text (number, formula or Material.field) in one highlighted box, step words give a step's materials and settings, storage unchanged; whole-page edit with one Save, one Confirm per SOP (`records.confirm`), the assistant's fill-in (`sops.suggest`) |
| [0047](../decisions/0047-workcells.md) | Workcells list member instruments mapped to twin devices; drafts may share instruments, confirming checks that no member is in another confirmed workcell, and the twin mapping is unchecked until 015 |
| [0048](../decisions/0048-plain-words-on-contracts.md) | Every operation contract carries plain words (`verbs.done`, `verbs.intent`) that screens read from one catalog; one value renderer names records at any depth, and kinds give fields a lab form |
| [0049](../decisions/0049-evidence-by-item-and-checked-calculations.md) | Kinds key lists by item (SOP steps by id), each item with its own evidence and state; `record`, `template` and `memory` sources name where a value was copied from; calculator results carry a handle that `calculated` evidence must name, checked by the record service |
| [0050](../decisions/0050-review-tiers-batch-confirm-summaries.md) | Review in tiers (needs you, to confirm, for your information) with addressees, only "needs you" in the nav; `records.confirm_many` when nothing is a guess, all or nothing; kinds summarize records, and the summary and readiness summary are stored at every write |
| [0051](../decisions/0051-change-sets.md) | `changes.apply` runs ordered operations as one change with `$1.id` references, all or nothing; for an agent, any step that needs a person makes the whole set one proposal, confirmed as one on Review |
| [0052](../decisions/0052-library-mentions-in-review.md) | Library mentions wait in Review: one item per document with its count, checked on the document page as before |
| [0053](../decisions/0053-what-changed-since-you-looked.md) | A per-person seen marker, `records.diff` since you last looked (or first drafted), history naming the operation (`via`), `activity.list` filters, and a Today home page |
| [0054](../decisions/0054-skills-served-by-the-api.md) | Skills are bundled by `pnpm generate` and served by `skills.list`, `skills.get` and MCP resources `skill://<module>`; the assistant's prompt includes the calculators skill; CI fails when an operation is in no skill |
| [0055](../decisions/0055-assistant-core-toolset-and-page-context.md) | The assistant names a core toolset, the calculators and the page's modules, and runs the rest with `run_operation` after `operations.describe`; `records.kinds` has summary and filter modes; page context names the record and version |
| [0056](../decisions/0056-a-persons-own-edits-are-confirmed.md) | A person's own edit confirms the sections it changes unless an agent's unconfirmed value is left in them; editing never activates a draft |
| [0057](../decisions/0057-people-parity.md) | Archive, Unarchive, Discard draft and Restore on the record page, a generic Calculators page, and a test that every agent write has a web caller or a stated reason |
| [0058](../decisions/0058-opentrons-protocols-from-data.md) | Opentrons Flex protocols: the API sends the plan's data, the science service writes it into one fixed program and runs it in Opentrons' simulator before export |
| [0059](../decisions/0059-deck-layouts-confirmed.md) | Deck layouts for Opentrons Flex groups are the transfer plan's own section, drafted by code from the configuration and confirmed by a person per group; exports and the loading list read only that |
| [0060](../decisions/0060-transfer-executions-and-reruns.md) | Reading an Echo transfer report records the execution (`TRN`) with each exception, ends the plan's reservations, and drafts a rerun plan of the same design for the failed, short and missing transfers |
| [0061](../decisions/0061-worklist-format-records.md) | The lab's CSV worklists (Hamilton, Mantis, PreciseDrop) are worklist format records of typed columns or a volume grid, drafted from an example file, confirmed by a person, pinned on a group and filled by one generic writer |
| [0062](../decisions/0062-lab-memory-records.md) | Lab memories are records with typed conditions and effects; agents propose drafts, people remember directly; retire and replace keep history; rules, timing windows and evidence cite a memory by id |
| [0063](../decisions/0063-areas-and-record-pages.md) | Eight menu areas with tabs, one inventory view, record pages that lead with an identity line and key facts, three state vocabularies (plan 004f) |
| [0064](../decisions/0064-check-options.md) | A failing check offers ranked options, each a label, its consequence, an operation and its complete input (the record and version included); `quickFix` is gone |
| [0065](../decisions/0065-composite-and-nested-item-keys.md) | Keyed lists take composite keys (`'plate+well'`) and nest (`'groups/transfers'`), each nested item with its own evidence and state; the parent is compared without its keyed lists |
| [0066](../decisions/0066-assay-templates-and-design-math.md) | Assay templates are typed records; design math (conditions, totals) is pure |
| [0067](../decisions/0067-designer-drafts-from-a-confirmed-template.md) | The designer drafts the experiment and its plate map from a confirmed template in one write, once every essential input is answered |

## 000 Foundation (D1 to D7, all as recommended)

D1 TypeScript core plus Python science (0001). D2 Postgres (0002). D3 React and Vite (0003). D4 port echo650-twin (0004). D5 agent over MCP (0005, now 0020). D6 org and lab IDs (0006). D7 Docker Compose first (0007).

Round 1 context: personal project to be adopted by an academic lab later; no regulation; real hardware later through a Python device gateway; start fresh with realistic seed data; built by Wali plus agents; runs on Windows now. [Plan 000, 3.1](../plans/000-foundation-architecture.md)

## 002 Core records (T1 to T6, all as recommended)

002-T1 snapshots (0009). 002-T2 exact decimals (0010). 002-T3 Zod 4 (0011). 002-T4 Drizzle (0012). 002-T5 `PREFIX-` plus counter (0013). 002-T6 links table (0014). Round 2 answers: full history for everything, archive instead of delete (only unlinked drafts can be deleted), units include cells/mL, OD600, %v/v, U/mL, CFU and ng/µL, agent attribution now and roles later. [Plan 002](../plans/002-core-records.md)

## 003 Operation registry (round 4)

Agents act directly on drafts and propose the rest (0016); two MCP tools, `describe_operations` and `run_operation`; outside agents including bring-your-own-key models; preview by rollback (0017); every write all-or-nothing; log changes only, with a live ledger (0018). Wali eventually wants autonomous agent execution and a live view of agent activity. [Plan 003](../plans/003-operation-registry.md)

## 004 Agent shell

- **Round 3 (UI):** left nav, center page, right agent panel; a global ask bar and a per-page panel; confirm section by section; track-changes highlighting plus a change list; desktop first, bench views tablet-friendly; the bench console design system (mockup v3).
- **Round 5 (all as recommended):** our own tool loop with model adapters (0020); keys in `.env`; password sign-in (0019); save every conversation; first screens use real data; split 004a, 004b, 004c.
- **Round 6, 004c (C1 to C6, all A):** a draft is a record with evidence and section reviews; anything an agent sets is assumed unless it names a source; an edited section goes back to review; highlight against the last confirmed values; readiness checks per kind in code; build against the test widget kind first (0021).
- **After first use:** a value the person told the agent is `stated`, not assumed; approving a proposal confirms the sections it touched.
- **Round 7, 004d (R1 to R6, all A):** one Review page; agent changes to active records stay proposals; one nav count; a "Waiting for you" line after assistant turns; one verb, "Confirm"; the last section's confirm activates (0022).
- **004f (N1 to N8, all A; 2026-10-01):** eight menu areas with tabs, and a new capability's plan says where it goes; one Inventory view of everything physical and what it is; reagents and materials in one list, merged only when linked; record pages lead with an identity line, key facts and the record's picture, then fixed tabs; plate maps live in experiments and layouts; links in two columns, "Based on" and "Used in"; sources once per section; three state vocabularies (0063).

[Plan 004](../plans/004-agent-shell.md)

## 005 Lab memory (M1 to M22, all as recommended)

- **Round 1 (005-M1 to M6):** memory holds only what has no typed home, and a memory that implies a typed value proposes it on the record with source `lab_memory` (measured durations stay 019's statistics); memories link to records with typed conditions; five kinds (convention, preference, quirk, lesson, fact); three strengths (rule, default, note); lab and personal memories, all visible; a memory never silently overrides a confirmed record, the more specific wins, and each kind has a check-again date.
- **Round 2 (005-M7 to M11):** a code-picked context bundle of about 15 lines per page; design tools apply memory themselves through `memory.for`; weights from evidence counts for and against, which order memories and suggest promotions but never change strength; library search reused; `memory` evidence and a "used in" list. One "from lab memory" tag per page.
- **Round 3 (005-M12 to M18):** people add memories directly and they're active at once; each module ships detectors feeding `memory.observe` (a new AGENTS.md rule), with 013 deviations and repeated overrides backfilled; candidates are proposed only past a bar; agents ask once in chat on general statements and corrections, prompted by code; a Lab memory section in Review grouped by source; contradictions and decay by quiet opportunities make a memory "due for a check", never auto-retired; 25 seed memories, none derived.
- **Round 4 (005-M19 to M22):** a Lab memory page grouped by what memories are about; a folded "Lab notes" line on record pages; "Using N lab notes" in the assistant; split 005a to 005d. [Plan 005](../plans/005-lab-memory.md)
- **After the adversarial review (7 changes, 2026-09-30):** an optional typed effect (`prefer`, `avoid`, `set`) that code applies, statements only read by agents; code blocks only conflicting effects, with a total specificity order; an agent's memory is a draft until a person confirms it; a closed condition object each consumer evaluates; 005c split into 005c-1 (intake, candidates, Review section, override and structured-deviation detectors) and 005c-2 (weights, decay only for detectors that report negatives), dead-volume detector moved to 016 or 022; a memory and its typed change are one change set; acceptance scenarios.

## 006 Seed lab (round 6)

Wali's real instrument list; assays are sandwich ELISA, single-point compound screen with dose-response follow-up (CellTiter-Glo or HiBiT), enzyme kinetic screen, Dual-Glo reporter, plasmid assembly (Gibson, Golden Gate) with purification; a fictional Demo Lab; YAML in `seed/`, vendor PDFs linked not committed; own SOPs plus openly licensed ones; kinds plus a small stocked lab. Every value is marked verified, estimated or unknown; no invented catalog numbers. [Plan 006](../plans/006-seed-lab.md)

## 007 Labware (L1 to L6, all as recommended)

| # | Decision |
| --- | --- |
| L1 | 007 is labware types only; physical plates and tubes, contents and locations belong to inventory (010) |
| L2 | Parametric grid plus an explicit well list for irregular labware; canonical well names `A1` to `AF48` |
| L3 | One labware kind with families: plate, reservoir, tube, rack, tip rack, lid (flask and dish added for 010) |
| L4 | Dead volume: a default on the type plus per-instrument-kind values, each with a source |
| L5 | Specs from Opentrons' library and echo650-twin's reviewed catalog, pasted datasheets, and agent knowledge marked estimated; web access for the in-app agent is its own later plan |
| L6 | Store each platform's name for the type and export Opentrons JSON; never generate Hamilton files. Nothing connects to instrument software yet; simulate first |

[Plan 007](../plans/007-labware-library.md)

## 008 Instruments (I1 to I15)

| # | Decision |
| --- | --- |
| I1 | Instrument and equipment kinds are records; twin and driver code attach optionally by ID |
| I2 | Adopt echo650-twin's configuration graph, mounts, sites, capability providers and operating profiles; kinematics and visuals wait for the twin port (015) |
| I3 | A configuration is what is physically installed now, versioned; each mount says who can change it and roughly how long it takes |
| I4 | Only serial-bearing parts that move between instruments (Flex pipettes, gripper, modules) are records |
| I5 | Capability contracts are code in `packages/schema`; limits per kind are data |
| I6 | Manual stations (bench, biosafety cabinet, hand multichannel) are instrument kinds whose capabilities a person performs |
| I7 | Model the lab's own instruments first (see [Registries](registries.md)) |
| I8 | Workcells are design documents built from registered instruments and FlexPods (step 008d) |
| I9 | An instrument is in at most one physically active workcell; others are used standalone |
| I10 | The workcell is the FlexPod (PlateOrient, two 12-position stackers) with the Echo, PreciseDrop, LidValet, Mantis, A4S, XPeel and MicroSpin |
| I11 | A workcell is a list of member instruments mapped to the digital twin; no 2D layout |
| I12 | Reach and move times come from the twin; nobody enters them |
| I13 | No docks, and re-teaching is not tracked or enforced |
| I14 | A workcell may have several robots (modelled in the twin) |
| I15 | Each member says whether it can also be used by hand |

[Plan 008](../plans/008-instrument-library.md)

## 009 Reagents and liquids (R1 to R12, all as recommended)

| # | Decision |
| --- | --- |
| R1 | 009 owns products and lots; 010 owns the containers holding a lot |
| R2 | Kit components are their own product records; a kit lot lists its component lots |
| R3 | Lab-made solutions are recipes; a batch is a lab-made lot traceable to its ingredients |
| R4 | Two layers: platform-neutral liquid types on products, per-device liquid classes; a resolver picks and explains |
| R5 | Full parameters only for Opentrons; Venus (STAR, Vantage, FeliX) stores the class name plus a read-only imported copy; Echo stores the calibration name. All classes editable; an edited Venus class shows "changed here, apply in Venus" |
| R6 | A typed handling-rule vocabulary defined here, shared with 010; each rule has a source and is enforced or advice |
| R7 | One class = one device, one tip or source plate type, one dispense mode, one volume range |
| R8 | A mixture's liquid type: the largest component, unless a listed solvent passes its threshold (at least 70% DMSO, over 20% glycerol); marked assumed |
| R9 | SOP variables link to lot-specific product fields; the value comes from the lot picked at planning |
| R10 | Quarantined lots are blocked; expired lots warn and need a reason to confirm |
| R11 | A class is "verified in this lab" only with a passing verification record from a real run; demo records never count |
| R12 | Seed classes from Opentrons shared-data (Apache-2.0) and PyLabRobot's Hamilton defaults (MIT); Echo names are plate type plus calibration (`384PP_DMSO2`) |

[Plan 009](../plans/009-reagents-and-liquids.md)

## 010 Inventory (V1 to V12, all as recommended)

| # | Decision |
| --- | --- |
| V1 | Entity kinds are records built on a base class from code (DNA, RNA, protein, chemical, cells, organism, other) with typed fields |
| V2 | Entity, then a sample (lab-made prep) or a lot (bought or recipe batch), then container contents |
| V3 | Wells know their full composition with amounts, concentrations and lineage |
| V4 | Append-only volume ledger; no negative volumes; below dead volume warns; "unknown" allowed; measured values replace computed ones with a reason |
| V5 | A container's readable name is its barcode; vendor barcodes also resolve |
| V6 | A fixed location tree; boxes and racks are containers that move |
| V7 | People record physical events directly; an agent's record is a proposal unless it comes from a run log or a run the person started. Autonomy is earned per scenario: confirm, edit and reject rates are kept, and a person can switch a scenario to auto-confirm. Nothing auto-confirms at launch |
| V8 | Confirmed plans soft-reserve stock; over-commitment warns |
| V9 | Sequences with features, GenBank and FASTA, SMILES, InChIKey and molecular weight, duplicate detection; no construct designer yet |
| V10 | One entity per library compound |
| V11 | Passage, confluence and cell count on flasks; banks are samples |
| V12 | An agent drafts spreadsheet imports; a person confirms |

[Plan 010](../plans/010-inventory.md)

## 011 SOP and literature library (S1 to S6, all as recommended)

S1 a library document and a digital SOP are two records. S2 a content-addressed file store on a Docker volume, S3-ready. S3 Docling in the science service converts documents. S4 hybrid search: Postgres full text plus pgvector. S5 embeddings local by default, an OpenAI-compatible provider optional; one model per lab, stored with every vector. S6 agents mine mentions and parameters, a person confirms. [Plan 011](../plans/011-sop-library.md)

## 012 Digital SOPs (G1 to G11, all as recommended)

G1 our own schema with fixed sections; LabOP as a test and import path. G2 typed steps from a fixed action vocabulary plus "manual". G3 a small expression language with units and exact decimals. G4 materials and instruments named by role, bound when an experiment is planned. G5 run-level inputs are typed variables. G6 unclear source text becomes open questions that block confirm. G7 variants are variables; structural changes make a derived SOP with a diff. G8 no nesting; composition belongs to templates (017) and workflows (018). G9 recording runs belongs to 013. G10 out: printable document; in: digitizer and LabOP. G11 a benchmark, plus an AI review loop that fixes what the source settles as tracked changes and asks where it is ambiguous. [Plan 012](../plans/012-digital-sops.md)

## 013 Campaigns and experiments (E1 to E12, all as recommended)

E1 campaign, experiment, run. E2 an experiment is the design; a run is one execution. E3 hypotheses with an optional testable prediction. E4 fixed stages, separate from record status. E5 experiments pin confirmed SOP versions and bind their roles and inputs. E6 013 builds the full experiment record; 017 adds templates. E7 the run view is a checklist: tick per step, "all done as planned", type only deviations. E8 a confirmed design is frozen per version. E9 runs attach data files; conclusions per hypothesis. E10 sets carry results to the next experiment. E11 agents draft; planning, concluding and stage changes are proposals. E12 everyone in the lab sees everything; owners and contributors for filters. [Plan 013](../plans/013-campaigns-and-experiments.md)

## 015 Digital twins (T1 to T13)

| # | Decision |
| --- | --- |
| T1 | Twins are uploaded into this app; echo650-twin is only where they are built. No code sync |
| T2 | Twins run headless in the API (times, checks, scheduling) and in the browser (3D) from the same code |
| T3 | A twin's setup is derived from the instrument's registry configuration; mismatches are warnings |
| T4 | The FlexPod layout is made in the twin studio and imported as a versioned layout; the member check runs on import |
| T5 | Instruments without a full twin get a generic twin from their kind (estimated times), replaced on upload |
| T6 | Headless simulation first, 3D pages second |
| T7 | A package is data plus its 3D model, never code; behaviour comes from tested templates in the app |
| T8 | Every phase's time is a typed model in seconds with min, typical and max, computed before animation |
| T9 | One provenance list for every value: measured, vendor, derived, estimated, unknown |
| T10 | Commands that do lab work name a capability from the catalogue; device-only commands are internal |
| T11 | Parts move between named positions; robot-loaded sites carry access poses; collision optional |
| T12 | Uploads are checked (closed schema, plain-language errors), land as drafts a person confirms, versioned |
| T13 | Codex (Astra) audits and standardizes the existing twins in echo650-twin and exports them as packages |

[Plan 015](../plans/015-digital-twins.md), [twin package standard](../plans/015-twin-package-standard.md)

## Designers: 014 plate maps, 016 transfers, 017 experiment designer (all as recommended)

Locked 2026-09-29. Plans: [014](../plans/014-plate-map-designer.md), [016](../plans/016-transfer-designer.md), [017](../plans/017-experiment-designer.md).

- **Round 1 (P1 to P6, shared):** three linked documents (experiment, plate maps, transfer plans), each confirmed on its own; a plate map states intended contents only; layout templates plus plate maps; maps store the rules and the wells with overrides; the transfer plan picks containers and holds reservations; upstream changes mark confirmed documents "out of date" and redraft drafts.
- **Round 2, 014 (M1 to M6):** every placement strategy (in order, randomized, balanced across plates, edge handling) with stored seeds, and lab-made layout templates; a dilution series is one object; one plate map spans many plates; a layout is for one plate format; small edits by hand, bigger ones through the agent; wells carry analysis groups.
- **Round 3, 016 (016-T1 to T6):** code solves transfers exactly and the agent picks the method per group. Every worklist writer is built against an example file as a golden-file test (mocks in `seed/worklists/` until the lab has real exports); Echo and Opentrons writers are code, while Hamilton, Mantis and PreciseDrop CSVs are **worklist format** records an agent drafts from an example and a person confirms. Deterministic read operations do the math for agents and the UI: `transfers.options`, `transfers.dilution_options`, `transfers.source_volumes`, `transfers.check`. Echo CSV and Opentrons first, never Venus methods; Echo transfer reports imported and matched to the plan. Tip handling is declared by each instrument method, and the plan counts tips and warns on clashes; default tip rules apply only where we write the protocol (Opentrons). Deck layouts drafted and checked against the instrument's configuration.
- **Round 4, 017 (017-D1 to D7):** an assay template is a versioned, confirmed record; the custom builder is the agent drafting that same record, and any experiment can be saved as a template; the designer asks only a template's essential inputs; templates name capabilities and roles, bound to the lab's instruments by 016's tools; conditions are factors with levels, with full factorial and one-factor-at-a-time first; replicates, plate counts and totals come from template rules before confirm, and power analysis waits for 020; ELISA first, then compound screen and dose-response, Dual-Glo, pNPP, with plasmid assembly after the workflow creator (018).
- **Dilution optimizer, 016:** `transfers.optimize_dilution` decides per compound and point whether the source plate works or an intermediate dilution is needed, and packs all compounds into the fewest intermediate plates and wells, within the DMSO limit and the plate's dead and maximum volume, optimizing accuracy, then plates, then wells; its result is drafted as intermediate plate maps and transfer plans. It is the first of the lab calculators (0024).

## 018 Workflow creator (W1 to W12, all as recommended)

Locked 2026-09-29. Built on echo650-twin's Runbook model.

- **Round 1 (018-W1 to W6):** a workflow is a design for one work unit (one assay plate and what happens to it), with shared plates marked; plate count and units at once are run settings. Code builds the draft from confirmed SOPs, plate maps and transfer plans, including intermediate dilution plates from 016's optimizer; the agent only picks joins (from ranked `workflows.join_options`) and holds. One step per SOP step, with SOPs drawn as nodes you open; robot moves are derived, not drawn. Connections are labware flow, wait-for and timing windows; no cycles and no run-time branches (a data decision ends the workflow and a set starts the next). Steps list candidate instruments from the workcell and standalone instruments; orchestration across them is 019's. A typed schedule request is the contract with 019; 018 shows only an unlimited-resource timeline, "not a schedule".
- **Round 2 (018-W7 to W12):** durations carry their source (measured, simulated, transfer plan, SOP, default); handling rules come from planned contents, SOP windows and lab memory, each with its source, and agents can research missing rules as proposals with citations; holds are steps with conditions, and working hours are the scheduler's calendar; standalone workflows for routines, with recurrence on the schedule request; a run's checklist comes from the workflow's steps; several experiments on one day are combined by the scheduler. [Plan 018](../plans/018-workflow-creator.md)

## 019 Scheduler and orchestrator (S1 to S18)

Locked 2026-09-29; all as recommended except S12 (B). Built on echo650-twin's deterministic dispatch and exposure kernel, which had no solver, people, calendars or hand carrying.

- **Round 1 (019-S1 to S6):** two levels in one engine: a lab orchestrator across standalone instruments, people and the workcell, and the ported echo650 kernel planning each workcell segment exactly; we plan and simulate FlexPod segments and Cellario executes them; plates move between places as derived carries with travel times, counted as time out of controlled conditions; people are resources with hours, absences and training; person time is split from walk-away time; the engine is echo650's slack-first dispatch plus minimum and maximum waits, people and calendars, to be improved or overhauled where it doesn't fit, with a solver interface for later.
- **Round 2 (019-S7 to S12):** the app owns calendars and bookings, with a calendar page where people book instruments and actions directly and an iCal feed out; a schedule is a design a person confirms (tentative bookings until then); confirmed bookings stay put and moving others' work needs their confirmation; agents use options, what-ifs and explanations and never set times; a person can loosen a hard rule for one schedule with a reason; people are the only transporters for now (S12 B), AMRs later.
- **Round 3 (019-S13 to S18):** durations carry a spread by source, a person can state an expected duration, repeatable actions learn their mean and standard deviation from Cellario, instrument and robot logs, and per-action timing models fitted from instrument logs predict worklists and calibrate the twins, and hard rules must hold in fixed stress cases; live runs follow actual times and re-plan only what hasn't started, small own-work re-plans applying automatically; Gantt lanes by instrument, person and plate with simulation playback; prep lists and loading cards; a fixed objective order (rules, science margin, priorities, finish, out-of-hours work, changeovers) that people meet as three or four option cards and one "what matters most" question, with the agent recommending; split 019a to 019e. [Plan 019](../plans/019-scheduler-and-orchestrator.md)

## 020 Analysis (A1 to A18, all as recommended)

Locked 2026-09-29. Wali asked whether scientists should also get Plotly for control over their graphs; A7 answered it with one engine and a format panel.

- **Round 1 (020-A1 to A6):** an analysis template is a series of steps against plate-map roles and groups; an analysis applies it to runs, is drafted and confirmed, and its results are versioned and linked to their files. Every statistical method is a vetted entry in a catalog in the science service, and derived columns use 012's expression language (a sandboxed Python step may come later). An import format per reader export turns files into tidy measurements, with agent-drafted column mappings for unknown files. Graphs are Vega-Lite specs. Exploration covers results across runs, experiments, campaigns and sets in linked views, and selections can become sets. An analysis drafts itself when a run's data arrives and a person confirms it.
- **Round 2 (020-A7 to A12):** one chart engine (Vega-Lite) with a Prism-style format panel, and exports (CSV, Excel, Python notebook with Plotly or matplotlib, Prism .pzfx) instead of Plotly inside the app. Measurements and results in Postgres; Parquet and DuckDB wait for per-cell imaging. Exclusions need a reason, and outlier tests only propose. The first catalog covers the five seed assays, checked against reference results (NIST, R drc). Hit calls and verdicts are computed (a prediction is supported only if its whole confidence interval passes). Repeats are fitted per run and then summarized, never extrapolated.
- **Round 3 (020-A13 to A18):** agents can do everything but confirm; questions about data become editable view specs, not SQL; `analysis.power` uses the template's own history for the designer; control charts per template raise drift notes and lab memory proposals; an analysis page, an explore page and a templates page; split 020a to 020g. [Plan 020](../plans/020-analysis.md)

## 021 Lab notebook (N1 to N12, all as recommended)

Locked 2026-09-30. Wali asked how the timeline is computed; the plan answers it (modules declare notable operations, code reads the ledger and record history and groups by experiment and day).

- **Round 1 (021-N1 to N6):** one stream of dated entries, each linked to any records or none, read per person, experiment, campaign or lab-wide; the body is Markdown with a closed set of embeds, edited in a what-you-see editor; the timeline is computed by code from a closed list of notable events, one summary line per group; entries stay editable with full history, late edits are marked, and a person can lock an entry (then only addenda); agents only draft, on request, with numbers as record references; readable names link at once, other names are suggested, and embeds are pinned by version.
- **Round 2 (021-N7 to N12):** a value written in a note stays text, and the agent proposes the run record citing the words; notes join the library search and the latest two or three about the page's records reach agents as data; the lab sees active entries, drafts only their author; a note box on the run view with photos and device dictation; PDF and HTML export on request; no entry templates. [Plan 021](../plans/021-lab-notebook.md)
- **After the adversarial review (8 changes, 2026-09-30):** the entry schema settled before 021a (`at` and `day` with a lab time zone, tags on the record envelope, `@` mentions, review requests and entries addressed to agents, a core `Locator` for places inside records, replies, follow-up checkboxes, the author always a person); agent drafts addressed to their author rather than private; a closed body syntax checked on write (no raw HTML or external images); N7 goes through a new 013 `runs.correct` in the structured step form; ledger rows record `{id, version}` (ADR 0018 amendment); a shared text index owned by 011 and one PDF renderer (headless Chromium) shared with 020; save rules, one entry per bench note, photo handling in 011, only active entries in the context bundle, locking as a kind rule; acceptance scenarios.
