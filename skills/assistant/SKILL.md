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

Use these to pick up where the person and the assistant left off, for example to see which changes it proposed and why.
