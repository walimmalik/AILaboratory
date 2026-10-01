# 0061: Areas with tabs, one inventory view, and record pages that lead with facts

- Status: accepted
- Date: 2026-10-01
- Plan: 004f

## Context

The web app grew one menu entry per record kind: 30 entries, with every kind and its items on separate pages (products and lots, entities and samples, instrument models and instruments, layouts and plate maps). Record pages rendered the schema: fields in schema order, sections folded to bookkeeping on confirmed records, a source column repeated on every row, and links as a "points to / used by" table. One page could say "active", "confirmed", "in use" and "unverified" with no rule between them. Wali asked for fewer, linked views, with key information readily available and details under tabs.

## Options

1. Areas with tabs (eight menu entries), a single inventory view, and one record page frame (identity line, key facts, the record's picture, then fixed tabs): fewer places to look, but every kind needs its facts chosen by hand.
2. Keep the per-kind pages and collapse the menu groups: less work, but the pairs stay split.
3. Keep the pages and fix wording only: cheapest, and leaves the complaints standing.

## Decision

Option 1, as decided in plan 004f (N1 to N8):

- The menu is Today, Review, Activity, Scan, Experiments, Inventory, Instruments and Library, plus Calculators, Wiki and All records at the foot. Each area is one page with tabs. A new capability's plan says whether it becomes a menu entry, a tab in an area, a tab on a record page, or a fact on the Overview.
- Inventory lists everything physical with what it is: products with their lots, entities with their samples, containers, filtered by place. A product and an entity share a row only when linked.
- Every record page has an identity line, key facts chosen per kind and the record's own picture, then the tabs Overview · the kind's tabs · History · Connections · All fields. Confirmed content is open. The identity line and facts come from the API (`records.overview`) so agents read the same summary.
- Plate maps have no menu entry: they live in their experiment and on their layout (014 P3's two kinds stay).
- Links show on a Connections tab in two columns, "Based on" and "Used in", grouped by relation in words.
- Sources are said once per section; a value nobody sourced is marked wherever it shows.
- Three state vocabularies: the record's review state in the header, the physical thing's state in the identity line, a value's source beside values only.

## Consequences

- Old paths (`/lots`, `/samples`, `/plate-maps`…) must open the matching tab so links in history, chat and the wiki keep working.
- Each kind needs a summary definition (identity line and facts) in the API; a kind without one falls back to its kind, its one-line summary and its simple top-level values, and a test lists the kinds that use the fallback, so a new kind is a deliberate choice.
- Inventory needs one read operation joining products, lots, entities, samples, contents and places (`inventory.overview`), named in the inventory skill.
