# Agents, drafts and review

Two promises shape how agents work here: an agent can do anything a person can, and an agent drafts while a person confirms. This page explains how both are made true. Built in plans 003 and 004; decisions in ADRs [0015](../decisions/0015-operation-registry.md) to [0018](../decisions/0018-activity-ledger.md), [0020](../decisions/0020-own-agent-loop.md) to [0022](../decisions/0022-one-place-to-review.md).

## Human = agent

Every capability is an **operation** in one registry. People (through the web app) and agents (through MCP or REST) call the same operations through the same code path, `OperationRegistry.execute`. The web app can't reach the API any other way: a lint rule forbids `fetch` and friends in `apps/web/src`. So there is nothing the UI can do that an agent can't. Each module ships a skill in `skills/` that teaches agents when and how to combine its operations.

Agents reach the app three ways:

- **Outside agents** (Claude Code, the Claude app, bring-your-own-key models) connect to the MCP server at `/mcp` with an agent token. Two tools: `describe_operations` and `run_operation`.
- **The in-app assistant** runs our own tool loop in the API, with one tool per operation, on Anthropic, OpenRouter or any OpenAI-compatible model. It acts as an agent on behalf of the signed-in person. See [assistant.md](../architecture/assistant.md).
- **REST** for scripts, with a bearer token.

## What agents may do on their own

Each write operation declares an agent policy: `direct`, `propose`, or a rule decided per call. People always act directly. The policy is resolved in one place, so autonomy can be widened later without touching operations.

| Situation | Agents |
| --- | --- |
| Creating and editing drafts | Direct |
| Creating active records, editing or restoring active records | Proposed |
| Activating, archiving, unarchiving | Proposed |
| Confirming a section, asking the assistant, approving proposals | People only |
| Physical events (fill, transfer, consume, move; 010) | Proposed, unless from an instrument run log or a run the person started. Moving a container the person asked for in the same conversation is direct |
| Planning or concluding an experiment, changing stages (013) | Proposed |

A **proposal** stores the input and a preview (the operation run and rolled back). A person confirms or rejects it. Confirming runs the change as the proposing agent, so history credits the agent and the ledger records who confirmed. If the record changed since the proposal, the proposal fails and nothing changes.

**Earned autonomy (010-V7).** Wali wants agents to earn autonomy. The ledger will keep, per scenario ("move requested in the same conversation", "consume recorded by a run log"), how often proposals were confirmed unchanged, edited or rejected. When the record is good enough, a person can switch that scenario to auto-confirm; the switch is itself a recorded, reversible setting. Nothing auto-confirms at launch.

## Calculators: agents compute, they don't guess

Numbers agents rely on come from **calculators** ([ADR 0024](../decisions/0024-lab-calculators.md)): read operations marked `calculator: true`, backed by pure functions in `packages/domain`, indexed by one skill (`skills/calculators/`) that every agent loads, the in-app assistant included. A calculator returns the result, the inputs it used with their sources, ranked options with the numbers behind the ranking, and a plain explanation; it never writes. When an agent puts a calculator's result into a draft, the value's evidence is `calculated` by that operation, not `assumed`. People reach the same calculators from the UI. Planned so far: unit and mass-to-molar conversion, mixing and C1V1, plate-to-plate mappings, recipe scaling, liquid-class resolution, dead-volume lookup, SOP expressions, series expansion and placement, `transfers.options`, `transfers.dilution_options`, `transfers.optimize_dilution`, `transfers.source_volumes`, `transfers.check`, design totals and factor expansion.

## Preview and all-or-nothing

Every write runs in one transaction. `?preview=true` (REST) or `preview: true` (MCP) runs the real code and rolls back, returning exactly what would have happened; nothing is saved or logged. Batches are all-or-nothing.

## The activity ledger

Every write outcome (succeeded, failed, proposed, approved, rejected) is logged with actor, operation, records touched, input, error and duration. Reads are not logged. The Activity page streams it live. Failed writes are logged too, so the ledger shows what agents tried.

## Draft and confirm

A draft is a record in `draft` status. Kinds that people review declare **sections** (groups of fields) and **readiness checks**.

- **Evidence per field.** When a value changes, its evidence is replaced: an agent naming no source gets `assumed`, a person gets `person`, and a caller may name `datasheet`, `imported`, `measured`, `calculated` or (agents only) `stated`. See [Data model](data-model.md#evidence-sources).
- **Confirmation is derived.** A person confirms a section, which stores the values they saw. A field is confirmed while it still equals that value; otherwise it is "changed" (shown with the confirmed value struck through) or "unconfirmed". So any edit, by anyone, sends its section back to review, and highlighting always compares against what was last confirmed.
- **Readiness checks** live on the kind in code: a plain label, blocker or warning, the source of the rule, the section, a suggested fix, and a test. `records.readiness` returns sections, per-field state, check results and what is missing in plain words.
- **One Confirm.** `records.confirm` confirms every section nothing blocks and activates a draft left with nothing to do; for a kind without sections it simply activates the draft. Confirming the last section on its own also activates. A draft of a kind without sections counts an agent's guesses as estimates until it is active.
- **Your own writes are seen.** A person's own write or approval marks the record seen at the new version, so "changed since you last looked" shows only other people's and agents' work.
- **Deleting drafts.** An agent deletes a draft directly only when agents working for the same person made it alone and nothing is confirmed; deleting anything a person wrote or confirmed is a proposal.
- **The assistant's suggestions stay unverified.** A step or value the assistant filled in from the SOP editor (`sops.suggest`, which gives up after 45 seconds, 90 for drafting every step, and can be cancelled) is saved as `assumed` with the assistant's reason when the person keeps it unchanged, so it is counted and marked like an agent's value until the one Confirm.
- **The assistant reads short forms of long results.** `review.list` puts its counts first and takes a limit, `records.get {brief: true}` leaves out confirmations and per-item evidence, and `operations.describe {schema: false}` lists a namespace without schemas. It is told to group changes into one `changes.apply` set and which of its proposals people rejected and why.
- **Copied values are checked.** `record` and `template` evidence must name a version that exists and was active, and with a `path` the value there must match; `memory` evidence is refused until lab memory (plan 005) is built.
- **Approval confirms.** Confirming an agent's proposed change confirms the sections it touched, since the person reviewed exactly that change.
- **Editing in place.** From the review, Edit opens a section as a form drawn from the kind's schema; the person says where the values came from (entered, measured, a datasheet with a link, calculated, with a note), and Save runs `records.update`, the same operation an agent uses. Each failing check has a "Fix in …" link to its section; passing checks fold away.
- **People creating records.** A person may create a record active directly, which confirms every section as written; an agent may not.

## One place to review

The **Review** page lists everything waiting for a person, grouped by kind: drafts (with the sections left, what is missing and how many values are assumed) and proposed changes to active records (before and after, Confirm change or Reject). The nav shows one count. After an assistant turn that left something waiting, the panel adds a "Waiting for you" line computed by the app, not written by the model. One verb throughout: "Confirm". Record status reads "draft · needs your review", "active", or "active · change waiting".

## Assumptions, questions and review loops

- **Mark what is assumed.** Anything an agent guessed stays in agent ink until a person confirms it. Unknown values stay unknown.
- **Open questions (012-G6).** Where a source is unclear (contradictions, "about 1 µL", missing values), the digitizer records an open question with the passages involved and a suggested answer. Open questions block confirm until a person answers or accepts.
- **AI review loop (012-G11).** Before a person sees a digitized SOP, a reviewer model checks it against the source. It fixes only what the source settles, each fix a tracked change with a reason and a passage, and asks an open question where the source is ambiguous. Two rounds by default. The review never confirms anything.
- **Downstream changes (P6, plans 014 to 017).** When something upstream changes, downstream drafts redraft automatically; confirmed documents are marked "out of date" with a one-click redraft that is confirmed again.

## Lab memory (plan 005, locked)

- **What it holds:** conventions, preferences, quirks, lessons and facts that no registry has a field for. A memory that implies a typed value (a handling rule, a timing window) proposes it on the record, which stays the one place code reads.
- **Strength:** a rule is followed, or a design breaking it shows a readiness warning accepted with a reason; a default fills a choice no confirmed record decides, in normal ink with its source; a note only informs. A memory never silently overrides a confirmed SOP or template: the agent proposes changing it.
- **Reading:** code picks a bundle of about 15 memories for the page (the record, its selection and its links, plus lab-wide rules); design tools apply a memory's typed effect (`prefer`, `avoid`, `set`) through `memory.for`, and agents read the statements; values filled from memory carry `memory` evidence.
- **Writing:** people add memories directly (active at once); an agent's memory is always a draft until a person confirms it; agents ask once in the chat when a person states or corrects something general; detectors in each module report through `memory.observe`, and a candidate is proposed only past its detector's bar, into Review's Lab memory section.
- **Weight and decay:** evidence for and against, and quiet opportunities (matching runs where it didn't happen), set a memory's weight, and only detectors that can observe absence make a memory decay; a memory losing support becomes "due for a check", never retired automatically.
