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

## Preview and all-or-nothing

Every write runs in one transaction. `?preview=true` (REST) or `preview: true` (MCP) runs the real code and rolls back, returning exactly what would have happened; nothing is saved or logged. Batches are all-or-nothing.

## The activity ledger

Every write outcome (succeeded, failed, proposed, approved, rejected) is logged with actor, operation, records touched, input, error and duration. Reads are not logged. The Activity page streams it live. Failed writes are logged too, so the ledger shows what agents tried.

## Draft and confirm

A draft is a record in `draft` status. Kinds that people review declare **sections** (groups of fields) and **readiness checks**.

- **Evidence per field.** When a value changes, its evidence is replaced: an agent naming no source gets `assumed`, a person gets `person`, and a caller may name `datasheet`, `imported`, `measured`, `calculated` or (agents only) `stated`. See [Data model](data-model.md#evidence-sources).
- **Confirmation is derived.** A person confirms a section, which stores the values they saw. A field is confirmed while it still equals that value; otherwise it is "changed" (shown with the confirmed value struck through) or "unconfirmed". So any edit, by anyone, sends its section back to review, and highlighting always compares against what was last confirmed.
- **Readiness checks** live on the kind in code: a plain label, blocker or warning, the source of the rule, the section, a suggested fix, and a test. `records.readiness` returns sections, per-field state, check results and what is missing in plain words.
- **The last section activates.** Confirming the last section of a draft, with no blocker failing, activates it in the same version; the button says "Confirm … and activate".
- **Approval confirms.** Confirming an agent's proposed change confirms the sections it touched, since the person reviewed exactly that change.
- **People creating records.** A person may create a record active directly, which confirms every section as written; an agent may not.

## One place to review

The **Review** page lists everything waiting for a person: drafts (with the sections left, what is missing and how many values are assumed) and proposed changes to active records (before and after, Confirm change or Reject). The nav shows one count. After an assistant turn that left something waiting, the panel adds a "Waiting for you" line computed by the app, not written by the model. One verb throughout: "Confirm". Record status reads "draft · needs your review", "active", or "active · change waiting".

## Assumptions, questions and review loops

- **Mark what is assumed.** Anything an agent guessed stays in agent ink until a person confirms it. Unknown values stay unknown.
- **Open questions (012-G6).** Where a source is unclear (contradictions, "about 1 µL", missing values), the digitizer records an open question with the passages involved and a suggested answer. Open questions block confirm until a person answers or accepts.
- **AI review loop (012-G11).** Before a person sees a digitized SOP, a reviewer model checks it against the source. It fixes only what the source settles, each fix a tracked change with a reason and a passage, and asks an open question where the source is ambiguous. Two rounds by default. The review never confirms anything.
- **Downstream changes (in planning, P6).** When something upstream changes, downstream drafts redraft automatically; confirmed documents are marked "out of date" with a one-click redraft that is confirmed again.

## Lab memory (plan 005, not started)

Agents will read the lab's conventions, preferences, instrument quirks and lessons through MCP and a context bundle for the current page. They may propose new memories; a person confirms. Memories derived from data link to their evidence. Quirks appear beside results (for example next to a chosen liquid class); they never silently change them.
