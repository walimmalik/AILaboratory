---
name: ailab-platemaps
description: Work with plate layouts and plate maps in AILaboratory through its MCP tools: draft a layout template (what goes in which wells, controls, standards, replicates, placement, edges, analysis groups), preview how many subjects fit, apply a layout to real samples or compounds as a plate map, edit wells by hand and export the map as CSV.
---

# Plate layouts and plate maps in AILaboratory

A **layout template** is the lab's reusable plate pattern for one format: which wells hold subjects, which hold controls, blanks or a standard curve, how replicates sit, how subjects are placed and how analysis groups the wells. It never names samples; a plate map applies it to real subjects. Plan 014; see docs/architecture/plate-maps.md.

## Drafting a layout

`layouts.draft` with:

- `label`, `wells` (6, 12, 24, 48, 96, 384 or 1536; a layout is for one format) and `subjectRole` (`sample`, `compound`…).
- `subjectRegion` in lab words: `["columns 3-22"]`, `["A1:H6"]`, `["rows A-D"]`. Left out, subjects take every well not fixed.
- `subjectConcentration` for a single point, or `subjectSeries: {top, factor, points, direction?}` for a dilution series per subject ("10-point 3-fold from 10 µM" is `{top: {value: "10", unit: "uM"}, factor: "3", points: 10}`). Not both.
- `fixed`: regions repeated on every plate, each `{id, role, label, region}` with an optional `concentration`, `series` (a standard curve) and `replicates`. Add a `subject` only for a standing control the lab always uses.
- `replicates` with `arrangement` (`side_by_side`, `down_column`, `another_plate`), `fillOrder` (`row` or `column`), `strategy` (`in_order`, `randomized_within_plate`, `balanced_across_plates`), `edge` (`use`, `empty`, `buffer`) and `leftover` (`empty`, `neutral_control`, `buffer`).
- `groups` for analysis: `{id, label, roles, by: "subject" | "subject_and_point" | "plate"}`, e.g. a curve per compound or Z' per plate.
- `evidence` for where values came from; values you chose yourself are assumed.

A layout that can't work on its plate (a region off the plate, two regions sharing wells, a series that doesn't fit the subject region) is refused with the reason. Fix what it says and draft again. A layout without controls or standards drafts, with a warning in `records.readiness`.

## How many fit

`layouts.preview` `{layout, subjects}` (or `{attributes, subjects}` to try a layout without saving it) returns `perPlate`, `plates` and every planned well with its role, subject, replicate, series point and concentration. Use it instead of counting wells yourself, and quote its numbers. Randomized and balanced strategies need a `seed`.

## Changing and confirming

A layout is a design: change it with `records.update` and a person confirms it section by section (`records.confirm_section`). Only confirmed layouts are used downstream.

## Plate maps

- `platemaps.draft` `{label, layout, subjects: [{record, label?}], experiment?, purpose?, labware?: {id, version}, controls?: [{region, record}], strategy?}` applies a layout to real subjects in the order given. The layout's current version is pinned (`layoutVersion` to pin another). Use a confirmed layout; a draft one blocks confirming the map. Name what goes in each control region with `controls` (the region is the layout's fixed region id, e.g. `dmso`).
- `platemaps.wells` `{id}` returns every well, plate by plate, with role, subject and its name, replicate, series point and concentration. Read it rather than working positions out yourself.
- `platemaps.override` `{id, expectedVersion, overrides: [{plate, well, role, subject?, note}]}` changes wells by hand; `clear: [{plate, well}]` removes hand edits. Say why in `note`. On a confirmed map it is a proposal.
- `platemaps.export` `{id}` gives the CSV (`filename`, `csv`). Hand big exports over as a file, not pasted in chat.
