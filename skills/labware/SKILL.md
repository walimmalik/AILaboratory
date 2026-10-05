---
name: ailab-labware
description: Draft, import, export and inspect labware types (plates, reservoirs, tubes, racks, tip racks, lids) in AILaboratory through its MCP tools.
---

# Labware types in AILaboratory

A labware type is a record of kind `labware_type` (readable names like `LWT-0001`). Create, edit, find and confirm them with the `records.*` operations (see the records skill); the `labware.*` operations add what records can't do. Read `records.kinds` for the full attribute schema.

## Drafting a type

When an SOP/assay needs a missing type, find existing types first (`records.list`), then draft the definition with the source evidence already available rather than asking the scientist to enter a form. Leave unsupported geometry/volumes absent and ask only the next consequential missing fact. A labware type is not a physical container; never invent barcodes, stock or locations. Readiness and human confirmation still apply.

- Create it with `records.create`, `kind: "labware_type"`, the product's full name as `label`, and what you know as `attributes`. Only `family` is required: `plate`, `reservoir`, `tube`, `rack`, `tip_rack` or `lid`.
- `manufacturer` is a vendor record ID (`vnd_…`). Find it with `records.list` (`kind: "vendor"`, `search`), or create one (`kind: "vendor"`, label = the company name, `attributes: {}`).
- Geometry is in mm (`{"value": "127.76", "unit": "mm"}`), volumes in `uL`, `mL`, `L` or `nL`.
- `wells` is a grid or an explicit list:
  `{"layout": "grid", "rows": 8, "columns": 12, "pitch": {"value": "9", "unit": "mm"}, "a1": {"x": {"value": "14.38", "unit": "mm"}, "y": {"value": "11.24", "unit": "mm"}}, "well": {"top": {"shape": "circular", "diameter": {"value": "6.86", "unit": "mm"}}, "depth": {"value": "10.67", "unit": "mm"}, "bottom": "flat"}}`.
  `a1` is the centre of A1 from the left edge (x) and the back edge (y). Square wells are `rectangular` with `xSize` and `ySize`; tapered wells add `base`.
- Say where each value came from in `evidence` (e.g. `{"footprint": {"source": "datasheet", "reference": "https://…"}}`). Values you estimate get no evidence and show as assumed. Leave out what you don't know rather than guessing; readiness lists it.
- Unknown attribute names are refused. Check the schema from `records.kinds` if you are unsure.

## Opentrons

- `labware.import_opentrons` takes an Opentrons labware definition (schema version 2, the JSON in Opentrons shared-data) and drafts a type with every value marked imported. It finds or creates the vendor. Trash, adapters and lids are refused.
- `labware.export_opentrons` returns a definition in the `custom_beta` namespace, for Opentrons' simulator or as custom labware. If the type is incomplete it refuses with `not_ready` and names what is missing. In the app the person gets the definition as a file to download, so don't paste it into your reply. People can also import a definition file from the Labware page.

## Standard well positions

- `labware.use_standard_positions` with `{id, expectedVersion}` sets the pitch and A1 offset of an SBS plate or reservoir to ANSI/SLAS 4-2004 (96, 384 or 1536 wells; 12- or 24-trough reservoirs). Use it when the datasheet gives no drawing and the type is marked SBS; it refuses other grids, non-SBS labware and a pitch that disagrees with the standard. The values are marked calculated from the standard, so a person still checks them against the datasheet.
- A failing check that can be fixed this way lists it in `options` in `records.readiness`, with the operation's whole input.

## Wells

`labware.wells` returns every well with its name and, when known, its centre (mm from the left and back edges). `order: "column"` (default) runs A1, B1, C1…; `"row"` runs A1, A2, A3….

## Review

A person confirms Identity, Geometry, Volumes and Instrument names; confirming the last one makes the type active, unless a blocker fails (outer size unknown, no wells, no maximum volume, non-standard SBS spacing, dead or working volume larger than the maximum). Use `records.readiness` to see what is left and tell the person. Checks that don't apply to the family are left out, and `notApplicable` lists attributes not to fill in (for a tube: pitch, A1 offset, SBS length and width).
