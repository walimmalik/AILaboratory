# 004g: AI-first scientific reconciliation

## Decisions and established requirements

| ID | Requirement or decision | Status and authority | Contract for this plan |
| --- | --- | --- | --- |
| E1 | The agent performs evidence work and creates necessary registry drafts | Established: product rules 2, 3 and 6; Wali's 2026-10-05 request | Search existing records first; create missing kinds, products, entities and related planning drafts through existing operations. Ask for facts and consequential scientific choices, rather than sending the scientist to fill registry forms. Never invent specimens, stock, measurements or validated settings. |
| E2 | Reusable method, experiment and run are different scientific stages | Accepted: ADRs [0037](../decisions/0037-sop-record.md), [0039](../decisions/0039-designs-pin-inputs.md), [0066](../decisions/0066-assay-templates-and-design-math.md), [0067](../decisions/0067-designer-drafts-from-a-confirmed-template.md) | Method readiness checks the reusable procedure. Experiment readiness checks chosen subjects/design and bound definitions. Run preparation checks current physical facts. Deferred per-run inputs do not make a valid reusable method broken. |
| E3 | Answer received does not mean scientific issue resolved | Established: science constraints and explicit unknowns; demonstrated defect at review baseline | An unknown, refusal, acknowledgement or free-text reply remains unresolved until a specific disposition/change is accepted and relevant checks pass. No answer text alone can remove a method blocker. |
| E4 | Human and agent use the same operation contracts; people-only authority stays enforced | Accepted: foundation, ADRs [0051](../decisions/0051-change-sets.md), [0055](../decisions/0055-assistant-core-toolset-and-page-context.md), [0056](../decisions/0056-a-persons-own-edits-are-confirmed.md) | An agent may investigate, draft and propose. Ordinary approved proposal writes retain the proposing agent plus human approver; bounded people-only dispositions execute as the authenticated person. Approval never elevates arbitrary proposed operations. |
| E5 | Existing questions, ranked options, changes and review remain the core | Accepted: ADRs [0037](../decisions/0037-sop-record.md), [0051](../decisions/0051-change-sets.md), [0064](../decisions/0064-check-options.md) | Extend these contracts. Do not create a generic workflow engine, a parallel questionnaire or an overlapping task store. |
| D1 | How does the person authorize a reconciliation change? | **Accepted by Wali, 2026-10-05:** show the exact change and an **Apply decision** button in chat; final SOP confirmation is separate ([ADR 0068](../decisions/0068-interactive-scientific-decisions.md)) | Chat text informs the proposal. The authenticated person approves the exact version-bound decision; ordinary proposed operations retain agent plus human approver, while only bounded human dispositions/scopes execute as person. A chat answer never substitutes for this action. |
| D2 | How is a multi-record scientific request reviewed? | **Accepted by Wali, 2026-10-05:** one scientific summary with explicit approval controls for each meaningful decision; supporting records expandable ([ADR 0068](../decisions/0068-interactive-scientific-decisions.md)) | A decision may atomically change several records. This newer choice supersedes the coarse approval presentation in 004e R2 / “one intent, one confirm”; it preserves `changes.apply` atomicity within each inseparable decision. Final record/design confirmations remain explicit and follow their prerequisites. |
| E6 | Scientist-facing generated content and progressive disclosure | Established: product rule 9, [004e](004e-review-v2-and-agent-context.md), [004f](004f-navigation-and-record-pages.md), Wali's 2026-10-05 requirement | Procedure words describe lab work precisely. Review status, schema names, IDs, tool traces and audit details live in dedicated expandable views. Scientific units, controls, constraints and uncertainty remain visible where needed. |
| D3 | What happens when working changes are not scientifically valid? | **Accepted by Wali, 2026-10-05** ([ADR 0069](../decisions/0069-working-methods-and-scientific-uncertainty.md)) | Keep working changes separate from the last valid confirmed version; that earlier confirmed version remains available. New downstream acceptance uses an explicitly identified valid confirmed version, never an invalid working revision carrying an active flag. |
| D4 | May a scientist approve an experimental method variation without independent validation? | **Accepted by Wali, 2026-10-05** ([ADR 0069](../decisions/0069-working-methods-and-scientific-uncertainty.md)) | Yes, with a recorded scientific rationale and clear **Unvalidated method variation** label retained in review, procedure context and downstream use. Invalid units, physical impossibility and unspecified critical instructions still block. The label is not proof of validation. |
| D5 | What happens when old answers or actual report movements are uncertain? | **Accepted by Wali, 2026-10-05** ([ADR 0069](../decisions/0069-working-methods-and-scientific-uncertainty.md)) | Preserve history and record what is known; require reconciliation before affected future use, blocking only that affected use. Apply this same historical-preservation/future-eligibility policy to old answered questions. Never guess actual movements or retroactively rewrite accepted history. |

Status: **reviewed implementation specification**, prepared 2026-10-05. D1–D5 are locked; independent planning feedback is incorporated, with implementation validation still required. This document authorizes no application implementation and is not evidence that any listed defect has been fixed. Independent packages can proceed after their producer contracts pass; the SOP interaction does not wait for every execution safety track.

Extends plans [004e](004e-review-v2-and-agent-context.md), [004f](004f-navigation-and-record-pages.md), [012](012-digital-sops.md), [016](016-transfer-designer.md) and [017](017-experiment-designer.md). Read [000](000-foundation-architecture.md) first.

Evidence baseline: `9624e5324655472bf1b864c4a6830d448b0e7169`. The completed 5 October review informs the finding index and published ticket specifications; independent-review dispositions are recorded below. Browser observations, isolated reproductions and source findings retain those distinctions in tickets. The review was not a full regression or physical validation. No per-ticket review or verification documents are added to this tree.

## 1. Outcome and boundaries

### Retain unfinished source-described steps

Authorized by Wali on 2026-10-05 after a live draft omitted washing and showed only the reader step. Preserve source-described actions in order, with stable IDs and citations; omit disputed operative settings and attach an open method question to the affected step. At the bench, show **Needs clarification**, known settings and a question-specific assistant discussion action. Keep the draft/incomplete warning in print. Multiple questions remain individually selectable. Final activation remains blocked by unresolved method questions; recording a response or editing a step does not resolve one.

This bounded slice reuses `SopStep`, `QuestionDraft.about.step` and the current assistant page context. It adds no schema, operation, question-resolution path or automatic detector for missing scientific settings. Authoring guidance must create the step and question together in new drafts. Preserve older drafts rather than rewriting their history. Acceptance covers a cited wash followed by a supported read step, absent disputed wash settings, persisted question links, exact discussion context, print and reload, and blocked final activation after an unknown response or ordinary edit. See the accepted extension in [ADR 0069](../decisions/0069-working-methods-and-scientific-uncertainty.md).

### Next small runtime batch: Responses and continuation

Authorized by Wali on 2026-10-05 after merging PRs #193–195. [ADR 0070](../decisions/0070-responses-agent-continuation.md) records the implementation choice: explicitly select Responses for a configured compatible endpoint, preserve provider output and continue nonterminal commentary within the existing loop limit. Refused/truncated output cannot execute tools or become accepted SOP review/suggestion content. Existing proposal pause and human confirmation remain intact.

This SG-16a follow-up has three bounded owners: adapter/model contract, loop and SOP consumers, and configuration/documentation/integration. A focused producer checkpoint precedes integrated runtime validation. Acceptance covers exact replay and model/protocol changes; commentary → tool → final; bounded commentary; terminal tool refusal; pending/deferred call resume; and one disposable live/browser scientific draft journey. It introduces no operation or table. Tool-menu/schema-size changes remain SG-16d so they can be measured separately. Review evidence and live outcomes belong in the PR.

A scientist asks for a reusable SOP or an experiment in lab language. The agent checks sources, methods, registries and calculators, creates necessary drafts, and asks the next coherent question that needs scientific judgment. The scientist sees a concise issue, supported choices and their consequences. After a selection, the assistant presents the precise proposed change. **Apply decision** applies it through a people-authorized operation and reruns checks. The page shows what changed, whether the issue is resolved, and what remains. Confirming the SOP is a later, separate action.

Implementation scope clarification, Wali 2026-10-05: this greenfield app is a technology demonstration of AI-first lab operations. Prefer the smallest coherent implementation that proves the scientific journey. Reuse existing records, proposals, operations and identifiers; do not build generic workflow, compatibility, replay or migration frameworks for speculative use. Keep scientific correctness, explicit authority and existing-data preservation, but implement broader capabilities only when a demonstrated path requires them.

The scientist should not need to know record kinds, operation names or variable identifiers to complete this journey. They can inspect and edit scientific values directly. Supporting records, evidence and full history remain accessible.

In scope:

- Correct SOP issue state, preserved history, stage classification and traceable reclassification.
- Default adaptive intake, source reconciliation, agent-created registry drafts and scientific prose.
- Version-bound decision cards in chat and record review, with operation/permission parity, and selection of the exact protocol edition/file used as evidence.
- Stage-specific readiness and progressive disclosure in SOPs, Review, changes, Library, plate maps and run checklists.
- Linked fixes for shared scientific validation, accepted inputs, conservation/stock math, resolved design authority, execution/report lineage, transaction receipts and recoverable assistant runs.
- A repeatable, explicitly hypothetical scientific demo and deterministic/fault/live-agent evaluation.

Excluded:

- Hardware execution, new instrument capabilities, physical accuracy claims, new scientific settings or assay results invented for the demo.
- A general workflow engine, task database, free-form parameter blobs, compatibility readers or parallel operation paths.
- Replacing accepted template essentials, version pins, record history, Kind/Instance/State, the design/confirm model, or existing calculator authority.
- A model migration, default provider change, mandatory second-model review of every response, or token-price optimization project. Evaluate the configured model before drawing quality/cost conclusions.
- Broad visual redesign. Follow bench console tokens, one outline per block, agent ink rules and the established area/record-page layout.

## 2. Scientific lifecycle and authority

### 2.1 What is required at each stage

| Stage | What must be known before its acceptance boundary | What may remain intentionally deferred | The agent's work |
| --- | --- | --- | --- |
| Reusable SOP / assay template | Coherent procedure, material roles/requirements, valid variable rules and bounds, scientifically justified constraints, source-conflict disposition, controls/replicate rules where the method requires them | Actual specimens, chosen run-input values, compatible material binding where allowed, physical lots/containers, stock count, operator, date | Read sources and confirmed definitions; draft the procedure/roles/formulas; flag genuine method conflicts; preserve valid input slots without asking for next week's stock |
| Experiment design | Scientific aim and essential answers; selected subjects; chosen dilution/dose, factors, controls and replicates; explicit plate roles; compatible pinned accepted definitions; success criteria | Exact physical source containers and future availability when they are not part of design acceptance | Use `assays.design`, `designer.start`, existing bindings and domain-backed calculators; reconcile one design and derive maps/totals from it |
| Run preparation / execution | Exact accepted design versions; physical specimens/plates/containers and quantities; instrument/configuration and availability; relevant timing/handling constraints; explicit simulation versus physical mode | Unmeasured actual outcomes, which are recorded as actuals/deviations during or after work | Check live inventory/availability without freezing physical state; state missing facts; stop at an honest preparation gate; use the execution manifest for reports |

SOP confirmation means “this reusable procedure is reviewed”, not “stock is reserved” or “ready to execute”. A formula waiting on a declared per-run input is a deferred calculation, not a broken formula. An invalid formula, absent critical method instruction or unresolved source conflict remains a method blocker. Choosing a different plate for a particular experiment does not silently rewrite the reusable SOP. Actual lots may remain late-bound where the design contract allows this; verify them before the applicable run-preparation boundary rather than imposing a blanket lot-before-experiment-confirmation gate. Retain later-stage obligations through existing variables, role requirements and readiness contracts; reclassification does not require a new experiment requirement subsystem.

Preserve ADR 0067's contract: `designer.start` still requires essential answers and an accepted template. Before that boundary the assistant can investigate and draft supporting records; it cannot disguise a half-created experiment as a complete designer result.

### 2.2 Authority matrix

| Action | Agent | Person | Server obligation |
| --- | --- | --- | --- |
| Search/read sources, records and readiness; calculate | Allowed through existing read/calculator operations | Allowed | Scope to lab; identify versions and calculation evidence |
| Create missing registry/planning drafts | Allowed under existing policies | Allowed | Validate every entry point; label assumptions; prevent fabricated physical facts |
| Fix a source-settled value in a draft | Allowed, with cited evidence and ordinary draft policy | Allowed | Preserve field evidence, question history and versions; do not resolve a people-only question implicitly |
| Propose a scientific decision or reclassification | Allowed | Allowed | Return exact affected records, versions, fields and consequences |
| Apply a shown decision | Cannot call as a person or mark approved | **Apply decision**, authenticated as that person | Revalidate authority/input/evidence/versions; ordinary proposal operations retain agent plus human approver, bounded disposition runs as human, all linked writes atomic |
| Record a reply such as “I don't know” | May record conversational content; cannot settle the question | May submit a response | Preserve response separately from resolution; readiness stays blocked where appropriate |
| Resolve or defer an existing people-only question | Propose only | Explicit accepted disposition | A specific operation owns transition; generic writes cannot delete or bypass it |
| Confirm reusable SOP/design | Never | Explicit final confirmation | Recompute authoritative readiness; no hidden confirmation inside reconciliation |
| Adopt newer scientific inputs | Recommend/propose | Explicit acceptance | Keep original pins until adoption; show scientific impact and recheck derived work |

Verified baseline: `proposals.approve` runs ordinary operations as the proposing agent with `approvedBy` set to the person (`proposal-operations.ts:33`); it does not impersonate the approver. Agent `changes.apply` cannot include people-only steps; a human-initiated set can. Preserve both rules. The extended approval entrypoint runs only its narrowly typed question disposition or explicit confirmation scope as the person, never arbitrary agent-supplied operations under elevated identity.

### 2.3 One intent, several meaningful decisions

One scientific summary may contain “choose the wash method”, “use these four mock subjects” and “adopt the corrected dilution”. Each decision has its own explicit acceptance control. A single decision may need a linked SOP edit, a layout change and recalculation: those writes are one `changes.apply` transaction and cannot be accepted piecemeal.

The nine walkthrough drafts were one `changes.apply`, with actor provenance containing the conversation. Baseline Review groups by `actor.sessionRef`, merging the whole conversation. SG-01 adds minimal originating user-message/intent metadata to proposals and created-record provenance so two unrelated requests in one conversation get two summaries. Existing conversation/change-set IDs and record links remain the grouping substrate. A meaningful decision is one version-bound proposal with a specific scientific consequence and any inseparable dispositions; source-settled supporting drafts are expandable “Drafted” rows, not artificial decisions for each field.

Final confirmations remain governed by record prerequisites. A summary may offer **Confirm these supporting records**, showing every exact record/version and scope first. The persisted `confirmation_scope` handler inside `proposals.approve` chooses existing all-or-none `records.confirm_many` only when its no-assumptions/no-unchecked/no-blockers/no-changed-accepted preconditions already hold for every record. It prevalidates the whole set, so dependency-ordered confirmations use the same handler's internal human `changes.apply` scope that rechecks each step; do not silently relax batch eligibility. Never include final SOP confirmation in Apply decision. Generated support drafts fully reviewed together should not require nine page visits or hidden confirmations.

Originating-intent metadata has an explicit producer: SG-16a derives the intent from the authenticated current user-message/context, and SG-03 propagates it through operation context and persists it on proposals, `changes.apply` results and created-record provenance. SG-01 owns the shared shape. A fresh user request starts a new intent; a response submitted in a specific decision/reconciliation context continues that validated open intent. The model cannot silently merge unrelated requests. Test direct draft creation and change sets, two separate requests in one conversation, and a contextual reply that retains its original intent. Historical rows without this metadata are migrated as unknown-origin groups using a known original change-set boundary where available, otherwise remain individually identified; they are labelled honestly and never silently merged as one whole-conversation scientific request.

## 3. SOP reconciliation contract

### 3.1 Extend the current shape

The source of truth remains `SopAttributes.questions` / `OpenQuestion` in `packages/schema/src/sops.ts`, its kind validation in `apps/api/src/sops/kinds.ts`, and `sops.answer_question` in `packages/schema/src/operations/sops.ts` / `apps/api/src/sops/operations.ts`. Readiness continues to use `CheckResult.options` / `CheckOption` from `packages/schema/src/design.ts` and ADR 0064. `records.update`, `records.readiness`, `records.confirm`, `records.diff` and `changes.apply` remain the ordinary operations around it.

SG-01 specifies the current schema in one change before consumers change. The proposed minimum semantic additions are:

| Field/semantic | Required meaning |
| --- | --- |
| Stable question identity and `about` | Keep stable question IDs and links to affected steps, variables/materials and evidence paths; reordering must not change identity |
| Stage | `method`, `experiment` or `run`, with a server-verifiable binding and plain-language reason. Unverifiable classification or prose conflict stays method/unclassified and blocking |
| Response | Person's reply, actor/time and version; optional when the person directly accepts a prepared decision. A response carries no implication of resolution |
| Disposition | Open, resolved, or deferred to a later stage; response received is separately represented. The current `answered` status must no longer imply settled |
| Resolution | Exact accepted action/change, reason, scientific basis, affected version/paths and result of the relevant recheck; retain proposer and human acceptor |
| Deferral | Target stage, required fact/condition and concrete downstream check binding: declared input, late-bound role or named run-preparation check. Missing binding refuses deferral; pinned-SOP consumers inherit the obligation |
| Reopening | Preserve earlier resolution and show which changed input/check invalidated it; history remains append-only through the record service |

These are semantics to encode as typed schema, not arbitrary JSON metadata. Use record history/evidence for details they already store; do not duplicate complete attribute snapshots inside every question. The schema PR decides the smallest representation that provides the above observability and publishes example payloads for its consumers.

Internal question IDs, dispositions and verification metadata must not themselves become scientific values marked “agent-entered, please verify”. The scientist reviews the scientific decision and its effects. Assumed values and method uncertainties remain visible in the appropriate readiness/evidence view.

Stage is guarded at initial creation as well as later reclassification. An agent may declare a non-method stage only where the server verifies a declared late-bound input/material or an applicable run check; a source conflict concerning an instruction, constant or formula cannot be born as a run question. All deferred issues are listed at final SOP confirmation. Design/run readiness reads the pinned SOP's deferred obligations and resolves them on its concrete check surface. A person cannot defer an unsupported method defect into orphan prose.

The questions path is operation-owned for **all actors**. Generic create/update, restore and proposed/approved sets cannot add, omit or alter questions/dispositions; generated UI and agent drafting/review use the owning SOP operations. Initial `sops.draft` is the typed creation route. Authorize traceable wording corrections/supersession through the same question operation, preserve original history, and update affected All fields editing rather than leave a bypass.

### 3.2 Transitions

| From / event | Result | Can method readiness improve? |
| --- | --- | --- |
| Open → nonempty reply, including “I don't know” | Response received; issue remains open | No |
| Open → agent proposes a supported change | Pending decision; open until accepted | No |
| Open → person applies version-bound change and checks pass | Resolved with accepted change and recheck evidence | Yes, for that issue only |
| Open → person applies change but another relevant method check fails | Change recorded; issue remains unresolved with the failure/next decision | No false “Settled” label |
| Misclassified run/experiment input → person accepts traced reclassification | Deferred, with later-stage obligation | Yes only if the method is valid without that fact |
| Resolved → affected scientific values/evidence change | Reopened or explicitly invalidated pending recheck | Earlier answer cannot authorize new values |
| Any → agent/generic write removes a question or rewrites its resolution | Refused with clear reason | Never |
| Any → person corrects question wording/removes duplicate | Traceable correction/supersession via the question operation; original history retained | Only if no scientific obligation is lost |

A resolved issue is not a permanent bypass token. Relevant domain checks still evaluate the actual method. “Accept suggestion” cannot resolve a question whose suggestion is only prose: it must preview a structured, valid change or a supported classification/disposition. A scientist's custom answer may start a new proposal; arbitrary text cannot be treated as a scientifically valid setting.

### 3.3 One durable decision and one approval entrypoint

A decision is an **existing proposal row**, not a transcript card or new table. Baseline rows already store ID, operation/input, preview, status, proposer and decider. SG-01 adds narrowly typed decision metadata: originating intent, optional SOP/question disposition, exact source references, read/write record-version dependencies and server preview identity. Chat and Review retrieve and render the same object; ordinary proposals remain supported through the same entrypoint.

Preparation always records the authenticated originating actor from server context; callers cannot supply, impersonate or elevate it. An agent-prepared ordinary decision runs as that agent with the human approver retained. A human-prepared ranked-option decision, including the model-unavailable fallback, runs as the authenticated applying person under normal permissions and ADR 0056, retaining the preparing person in proposal history; no synthetic agent identity is invented. The approval handler verifies that the current person may apply that explicit scope. Tests cover equivalent human- and agent-prepared decisions, attribution and refusal of arbitrary people-only steps from an agent proposal.

Add a narrowly typed prepare-decision capability (proposed ID `review.prepare_decision`, finalized in SG-01) for changes normally executed directly on drafts and for optional question disposition. It accepts existing `CheckOption`/operation inputs or an explicit allowed scope, checks affected paths/lab/authority, generates a rollback preview and stores it in the proposal row. It cannot prepare arbitrary human execution of agent operations. Exact changed values, affected counts and scientific consequences come from server diff/domain results; model prose is an explanation, never the authority for displayed change.

Extend people-only `proposals.approve` as the sole Apply entrypoint for chat and Review. In one transaction it verifies preview/dependencies, runs agent-prepared ordinary steps as the proposing agent with the human approver (human-prepared steps use the applying person as specified above), executes only the two bounded people-only variants as the human—typed SOP disposition and server-derived `confirmation_scope`—through their owning operations, and rechecks readiness. Explicit supporting-confirmation scopes use human `changes.apply` with the visible exact records/versions, not an agent-proposed list of arbitrary people-only calls. No final SOP confirmation is included. Failed mutation rolls back all linked writes/disposition; a valid but insufficient correction records the change while leaving its issue unresolved.

`sops.answer_question` remains the people-only owner of response and disposition semantics, called by direct human response controls or the bounded approval handler. It does not become a competing approval store. Variants distinguish response-only, evidence-backed reconciliation, accepted reclassification and a person-rationale variation under D4. The variation retains **Unvalidated method variation** and its rationale downstream; hard scientific invalidity still refuses. A reply alone never resolves.

Approval outputs committed versions, changed facts, current issue state/readiness and next action. Proposal ID is the idempotency/receipt key; a repeated apply returns its durable outcome. Reject/supersede retains history. On reload or a new conversation, rebuild pending work from authoritative open questions, proposal state and originating-intent draft links. Historical cards show pending, applied, rejected or superseded state and cannot act on obsolete previews. A conversation summary is a hint, not scientific state.

Before migration, inventory actual persisted records and existing pins; there is no verified permission to blanket reseed this deployment. Preserve original answered text, accepted versions, file evidence and historical design/run pins. Draft legacy answers become response-received until verified. For accepted historical SOPs, expose uncertain old answers as **Needs re-review** and enforce D5 at affected **future** acceptance/use, including a new execution of an existing design with old pins; do not rewrite historical acceptance or retrospectively falsify what a run followed. A separately reviewed valid working version can restore future eligibility under D3. Migration tests distinguish historical completed runs, affected future execution even with existing pins, new consumers and unrelated uses; no blanket lab freeze or silent grandfathered resolution.

Supporting-record approval is a typed `confirmation_scope` variant of the same persisted proposal row, including when its drafts already exist. SG-03 derives the exact record/version list and dependency order from server-held originating-intent links, then presents the explicit scope; it never accepts an arbitrary agent-selected list of people-only operations. `proposals.approve` remains the only outer Apply entrypoint. Its bounded handler internally chooses `records.confirm_many` when every recomputed batch precondition holds, or ordered human `changes.apply` for dependency-ordered confirmation; Review never calls either outside this proposal receipt, preserving one proposal identity and receipt for reload, rejection and retry. SG-06 renders that shared object. Final SOP confirmation is excluded; supporting registry/design confirmations are visibly named in their own allowed scope.

SG-03 owns the transaction-level confirmation contract: each `records.confirm` step recomputes readiness against preceding successful writes visible within the same transaction, rather than cached pre-transaction state. A kind → entity → sample scope succeeds in dependency order, fails in reversed order, and rolls back every confirmation if a later step fails. `records.confirm_many` retains its prevalidation semantics. Human callers may prepare and approve their own ranked-option proposal through the same boundary; this is explicit human action under ADR 0056, not invented agent provenance.

For an uncertain accepted SOP version already pinned by a design, use the existing **new revision → explicit adoption → reconfirmation** route. Reconciliation produces a new valid confirmed SOP version; the existing design continues to identify its old immutable version until the person explicitly adopts the new one and reconfirms the changed design. New execution uses that accepted design version. Future-use eligibility records the affected uncertainty without rewriting the historical SOP, approval or completed run. Tests prove the old future execution remains blocked, the explicit adoption preview names the new SOP and design versions, and the reconfirmed design becomes eligible when the actual issue is resolved. No new append-only waiver/disposition system is introduced to patch immutable scientific snapshots.

### 3.4 Concurrency, freshness and failure

| Situation | Required behavior |
| --- | --- |
| Another agent/person or sibling decision edits SOP | Record-wide versions are the baseline, not path CAS. Recompute server preview/dependencies; if disjoint changes leave exact affected values/checks/consequences identical, refresh the version without a forced scientist interruption. Any substantive change is shown and requires a new click; never silently apply a different preview |
| Related plate/source/definition changes | Recheck actual read/write dependencies even if SOP version did not change. A newer source edition alone does not invalidate a legitimately pinned old edition; explicit adoption can change its consequences |
| Physical inventory changes | Live run-preparation recheck; no silent design-pin replacement. A previously sufficient quantity is not a reservation |
| Double click/retry/connection loss | Reconcile by durable receipt/decision identity. Show committed result or explicit unknown completion; never state “not run” without evidence |
| Tool/application failure before commit | Keep question open and show actionable failure; linked writes roll back |
| Commit succeeds, activity/message delivery fails | Recover durable result; no replayed scientific mutation. Activity reflects commit once; rendering failure is not mutation failure |
| User rejects decision | Keep method/issue unchanged, preserve proposal outcome, offer another supported choice |
| Card prepared while assistant works | Presenting an actionable card ends/pauses that turn; enable Apply only after no active run can race its writes. Preparing a card does not authorize subsequent unversioned agent changes |
| User stops/steers assistant | Persist terminal/interrupted state; show committed work and outstanding decision. Resume by rereading records/proposals, including in a new conversation; never imply rollback of committed drafts |
| Readiness displayed from cached summaries | Summary is a hint. Acceptance/batch confirmation recomputes actual checks/dependencies inside the authoritative path |

## 4. Interaction and screen specifications

### 4.1 SOP Overview and assistant

The Overview leads with purpose, applicability and the method. A concise readiness row says, for example: **“SOP review: 2 decisions remain. Choose samples and run details later.”** Live readiness on page load and after apply supplies this row. Count a question by stable ID; several checks bound to the same question share its decision key. Unbound blockers retain their own check key rather than disappearing. Refresh after relevant dependency changes; cached Review summaries cannot decide acceptance. Keep every actual blocker accessible in the expanded list.

The primary readiness action is **Resolve with assistant**. It opens the assistant with the active question, relevant stage, displayed record/version and selected evidence. A compact issue list permits choosing a different issue; the assistant does not force a fixed sequence or a giant form.

An active question has a short title, why it matters, supported choices and their consequences. The recommendation appears only when supported. **Show evidence** expands source passages/definitions, uncertainties and calculator results. “I don't know” is always available as a response and explicitly retains the blocker. Custom response opens a short text field for a fact/reason, not nine copies of the question paragraph.

After a choice the chat shows the server's exact change in lab language and **Apply decision**. After apply it shows the committed outcome and next useful decision. Completed tool investigation folds under **What I checked**; full tool trace remains accessible. Safe internal record/source links and structured action cards work as links, rather than literal Markdown. If the model is unavailable, render existing ranked readiness options through the same prepare/preview/approval path; the scientist can continue without a second acceptance mechanism.

When all method blockers are resolved, show **Confirm SOP** with its review scope. While blocked, the action is **Review ready sections**, naming what remains unresolved and that the SOP will remain a draft. Preserve ADR 0046's partial confirmation behavior but make the result explicit before and after the action.

First bounded SG-05 presentation slice: the current structured SOP question IDs supply the open method-decision count and individual discussion links. Only the known aggregate method-question check is folded into that summary; all actual checks remain accessible, and other blockers or unsupported history stay visible. Partial review and final confirmation keep the existing operation and readiness guards, with explicit scope and result wording. This slice does not implement Apply decision, ranked-option fallback, immutable source selection or full SG-05 acceptance.

### 4.2 Concrete wash-conflict example

This example uses the reviewed conflict, not a proposed validated wash setting:

> **Wash volume needs review.** The source specifies 400 µL, while the selected plate definition lists a 350 µL working maximum. This procedure cannot use those together.
>
> **Check an alternative compatible plate** — the assistant will inspect confirmed plate definitions; no substitute is assumed.
>
> **Use a documented lab wash method** — provide or locate the validated procedure; the assistant prepares its supported change.
>
> **I don't know yet** — keep this method issue open.
>
> Show evidence: source passage and the exact accepted plate definition/version.

If the person chooses “I don't know”, the UI says **“Your reply is saved. The wash method still needs review. I can check other instructions or prepare the parts we already know.”** It does not move the question to “Settled”. Continue source search, calculations using known inputs and supporting drafts, or discuss clearly hypothetical alternatives in conversation. Do not invent a persisted unconfirmed designer/session path or weaken ADR 0067: creating a complete experiment still needs the required accepted template/essentials. If evidence supports an alternative, the next card names the exact proposed plate role/default or wash instruction and affected steps. A scientist may instead approve a fully specified experimental variation with rationale under D4 and its visible unvalidated label; lowering a volume merely because it fits is never silently treated as validated science.

A separate issue “Who will run this next week?” is proposed for reclassification to run preparation. Its card states that the reusable method remains unchanged, and the operator is still required before the relevant execution boundary. Accepting that disposition preserves the original question and its reason. It does not rewrite a method conflict into a run issue.

### 4.3 Review and change inspection

One request appears as one scientific summary: aim, what the agent drafted, meaningful decisions, assumptions and next prerequisite. Supporting records are expandable rows with name, type in lab words, review state and relationship. Keep per-record histories, permissions and confirmations intact.

Each meaningful decision has a concise effect and approval control; inseparable linked edits expand as one atomic set. Display outstanding supporting-record confirmations and dependency order within the summary. Do not imply that approving one decision confirms all nine drafts.

For the nine-record mock ELISA request, the summary leads with **“Plan an IL-6 ELISA for four mock supernatants”**, sample/replicate/control facts, remaining scientific choices and missing physical facts. The verified set is one campaign, one material kind, one entity, four samples, one experiment design and one plate map. Expand **Supporting records (9)** to see their actual names and versions. The meaningful supporting decision is **“Use these four mock supernatants”**, covering the material kind/entity/sample definitions together with their explicit hypothetical status; the campaign is shown as organizational context with any real dependency respected. Show experiment aim/design choices and plate placement/controls as distinct scientific review scopes. Offer one visible supporting-confirmation scope after reviewing its contents, showing exact included records and any exclusions. Do not turn the four samples into four extra approvals or silently confirm experiment/map decisions. Another request in the same conversation gets its own summary.

For a dilution correction, lead with **“Sample dilution: 1× → 2×; four samples affected.”** Expand recalculated quantities, affected wells/procedure and old/new values when requested. Numbers and affected counts come from server/domain results. Never hide a changed critical constraint just because the diff is compact. Generic nested dumps remain in All fields/technical detail, not the default decision view.

### 4.4 Library, plates and run views

| View | Default content | Expanded content/context | Acceptance |
| --- | --- | --- | --- |
| Library | Task entry (“Draft a method”, “Find instructions”, “Find a lab convention”) and search using existing accessible module search operations | Specialist definitions remain browseable under the established Library area; preserve current filters and named record links | A scientist can start without choosing among nine database categories. Cross-module search enhancement is optional after verifying a concrete gap; no new top-level menu is added without the 004f placement rule |
| Experiment Plates | Compact rows: plate purpose/role, format, subjects/controls, counts, state and exceptions; selected plate grid open | Other grids on demand, full legend and search, selected wells supplied to assistant as typed context | Large experiments do not render every map at once; selected-well correction remains reproducible after reload/navigation |
| Run checklist | Current actionable step with procedural detail, resolved quantities/units, materials, timing and unresolved/deviation state | Previous/upcoming steps, complete protocol and exact accepted inputs always accessible | Titles alone are insufficient; a scientist can tell what to do and what is missing. Simulation is conspicuous and never presented as physical validation |
| Assistant | Current outcome, unresolved decision, Apply control and valid action links | Evidence summary and full transcript/tool calls | Completed reads do not displace the actionable decision; stop/steer and recovery state are usable |

Reuse Stock's compact facts/expandable lots pattern, established tabs and existing shared components. Check keyboard/screen-reader behavior, focus after apply, and laptop width with the assistant open. A full protocol can be opened at any time; progressive disclosure must not conceal a required safety instruction or unresolved step.

First bounded SG-07 task-entry slice: the existing Library menu opens `/library`, offering the three lab tasks before specialist categories. Draft a method starts a fresh existing assistant conversation with purpose/source intake and explicit unknowns; it creates no record from the button itself. Find instructions and Find a lab convention open the existing Documents and Lab memory searches. Specialist links and draft counts remain under a closed Browse the library disclosure, and their pages link back to task entry. This adds no search operation, cross-module search framework or top-level menu entry. Source-search behavior and any concrete search gap have their own acceptance evidence.

### 4.5 Choose and link exact protocol instructions

The SOP shows **Instructions used** with a readable title, printed edition/date only when actually known, and **Open instructions**. **Choose instructions** searches existing editions or lets the scientist upload a new document/revision through existing library/file operations. Rows show title and edition, not a field requiring a document ID. **Use instructions** prepares the exact source-reference change; its server preview identifies the chosen edition/file and any changed citation context, followed by **Apply decision**. Choosing instructions attaches evidence; it does not automatically settle a scientific conflict, adopt new wash settings or confirm the SOP.

Baseline `source: {document, revision?}` uses a free string; citations identify document/passages without an immutable file/version pin. `library.add_revision` preserves earlier files, but `library.read` reads the current original. SG-18 adds the exact-source read/reference contract shared with SG-01: document record version, file identity/content digest and immutable parse snapshot identity, with source title/printed revision as display metadata. Cited passages/quotes bind to that parse snapshot. Resolve the chosen file at the chosen version; never silently fall back to latest. Existing source references migrate explicitly with uncertain associations marked for re-review under D5.

Adding v2 must not change a SOP legitimately using v1. Re-parsing the same bytes may produce new passage boundaries; keep the prior parse snapshot readable and require explicit review where citation identity/text changes. Missing file/digest mismatch is an actionable failure. A PDF parse failure can leave the selected file attached and openable, with **Text could not be checked**; no matched-citation or scientific evidence claim is made. File/source access retains lab scope and license rules. No manual schema identifiers appear in this scientist flow.

First bounded SG-18 delivery slice: library-owned immutable converted snapshots and exact-reference reads through `library.read`, with parse/search results identifying the snapshot they returned. Current discovery uses the same stored snapshots. Preserve only observable retained text when upgrading the current parse; do not reconstruct deleted parses or infer old SOP pins. Acceptance covers historical versions, same-file reparses, actual-byte verification, missing pinned passages, lab isolation and atomic publication. An independent producer checkpoint precedes SOP source/citation consumers and the chooser. This slice alone does not make existing SOP source associations exact or deliver source adoption in the UI.

## 5. Generated science and default agent behavior

### 5.1 Content contract

- **Procedure:** purpose/applicability, materials and their roles, sequential instructions, quantities/units, timing/constraints and acceptance criteria. Use scientific names such as dilution, concentration, standards, controls and replicates precisely.
- **Uncertainty:** short scientific issue with why it matters, evidence and next decision. An unresolved setting is not written as a bench instruction.
- **Review:** provenance, assumptions, agent authorship, draft state and software identifiers in the readiness/evidence views. Method text is not repeatedly padded with “blocking gate”, “QA draft” or adoption bookkeeping.
- **Preparation:** actual specimens/lots/containers and execution scheduling in experiment/run context when late binding is allowed.

Render labels supplied by schema/kind contracts instead of displaying `sample_dilution` or `capture_ab_working_conc` directly. Technical names remain available under All fields. Translate neither scientific precision nor dimensional quantities into vague prose. Source citations and known unknowns remain inspectable.

### 5.2 Skill and harness changes

Update `skills/sops/SKILL.md`, `skills/assays/SKILL.md` and the relevant registry/design/run skills; generate bundled skills through `pnpm generate`. Each added/changed operation must be named in its owning module skill. The default SOP/assay workflow, rather than a special “grill me” invocation, is:

1. Identify the intended stage and whether the request is hypothetical, reusable method work or intended physical preparation. Ask only if the context does not establish it.
2. Inspect current sources, accepted methods, available registry definitions and confirmed lab memory. Reuse facts already available; request essential absent facts once.
3. Perform source-settled drafting and calculators through operations. Create necessary supporting drafts with evidence rather than ask the user to enter registry forms. Do not create physical specimens/lots/stock merely to make feasibility pass.
4. Select the next coherent consequential decision. Avoid unrelated bundles; coupled choices can be one question when their scientific consequences are inseparable.
5. Show supported choices, evidence and the exact proposed change. Wait for **Apply decision** where authority requires it. Do not equate conversational assent with server acceptance.
6. Recheck, summarize the result in lab language, and either continue useful evidence work or present a genuine blocker/final confirmation action.

An assistant turn must end with completed work, an explicit human decision request, a specific failure/blocker or an honest limit/continuation state. A promise to investigate is not a completed response when the agent can still investigate. Recovery/retry logic must not endlessly rerun a stalled model.

Typed context extends the existing page/record/version contract: selected plate/well addresses or rows, selected source passage, active question/check and its stage. Context identifies what is visible and selected, not the user's authorization. Reject stale/nonexistent/cross-lab selections. The model should state when requested selection context is unavailable.

Serve a concise skill manifest and batch discovery using existing `skills.list/get` and `operations.describe` before adding tools. A bounded durable summary refers to goals, proposal/receipt identities, question IDs and records; authoritative records/proposals determine their current state on resume. A summary cannot independently assert accepted science or replace receipts. Preserve full audit/transcript access; output clipping is not memory.

Do not change the configured provider/model by inference. Measure live prompts as qualitative evidence with model/configuration/version, time, tool/model calls, repair count and first-pass completion. Record tokens/billing only if the provider supplies them. A small sample cannot rank models or prove scientific correctness.

## 6. Linked scientific safety tracks

| Track | Contract | Relationship to SOP UX |
| --- | --- | --- |
| Shared validation and accepted revisions (SG-10) | Lot CoA dimensions, uniqueness and kit membership apply through generic/specialized writes. A pin identifies a scientifically valid accepted snapshot, not merely an active flag. Human editing policy remains explicit under D3 | Required before claiming downstream design acceptance safe; basic SOP question flow can ship on draft fixtures without waiting for this entire registry audit |
| Conservation and aggregate feasibility (SG-11) | Sequential per-well inflow minus outflow, inventory and dead volume share pure domain calculations; shared eligible pools are counted once across all demands | Required before stock/transfer readiness claims; does not prevent method authoring or non-executable draft design |
| One resolved scientific design (SG-12) | Resolve plate role, dose, controls and technical/biological replicates once from accepted template and explicit experiment answers; derive protocol/map/totals consistently | Required before “as designed” means internally consistent; independent of presenting a focused SOP question |
| Immutable execution/report lineage (SG-13, SG-14) | Runs manifest exact scientific versions and physical bindings; exports/reports use executed/exported versions; live physical state stays live. Extra actual movements and exceptions are retained | Required before export/report/rerun acceptance; the method reconciliation milestone makes no execution claim |
| Harness and transaction reliability (SG-15, SG-16) | Commit-aligned event/receipt delivery; durable call reconciliation; complete lifecycle recovery; stop/steer; typed context | SG-15a and SG-16a are prerequisites for the integrated method journey; broader receipt replay, stop/steer and selected-well work have independent exits |
| Exact protocol evidence (SG-18) | Exact file/version/digest/parse reads and SOP source/citation pins; readable chooser and explicit source adoption | SG-01 shares the schema contract; SG-18 must pass before exact-edition/citation guarantees. New editions do not invalidate legitimate older pins |
| Demo, documentation and evaluation (SG-17) | Explicit hypothetical planning, stage-specific readiness, procedure detail, honest missing stock stop, and revision-scoped evidence | Each shipped milestone gets proportionate QA; complete end-to-end demo requires the tracks for the paths it actually exercises |

SG-10d performs a scoped scientific-read audit of SOP resolution/defaults, lot-to-product fallback and transfer liquid classes against the pin contract. Do not freeze container contents or instrument availability as a substitute. SG-13 includes required accepted liquid-class/configuration dependencies in export lineage; changing them later must not reinterpret an old report.

SG-15 resolves nested/preview transaction ownership: rolled-back work emits no committed success, and after-commit delivery cannot turn a durable mutation into a reported failed mutation. Validate the exact nested paths before editing the harness. SG-14 preserves ADR 0060's rule that unplanned transfers are not automatically rerun; their actual movement still needs honest inventory accounting.

## 7. Work packages, ownership and order

Published tracking: [GitHub epic #162](https://github.com/walimmalik/AILaboratory/issues/162) with 25 implementation tickets. [Delivery sequence and evidence index](https://github.com/walimmalik/AILaboratory/issues/162#issuecomment-5992746822). SG-10/15/16 retain group IDs for traceability; their child rows below are independently closable tickets with independent exits. Other packages are bounded tickets, split into small PR steps where indicated. Owners coordinate schema/operation contracts before consumers start. One writer owns a file/shared interface at a time. The primary owns integration and full gates; agents preserve unrelated edits and existing `.serena/`.

| ID / issue | Owner responsibility and first files | Deliverable and bounded PR steps | Dependencies / exit evidence |
| --- | --- | --- | --- |
| SG-01 / [#163](https://github.com/walimmalik/AILaboratory/issues/163) | Contract owner: SOP/design/proposal/library schemas, generated files; owning docs | ADRs 0068/0069; typed question transitions, existing-proposal decision metadata/read-write dependencies, originating intent, exact source reference shared with SG-18 and preserved-history migration shape. Publish concrete payloads; no decision table/task engine | Decisions locked; generation/contract tests; focused consumer checkpoint before SG-03/04/18 depend on it |
| SG-02 / [#164](https://github.com/walimmalik/AILaboratory/issues/164) | SOP validation owner: `apps/api/src/sops/kinds.ts`, record-service guards and draft migration | Prevent question bypass for all actors; stage guard on creation/reclassification; concrete downstream obligation; draft-answer migration without granting resolution | SG-01; generic create/update/restore/proposal bypass tests, retained history, valid per-run deferral, wash conflict falsely labelled run still blocking. Accepted-history migration belongs to SG-10c |
| SG-03 / [#165](https://github.com/walimmalik/AILaboratory/issues/165) | Decision operation owner: SOP operations, proposal/change-set integration, client contracts | Typed prepare/confirmation scopes in existing store; common approve; human-prepared attribution; dependency-ordered transaction confirmation; persist originating intent; server diff; response/reclassification/evidence/rationale variants, human disposition without arbitrary elevation; sibling repreview/idempotency; no final SOP confirm | SG-01/02/15a/16a; chat/Review identical history, retained agent+approver, stale/substantive and disjoint sibling tests, atomic rollback, D4 hard-block/label cases |
| SG-04 / [#166](https://github.com/walimmalik/AILaboratory/issues/166) | Agent-content owner: `skills/sops`, `skills/assays`, relevant registry skills; assistant prompts | Default adaptive intake, registry drafting and scientist-facing procedure; stage separation and useful terminal response; concise discovery using current tool contracts | SG-01 vocabulary; no ordinary tool authority expansion; deterministic skill tests plus bounded live prompts |
| SG-05 / [#167](https://github.com/walimmalik/AILaboratory/issues/167) | SOP/chat UI owner: `SopPage.tsx`, `Sops.tsx`, `RecordReview.tsx`, `AssistantPanel.tsx`, `RichText.tsx` | Focused issue/live decision count, exact common Apply card, reload states, truthful partial/final confirmation, safe links and ranked-option fallback without model | SG-02/03/04/16a; UI fidelity and unknown/apply/stale/pending-reload/model-unavailable journey; SG-18 for exact source chooser claim |
| SG-06 / [#168](https://github.com/walimmalik/AILaboratory/issues/168) | Review/diff UI owner: `ReviewInbox.tsx`, `Value.tsx`, `AllFields.tsx`; review operations | One scientific summary, meaningful decision controls with expandable records, semantic diffs; recompute actual eligibility for batch acceptance. Preserve inseparable transaction grouping | D2 and SG-03/15a including persisted confirmation scopes and ordered-confirmation tests; stale dependency and changed dilution acceptance; no hidden per-record confirmation |
| SG-07 / [#169](https://github.com/walimmalik/AILaboratory/issues/169) | Library-navigation owner: `AreaHead.tsx`, Library views, `lib/kinds.ts` | Task entry/search through existing module operations; secondary specialist browse. Investigate cross-module gap separately before adding search capability | Existing 004f layout; search isolation, task start and retained browse paths verified |
| SG-08 / [#170](https://github.com/walimmalik/AILaboratory/issues/170) | Plate-view owner: `KindTabs.tsx`, plate page/selection context consumer | Compact maps with selected grid, counts/exceptions and selected-well handoff | SG-16c; many-map fixture and correct selected-well edit/absence tests |
| SG-09 / [#171](https://github.com/walimmalik/AILaboratory/issues/171) | Run-view/seed owner: `Experiments.tsx`, `apps/api/src/sops/seed.ts`, campaign run rendering, `seed/` | Current step with complete procedural instructions, quantities/timing/deviations; expandable full protocol; repair title-only seed data from sources | Existing run contract; SG-13 before claiming complete manifest; simulation skip/reload/finish with complete instructions |
| SG-10 / child tickets | Core-records/reagents owner; see SG-10a–d | Shared invariants, accepted pins, working/confirmed separation and scientific reads | Child exits below; no blanket D3/migration dependency for lot parity or pin guard |
| SG-11 / [#172](https://github.com/walimmalik/AILaboratory/issues/172) | Pure math/feasibility owner: `packages/domain`, `transfers/rules.ts`, `assays/designer.ts` | Sequential well conservation/dead volume; joint stock feasibility over overlapping eligible pools, avoiding both double counting and greedy allocation. Expose same domain results through calculators/readiness | No model arithmetic; 5 µL in/10 µL out rejected, shared 100 µL versus two 60 µL draws short; A-only + A-or-B feasible assignment and impossible restricted-pool cases; independent pools not over-aggregated |
| SG-12 / [#173](https://github.com/walimmalik/AILaboratory/issues/173) | Assay-design owner: schema/domain design, `assays/designer.ts`, `assays/operations.ts`, `assays/kinds.ts`, template/layout seed | Explicit destination/source role; resolved dose/controls/replicates shared by protocol/map/totals. Refuse contradictions; do not pick first bound labware | SG-10b and SG-11 relevant totals; source-first Echo fixture, 5 versus 10 µM conflict, replicate/layout capacity cases; not gated on SG-10c/d |
| SG-13 / [#174](https://github.com/walimmalik/AILaboratory/issues/174) | Execution-lineage owner: campaign schema/`runs.ts`, transfer export/reports, exact-version readers | Full run manifest/physical bindings; export identity/report interpretation from original version; immutable scientific dependencies | SG-10b plus relevant SG-10d audited reads; v1 25 nL export/v2 50 nL edit/v1 report cannot invent shortfall; newer default/product/liquid class cannot alter old interpretation |
| SG-14 / [#175](https://github.com/walimmalik/AILaboratory/issues/175) | Actual-movement owner: `transfers/reports.ts`, inventory operation calls, execution detectors | Account for extra actual movement/unknown identity, execution exceptions, safe remainder/rerun derivation and once-only application | D5 and SG-11/13; identifiable extra transfer updates inventory once, ambiguous extra is unresolved, no “complete” false claim or automatic extra rerun |
| SG-15 / child tickets | Transaction/receipt owner; see SG-15a–b | Minimum atomic decision producer separately from broader tool replay | SG-15a is the SG-03 dependency; broader SG-15b has its own exit |
| SG-16 / child tickets | Assistant-lifecycle/context owner; see SG-16a–d | Minimum recovery/active-issue context, then independent stop/steer, selections and optional optimization | SG-16a is the SG-05 dependency; SG-16c is the SG-08 dependency |
| SG-17 / [#176](https://github.com/walimmalik/AILaboratory/issues/176) | Integration/demo/docs owner: seed fixtures, affected tests, `docs/architecture/`, `docs/wiki/`, benchmark expectations | Correct wiki current/target distinctions; deterministic/fault/browser/live-agent acceptance suite and demo script in existing appropriate docs; attach executed evidence to PRs | Applicable tracks for demonstrated path; full required gates and independent review once integrated; no invented transfer success/physical result |
| SG-18 / [#177](https://github.com/walimmalik/AILaboratory/issues/177) | Library/SOP source owner: library/file schemas/operations/parsing, SOP citation checks and source chooser | Exact edition/file/digest/parse snapshot reference and read; explicit legacy association review; chooser/upload through existing operations, readable Open/Use instructions, no latest fallback | SG-01 source schema and SG-03 common Apply; v1 source stable after v2, same-file reparse review, digest/file/parse failure, lab/license isolation; chooser links verified |

| Child issue | Problem and owned files | Scope | Independent dependencies and acceptance |
| --- | --- | --- | --- |
| SG-10a / [#178](https://github.com/walimmalik/AILaboratory/issues/178) | Generic lot writes bypass receive checks; `apps/api/src/reagents/kinds.ts`, `operations.ts`, relevant domain/schema tests | Shared CoA dimensions, product/lot uniqueness and kit membership on all entry points | No working-version dependency; specialized/generic create/update valid/invalid/permission parity, including undefined CoA/wrong-unit/duplicate/foreign-component cases |
| SG-10b / [#179](https://github.com/walimmalik/AILaboratory/issues/179) | Active flag admits invalid scientific pins; `apps/api/src/records/pins.ts`, shared acceptance checks and actual pin consumers | Refuse new invalid accepted snapshots; scope scientific acceptance assessment to exact version | No working-edit/migration dependency; invalid-active pin reproduction fails safely, valid pinned snapshots remain stable; historical identity is not a future-eligibility exemption |
| SG-10c / [#180](https://github.com/walimmalik/AILaboratory/issues/180) | Working edits/migrated uncertainty can contaminate accepted use; core record schema/service, SOP migration, future-use readiness | D3 working/confirmed separation and D5 affected-future eligibility, not historical rewriting | SG-01/02 metadata and SG-10b; deploy accepted-answer migration with SG-02, explicit new-SOP adoption and design reconfirmation restore eligibility; incomplete working edit never overwrites accepted version, old completed-run pins intact, affected future run with existing pin blocked until reconciliation, unrelated use allowed |
| SG-10d / [#181](https://github.com/walimmalik/AILaboratory/issues/181) | Pinned science resolves some defaults live; SOP resolve/calculate, transfer export/liquid-class readers | Scoped source-traced audit and fixes per demonstrated read path; distinguish scientific definition from physical state | SG-10b contract; SG-18 only for exact SOP source reads. New default/product/liquid class cannot reinterpret old science; live volume/availability still change honestly |
| SG-15a / [#182](https://github.com/walimmalik/AILaboratory/issues/182) | Preview/nested rollback and delivery failure lie about decisions; registry/activity/proposal persistence/approval transaction paths | Commit-aligned events/hooks and proposal-ID receipt, atomic decision foundation | SG-01 interface (not completed SG-03 implementation); rollback emits no success, retry returns committed outcome once despite missing activity/message, checkpoint before SG-03 |
| SG-15b / [#183](https://github.com/walimmalik/AILaboratory/issues/183) | Missing assistant call receipt misreports committed tools as not run; `assistant/assistant.ts`, tool-call persistence/history reconstruction | Broader durable call receipt/replay reconciliation using transaction truth | SG-15a; committed mutation + missing conversation receipt recovered, unknown completion distinct, no duplicate draft or false nonexecution |
| SG-16a / [#184](https://github.com/walimmalik/AILaboratory/issues/184) | Preflight fault strands running; issue context absent; assistant runtime/operations/schema, SOP context producer | Entire lifecycle recovery, active question/record/version context, trusted intent stamping, terminal-turn and pending-card pause contract | SG-01 context and SG-15a; two requests yield distinct intent IDs and contextual reply retains its intent; injected preflight fault exits running, pending reload/new-chat recovery, no Apply race; required before SG-05 |
| SG-16b / [#185](https://github.com/walimmalik/AILaboratory/issues/185) | Scientist cannot stop/steer; assistant runtime/operations and composer | Explicit interruption/continuation; reread committed records/proposals on resume | SG-16a/15b; committed work survives stop, new intent preserved, no false rollback or repeated mutation |
| SG-16c / [#186](https://github.com/walimmalik/AILaboratory/issues/186) | Selected wells/passages invisible; assistant context schema and plate/source UI producers | Typed visible versioned selection with lab checks; selection is not authority | SG-01 shape; valid/absent/stale/cross-lab context tests; required by SG-08, not basic SOP issue journey |
| SG-16d / [#187](https://github.com/walimmalik/AILaboratory/issues/187) | Unbounded history/namespaces and serial discovery burden; assistant history/context, skills service | Optional bounded reference summary and manifest/batch discovery | SG-16a/15b; measured long-conversation improvement retaining authoritative decisions/unknowns, no fabricated cost target; no method milestone dependency |

Sequencing:

1. **Contract and safety foundations:** SG-01/02/15a/16a; SG-10a/10b/11/13 proceed as separate tracks with their concrete contracts. SG-04 updates stage/content behavior. SG-18 starts after SG-01's source schema.
2. **One complete method journey:** SG-03 then SG-05 with SG-04, SG-15a and SG-16a. Demonstrate unknown plus useful continuation, accepted reclassification, supported atomic method change, recheck, preflight recovery and separate final confirmation. Include SG-18 before declaring exact-source linking complete. No transfer/run readiness claim.
3. **Carry the interaction into design:** SG-06/07/08 with SG-16b/c; optional SG-16d follows measured need. SG-12 must pass before experiment/map/totals consistency claims. SG-15b underpins broader safe continuation.
4. **Complete scientifically trustworthy preparation/reporting:** SG-09/10/11/12/13/14 integrated for the specific end-to-end journey; SG-17 publishes actual acceptance evidence and docs. This is the point for execution-readiness/report guarantees, not the earlier method milestone.

**Deployment gate for existing accepted methods:** the early method milestone is limited to new draft fixtures until SG-10c passes. Production use involving edits of an accepted SOP, accepted-history migration or legacy source reconciliation additionally depends on SG-10c and its SG-10b acceptance guard. SG-02/05/18 must enforce this rollout boundary; SG-02 and the accepted-history migration/eligibility slice of SG-10c deploy together for a populated lab. Migration preserves original answer text and historical accepted snapshots while marking affected accepted-version eligibility **Needs re-review**; no legacy accepted answer is read as resolved merely because it was answered. Schema/migration compatibility and affected-future-use guards are checked before deployment, not left for a later milestone. The draft-only path can be accepted independently without claiming existing-method migration or production readiness.

Before dependent consumers use SG-01, SG-15a, SG-10b or SG-12 as ready producers, assign a focused independent native subscription Astra high checkpoint under AGENTS.md: exact schema/files, outputs, acceptance tests and unanswered contract questions. Resolve material findings first; avoid duplicate broader review. Report unavailable owner/model combinations honestly. Substantial integration receives independent review proportionate to scientific risk.

## 8. Finding-to-package traceability

These IDs give every completed-review finding or explicit improvement a ticket destination. The row's evidence type is the review's, not newly executed acceptance. Several findings may share a package because they concern the same bounded contract; tickets carry the reproduction/source references from the report.

For source-traced findings, the first implementation step is the smallest discriminating reproduction at the current revision. Fix demonstrated contract failures, not speculative ones. A passing check disproves only its exercised scenario; an inconclusive/unavailable reproduction is an evidence gap, not a disproven finding. Keep that gap explicit until a bounded check resolves it or the primary makes an evidence-scoped decision.

| Finding | Evidence and concrete problem | Work package(s) |
| --- | --- | --- |
| F01 | Browser: initial agent promises investigation and ends without a decision/result | SG-04, SG-16 |
| F02 | Browser: broad question bundles and nine repeated answer forms/readiness paragraphs | SG-04, SG-05 |
| F03 | Browser/source: method questions include experiment/run facts and gate reusable SOP | SG-01, SG-02, SG-04 |
| F04 | Executed browser: “I don't know” becomes settled | SG-02, SG-03, SG-05 |
| F05 | Source: generic question omission bypasses clarification/history guard | SG-02 |
| F06 | Browser: “Confirm SOP” partially confirms without clear scope | SG-05 |
| F07 | Browser: question IDs presented as agent-entered values for verification | SG-01, SG-05 |
| F08 | Browser: one request becomes nine uncoordinated Review drafts | SG-06 |
| F09 | Browser: validator count conflated with human decisions and stage readiness | SG-01, SG-05, SG-06 |
| F10 | Browser/source: dilution diff expands large unchanged nested protocol tables | SG-06 |
| F11 | Browser/source: tool transcripts and long answers displace current action | SG-05, SG-16 |
| F12 | Browser/source: Library requires nine category choices before starting | SG-07 |
| F13 | Source/browser: every map rendered in full; selected well absent from context | SG-08, SG-16 |
| F14 | Browser/source: run titles lack procedural detail; checklist overload | SG-09 |
| F15 | Isolated runtime: invalid active revision pinned and accepted downstream | SG-10 |
| F16 | Isolated runtime: generic lot create/update bypass CoA/unit/unique/kit validation | SG-10 |
| F17 | Executed pure-rule: intermediate well 5 µL in then 10 µL out passes | SG-11 |
| F18 | Source: first bound labware may be source rather than destination | SG-12 |
| F19 | Source: dose, controls/replicates, layout placement and totals disagree | SG-12 |
| F20 | Source: campaign run lacks exact map/transfer/physical-binding manifest | SG-13 |
| F21 | Source: old exported report interpreted against current transfer version | SG-13 |
| F22 | Source: live SOP defaults/product fallback/liquid classes change pinned interpretation | SG-10, SG-13 |
| F23 | Source/arithmetic: repeated demands independently consume the same stock pool | SG-11 |
| F24 | Source: unplanned actual transfers omitted from stock and execution completeness | SG-14 |
| F25 | Source: nested/preview transaction success emitted before rollback | SG-15 |
| F26 | Source: post-mutation activity failure can make committed write appear failed | SG-15 |
| F27 | Source: stale cached readiness/dependency summaries govern Review eligibility | SG-06, SG-10 |
| F28 | Isolated fault: committed mutation with missing message replayed as “not run” | SG-15 |
| F29 | Isolated fault: preflight exception strands conversation running | SG-16 |
| F30 | Browser/source: final Markdown handoff links render literally | SG-05 |
| F31 | Source/opportunity: serial skill discovery/tool namespace accumulation/history replay | SG-04, SG-16 |
| F32 | Source/opportunity: user cannot stop/steer running task or safely continue | SG-16 |
| F33 | Wiki drift: planning described as stock reservation; unscanned run implies bindings | SG-17, SG-13 |
| F34 | Wiki drift: every human edit returns to review; adoption/redrafting overstated | SG-17, SG-10 |
| F35 | Browser: “yes, as designed” obscures absent physical facts | SG-05, SG-12, SG-17 |
| F36 | User requirement/browser: technical variable labels and workflow bookkeeping leak into procedure | SG-04, SG-05, SG-06 |
| F37 | Coverage: PDF/DOCX ingestion unavailable because Docling missing | SG-17; record prerequisite and unrun coverage, repair only the demo/test runtime if required |
| F38 | Coverage: qualitative model sample lacks token/billing metrics or comparison | SG-17; scoped evaluation, no fabricated cost/model ranking |
| F39 | Coverage: simulated checklist is not physical validation or assay results | SG-09, SG-17; retain clear simulation labeling and evidence limits |
| F40 | Required positive behavior: agent creates registry drafts, preserves duplicate placement, refuses invented physical data and people-only confirmation | SG-04, SG-08, SG-17; regression cases preserve these strengths |
| F41 | User requirement/source verification: exact protocol edition/file cannot currently be selected, read and pinned reliably | SG-01, SG-18; explicit adoption and immutable citation fixture |

## 9. Acceptance and evidence

### 9.1 Deterministic contract checks

Every added/changed operation has valid-input, invalid-input and permission tests, including agent calls inside proposals/change sets and cross-lab inputs. Generate schema/client/skills and fail on stale generated files. Use PGlite for API contracts, pure domain tests for mathematics, and existing fixtures for source/record evidence. Tests assert scientific behavior and authority rather than mirror implementation.

Required cases:

- Unknown response never resolves; unsupported custom text cannot become a valid wash setting; source-supported change resolves only after recheck.
- Agent omission/status rewrite/approved generic proposal cannot delete a people's question or its history. Traceable reclassification removes only an incorrectly staged obligation.
- Human generic create/update/restore cannot bypass the owned question path. A wash instruction conflict born with `run` stage still blocks; a valid declared input can be late-bound. Deferral without a concrete downstream check refuses; a run using the pinned SOP inherits and checks that obligation.
- A valid SOP with declared per-run inputs can be confirmed; incomplete physical preparation stays **Needs checking**. A real method defect cannot be deferred just to activate the SOP.
- Stale SOP/dependency card, wrong lab, rejected card and duplicate submit cause no unintended writes. An inseparable multi-record decision is atomic.
- Chat and Review apply the same proposal and produce identical history. Ordinary operations retain agent plus approver; arbitrary people-only steps refuse. Reload/new-chat retrieves pending/applied/superseded state from the server. Apply cannot race an active assistant turn.
- Applying sibling A on unrelated paths automatically re-previews B with the identical result under its new record version. If A changes B's values or scientific consequence, show the changed preview and require a new click. Server-rendered exact values cannot disagree with the model's explanation.
- Human edit attribution follows ADR 0056; final activation remains explicit. Cached Review eligibility is recomputed after dependency changes.
- Every accepted scientific pin uses a valid accepted snapshot. Edit/adopt/recheck paths are explicit and an old design remains stable under newer definitions.
- An incomplete working edit leaves the last valid confirmed version available. D5 migration preserves historical completed-run evidence, but affected future execution of an already-pinned design requires reconciliation; unrelated future use stays eligible. An accepted rationale variation remains labelled unvalidated and cannot bypass hard scientific failures.
- Lot validation is identical for generic/specialized create and update. Conservation and stock aggregation cover counterexamples and valid control cases.
- Overlapping-pool fixture: A and B each contain 6 µL; one demand needs 6 µL from A only, another needs 6 µL from A or B. It is feasible independent of evaluation order; allocating flexible demand to A first must not falsely reject it. A demand requiring 7 µL from A only is infeasible even when total pooled stock covers total demand. Use domain/calculator output for actual claims.
- Protocol, destination plate, map, controls/replicates, dose and totals agree; incompatible layout/template inputs refuse with a lab reason.
- Old exports/reports are interpreted against immutable executed inputs; extra actual movement and exceptions cannot disappear; duplicate report/receipt cannot debit twice.
- Nested/preview rollback emits no committed success; missing message after commit reconciles; preflight failure/stop does not strand “running”; resume does not repeat completed mutations.
- Exact-source fixture: select v1/file A, add v2/file B, then the old SOP link/quote still opens and checks v1. Explicit adoption previews v2 and updates only on Apply. Same-file reparse changing passages requires review; digest mismatch/parse unavailable cannot claim checked citations or silently use latest.

Use a scripted model/provider fixture in CI for investigation, source choice, unknown response, proposed decision, interruption and receipt-recovery scenarios. Assert one coherent question per card, no repeated issue paragraph in answer fields, distinct decision count, readable scientist labels and current action visible at laptop width. Do not globally ban useful scientific identifiers; checks target software keys/operation names exposed in scientist-facing areas, with explicit appropriate technical/scientific contexts. Each assistant turn ends in completed work, a human decision, a specific blocker/failure or an honest continuation/limit state. Live model quality is assessed separately.

### 9.2 Browser and live-agent journey

Use an agent-owned disposable lab and explicit hypothetical IL-6 ELISA planning. Realistic scientific source fixtures have reviewed expectations; missing physical facts remain missing. The journey is:

1. Ask for a reusable method and observe evidence investigation plus one consequential source question, without special coaching.
2. Say “I don't know”; reload and verify the issue stays open and the reply is visible. Ask to continue: the agent checks further evidence/known calculations or supporting drafts without inventing a setting or bypassing the accepted template requirement.
3. Resolve a documented issue through exact-change **Apply decision**; verify committed scientific changes, checks and next action. Repeat with a concurrent edit to exercise stale acceptance.
4. Reclassify one genuine run-specific fact, inspect its retained obligation, review ready sections while still blocked, then separately confirm a fully valid SOP.
5. Ask the agent to draft four explicitly mock supernatants and an experiment/map with duplicates, standards and blanks. Review the nine-record fixture as one originating request: supporting material/entity/samples are one visible scientific review scope, with clear experiment/map controls. Confirm via a permitted exact scope rather than visiting nine pages; a second request in the same conversation is not merged into it.
6. Request 1× → 2× dilution; inspect concise changes and selected-well context. Confirm required records explicitly and reject an active-record proposal; reload to verify persistence.
7. Ask for transfer preparation with absent physical sources/stock. Observe **Needs checking**, not a fabricated export or success. Only exercise actual export/report fixtures after the relevant safety tracks pass.
8. Run an explicitly simulated checklist with complete procedure detail, a skipped step/deviation, reload and finish. No physical accuracy or assay result is claimed.

Also choose/open the exact protocol edition, reload with a prepared card, add a newer library edition, verify the original link, then explicitly adopt after preview. Start a new conversation after interruption and recover the same unresolved issue from records/proposals. Exercise the model-unavailable ranked-option path. Score live prompts against the same rubric: one coherent question, no duplicate question wall, useful work after unknown, no invented science/authority, exact source, truthful resume and visible action. Report the number/configuration of runs and first-pass success; repeat only when failures or changes justify it.

Also exercise many plate maps, laptop width with assistant open, keyboard focus and accessible controls. Apply the installed `ui-workflow-fidelity` skill as required by AGENTS.md once the workflow is usable; inspect actual browser behavior against D1/D2 and the screens above before declaring completion. This is verification, not another approval stage.

Record baseline and tested revision, model/provider configuration, prompts, scientific outcome, calls/time, tool repair count, blockers and coverage in PR descriptions. The review's 10 prompts / 46 model calls / 107 tools are qualitative baseline evidence, not a target or cost benchmark. A model trial must preserve unknowns and authority as well as reduce cognitive burden; faster unsupported science is failure.

### 9.3 Gates and documentation

Each small PR runs checks appropriate to its changed contracts; the integrated milestone runs required `pnpm generate` freshness and `pnpm check`, affected browser E2E, and Python checks if science-service code changes. Assign one owner for heavy/full runs. Classify failed checks as product, harness, environment or pre-existing with evidence; an unavailable check is unrun, never passed. Rerun only evidence invalidated by new changes/findings.

Update the owning module's living architecture doc, affected wiki and skills in the same PR as behavior. Wiki pages explicitly distinguish current behavior from accepted target: planning feasibility versus reservation, method acceptance versus execution preparation, human-edit confirmation, explicit version adoption and known versus unknown physical state. Detectors for new outcome data use `memory.observe`, or the owning plan gives a reason for none.

Completion requires resolved material findings, locked consequential decisions for the implemented scope, required passing gates and the actual accepted UI journey. Issue closure and PR descriptions name exactly which milestone/path passed and what remains outside its claim.

## 10. Independent planning review and dispositions

Opus 5.5 and Fable 5.1 reviewed through the authenticated first-party Claude CLI subscription, with tools disabled; a separate native Astra high agent reviewed independently. Each reviewed the evidence brief and specification, not an independently executed implementation. Two full review rounds and a focused final Fable consistency pass informed this plan. The final pass found the prior six contract gaps closed; its remaining approval-wording, internal batch-routing and dependency-table corrections are incorporated.

Accepted revisions: persisted proposal identity and a single approval boundary; server-derived exact change facts; guarded initial stage assignment and concrete inherited obligations; source edition/file/parse identity; preserved history with affected-future-use gating; explicit human-prepared attribution; persisted supporting confirmation scopes and transaction-order tests; owned originating-intent stamping; safe pending-card/run recovery; sibling repreview; overlapping-stock allocation tests; independently closable foundation tickets and a measurable scripted/live rubric.

The final consistency pass added a production migration gate joining SG-02 with SG-10c for existing accepted methods, and the explicit new-SOP revision/adopt/reconfirm route for an already-pinned design. New-draft fixture acceptance remains independently deliverable.

Rejected or narrowed advice: do not run all approved agent operations as a human; preserve actor/approver attribution and bounded human scopes. Do not reset a populated deployment or exempt affected future executions merely because they use historical pins. Do not add a persisted incomplete-designer session that bypasses accepted template essentials. Do not treat a newer protocol edition alone as invalidating an intentionally pinned old edition. Do not group unknown-origin historical work by an entire conversation as if it were one scientific request. Broader search/summary optimization remains conditional on measured need.

Planning review does not close scientific findings or prove a UI, migration or runtime behavior implemented. Those claims require the ticket-specific evidence and integrated gates above.
