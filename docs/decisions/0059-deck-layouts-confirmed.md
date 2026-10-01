# 0059: Deck layouts are their own section of the transfer plan

- Status: accepted
- Date: 2026-10-01
- Plan: 016 (016b-4)

## Context

Plan 016 T6 (A): the plan drafts a deck layout per instrument step, checked against the instrument's current configuration, drawn as a 2D deck with a plain loading list. In 016b-3 the Flex export worked the deck out at export time, so nobody confirmed it. Wali asked (2026-10-01) whether the deck layout and the labware it uses are confirmed by a person. Labware types and the plan already were; the deck was not.

## Options

1. Keep the deck inside each group, confirmed with the Transfers section.
2. Keep decks in their own field, `decks` (one layout per Flex group), as a third section of the plan, **Deck layouts**, reviewed per group.

## Decision

Option 2.

- A layout is `{group, sites, free, trash}`: what goes on each slot (a plan plate, or a full rack of a pinned tip rack type), and the free slots and trash the Flex had when it was set, copied by code like a group's device limits.
- Code drafts it when a group is drafted or its instrument is set, and `transfers.set_deck` lays it out again or takes a person's or agent's sites (direct on drafts, proposed on a confirmed plan). When code can't lay a group out, it has none and readiness says why.
- Readiness blocks a Flex group without a layout, a layout that doesn't fit the group (free slots, plates used, tip racks for the tips it takes), unconfirmed tip rack types, and an unconfirmed instrument. `transfers.check` warns when the Flex changed since; the export refuses then.
- Export and `transfers.loading_list` read only the plan's layout, and export only from a confirmed plan, so what runs is what a person confirmed.

## Consequences

- The deck is reviewed on its own, and a change to one group's layout sends only that layout back to review; editing transfers does not silently move the deck (readiness flags a layout that no longer fits).
- Plans without Flex groups have an empty Deck layouts section, confirmed with the rest.
- Not yet: layouts for other instruments (Hamilton carriers with 016c), the 2D deck view (016d), and proposing a configuration change with its time cost when a layout needs something not installed (T6).
