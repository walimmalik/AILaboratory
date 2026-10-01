---
name: ailab-records
description: Create, find, edit, activate, archive and restore records in AILaboratory through its MCP tools, and understand proposals, previews, history, evidence and the draft-and-confirm review.
---

# Working with records in AILaboratory

AILaboratory exposes everything as operations. You have two MCP tools:

- `describe_operations` lists operations with their input and output JSON Schemas. Pass `namespace: "records"` to see only these.
- `run_operation` runs one: `{operation, input, preview?}`.

## What a record is

Every lab thing (a labware type, a plate, a plasmid, an SOP) is a record with the same envelope: `id` (internal, e.g. `wdg_01…`), `kind`, `name` (readable, e.g. `PLT-000345`, never reused), `label`, `status` (`draft`, `active`, `archived`), `version`, who created and last changed it, and `attributes` (validated against the kind's schema). Quantities are always `{value, unit}` with `value` as a decimal string, e.g. `{"value": "50", "unit": "uL"}`.

## Rules you will meet

- **Drafts are yours to shape.** You can create drafts and edit them directly.
- **Active records need a person.** Creating an active record, editing or restoring an active record, and activating, archiving or unarchiving all come back as `{"status": "proposed", "proposal": {…}}`. The change has not happened. Tell the person what you proposed and why; they confirm or reject it on the Review page (`proposals.approve` and `proposals.reject`, people only). `proposals.list` shows proposals by status. Always pass a short `reason` so they know why.
- **What changed.** `records.diff {id}` lists what changed since the person you work for last looked at the record (or since it was first drafted), value by value, with which operation made each version. Use it to tell them what your last turn changed. The record page sets the marker with `records.mark_seen` when a person opens it; agents can't. `records.history` names the operation on each version (`via`). `activity.list` takes `record`, `conversation`, `since`, `actor` (`people` or `agents`) and `mine`.
- **Several changes that belong together go in one change set**, not one proposal per operation. `changes.apply` with `{steps: [{operation, input}], reason}` runs them in order, all or nothing. A later step can use an earlier step's output: `"$1.id"` is the id step 1 returned. A calculator step keeps its result: `"$1.calculation"` is its handle, so a later step can mark a value calculated from it (`{"source": "calculated", "calculation": "$1.calculation", "output": "/volume"}`). If any step needs a person, the whole set comes back as one proposal the person confirms or rejects as one, so nothing is left half done. If a step fails, the error names it and nothing changed.
- **Preview first when unsure.** `preview: true` returns exactly what would happen, and saves nothing.
- **Edits replace all attributes.** `records.update` takes the complete new `attributes`, not only the changed ones: read the record, change what you need, send them all back. `records.get {id, brief: true}` reads it without the section confirmations and per-item evidence, which a long SOP repeats for every step; the attributes are complete either way.
- **Versions protect against overwriting.** Every change needs `expectedVersion`, the version you last read. A `version_conflict` means someone changed the record: read it again with `records.get`, re-apply your change, and retry.
- **Nothing is deleted.** Active records are archived (`records.archive`, undone by `records.unarchive`; both are proposed when an agent asks). Only unlinked drafts can be deleted (`records.delete_draft`), with their history: you delete directly only your own draft (you alone wrote every version, for the person you work for, and nothing is confirmed); deleting anything another agent or a person wrote or confirmed is proposed.
- **History is complete.** `records.history` returns every version with its actor and reason; `records.restore` makes an old version current again as a new version.
- **Skills.** Each module has a skill like this one. `skills.list` lists them; `skills.get {name}` (e.g. `"sops"`) reads one in full. Over MCP they are also resources at `skill://<module>`. Read a module's skill before you first work in it.
- **Kinds first.** `records.kinds` lists the kinds this lab can hold, with each kind's attribute JSON Schema. Read it before `records.create`. It is long: `{"summary": true}` lists the kinds with their sections and keyed lists only, and `{"kinds": ["sop"]}` gives the schemas of the kinds you name.
- **Finding operations.** `operations.describe` lists operations with their schemas, by `namespace` (e.g. `"sops"`), `ids` or `calculators: true`; `schema: false` lists only IDs and summaries, which is how to scan a large namespace before asking for the schemas you need by `ids`. The in-app assistant names only a core set of tools (records, review, skills, calculators and the module of the person's page) and runs the rest with `run_operation`.
- **Finding records.** `records.list` returns records newest first; filter by `kind`, `status` or `search` (label or readable name). Archived records appear only with `status: "archived"`. To name many records at once (what a plate's wells hold), pass up to 500 `ids`: those come back in any status.
- **Say where values came from.** Every value you set is marked "assumed" until a person confirms it. If a value comes from a source, pass `evidence` with the create or update: `{"volume": {"source": "datasheet", "reference": "https://…", "note": "p. 2"}}`. Sources: `stated` (the person you work for told you the value), `datasheet`, `imported`, `measured`, `calculated` (with `calculation`, the handle a calculator returned, and `output`, a JSON pointer into its output when the value is one part of it; the record service checks the value against it), `record` and `template` (with `from: {id, version, path?}`, the confirmed record you copied it from; the record service checks that the version exists and was active and, with `path`, that the value there is the one you set), or `assumed`. `memory` is refused until lab memory is built. Never name a source you did not use. A `datasheet`, `measured` or `imported` value you name is shown to the person as unchecked: they confirm it record by record, not in a batch.
- **Lists keyed by item.** Some kinds key a list's items (an SOP's steps by `id`, variables by `name`, materials and solutions by `role`, questions by `id`). Each item keeps its own evidence and confirmation: change one step and the person sees that step, not the whole list, as changed when they confirm. Evidence can name one item as `"/steps/<id>"`; evidence named for the whole list applies to the items you changed.
- **People confirm a draft with one Confirm.** Kinds listed with `sections` in `records.kinds` group their values in those sections, and readiness reports each one. `records.readiness` says which sections are confirmed, which values changed since they were confirmed, which are still assumed, and which checks fail (with a fix, and sometimes `options`: ways to fix it in one step, best first, each `{label, consequence, operation, input}` with the complete input, record and version included; run the one you recommend with `run_operation`, or name them to the person), and which attributes don't apply to the record as it stands (`notApplicable`; don't fill those in). Your changes to a confirmed value send its section back to review. A person's own edits confirm the sections they change unless one of your unconfirmed values is left in them (ADR 0056), so a person you work for may find a section confirmed after fixing it. Only people call `records.confirm` (every section at once, the one Confirm on a record's page; for a kind without sections it makes the draft active) and `records.confirm_section` (one section, under the page's technical details). Confirming activates the draft when no blocker check fails. `records.activate` is refused with `not_ready` until every section is confirmed and no blocker check fails; tell the person what is missing. You can't create such a record active.
- **What waits for people.** `review.list` returns everything waiting for a person: drafts (with the sections left to confirm, the failing blocker checks as `blockers`, and `missing`, both together) and proposed changes. Its `counts` come first and give the totals (per kind for drafts), so they survive a cut; the list holds at most 200 drafts, newest first, `limit` lists fewer items, and `kind` lists one kind's drafts on its own. Use it to tell the person what needs them, with the totals. Each item has a `tier` (`needs_you` for proposed changes, `to_confirm` for drafts and for documents whose library mentions need checking) and `for` (the person it is waiting on); `mine: true` lists only the caller's, and `counts.needsYou` is what the nav shows. Every record carries a one-line `summary` and a `readiness` summary (blockers, warnings, estimates, sections left) stored at its last write. A person can confirm a batch of drafts with `records.confirm_many`; Review offers it for the drafts that hold no assumed value, no unchecked value (`unchecked`: an agent's `datasheet`, `measured` or `imported` value, which the server can't check), no failing blocker check and no changed value (warnings are counted, not blocking). Agents can't call it.
- **Links.** `records.links` with `direction: "from"` shows what a record points to; `"to"` shows where it is used.

## Common refusals

Refusals come back as tool errors with `{code, message}`. The message says what to fix.

| Code | When | What to do |
| --- | --- | --- |
| `invalid_input` | The input doesn't match the operation's schema | Read the schema with `operations.describe {ids: [...]}` and send it again |
| `invalid_attributes` | The attributes don't match the kind's schema, or a quantity has no unit | Fix the fields the message names; read the kind with `records.kinds {kinds: [...]}` |
| `invalid_input` on evidence | A `calculated`, `record` or `template` source doesn't hold the value you set, or names a version that was never active; `memory` is not accepted yet | Name the source you really used, or leave the value assumed |
| `version_conflict` | Someone changed the record since you read it | `records.get` again, re-apply your change, retry with the new `expectedVersion` |
| `not_ready` | The draft still needs a person, or a blocker check fails | Tell the person what the message lists |
| `invalid_state` | E.g. editing an archived record, confirming one already active | Read the record's status first |
| `linked` | Something still uses the record you tried to delete | Archive it instead, or ask |
| `not_found`, `unknown_kind` | No such record in this lab, or no such kind | Look it up with `records.list` or `records.kinds` |
| `forbidden` | People-only operations (confirm, approve, reject) | Ask the person to do it on Review |

## Example

```json
{"operation": "records.create", "input": {"kind": "product", "label": "PBS, 10x", "attributes": {"category": "buffer", "origin": "bought", "form": "liquid", "storage": {"min": {"value": "15", "unit": "degC"}, "max": {"value": "25", "unit": "degC"}}}, "evidence": {"storage": {"source": "datasheet", "reference": "https://example.org/pbs-10x.pdf"}}, "reason": "Needed for the ELISA wash buffer"}}
```
