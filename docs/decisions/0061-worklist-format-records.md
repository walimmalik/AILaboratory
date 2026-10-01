# 0061: Worklist formats are records filled by one generic writer

- Status: accepted
- Date: 2026-10-01
- Plan: 016 (016c-1)

## Context

Plan 016 T1 (A): the Hamilton STAR and Vantage, Mantis and PreciseDrop read whatever CSV the lab's own method or software reads, so each is a **worklist format** record drafted by the agent from an example file and confirmed by a person, then used by one generic CSV writer. A new lab method is a new format record, not a code change. T5 (A): each method declares how it handles tips. The examples are the mocks in `seed/worklists/` until real exports exist.

## Options

1. A format as a free template string with placeholders.
2. A format as typed columns: each column a header and one value from a fixed list (plate name, barcode, labware, type, well, volume, unit, liquid class, liquid, new tip, row number, fixed text), with well naming and new tip spellings per column; two layouts, rows and grid.

## Decision

Option 2.

- `worklist_format` (`wlf_`, WLF-0001) holds the instrument kind whose method reads it, the method's name, the layout, the volume unit, the tip behaviour (`none`, `new_each`, `per_source`, or `column` when the file has a new tip column the method obeys) and the example file it was drafted from.
- `rows` writes a header and one row per transfer in plan order (STAR, Vantage, PreciseDrop). `grid` writes one volume grid per destination plate and source well after a few preamble lines, with a fixed text for empty wells (Mantis); volumes into the same well add up.
- Wells read as A1, or as a position counted down columns or along rows (Hamilton tube racks). Labware reads the type's `hamiltonLabware` when it has one; the liquid class reads its `platformName`.
- `worklists.draft_format` checks the headers against the example file when one is given and refuses a mismatch, saying where. Every write refuses a format the writer can't fill (a constant without text, a new tip column without `tips: column`, a rows format without volume or destination well).
- A person confirms it with `records.confirm`, like every other record, so there is no separate `worklists.confirm_format`. A group pins a confirmed version with `transfers.set_instrument`; readiness blocks an unconfirmed format or one for another instrument kind (`worklists_fit`), and reports a newer confirmed version.
- `transfers.export` writes the pinned format for the group's transfers, one file per grid or one for rows, stored with the plan version like the Echo and Opentrons files.

## Consequences

- Adding a lab method needs an example file and a confirm, no code. A method whose file needs something outside the value list (a computed column, several reagents in one grid) needs a new value in code.
- FeliX has no per-well worklist in the lab yet, so it gets none until an example exists.
- Tips follow the method (T5): a format that fixes them (`none`, `new_each`, `per_source`) decides the group's tip count; with `column`, the group's rule fills the file. `worklist_tips` (warning) says when a method keeps a tip after it touched liquid already in a well, or ignores a tip rule the group sets (016c-2).
- The seed drafts the four mock formats from `seed/worklist-formats.yaml`, each marked assumed and checked against its example (016c-2).
