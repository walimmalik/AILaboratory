# 004f: Navigation, one inventory view and record pages

- Status: accepted. Added by Wali on 2026-10-01 ("why are reagents and lots different than inventory?", "the details tab throughout the app is not very useful or intuitive", "why are plate maps separate from layouts", "we need to think about how we organize our tabs better and unify and link things that are linked in less views"). N1 to N8 accepted by Wali the same day as recommended; for N6 he asked for better column names and chose "Based on" and "Used in".
- Extends: [004 Agent shell](004-agent-shell.md), [004e Review v2](004e-review-v2-and-agent-context.md) (ADR [0048](../decisions/0048-plain-words-on-contracts.md) values as people read them), [010 Inventory](010-inventory.md) (010e screens), [014 Plate maps](014-plate-map-designer.md) (P3 two levels stays)
- Takes over from the 2026-10-01 UX review, item 23: the 25-entry nav, "FIELDS · No fields." on vendors, the missing Where column on Lots, "Where in it" ending with the container's own label in Places and Scan, and the 404 record page.
- Source: the survey and mockups kept in the project files at `reviews/inventory-details-redesign/` (`proposal.md`, mockups `m0` to `m6` in night and day, `now/` with 26 screenshots of `main` at 6ffdf4d, and Fable's critique in `fable-critique.md`).

## Why

1. **The menu follows the database, not the work.** 30 entries in 7 groups, one per record kind. Each kind and its items sit on two pages (Reagents and Lots, Entities and Samples, Instrument models and Instruments, Layouts and Plate maps, Labware and Containers). "Do we have staurosporine, and where?" takes four pages.
2. **Record pages show the schema.** Fields in schema order with schema names; containers, lots, samples and vendors still use the old FIELDS block. A confirmed record folds every section to bookkeeping ("4 of 7 filled · confirmed by you 21:28:58"), so an experiment shows nothing of its question, subjects or protocol without clicks, and "empty · confirmed" reads as a contradiction.
3. **Sources, history and links are raw.** The source of each value sits in a far-right column and repeats on every row; the version history and the physical ledger are two tables; links are a "points to / used by" table of relation keys.
4. **State words collide.** One page can say "active", "confirmed", "in use", "sealed" and "unverified" with no rule for which means what.

## Decisions

Wali chose the recommended option (bold) for all eight on 2026-10-01.

| # | Question | Options | Recommendation and why |
| --- | --- | --- | --- |
| N1 | How is the menu organised? | A) **Eight plain entries (Today, Review, Activity, Scan, Experiments, Inventory, Instruments, Library) plus the foot (Calculators, Wiki, All records); each area is one page with tabs** · B) Keep the seven groups, one entry each until opened · C) Keep today's menu and only merge pairs | **A.** Each area answers one question (what am I running, what do we have, what can do it, what do we follow). Scan stays a big target for the bench; the find box in the top bar also takes a barcode, lot number or name. Wali added: **when a new capability arrives, decide on purpose whether it is a new menu entry, a tab in an area, or a tab on a record page** (see the placement rule below). |
| N2 | What goes in Inventory? | A) **Everything physical and what it is: reagents and kits with their lots, biological materials (cell lines, plasmids, compounds) with their samples, plates and tubes, filtered by a place tree** · B) Only physical stock; products and entities stay in Library · C) Today's pages plus a Where column | **A.** "Do we have it, where, how much, until when" is one question. Products and materials with nothing in stock stay findable under "Not in stock". |
| N3 | Are reagents and biological materials one list? | A) **One list with type as a filter; a product and an entity show as one row only when the records are linked, never by matching names** · B) Two tabs · C) Separate pages | **A.** People look things up by name, not by registry. The data stays two kinds (product rule 4); only the view merges them. |
| N4 | How is a record page laid out? | A) **Identity line, key facts and the record's own picture first; tabs in a fixed order: Overview · the kind's own tabs · History · Connections · All fields. Checks sit on the Overview** · B) One long page with every section open · C) Today's page with wording fixes | **A.** Key information readily available, detail under tabs, the same shape for every kind. |
| N5 | Plate maps and layouts? | A) **No Plate maps menu entry. A layout stays the lab's template under Library, Plate layouts; a plate map lives in its experiment (a Plates tab) and on its layout ("Plates made from it"); maps with no experiment are listed under Plate layouts with a filter. A plate map's page is its layout's page filled in, with the crumb "IL-6 ELISA, 96 wells → for EXP-0004"** · B) One merged Plates page · C) Merge the two kinds | **A.** 014 P3's two levels stay (templates stay clean, maps keep hand edits); only the menu split goes. |
| N6 | How do links show? | A) **A Connections tab with two columns, grouped by relation in words with dates, names first and codes as tags; the links that matter most also appear as facts on the Overview** · B) A drawn graph · C) Today's table with relations in words | **A.** Wali asked for better names than "what it is" and "where it went" and chose **"Based on" and "Used in"** over "Upstream / Downstream", "Inputs / Outputs" and a pair per kind: plain, short and true for every kind, with the relation words under each link (sold by, dissolved in) carrying the detail. |
| N7 | Where does a value's source show? | A) **Once per section in All fields ("Manufacturer from the lab's instrument list; 5 values entered by an agent with no source given"); a value with no source carries a small mark in agent ink wherever it shows, and tapping or hovering it says who entered it** · B) Beside every value · C) On hover only | **A.** The Overview is read for content, All fields when checking; a value nobody sourced is still visible at a glance. |
| N8 | Which words name which state? | A) **Three vocabularies, each in its own place: the record's review state in the header; the physical thing's state in the identity line; a value's source only beside values. "Unverified" is never shown on a confirmed record** · B) Fix clashes one by one | **A.** A written rule keeps new pages from mixing them again (Fable's main finding on the first mockups). |

## Rules this adds

Written into [web-app.md](../architecture/web-app.md) and the wiki's [UI page](../wiki/ui.md).

- **State words.** Record: draft, needs your review, confirmed, change waiting, archived (said once, in the header). Physical thing: unopened, opened, in use, sealed, empty, expired, quarantined, discarded (in the identity line). A value's source: measured, from the datasheet, calculated, from SOP-0003 v2, entered by you, no source given (agent ink when an agent entered it), only beside values. "Unverified" names a value with no source that nobody has confirmed; once a person confirms the section it reads "no source given".
- **Placement of a new capability.** A new menu entry only when it is a new area of work people go to on its own; a tab in an area when it is another kind of thing the area lists; a tab on a record page when it is more about one record; otherwise a fact or a block on the Overview. The plan that adds the capability says which, and why.
- **Every record leads with an identity line and its key facts,** chosen per kind, not taken from schema order. Codes are tags after names, never prefixes.
- **Confirmed content is open,** never folded to bookkeeping. Nothing filled reads "none" or "not chosen yet", never "empty · confirmed".
- **Reading width is capped** (about 1,200 px) so a value and its source stay together on wide screens.

## Build steps

Each step is one PR; each is useful alone.

| Step | Delivers |
| --- | --- |
| 004f-0 | This plan, its ADR, the rules above in web-app.md and the wiki |
| 004f-1 Record page frame | Identity line, key facts and tabs for every kind, from a `summary` the API returns with `records.get` (so agents read the same summary), replacing the FIELDS block and the folded Details block; reading width cap; sources once per section (N7); state words (N8) |
| 004f-2 Connections and one timeline | Relation words for every link, the two-column Connections tab, Based on and Used in (N6); versions and the physical ledger as one History timeline |
| 004f-3 Navigation | The eight entries and the area pages with tabs (N1); old paths open the matching tab |
| 004f-4 Inventory | One list grouped by what it is (N2, N3) with Where, amount left and earliest expiry, the place tree, the selected row's summary, bulk Move and Discard, agent-proposed rows in agent ink; one read operation `inventory.overview` so an agent sees the same view; the "Where in it" line shared with Scan |
| 004f-5 Overviews per kind | One PR each: experiment (stage steps and the design readable on arrival), plate layout and plate map (N5), container, lot and product, sample and entity, instrument and model, labware type, vendor |

Before 004f-1 and 004f-4 are built, the draft state of the new frame (an agent-proposed lot) and the narrow layout of Inventory are mocked and shown to Wali with the PR.
