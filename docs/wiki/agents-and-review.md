# Agents, drafts and review

Two promises shape how agents work here: an agent can do anything a person can, and an agent drafts while a person confirms. This page explains how both are made true. Built in plans 003 and 004; decisions in ADRs [0015](../decisions/0015-operation-registry.md) to [0018](../decisions/0018-activity-ledger.md), [0020](../decisions/0020-own-agent-loop.md) to [0022](../decisions/0022-one-place-to-review.md).

## Human = agent

The scientist-facing experience starts with the experiment, the scientific question and what the evidence supports. Version tracking, provenance and workflow mechanics are handled behind the scenes or available in optional details. A draft SOP with unresolved questions opens on one actual question and why it matters, with **Help answer this** and access to the other questions. Assumptions and scientific warnings stay visible; partial-review controls sit under **Review details**. Applying a meaningful change and confirming the finished SOP still use the existing explicit controls. See [the presentation clarification in ADR 0068](../decisions/0068-interactive-scientific-decisions.md#presentation-clarification-wali-2026-10-06).

Planned refinement: [004g](../plans/004g-ai-first-scientific-reconciliation.md) and [ADR 0068](../decisions/0068-interactive-scientific-decisions.md) introduce agent-guided reconciliation with explicit human **Apply decision** controls. A reply is not automatically approval or resolution. Final SOP confirmation remains separate; inseparable changes stay atomic. These are accepted interaction decisions awaiting implementation.

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

Applying a proposal stores its actual result and touched records on that proposal in the same transaction as the change and activity entries (004g SG-15a). Retrying the same proposal returns that stored result without applying it twice, including after a reload or lost activity delivery. People-only and lab permissions still apply. The preview can show different IDs or readable names from those created for real; the stored result identifies the committed records. Decision preparation and scoped supporting-record confirmation remain planned under SG-03, with final SOP confirmation separate.

The in-app assistant pauses with a review request as soon as it produces a pending proposal. Later calls in that batch do not run. Applying that pending change waits until the assistant turn has ended; asking about a previously approved proposal still returns its committed result. Preflight failures now leave an explicit failed conversation rather than a stranded running one (004g SG-16a).

After 16 action turns, the assistant has one opportunity to summarize saved work and remaining questions with no tools. The action-limit failure remains visible. For oversized results, a compact completed-write receipt lets it identify the saved record version even when earlier reads or large inputs hide the final output. This is historical save evidence, not a fresh read, readiness check or verification of omitted scientific details; full results remain in the conversation. Proposed and failed changes are not saved-write receipts.

Each fresh ask has a distinct originating user-message identity. A reply retains that identity only when it explicitly references an owned original message and a related pending proposal or open scientific question. Reloads read proposal state from the server; selected question context includes the current record version, stage, responses and disposition. Stale, missing or cross-lab selections refuse. Historical questions with an unsupported shape require reconciliation; a past answer is never inferred to be resolution. Dedicated decision cards, supporting-record grouping and broader stop/resume or tool replay remain planned.

For saved SOP responses, the assistant is guided to continue from what the person already supplied, including “I don't know”, without repeating the identical question. The issue stays open and disputed settings stay unchanged while it investigates evidence or suggests a specific next action. Chat prose and notes do not record a response; the people-only `sops.answer_question` action does. Selected-question chat offers **Record response** beneath the person's reply, then **Continue with assistant**. The question stays selected across navigation and reload; changed versions require a fresh review. The SOP question form remains an alternative. Response recording does not accept a scientific decision or confirm the SOP.

Earlier recorded chat answers keep their SOP, question and current issue status visible, with old controls under **Revisit response**. Unsaved answers stay actionable; revisiting a changed SOP still requires reviewing the current question before continuing.

**Earned autonomy (010-V7).** Wali wants agents to earn autonomy. The ledger will keep, per scenario ("move requested in the same conversation", "consume recorded by a run log"), how often proposals were confirmed unchanged, edited or rejected. When the record is good enough, a person can switch that scenario to auto-confirm; the switch is itself a recorded, reversible setting. Nothing auto-confirms at launch.

## Calculators: agents compute, they don't guess

Numbers agents rely on come from **calculators** ([ADR 0024](../decisions/0024-lab-calculators.md)): read operations marked `calculator` (with the title and group the Calculators page lists them by), backed by pure functions in `packages/domain`, indexed by one skill (`skills/calculators/`) that every agent loads, the in-app assistant included. A calculator returns the result, the inputs it used with their sources, ranked options with the numbers behind the ranking, and a plain explanation; it never writes. When an agent puts a calculator's result into a draft, the value's evidence is `calculated` by that operation, not `assumed`. People reach the same calculators from the UI. Planned so far: unit and mass-to-molar conversion, mixing and C1V1, plate-to-plate mappings, recipe scaling, liquid-class resolution, dead-volume lookup, SOP expressions, series expansion and placement, `transfers.options`, `transfers.dilution_options`, `transfers.optimize_dilution`, `transfers.source_volumes`, `transfers.check`, design totals and factor expansion.

For SOP variables, evidence describes the whole variable definition. A calculator's resulting quantity does not establish that entire definition. Keep the computed formula and its real source or assumed attribution; do not replace it with a fixed default just to attach calculated evidence. Calculator-backed downstream quantities still need matching calculation evidence.

## Preview and all-or-nothing

Every write runs in one transaction. `?preview=true` (REST) or `preview: true` (MCP) runs the real code and rolls back, returning exactly what would have happened; nothing is saved or logged. Batches are all-or-nothing.

Nested writes publish activity and start background work only after the outer transaction commits. Rollback publishes no success. Failed stream delivery or background work does not change a committed result; the stored activity and proposal receipt remain available to read.

## The activity ledger

Every write outcome (succeeded, failed, proposed, approved, rejected) is logged with actor, operation, records touched, input, error and duration. Reads are not logged. The Activity page streams it live. Failed writes are logged too, so the ledger shows what agents tried.

## Draft and confirm

A draft is a record in `draft` status. Kinds that people review declare **sections** (groups of fields) and **readiness checks**.

- **Evidence per field.** When a value changes, its evidence is replaced: an agent naming no source gets `assumed`, a person gets `person`, and a caller may name `datasheet`, `imported`, `measured`, `calculated` or (agents only) `stated`. See [Data model](data-model.md#evidence-sources).
- **Confirmation is derived.** A person confirms a section, which stores the values they saw. A field is confirmed while it still equals that value; otherwise it is "changed" (shown with the confirmed value struck through) or "unconfirmed". So any edit, by anyone, sends its section back to review, and highlighting always compares against what was last confirmed.
- **Readiness checks** live on the kind in code: a plain label, blocker or warning, the source of the rule, the section, a suggested fix, and a test. `records.readiness` returns sections, per-field state, check results and what is missing in plain words.
- **One Confirm.** `records.confirm` confirms every section nothing blocks and activates a draft left with nothing to do; for a kind without sections it simply activates the draft. Confirming the last section on its own also activates. A draft of a kind without sections counts an agent's guesses as estimates until it is active.
- **Your own writes are seen.** A person's own write or approval marks the record seen at the new version, so "changed since you last looked" shows only other people's and agents' work.
- **Deleting drafts.** An agent deletes a draft directly only when it is its own: that agent alone wrote every version, for the same person, and nothing is confirmed. Deleting anything another agent or a person wrote or confirmed is a proposal (Wali, 2026-10-01).
- **The assistant's suggestions stay unverified.** A step or value the assistant filled in from the SOP editor (`sops.suggest`, which gives up after 45 seconds, 90 for drafting every step, and can be cancelled) is saved as `assumed` with the assistant's reason when the person keeps it unchanged, so it is counted and marked like an agent's value until the one Confirm.
- **The assistant reads short forms of long results.** `review.list` puts its counts first and takes a limit, `records.get {brief: true}` leaves out confirmations and per-item evidence, `records.kinds {summary: true}` discovers kinds and sections, and `operations.describe {schema: false}` lists a namespace without schemas. Page context names relevant existing skills from its operation-module mapping (the campaigns skill owns runs); operation namespaces are not assumed to be skill names. It uses already offered operation schemas. When a relevant skill names the needed operation, it requests only missing schemas by ID directly; namespace summaries are for discovering unknown operations. Generic `records.create` needs the named kind's attribute schema; saving through `sops.draft` uses that operation's input schema. It is told to group changes into one `changes.apply` set and which of its proposals people rejected and why.
- **Batch confirm takes only what is checked.** A draft joins "Confirm the N ready ones" only when it holds no unverified value and no value an agent says came from a datasheet, import or measurement, which the server can't check (readiness lists them as `unchecked`; Review shows "N sources to check"). Values the person stated, and calculated or copied values the server checks, don't stop it.
- **Copied values are checked.** `record` and `template` evidence must name a version that exists and was active, and with a `path` the value there must match; `memory` evidence must cite a lab memory confirmed at that version (005a).
- **Approval confirms.** Confirming an agent's proposed change confirms the sections it touched, since the person reviewed exactly that change.
- **Editing in place.** From the review, Edit opens a section as a form drawn from the kind's schema; the person says where the values came from (entered, measured, a datasheet with a link, calculated, with a note), and Save runs `records.update`, the same operation an agent uses. Each failing check has a "Fix in …" link to its section; passing checks fold away.
- **People creating records.** A person may create a record active directly, which confirms every section as written; an agent may not.

## One place to review

The **Review** page lists everything waiting for a person, grouped by kind: drafts (with the sections left, what is missing and how many values are assumed) and proposed changes to active records (before and after, Confirm change or Reject)., then notices for your information, such as a lab memory past its check-again date. Most urgent first: by due date, then drafts other records wait on. What one agent made in one conversation sits together under the conversation's title, and what waits on other people is folded below yours (review 2026-10-01 item 16). The nav shows one count. After an assistant turn that left something waiting, the panel adds a "Waiting for you" line computed by the app, not written by the model. One verb throughout: "Confirm". Record status reads "draft · needs your review", "active", or "active · change waiting".

## Assumptions, questions and review loops

- **Mark what is assumed.** Anything an agent guessed stays in agent ink until a person confirms it. Unknown values stay unknown.
- **Open questions (012-G6, 004g).** Where a source is unclear, the agent records an open question with its passages. A response such as “I don't know” is preserved without resolving the issue. Unresolved method questions block confirmation; accepting a scientific decision and finally confirming the SOP are separate steps.
- **AI review loop (012-G11).** Before a person sees a digitized SOP, a reviewer model checks it against the source. It fixes only what the source settles, each fix a tracked change with a reason and a passage, and asks an open question where the source is ambiguous. Two rounds by default. The review never confirms anything.
- **Downstream changes (P6, plans 014 to 017).** When something upstream changes, downstream drafts redraft automatically; confirmed documents are marked "out of date" with a one-click redraft that is confirmed again.

## Model continuation

The assistant supports explicit Responses configuration for compatible model endpoints. Intermediate progress continues within the existing step limit; refused or truncated replies cannot execute tools. The same boundary applies to SOP review and suggestions. Proposal approval remains a person’s explicit action. Configuration, replay details and current limits are in the [assistant architecture](../architecture/assistant.md#responses-transport-and-continuation) and [ADR 0070](../decisions/0070-responses-agent-continuation.md); this changes no lab operation or scientific approval rule.

## Lab memory (plan 005, locked)

Built so far: 005a, the memory record and its operations (ADR 0062), and 005b, `memory.for`, the assistant's page bundle, `memory.used_in` and lab memory applied in the liquid class and instrument choice, and 005c-1a, `memory.observe` with candidates that become proposals at 3 runs on 2 days and the recurring run deviation detector, and 005c-1b, the repeated-override detector, the "possible lab memory" hint and proposed memories grouped in Review, and 005c-2, evidence for and against with weights and "due for a check" after quiet runs ([memory.md](../architecture/memory.md)).

- **What it holds:** conventions, preferences, quirks, lessons and facts that no registry has a field for. A memory that implies a typed value (a handling rule, a timing window) proposes it on the record, which stays the one place code reads.
- **Strength:** a rule is followed, or a design breaking it shows a readiness warning accepted with a reason; a default fills a choice no confirmed record decides, in normal ink with its source; a note only informs. A memory never silently overrides a confirmed SOP or template: the agent proposes changing it.
- **Reading:** code picks a bundle of about 15 memories for the page (the record, its selection and its links, plus lab-wide rules); design tools apply a memory's typed effect (`prefer`, `avoid`, `set`) through `memory.for`, and agents read the statements; values filled from memory carry `memory` evidence.
- **Writing:** people add memories directly (active at once); an agent's memory is always a draft until a person confirms it; agents ask once in the chat when a person states or corrects something general; detectors in each module report through `memory.observe`, and a candidate is proposed only past its detector's bar, into Review's Lab memory section.
- **Weight and decay:** evidence for and against, and quiet opportunities (matching runs where it didn't happen), set a memory's weight, and only detectors that can observe absence make a memory decay; a memory losing support becomes "due for a check", never retired automatically.

Implementation tracking: [004g epic #162](https://github.com/walimmalik/AILaboratory/issues/162) links the reviewed specification and 25 child tickets. No implementation acceptance is implied by ticket publication.
