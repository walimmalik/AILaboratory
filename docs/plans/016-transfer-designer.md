# 016: Transfer designer

- Status: accepted. Round 3 (T1 to T6) accepted by Wali 2026-09-29, all A, with the notes on T1, T2 and T5. Ready to build after 014a and 009b. Worklist examples are mocked in `seed/worklists/` until real exports exist. Shares round 1 (P1 to P6) with 014 and 017, see `014-plate-map-designer.md`.
- Depends on: 007 (labware, dead volumes per instrument kind, platform names, Opentrons export), 008 (instruments, resolved configurations, capabilities, `instruments.find_capable`), 009 (liquid classes and the resolver), 010 (containers, well contents, ledger, `inventory.transfer` and `inventory.stamp`, soft reservations), 012 (transfer steps in digital SOPs), 014 (plate maps as targets), 015 (twins, for simulation)
- Feeds: 013 (runs record what was transferred), 018 (a transfer plan is a workflow step), 019 (instrument time and tips for scheduling), 022 (the gateway runs the same plan on hardware)

## What this plan delivers

"How the liquid gets there", drafted by the agent and checked by code:

- **Transfer plans:** from sources (containers in inventory, or plates to prepare) to targets (a plate map, a stamp, a cherry-pick list, a reformat), worked out by code as concrete transfers: source well, destination well, volume, liquid class, instrument.
- **Instrument choice with reasons:** for each group of transfers the plan says which instrument does it and why ("Echo: 25 nL of DMSO stock, no tips"), with the alternatives it considered and what they would cost, and switching is one click that recomputes.
- **Methods, not only lists:** direct dispense with backfill, serial dilution in plate, intermediate dilution plates, stamping, pooling, reformatting (4 x 96 into 384), cherry-picking, reagent addition from a reservoir.
- **Deck layouts and loading:** where each plate, reservoir and tip rack sits on each instrument, checked against the instrument's current configuration (008 I3), drawn as a 2D deck view with plain loading instructions.
- **Worklists out, logs in:** files each instrument's own software runs, and the instrument's report read back to record what actually happened.
- **Totals:** source volume needed per container including dead volume, tips, plates, estimated instrument time (marked estimated).
- **Recommendation tools:** read operations that do the math on capabilities, volumes, dead volumes and dilutions and return ranked options with the numbers shown, so agents compute instead of guessing (T2).

## Starting point

- 007: platform names per labware type (Opentrons load name, Hamilton labware file, Echo plate type) and Opentrons JSON export; dead volume per instrument kind (L4).
- 009: one liquid class per device, tip or source plate, dispense mode and volume range; the resolver explains its pick and raises "no validated class"; Venus classes are named, never written. Echo class = source plate type plus calibration (`384PP_DMSO2`).
- 010: transfers, stamps and plate-to-plate mappings (quadrants, offsets) with mixing math and the ledger; plans soft-reserve stock; agent-recorded physical events are proposals unless from a run log (V7).
- `seed/instruments.yaml`: Echo 650 (2.5 nL droplets, 384PP, 384LDV, 1536LDV), Mantis (LV and HV chips, CSV plate-map import), PreciseDrop (CSV import, gradient dispense), STAR and Vantage (1 mL channels, CO-RE 96 and 384 heads), Flex, FeliX.
- 000 idea 1.5: SOP steps name capabilities; binding to instrument, liquid class and worklist happens here.

## Model

| Layer | Record | Holds |
| --- | --- | --- |
| Kind | **Worklist format** (`wlf_`, `WLF-0001`) | For one instrument kind and one lab method: columns, headers, units, well and plate naming, how the method handles tips, the example file it was drafted from (T1, T5). Echo and Opentrons formats are code, not records |
| Instance | **Transfer plan** (`tfp_`, `TFP-0001`) | Targets (plate maps or explicit wells), sources (containers picked from inventory, P5), method per group with the agent's reason and the alternatives considered, steps per instrument, deck layouts, totals, reservations, exported files, out-of-date flag (P6) |
| Part | **Step** | One instrument session: instrument (or a manual station), deck layout, ordered transfers with liquid class, expected duration |
| Part | **Transfer** | Source container and well, destination container and well, volume, liquid class, tip use as the method defines it |
| State | **Execution** | Which worklists were run, the imported instrument report, per-transfer outcome (done, failed, short), and the ledger entries it produced |

Pure logic in `packages/domain/transfers`: solving target concentrations into volumes (direct, backfill, serial, intermediate), feasibility per instrument (volume ranges, droplet quantum and rounding error, labware accepted), source volume totals with dead volume, transfer ordering, tip counting from the method's tip behaviour. Worklist writers and report readers live in the API: Echo and Opentrons in code, the rest through one generic CSV writer driven by worklist format records, each with golden-file tests from real example files.

## Operations

| Operation | Agents |
| --- | --- |
| `transfers.options`, `transfers.dilution_options`, `transfers.source_volumes`, `transfers.check` (the deterministic recommendation tools, T2) | read |
| `transfers.draft` (from plate maps, a stamp, a cherry-pick list or a description) | direct |
| `transfers.set_method`, `transfers.set_instrument` (switch and recompute), `transfers.pick_sources`, `transfers.set_deck` | direct on drafts |
| `transfers.confirm` (soft-reserves the sources, 010 V8) | people, or proposed |
| `transfers.export` (worklists and Opentrons protocols for a confirmed plan) | read |
| `transfers.import_report` (Echo transfer and survey reports first; matched to the plan, writes ledger entries "from a run log") | direct (a run log is evidence, 010 V7) |
| `worklists.draft_format` (from an example file), `worklists.confirm_format` | direct on drafts, confirm people or proposed |
| `transfers.get`, `transfers.loading_list`, `transfers.where_used` | read |

## Screens

- **Transfer plan page:** groups of transfers in plain words ("Echo: 320 compounds, 25 nL each, into 4 assay plates"), the reason for each method and instrument with the alternatives one click away, source containers with volume needed against volume available, totals, readiness panel, agent panel.
- **Deck view and loading list:** per instrument step, the 2D deck from 008 with each plate, reservoir and tip rack on its site, and a numbered list a person follows at the instrument; a mismatch with the installed configuration shows the proposed change and its time cost.
- **Report view:** the imported instrument report on the plate map, failed and short wells marked.
- **Worklist formats:** the example file beside the drafted columns, confirmed like any design.

## Dilution optimizer (added 2026-09-29, O1 answered by Wali)

Wali's lab app today has a dilution optimizer: it works out intermediate dilution plates so each point of every curve is hit despite the Echo's 2.5 nL droplet, and its workflow builds those plates and their transfers for you. 016 builds the same thing.

- **A deterministic tool the agent calls.** It is one of the lab calculators (ADR 0024): the toolkit of deterministic read operations every agent has, indexed by one skill. `transfers.optimize_dilution` (in `packages/domain/transfers`, exposed as a read operation next to `transfers.dilution_options`) does all the math. The agent calls it, chooses between the options it returns when there is more than one, and explains the choice; it never computes volumes itself (T2).
- **What it solves (O1, as Wali described it).** Inputs: every compound on the destination plates with its stock concentration and its curve points (014 series), the final well volume, the maximum DMSO percentage in the well, the accuracy tolerance, the dispensing instrument's droplet size and range, and the intermediate plate type (dead volume and maximum working volume, since each intermediate well must be prepared with enough volume for every draw plus its dead volume and must not overflow). For each compound and each point it decides whether the point can be dispensed from the source plate or needs an intermediate dilution, then groups all compounds' intermediate dilutions into the minimum number of intermediate plates and wells. The DMSO limit and the plate volumes are hard limits; within them it optimizes accuracy, then the number of plates, then the number of wells. It reports, per point, the source well, droplets, backfill, achieved concentration and error, and per intermediate well what to put in it and how much is drawn from it.
- **Real drafts.** The result becomes intermediate plate maps (014) and the transfers that make and use them (this plan), drafted and waiting for confirm like any other design. Intermediate plates become real containers in inventory (010) when the plan runs.
- **Workflows pick it up.** The workflow creator (018) receives the intermediate plates and their transfer steps automatically, through its "code builds the draft" path (W2).
- **Starting point.** echo650-twin's `src/agent/science/dose-response.js` has the two simple cases (a series pre-made on the source plate, and direct dispense with DMSO backfill that fails loudly when a point is out of reach); they are ported as the degenerate cases. If the lab app's optimizer code or rules can be shared, its logic is ported, and one of its results becomes a test case.
- **Defaults (O2, O3; say if wrong):** accuracy tolerance ±5% per point, set on the assay template and changeable per experiment, with the achieved concentration stored in the well so analysis uses the real value; intermediate plates are made by a preparation step in the transfer plan (diluent, then stock), with the instrument picked by `transfers.options`, and can be reused while within their stability window.

## Round 3 answers

Wali chose A for T1 to T6 on 2026-09-29, with these notes:

- **T1, worklist examples.** Every worklist writer is built against example files, not memory. The lab has no exports yet, so on 2026-09-29 Wali asked for mocks: `seed/worklists/` holds one per instrument (Echo 650 pick lists and transfer and survey reports, an Opentrons Flex protocol, Hamilton STAR and Vantage CSVs, Mantis and PreciseDrop files), each marked mock with what is stated and what is made up. The Echo pick list columns are Wali's: source plate name, barcode and type (plate type plus calibration, `384PP_DMSO2`), source well, transfer volume, destination plate name, barcode and type, destination well. Each example becomes a golden-file test, and a real export replaces its mock when one exists. Echo and Opentrons formats are fixed by the vendor, so their writers are code. Hamilton, Mantis and PreciseDrop CSVs are whatever the lab's own method or software reads, so each is a **worklist format** record: columns, headers, units, well naming and plate naming, drafted by the agent from an example file and confirmed by a person, then used by one generic CSV writer. A new lab method is a new format record, not a code change.
- **T2, deterministic recommendation tools.** Agents should compute, not guess. 016 ships read operations that do the math and return options with the numbers shown, which agents (and the UI) call before choosing: `transfers.options` (for a liquid, volume, source and destination labware: every feasible instrument and device, with volume range, droplet or tip rounding and its error, liquid class and whether it is verified, dead volume, tips, rough time, ranked), `transfers.dilution_options` (can this final concentration be reached from this stock within the DMSO or solvent limit and the instrument's minimum volume, directly or through an intermediate plate, with the volumes), `transfers.source_volumes` (volume needed per source container including dead volume and overage, against what inventory holds after reservations), and `transfers.check` (every rule on a finished plan). They live in `packages/domain/transfers` as pure functions and are exposed as operations, so a person can use them from the UI too.
- **T5, tips are set where the protocol runs.** Wali pointed out that tip handling is defined by the protocol that runs on the instrument. So tip use is not a free choice in every plan: each instrument method (a worklist format for Hamilton, the vendor behaviour for the Echo and Mantis, which use no tips) declares how it handles tips ("new tip per row", "per source", "a worklist column says"). The plan reads that to count tips and cost, and warns when the method's behaviour clashes with what is moved ("this method reuses a tip across rows, and these rows carry different compounds"). The A default rules apply only where we write the protocol ourselves (Opentrons Python) or where the worklist has a tip column the method obeys.

## Round 3 questions (as asked): transfer plans

Recommended option in bold. Asked 2026-09-29.

| # | Question | Options | Recommendation and why |
| --- | --- | --- | --- |
| T1 | What is a transfer plan, and who works out the transfers? | A) Targets (plate maps, a stamp, a cherry-pick list) plus sources (containers), solved by code in `packages/domain/transfers` into exact transfers. The agent picks the method per group (direct dispense with backfill, serial dilution in plate, an intermediate plate when a volume is below an instrument's minimum) and explains it; code checks every volume, concentration and DMSO limit · B) A list of transfers the agent or a person writes by hand · C) The agent writes robot code directly | **A.** Volumes and concentrations must be exact (002 T2) and checkable; a model writing thousands of transfers by hand will make arithmetic slips, and robot code (C) can't be reviewed by a person at a glance. The agent's job is the judgement: which method, which instrument. |
| T2 | How is the instrument chosen for each group of transfers? | A) Code lists the feasible options (volume range, droplet or tip quantum, liquid class available and whether it is verified, labware accepted, dead volume, tips used, rough time), the agent picks one and says why, and the person can switch with one click, which recomputes the plan · B) The agent picks on its own · C) The person always picks | **A.** Feasibility is a fact the code can check; preference ("use the Echo for anything in DMSO under 1 µL") is judgement plus lab memory. Showing the alternatives with their cost makes a switch a decision, not a guess. |
| T3 | Which worklists come first? | A) 016a: Echo CSV and Opentrons Python protocols (checked in Opentrons' own simulator). 016b: CSV worklists read by the lab's existing Hamilton STAR and Vantage methods, Mantis and PreciseDrop CSV, FeliX. We never write Venus methods or labware (007 L6, 009 R5) · B) Echo only first, the rest later · C) All of them in one step | **A.** Echo and Opentrons are the two where we can check what we write (the Echo CSV format is simple and public, Opentrons has a simulator). Hamilton, Mantis and PreciseDrop come next through file formats their software already imports. |
| T4 | How does the instrument's report come back? | A) In 016: the Echo transfer report (and survey) is imported and matched to the plan: each transfer is done, failed or short, failed wells are flagged on the plate, and the ledger (010) records what really happened as "from a run log" (V7). Other instruments' logs come as each gets its worklist, and live reporting with the device gateway (022) · B) Wait for the device gateway (022) · C) A person marks failed wells by hand | **A.** The compound screen SOP already says "record the Echo transfer log; failed transfers flag the well". Without it, inventory and analysis assume every well got its compound. |
| T5 | How are tips used? | A) Defaults from what is being moved: a new tip for every sample or compound transfer; one tip reused for a common reagent dispensed into wells that hold no liquid yet; a new tip whenever the tip touches liquid in the destination. Shown per group and changeable; totals feed cost and scheduling · B) Always a new tip · C) Only what the SOP says, nothing inferred | **A.** B wastes a rack per plate on buffer additions, which the scheduler then has to plan tip reloads for; C leaves most transfers without a rule. The default rule is the one most lab SOPs write down. |
| T6 | Where do deck layouts come from? | A) The plan drafts a deck layout per instrument step (which plate, reservoir, tip rack on which site), checked against the instrument's current configuration (008 I3), drawn as a 2D deck and a plain loading list. If the plan needs something not installed, it proposes a configuration change with its time cost · B) Each instrument has fixed deck layouts that plans must use · C) No deck layout; the operator sets up the deck | **A.** Opentrons protocols need a deck layout to run, and the loading list is what a person follows at the instrument. The lab can still save a standard deck as a starting point, which the agent reuses. |

## Defaults I'm assuming (say if any is wrong)

- A transfer plan can be run more than once only by copying it; each run's sources and report belong to that run (013).
- Manual pipetting is a method too: the plan prints a bench sheet (step by step, well by well) for a person, and the run checklist (013 E7) records it.
- Exported files are stored in the file store (011) with the plan version they came from.
- Time estimates are marked estimated until 019 and the twins (015) replace them with simulated times.
- The Opentrons simulator runs in the science service (Python), checked before a protocol can be exported.

## Proposed split

- **016a:** schemas, `packages/domain/transfers` (solver, feasibility, dilution optimizer, source volumes, tip counting), the recommendation operations, transfer plan operations, reservations. Built (016a-1): `packages/domain/src/transfers.ts` with volume fitting, direct dispense, backfill, dilution options, source volumes, tip counting, device ranking and the dilution optimizer. Built (016a-2): the calculator operations `transfers.dilution_options`, `transfers.optimize_dilution`, `transfers.source_volumes` and `transfers.options`. Built (016a-3, ADR 0045): the transfer plan record with `transfers.draft`, `set_instrument`, `pick_sources`, `check` and `reserved`, and soft reservations derived from confirmed plans. Next (016a-4): drafting a plan from plate maps (direct dispense with backfill and intermediate plates from the optimizer) and `transfers.set_method`.
- **016b:** Echo pick list writer and transfer and survey report import, Opentrons protocol writer checked in the simulator, deck layouts, against the examples in `seed/worklists/`.
- **016c:** worklist format records and the generic CSV writer: Hamilton STAR and Vantage, Mantis, PreciseDrop, FeliX.
- **016d:** transfer plan page, deck view, loading list, report view, agent drafting, skill.
