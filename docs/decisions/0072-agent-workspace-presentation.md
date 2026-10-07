# 0072: Agents request supported scientific views

- Status: accepted by Wali, 2026-10-07; implementation pending
- Date: 2026-10-07
- Plan: [004h](../plans/004h-scientist-experiment-workspace.md), D3

## Context

The user wants agent parity beyond filling records: the assistant should show the relevant plates, select wells, focus an addition and help construct assay-specific settings screens. The foundation anticipates UI tools; current `PageContext` contains record/version and selected SOP/source context, without a typed experiment/plate/well view contract. Arbitrary generated UI would bypass stable scientific types, accessibility and validation.

## Options

1. Agent writes chat and records only; people reconstruct the relevant view. This leaves presentation/context capability unequal.
2. Agent generates HTML/JavaScript/forms and arbitrary validation. Flexible, but not a stable scientific or authorization contract.
3. Agent drafts supported template data and requests typed views, rendered and validated by the application.

## Decision

Choose option 3. Agents may draft supported assay roles, fields, labels/groups and scientific values through ordinary operations, with evidence and existing review rules. The application owns supported renderers, units, applicability, calculations, requiredness and confirmation controls. New scientific primitives require schema/domain/API support; template prose cannot introduce them.

A bounded experiment-workspace read operation accepts a view descriptor: section, addition, map/version/plate, valid filters, color metric and bounded selection or selection reference. It returns server-validated scoped data and a descriptor usable in the web app or an external MCP client. This is a read/presentation request, not an experiment mutation or confirmation. Manual navigation uses the same view contract; simple hover/focus need not create database writes.

The assistant may display a requested view within the active experiment when that matches the person's request. It cannot replace unsaved scientific edits, take over another experiment/user's view or claim a headless tool call displayed a browser. Otherwise a tool result offers **Open this view**. Extend `PageContext` to retain this typed selection; revalidate server-side before using it in a turn or scientific operation.

## Consequences

- One stable Design/Plates/Transfers shell can render different experiments without separate assay-specific applications.
- People and agents can select materials, configure supported settings, show plate/transfer views and read identical scientific projections. Authority parity preserves people-only final confirmation.
- Presentation labels do not grant scientific authority. The model cannot calculate official values, hide required fields, suppress blockers, invent device limits or turn unknown evidence into a pass.
- No generic agent-authored page builder, browser automation bridge or global shared UI state store is required. Operation schemas, module skills and authorization/context tests are part of each slice.
