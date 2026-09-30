# 0047: Workcells are member instruments mapped to the twin

- Status: accepted
- Date: 2026-09-30
- Plan: 008

## Context

Plan 008 round 2 (I10 to I15, answered by Wali 2026-09-30) settled that a workcell is a list of registered instruments, each mapped to a device in the echo650-twin workcell, with no 2D layout, docks or reach tables: the twin holds everything physical. An instrument is in at most one confirmed workcell (I9), and each member says whether people can also use it by hand (I15). The build had to decide where the I9 rule is enforced, how an unverifiable twin mapping shows, and which operations exist beside the generic record ones.

## Options

For I9:

1. Refuse any write that puts an instrument in two workcells: this would stop drafts that plan another arrangement from the same instruments, which I9 allows.
2. Allow drafts to share instruments; a readiness blocker stops confirming a workcell while a member is in another confirmed one.

For the twin mapping before the twin connection (015):

1. Require the twin device list and refuse unknown devices: impossible until 015.
2. Record the mapping as given; readiness requires a twin workcell and a device per member (blocker) and warns that the mapping is unchecked until 015.

## Decision

Option 2 in both cases. The `workcell` kind (`wcl_`, `WCL-0001`) has one section, Members (`twin`, `members`, `notes`); each member is `{instrument, twinDevice?, byHand}`. Writes refuse members that are not instruments in the lab, listed twice, or sharing a twin device. Readiness blockers: every member confirmed, no member in another confirmed workcell, twin workcell and every twin device named; a warning says the mapping is not checked against the twin yet. Operations: `workcells.draft`, `workcells.change_members` (set or remove by instrument; an agent's change to a confirmed workcell is a proposal) and `workcells.of_instrument` (the confirmed workcell using it, and drafts planning it; none means standalone). Getting, searching and confirming use the generic `records.*` operations.

## Consequences

The scheduler (019) reads confirmed workcells and `byHand` to book members manually when the workcell isn't using them. When 015 lands, the twin check replaces the warning with a real comparison both ways. Two confirmed workcells can't share an instrument, but nothing stops archiving one and confirming another, which is how the lab rearranges.
