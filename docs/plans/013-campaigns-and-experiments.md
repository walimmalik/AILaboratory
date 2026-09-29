# 013: Campaigns and experiments

- Status: accepted. Round 1 (E1 to E6) and round 2 (E7 to E12) accepted by Wali 2026-09-29, all as recommended, with the note on E7. Ready to build after 012 (013a can start once 010a lands).
- Depends on: 002 (records, links, history), 003 (operations, agent policies), 004c/004d (draft-and-confirm, one Review page), 009 (lots), 010 (entities, samples, containers, soft reservations V8, agent policy per scenario V7), 011 (library documents, file store), 012 (confirmed digital SOP versions, roles and input variables bound "when an experiment is planned")
- Feeds: 014 (plate maps are made for an experiment), 016 (transfer plans), 017 (experiment designer and assay templates fill an experiment's design), 018 (workflows), 019 (the scheduler schedules runs), 020 (analysis attaches to runs and tests hypotheses), 021 (notebook entries link to experiments and runs), 005 (lessons proposed from concluded experiments)

## What this plan delivers

The scientific frame that every design and every bench action hangs from:

- **Campaigns:** a lab project with a goal, background, aims and people ("BRD4 degrader screen", "IL-6 reporter panel"). Everything done for it is reachable from its page.
- **Experiments:** one question inside a campaign, with its hypothesis, what is being tested, the SOP versions it follows, and the choices those SOPs leave open (which plate type, which lot, how many samples).
- **Runs:** each time an experiment is actually carried out (day 1, 2, 3 biological repeats), with what was really used and done, deviations, and the data files that came out.
- **Deep links:** "which experiments used lot LOT-0017", "which runs followed SOP-0004 v3", "what did we conclude about CMP-0003" are one query, in both directions.
- **Recording what happened** (handed over by 012 G9): the run is where actual values, times and deviations are captured against the planned SOP steps. The notebook (021) later shows it as a timeline and adds free writing.

## Starting point

- `seed/assays.yaml` already chains assays the way a campaign does: single-point screen with `next: assay-compound-dose-response`, Dual-Glo with constructs, plasmid assembly whose output is a registered plasmid.
- `seed/lab.yaml` has four people (PI, postdoc, grad student, automation engineer) to own campaigns and experiments.
- 012 decided: experiments pin a confirmed digital SOP version; a new SOP version flags experiments still in planning; roles (G4) and input variables (G5) are bound per experiment; lot-specific values resolve once the lot is picked (009 R9), and until then show a typical value as estimated.
- 010 decided: confirmed plans soft-reserve stock (V8); physical events by agents are proposals unless from a run log or a run the person started (V7), with per-scenario autonomy that can be earned later.
- 004d: one Review page for everything waiting on a person. The mockup's breadcrumb already reads `experiments / cytokine-panel-b / EXP-0042`.

## Proposed model (assuming the recommended answers)

| Layer | Record | Holds |
| --- | --- | --- |
| Kind-like | **Campaign** (`cam_`, `CAM-001`) | Title, goal, background, aims (each with a success criterion), owner and people, dates, stage, links to the entities it is about (target protein, cell line, compound library), references (library documents) |
| Instance | **Experiment** (`exp_`, `EXP-0001`) | Campaign and the aim it serves, question and hypothesis with a testable prediction, subjects (what is being tested), protocol (pinned SOP versions with their bindings), conditions and controls, readouts, success criteria, links to plate maps, transfer plans and workflows (slots filled by 014, 016, 018), stage, conclusion |
| State | **Run** (`run_`, `RUN-0001`) | Experiment and the design version it ran, date and operator, planned vs actual step values and times, lots and containers actually used, deviations with reasons, data files, run status |
| Link record | **Set** (`set_`, `SET-001`), see E11 | A named list of entities or samples one experiment hands to the next ("hits from EXP-0012") |

Campaign, experiment and run are all records (002), so they get history, links, drafts, sections and readiness for free. Lifecycle stage (E4) is an attribute, separate from the record status (draft, active, archived).

## Operations (first cut, adjusted once decisions are made)

| Operation | Agents |
| --- | --- |
| `campaigns.draft`, `campaigns.update`, `campaigns.set_stage` | direct on drafts, proposed on active |
| `experiments.draft` (from a question, an assay template or an earlier experiment), `experiments.update` | direct on drafts, proposed on active |
| `experiments.bind_protocol` (pin SOP versions, bind roles to labware types, lots, instruments; set input variables) | direct on drafts |
| `experiments.plan` (the design is confirmed; reserves stock) | people only, or an agent's proposal |
| `runs.start`, `runs.record_step`, `runs.record_deviation`, `runs.attach_data`, `runs.finish` | see E7 |
| `experiments.conclude` (outcome per hypothesis, with evidence) | agent drafts, person confirms |
| `sets.create` (from a conclusion or an analysis), `sets.get` | proposed |
| `campaigns.get`, `experiments.get`, `experiments.search`, `runs.get`, `experiments.where_used` (every experiment and run touching a record) | read |

## Screens

- **Campaigns list:** stage, owner, aims done of total, experiments by stage, last activity.
- **Campaign page:** goal and aims, each aim with the experiments serving it and their outcome; a simple flow of experiments (screen, then confirmation, then dose-response) with the sets passed between them; people; linked records and references.
- **Experiment page:** design mode (draft, readiness panel, agent beside it) until planned; then a run list and a results section. Sections: question and hypothesis, subjects, protocol, conditions and controls, layouts and plans, runs, results and conclusion.
- **Run view:** tablet-friendly, one step per row from the pinned SOP with planned values, a place for actuals and times, and a deviation button; scanned barcodes fill "what was used".

---

## Round 1 answers

Wali chose A for E1 to E6 on 2026-09-29.

## Round 1 questions (as asked): structure and lifecycle

Recommended option in bold. Asked 2026-09-29.

| # | Question | Options | Recommendation and why |
| --- | --- | --- | --- |
| E1 | How many levels between a campaign and the bench? | A) Campaign, then experiment, then run. Aims live inside the campaign as a list, and each experiment says which aim it serves · B) Four levels: campaign, aim (or study) as its own record, experiment, run · C) Two levels: campaign and experiment, and a repeat is a new experiment | **A.** Aims are short and belong to the campaign's story, so a record per aim adds pages without adding facts. The run level is needed because the same design is repeated on different days (biological replicates) and each day has its own lots, operator, deviations and data (see E2). |
| E2 | What is the difference between an experiment and a run? | A) The experiment is the question and the design (confirmed once); a run is one execution of that design on a day, with its own actuals and data. Repeating the same design is another run. Changing the design (new conditions, a different SOP) is a new experiment linked "follows up" or "repeat with changes" · B) One experiment is one execution; a repeat is a copied experiment · C) The experiment is only the design; executions live in the workflow and scheduler plans (018, 019) | **A.** Analysis across days (mean of three biological repeats) needs the runs grouped under one design, and B scatters them. C leaves nothing to record against until 019 exists. 019 will schedule runs, so this is the object it needs anyway. |
| E3 | How structured are the hypothesis and aims? | A) A plain-language statement plus an optional testable prediction: which readout, which measure (IC50, fold change, Z', percent activity), a comparison and a threshold with a unit ("DC50 of CMP-0003 below 1 µM"). Analysis (020) can then mark each prediction supported, refuted or inconclusive with the evidence · B) Free text fields only · C) Fully structured, every hypothesis must have a machine-checkable prediction | **A.** The prediction is what makes "did it work?" answerable by an agent and keeps success criteria honest before data arrives, but exploratory experiments ("see what the library does") have no threshold, so it stays optional. |
| E4 | What stages do experiments and campaigns go through? | A) Fixed stages, separate from record status. Experiment: designing, planned (design confirmed, stock reserved, can be scheduled), running (a run started), analysing (runs done), concluded; plus on hold and cancelled from any stage. Run: scheduled, in progress, done, failed, aborted. Campaign: proposed, active, paused, completed, stopped · B) Only the record statuses (draft, active, archived) · C) Stages each lab defines for itself | **A.** The scheduler, reservations and "what is waiting for me" need stages they can rely on, and B can't say whether something ran. Custom stages (C) break every downstream rule that reads them. Moving to planned or concluded is a person's confirm, like any other. |
| E5 | How does an experiment use SOPs? | A) Its protocol section pins confirmed digital SOP versions and binds what each leaves open (roles to a labware type, lot or instrument; input variables such as sample count), so derived values compute for this experiment. Library documents that aren't digitized can be attached as "follows" or "reference" with a warning that nothing computes from them. A new SOP version flags experiments still designing; planned ones keep theirs · B) Tags only: an experiment is tagged with SOPs and documents, bindings happen elsewhere · C) Only digital SOPs allowed | **A.** 012 left binding to "when an experiment is planned", and this is where that happens. Allowing undigitized documents keeps quick experiments possible on day one without pretending they are computed; C would block work until 012c exists. |
| E6 | Where does 013 end and the experiment designer (017) begin? | A) 013 builds the full experiment record with all its sections (question, subjects, protocol, conditions and controls, layouts and plans, runs, conclusion) and a plain agent that drafts it from a question; plate map, transfer plan and workflow slots stay empty until 014, 016 and 018 land. 017 later adds assay templates and the guided designer that fills the same record · B) 013 is a thin container (title, campaign, tags); all design fields arrive with 017 · C) Merge 013 and 017 into one plan | **A.** One record shape from the start means 014 to 018 have somewhere to attach, and nothing gets migrated when 017 lands (greenfield rule). C makes a very large plan, which you've asked to avoid. |

## Round 2 answers

- **E7 (A, kept simple).** Wali, 2026-09-29: users are lazy, so the run view is a checklist. Each step has a checkbox that records it as done as planned (planned values become the actuals, with the time it was ticked), and one "all done as planned" button ticks every remaining step. A person types a value only when something differed, which makes it a deviation with a short reason. Scanning containers and lots is optional; when nothing is scanned, the run uses what the plan reserved. An agent filling a run from notes or a photo is still a proposal.
- **E8 to E12:** Wali chose A for all, 2026-09-29.

## Round 2 questions: the bench, results and handoffs

Recommended option in bold. Asked 2026-09-29.

| # | Question | Options | Recommendation and why |
| --- | --- | --- | --- |
| E7 | How is a run recorded at the bench? | A) A run view generated from the pinned SOP steps: planned value beside a field for the actual, start and end times, a deviation button (what changed, why, impact), and scanned containers and lots that call inventory operations (fill, consume) as the person goes. Anything that differs from plan is flagged as a deviation automatically. An agent can fill a run from notes or a photo as a proposal · B) Free-text run notes with attachments; structure waits for the notebook (021) · C) Nothing until instruments report runs (022) | **A.** 012 G9 handed this here. Planned-vs-actual per step is what makes deviations visible and feeds lab memory with real timings; B gives nothing an agent can compute with. |
| E8 | Can a planned design change once runs have started? | A) The confirmed design is frozen per version. Changing it makes a new design version (confirmed again) and later runs pin it; earlier runs keep theirs. One-off changes on the day are deviations on the run, not design edits · B) Editable any time, history shows it · C) Frozen for good; any change is a new experiment | **A.** Runs must say exactly what they followed; B makes cross-run analysis unreliable, C is too rigid for a design that needs a small fix after run 1. |
| E9 | Where do data files and results live? | A) A run attaches data files (reader exports, images) through the file store (011), each linked to the plate and read step it came from. Parsing and statistics are analysis (020); the experiment's results section shows key numbers from analyses and the conclusion per hypothesis (supported, refuted, inconclusive) with evidence, drafted by an agent and confirmed by a person · B) Files only, conclusions as free text · C) Parse reader files in 013 | **A.** Files need a home before 020 exists, and linking them to plate and step now is what lets 020 join reads to well contents (010). |
| E10 | How do results flow from one experiment to the next? (hits to dose-response, clones to sequencing) | A) A set is a named, versioned list of entities or samples, created from a conclusion or analysis ("12 hits from EXP-0012, viability below 3 SD"), confirmed by a person, and used as the subjects of a follow-up experiment; the campaign page draws the chain · B) A "follows up" link only; subjects are re-picked by hand · C) Tags on entities ("hit") | **A.** The screening cascade in `assays.yaml` is exactly this, and it keeps the reason each compound moved on. Tags lose which experiment said so and when. |
| E11 | Who may do what, agents included? | A) Agents draft and edit campaigns and experiments directly while they are drafts; planning, concluding and stage changes are proposals a person confirms; run records by an agent follow 010 V7 (proposal unless from a run log or a run the person started, autonomy earned per scenario) · B) Agents propose everything · C) Agents act like people | **A.** Same line as the rest of the app: agents draft freely, and anything that commits stock, time or a scientific claim needs a person. |
| E12 | Who can see and edit a campaign? | A) Everyone in the lab sees everything; each campaign and experiment has an owner and contributors, shown on the page and used for "my work" filters; permissions come with roles later (002) · B) Per-campaign membership that restricts who can see and edit · C) Private by default, shared on request | **A.** An academic lab mostly works in the open, and 002 left roles for later. The owner and contributor fields make B possible later without changing the records. |

## Defaults I'm assuming (say if any is wrong)

- Readable names: `CAM-001` for campaigns, `EXP-0001` for experiments, `RUN-0001` for runs, plus a short slug title for the breadcrumb (`experiments / brd4-degraders / EXP-0042`).
- An experiment belongs to exactly one campaign; a lab can have a standing "General" campaign for one-off work.
- An experiment can pin more than one SOP (the compound screen uses seeding, compound transfer and CellTiter-Glo SOPs).
- Controls and conditions are listed per experiment in lab terms (DMSO neutral, staurosporine 1 µM positive; 10-point 3-fold from 10 µM); well positions are the plate map's job (014).
- Stock reservations (010 V8) are made when an experiment is planned and released when a run records actual use or the experiment is cancelled.
- A concluded experiment can propose lab memories ("edge wells evaporate at 48 h") for a person to confirm (005).
- The seed gets one demo campaign with a few experiments across stages, built from `assays.yaml`, loaded as 013 lands.

## Proposed split (after decisions)

- **013a:** campaign, experiment and run kinds with sections and checks, stages, operations, seed demo campaign.
- **013b:** protocol binding against 012 (pin, bind roles and inputs, recompute, flags on new SOP versions), reservations.
- **013c:** run recording (bench view, deviations, data files), conclusions, sets.
- **013d:** campaign and experiment screens, agent drafting from a question, skill.
