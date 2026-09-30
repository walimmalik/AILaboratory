# 0046: SOP values take their kind from their text, and an SOP is confirmed once

- Status: accepted
- Date: 2026-09-30
- Plan: 012

## Context

The SOP editors from plan 012d (and the rework in PR 72) asked a person to classify each value before writing it ("What is this value?", four choices opening different fields), wrote formulas as `[Well volume] × [Wells]` with rows of operator and function buttons, and entered a step's words, its settings and the materials it uses separately, so the same fact was typed twice. In a step's words a variable read like any other word. Wali found it too much form and asked for real inline color coding, no operator buttons, hover cards that say how a value is worked out, and the assistant filling in formulas and steps. The confirm flow had one Confirm per section, eight for an SOP.

Storage is not the problem: `SopVariable.kind`, `expression`, `readFrom` and the formula language (ADR 0036) serve agents and the calculator well, and agents already write them.

## Options

1. **Derive the kind from what is written, keep the stored form.** One text box per value: a number or list is a usual value (or chosen each run, one checkbox), `Material.field` is read from that material, anything else is a formula. The editor writes the same fields an agent writes. Step words mark values and materials by lab name; the materials a step uses and the settings its words state are read from them.
2. Change the schema so a value is just its text, parsed on read: one field instead of four, but every reader (calculator, digitizer, benchmark, reviewer, experiments) would parse text, and agents lose the typed form.
3. Keep the kind as a choice and only restyle the editors: less change, but the classification step Wali objected to stays.

For confirming:

1. **One Confirm per SOP** that confirms every section that is ready, with the readiness list beside it; per-section state stays in the data and in technical details.
2. Keep one Confirm per section.

## Decision

Option 1 in both.

- **A value's kind is derived from its text** in the editor (`apps/web/src/lib/sop-text.ts`): empty or a number, an amount or a list is `default` (or `input` when "Ask each run" is ticked); exactly `Material.field` is `record` with `readFrom {role, field}`; anything else is `computed` with the formula in the calculator's text. Names are matched by lab name, longest first, at word edges, case-insensitively in a formula, so no brackets are needed (brackets and technical names are still read). A material's field inside a larger formula is refused with the fix in words (add it as a value of its own), because the calculator reads values, not records. The kind shows as two small words next to the value ("usual value", "worked out", "read from Capture antibody", "asked each run").
- **Step words keep `` `name` `` in storage** and show lab names in the box, matched as written (so "wells" in a sentence is not the value "Wells"). When the words change, the step's `uses` become the materials named, and a setting is read when the words state exactly one amount of its kind (a volume, a time, a temperature, a speed, a concentration, a wavelength, or "room temperature"). What the words never stated, an agent's or one set under More, is kept.
- **One box** serves formulas and step words: a textarea with transparent text over a mirror that paints the same characters, so typing, selection, undo and screen readers stay the browser's own. No library.
- **Hover cards** on a value or material, in the box and at the bench, say its formula, the values it uses as they are now, its value now and where it came from, its kind and source passage; a material says its type, requirements, usual record and the values it gives. Numbers come from `sops.evaluate` while editing and `sops.calculate` at the bench, never from the browser (ADR 0024).
- **At the bench**, a number that comes from a value keeps the value's color with a dotted underline, a material its own; a switch shows names instead of numbers.
- **One Confirm per SOP** confirms every section that is ready at once, as the person; each section still gets its own confirmation record, and a section with a failing blocker or open question stays unconfirmed and is named. It is a generic people-only operation, `records.confirm`, rather than one `records.confirm_section` call per section from the browser, so the confirm is one version and one history entry, and any kind with sections can use it.
- **Edit is the whole SOP, one form and one Save**, with where the values came from beside Save. Materials are one line each like values. Questions stay with their own block (a person answers them), and the source is not edited in the form.
- **The assistant fills in on request** through `sops.suggest`: a value, a step's settings and uses, a new step from a sentence, or every step from the source. It is a read: the answer is checked like the record would check it (the calculator for formulas, the SOP's materials and values for steps) and returned, never written. The editor shows it in agent ink with the model's reason until someone changes it; saving it is the person's edit, made after seeing it marked.

## Consequences

- No schema or migration changes; two operations are added (`records.confirm`, `sops.suggest`) and the SOP's parts are titled Values and Steps in readiness (ids unchanged); agents keep writing `wells * well_volume * 1.1` and `` `well_volume` ``, and the benchmark and reviewer are unaffected.
- A lab name that is also an ordinary word in a step (a material called "Plate") will be marked in the words after an edit. It shows in color as it is typed, so the person sees it; step words match names only as written to keep this rare.
- A setting stated twice in one step (two volumes) is not guessed; it is left to the person or the assistant under More.
- The editor treats a value's text as the source of its kind, so switching a formula to a number changes its kind without a separate choice; the change is in the record's history like any edit.
