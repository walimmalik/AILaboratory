# 0051: Change sets

- Status: accepted
- Date: 2026-09-30
- Plan: 004e (step 004e-3, second part; decision R2, as recommended)

## Context

An agent asked to do several things together (record a run from notes: step actuals, deviations and inventory events; 017's one confirm per design) made one proposal per operation. A person could confirm half of them and leave a run half recorded, and a later step could not name a record an earlier step would create.

## Options

A) A change set: one proposal holding ordered operations with references inside it (`$1.id`), previewed together by rollback, confirmed or rejected as one, applied atomically. B) Separate proposals sharing a group id, with "Confirm all in group". C) One proposal per operation, as before. Wali chose A.

## Decision

`changes.apply {steps: [{operation, input}], reason?}` runs up to 50 operations in order, on one transaction. A string value `"$N.path"` anywhere in a step's input is replaced by that value from step N's output (1-based, earlier steps only), e.g. `"$1.id"`. A reference to a later step, or to a value the output does not have, is refused. If any step fails, nothing in the set is changed, and the error names the step: "Step 2 (records.update): … Nothing in the set was changed." A set cannot hold another set, and each step keeps its own rules: people-only steps are refused for agents, and every step's input is validated.

For an agent, the set's policy is worked out by trying the steps in a transaction that is rolled back, asking each step's own policy with the earlier steps applied. If any step would be proposed, the whole set becomes one proposal. Its preview is every step's output. Otherwise it runs directly. A person's set always runs directly. Approving the proposal runs the set as the agent, inside the approval, all or nothing.

The ledger has one entry for the set, naming every record any step touched. Steps have no entries of their own. Each step's after-commit work (such as indexing an uploaded document) runs once the set is committed.

Review shows a set as one item: "wants to make N changes together, all or none", each step in words with its record and its field changes, and "Confirm all N" or Reject. A record page and its status chip count a set that changes the record as a change waiting.

## Consequences

- 013 run recording and 017's single confirm can be built on it.
- A set's preview is judged when it is proposed. If a record changes before approval, the step that touches it fails and nothing in the set is applied.
- A step's own proposal policy is only asked for agents. Previews run each step twice (once for the policy, once for the preview), which is fine at up to 50 steps.
