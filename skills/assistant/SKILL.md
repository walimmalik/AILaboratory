---
name: ailab-assistant
description: Read a person's conversations with AILaboratory's in-app assistant, and understand what the assistant did in the lab on their behalf.
---

# The in-app assistant

People talk to a model inside AILaboratory (the assistant panel). It works through the same operations you do, as an agent on the person's behalf. Its changes are in the activity ledger with `actor.sessionRef` set to the conversation ID (`cnv_…`).

- `assistant.status`: which model the assistant runs on, or why it is not set up.
- `assistant.list_conversations`: the person's conversations, most recent first.
- `assistant.get_conversation` with `{id}`: every message, including each operation the assistant ran (`role: "tool"`, with `outcome` done, proposed or failed, and the result).
- `assistant.ask` is for people only. As an agent you cannot send the assistant messages; do the work yourself with the operations.

Every fresh ask has its own server-stamped originating user-message identity, including two asks in the same conversation. A person can retain that request with `replyTo: {conversation, message}` only for a related selected pending proposal or open scientific question. `page.proposal: {id}` identifies a persisted proposal. `page.activeQuestion: {id, stage}` requires `page.record: {id, name, version}` and names a current `method`, `experiment` or `run` question. The server rechecks ownership, lab, record versions, stage/state and the original turn's relationship to that work. Selection and conversational assent grant no approval. Unsupported historical question context must be reconciled; never read an old answer as a resolution.

The assistant pauses with a terminal review request when a tool produces a pending proposal; later calls in that batch are recorded as unexecuted. Explicit human Review approval waits until the assistant turn ends. On reload, use authoritative record/proposal state; an approved proposal's stored receipt reports what actually committed. Dedicated Apply decision cards, broader stop/resume and recovery of uncertain tool mutations are separate capabilities and must not be claimed here.

Use these to pick up where the person and the assistant left off, for example to see which changes it proposed and why.

## Experiment workspace context

`page.workspace` identifies the experiment/version and typed Design, Plates or Transfers view alongside the matching `page.record`. The server resolves it again through the same `experiments.workspace` resolver before the model receives context. It refuses stale versions, foreign records and unrelated or invalid selections; it cannot combine workspace context with selected Library instructions. Workspace turns offer campaign, experiment, assay, SOP, plate and transfer tools. Use bounded pages to obtain more context, and read owning module skills when needed.

An Open view response is read-only navigation. Present its validated `href` as an explicit link and retain the person's experiment context. Do not claim browser display, confirmation, source adoption, reservation or execution from the read. Scientific edits and people-only confirmation retain their existing operations and authority. Pinned contextual overviews describe the exact record version, with current secondary names/stock/location facts disclosed separately.
