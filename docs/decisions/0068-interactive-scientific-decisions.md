# 0068: Apply scientific decisions explicitly within one task summary

- Status: accepted by Wali on 2026-10-05; implementation is planned, not built
- Date: 2026-10-05
- Plan: [004g AI-first scientific reconciliation](../plans/004g-ai-first-scientific-reconciliation.md)

## Context

The October 2026 walkthrough exposed an interaction gap: an agent could create related drafts and identify uncertainties, but Review and Readiness left the person to reconcile long lists of records and questions. A reply to an SOP question also counted as settled without applying the underlying scientific change. The user wants the agent to investigate and guide reconciliation, while retaining explicit human authority over consequential decisions and final SOP confirmation.

## Options

For a decision discussed in chat:

1. Show the exact change with an **Apply decision** button; keep final SOP confirmation separate.
2. Treat an explicit natural-language chat answer as approval of that change; keep final SOP confirmation separate.

For a request that produces several related records:

1. Show one scientific summary with explicit approval controls for each meaningful decision, with supporting records expandable.
2. Approve the entire displayed group with one action.

Wali selected option 1 for both questions on 2026-10-05.

## Decision

- The agent investigates available evidence, prepares a concrete proposed change and explains its scientific consequence. A chat reply supplies intent or evidence; it is not itself approval.
- A person applies a consequential decision using an explicit control showing what will change. The application invokes a registered, authorized operation under that person's identity. Agents cannot impersonate this action or gain access to people-only confirmation operations.
- Applying a decision and confirming the final SOP are separate actions. An unknown answer does not resolve the underlying scientific issue.
- One task summary presents related drafts and decisions. Supporting records, detailed evidence and unchanged content remain accessible without dominating the initial view.
- Approval is organized around meaningful scientific decisions, not individual database fields or operations. Writes that are inseparable remain one atomic change set under [ADR 0051](0051-change-sets.md). This decision does not authorize partial application of an atomic set.
- Before applying, the service checks the versions and relevant prerequisites represented by the preview. Changed input requires a refreshed preview and a new human action; the system must not silently apply a different result.

This refines the presentation of "one intent, one confirm" in plan 004e: a broad request can contain several meaningful decisions. It preserves atomic change sets, agent proposal policy, existing history and final confirmation authority. It does not create a new generic workflow engine or require a second task store.

## Consequences

- The person can resolve issues in context without manually reconstructing the agent's chain of records.
- Review and the assistant need a common decision presentation and result rather than separate approval behavior.
- Response capture, application and final confirmation must remain distinguishable in the contract and history.
- Implementation details, including any minimal schema extensions and treatment of existing incorrectly classified questions, are specified and reviewed in plan 004g. This ADR does not mark those mechanisms implemented.
- Existing agent proposals retain the proposing agent and the human approver in their history. A human-authorized decision does not grant the agent arbitrary people-only powers: ordinary proposed operations keep their actor checks, while a narrowly specified human disposition is executed by the authenticated approval boundary.
