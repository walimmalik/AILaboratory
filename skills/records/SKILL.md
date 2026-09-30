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
- **Active records need a person.** Creating an active record, editing or restoring an active record, and activating, archiving or unarchiving all come back as `{"status": "proposed", "proposal": {…}}`. The change has not happened. Tell the person what you proposed and why; they confirm or reject it on the Review page. Always pass a short `reason` so they know why.
- **Several changes that belong together go in one change set.** `changes.apply` with `{steps: [{operation, input}], reason}` runs them in order, all or nothing. A later step can use an earlier step's output: `"$1.id"` is the id step 1 returned. If any step needs a person, the whole set comes back as one proposal the person confirms or rejects as one, so nothing is left half done. If a step fails, the error names it and nothing changed.
- **Preview first when unsure.** `preview: true` returns exactly what would happen, and saves nothing.
- **Edits replace all attributes.** `records.update` takes the complete new `attributes`, not only the changed ones: read the record, change what you need, send them all back.
- **Versions protect against overwriting.** Every change needs `expectedVersion`, the version you last read. A `version_conflict` means someone changed the record: read it again with `records.get`, re-apply your change, and retry.
- **Nothing is deleted.** Active records are archived. Only unlinked drafts can be deleted (`records.delete_draft`).
- **History is complete.** `records.history` returns every version with its actor and reason; `records.restore` makes an old version current again as a new version.
- **Kinds first.** `records.kinds` lists the kinds this lab can hold, with each kind's attribute JSON Schema. Read it before `records.create`.
- **Finding records.** `records.list` returns records newest first; filter by `kind`, `status` or `search` (label or readable name). Archived records appear only with `status: "archived"`. To name many records at once (what a plate's wells hold), pass up to 500 `ids`: those come back in any status.
- **Say where values came from.** Every value you set is marked "assumed" until a person confirms it. If a value comes from a source, pass `evidence` with the create or update: `{"volume": {"source": "datasheet", "reference": "https://…", "note": "p. 2"}}`. Sources: `stated` (the person you work for told you the value), `datasheet`, `imported`, `measured`, `calculated` (with `calculation`, the handle a calculator returned, and `output`, a JSON pointer into its output when the value is one part of it; the record service checks the value against it), `record` and `template` (with `from: {id, version, path?}`, the confirmed record you copied it from), or `assumed`. Never name a source you did not use.
- **Lists keyed by item.** Some kinds key a list's items (an SOP's steps by `id`, variables by `name`, materials and solutions by `role`, questions by `id`). Each item keeps its own evidence and confirmation: change one step and only that step needs review again. Evidence can name one item as `"/steps/<id>"`; evidence named for the whole list applies to the items you changed.
- **People confirm drafts section by section.** Kinds listed with `sections` in `records.kinds` are reviewed in those sections. `records.readiness` says which sections are confirmed, which values changed since they were confirmed, which are still assumed, and which checks fail (with a fix, and sometimes a `quickFix` naming an operation that takes `{id, expectedVersion}` and fixes it in one step), and which attributes don't apply to the record as it stands (`notApplicable`; don't fill those in). Changing a confirmed value sends its section back to review. Only people call `records.confirm_section` and `records.confirm` (every section at once). Confirming the last section activates the draft when no blocker check fails. `records.activate` is refused with `not_ready` until every section is confirmed and no blocker check fails; tell the person what is missing. You can't create such a record active.
- **What waits for people.** `review.list` returns everything waiting for a person: drafts (with the sections left to confirm and what is missing) and proposed changes. It lists at most 200 drafts, newest first; `counts` gives the totals (per kind for drafts), and `kind` lists one kind's drafts on its own. Use it to tell the person what needs them, with the totals. Each item has a `tier` (`needs_you` for proposed changes, `to_confirm` for drafts and for documents whose library mentions need checking) and `for` (the person it is waiting on); `mine: true` lists only the caller's, and `counts.needsYou` is what the nav shows. Every record carries a one-line `summary` and a `readiness` summary (blockers, warnings, estimates, sections left) stored at its last write. A person can confirm a batch of drafts with `records.confirm_many` only when none holds an estimate, a failing check or a changed value; agents can't call it.
- **Links.** `records.links` with `direction: "from"` shows what a record points to; `"to"` shows where it is used.

## Errors

Refusals come back as tool errors with `{code, message}`. The message says what to fix. Common codes: `invalid_input` (fix the input to match the schema), `unknown_kind`, `invalid_attributes`, `not_found`, `version_conflict`, `invalid_state` (e.g. editing an archived record), `linked` (something still uses the record), `not_ready` (the draft still needs a person; the message lists what), `forbidden` (people only).

## Example

```json
{"operation": "records.create", "input": {"kind": "widget", "label": "Tip box", "attributes": {"color": "teal", "volume": {"value": "50", "unit": "uL"}}, "evidence": {"volume": {"source": "datasheet", "reference": "https://example.org/tipbox.pdf"}}, "reason": "Needed for the ELISA run"}}
```
