# 0069: Preserve accepted methods and reconcile uncertainty before future use

- Status: accepted by Wali on 2026-10-05; implementation is planned, not built
- Date: 2026-10-05
- Plan: [004g AI-first scientific reconciliation](../plans/004g-ai-first-scientific-reconciliation.md), decisions D3 to D5

## Context

The review found that an active scientific record could become incomplete while downstream consumers still treated that version as confirmed. It also found old question answers that did not establish a scientific resolution, and ambiguity in recording unexpected instrument movements. The app needs to support ongoing method development and experimental variation without changing past evidence or presenting uncertainty as established fact.

## Options

Wali chose the first option in each pair:

1. Keep working method changes separate from the last valid confirmed version; alternatively, reject incomplete edits and require a separate draft first.
2. Allow a scientist to approve an experimental variation with a recorded rationale and a clear unvalidated-method label; alternatively, require prior validation or a verified procedure before confirmation.
3. Preserve historical records and reconcile uncertainty before affected future use; alternatively, preserve history but permit continued use on warnings alone.

## Decision

### Working and accepted methods

An incomplete working revision does not replace the last valid confirmed method. The earlier version remains identifiable and available while the scientist develops the revision. Downstream selection and explicit adoption refer to an exact valid accepted version, never merely the current record's `active` flag.

This refines ADR 0039's assumption that an active version is sufficient proof of acceptance. It preserves ADR 0056's attribution for a person's edits and avoids a second confirmation of values they just entered, but editing does not silently publish an incomplete method. Final acceptance remains explicit where a working revision is pending. The implementation must specify selection, display, adoption and concurrency for the two version roles within the existing record/history service, not create a duplicate method subsystem.

Physical inventory, availability and actual observations remain current-state facts; they are not frozen by this method-version rule. The plan's shared input guards also prevent invalid scientific definitions from being accepted downstream while the version workflow is implemented.

### Experimental variations

A scientist may approve a fully specified experimental variation based on their own scientific rationale even when it has not been validated. Record the rationale, the person and relevant sources/uncertainty, and clearly label the method as unvalidated. Confirmation means the scientist accepted this specified method; it does not claim validation.

Invalid units, physical impossibility and unspecified critical instructions still block use. An unsupported number invented by the agent is not scientific rationale. The interface asks for the consequential scientific decision and presents its exact effects for human application under ADR 0068.

### Historical uncertainty and future use

Preserve historical records, source files, accepted snapshots and completed-run evidence. A migration or later discovery does not silently rewrite what was approved or performed.

If an old answer or imported report leaves a relevant fact unestablished, record what is known and require reconciliation before new work relies on that fact. This applies to new selection/adoption and affected future execution of an existing pinned design; a historical approval is not evidence that a newly discovered problem is resolved. Unrelated work remains usable.

For unexpected reported movements, preserve the raw observation and its provenance. Account for identifiable actual movement once where the inventory contract permits it. Missing identity or inconsistent quantities remain explicit discrepancies; do not guess a container, silently cap an observation, invent stock or claim an execution is complete without exceptions. Block only the affected availability, preparation or rerun claims until reconciliation.

## Consequences

### Incomplete draft steps (accepted extension, 2026-10-05)

Wali chose to keep source-described actions visible while their settings need clarification. A draft retains the ordered step, stable identity and citation, with an open method question linked through `about.step`. Disputed settings are omitted from operative parameters, repeats and instruction text; the question carries the uncertainty. The bench view labels the affected step **Needs clarification**, including in print, and offers discussion of the exact question and record version with the assistant.

This uses the existing step and question contracts, without another lifecycle state. An answer or ordinary edit does not settle the question, and the existing open-method-question check blocks final activation. It does not add an automatic scientific completeness detector: an omitted critical setting must still be identified and recorded as an open question. Existing historical drafts are preserved rather than silently rewritten to add missing steps or question links.

- Method authoring can continue without losing a usable accepted version.
- Experimental research is supported without mislabeling an unvalidated method as validated.
- Migration requires fixtures for supported and unsupported historical answers and downstream pins; it cannot assume all persisted data is disposable or reset a lab implicitly.
- Current eligibility and recorded historical approval are distinct. The plan must define where that distinction is evaluated and how it is explained in lab language.
- These policies are accepted. Their implementation and runtime acceptance are not yet complete.
