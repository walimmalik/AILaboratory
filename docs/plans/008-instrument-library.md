# 008: Instrument library

- Status: round 1 accepted by Wali 2026-09-29 (I1 to I6 as recommended; I7 to I9 answered in the table). 008a to 008c built. Round 2 (workcells, I10 to I15) answered by Wali 2026-09-30. 008d-1 built (workcell record and operations, ADR 0047); the seed correction and workcell page are next.
- Depends on: 002 (records), 003 (operations), 004c (draft-and-confirm), 007 (labware types, for site compatibility)
- Feeds: 009 (liquid classes per instrument kind), 015 (twin port binds twins to these records), 016 (transfer binding and worklists), 019 (scheduler resources), 022 (device gateway implements the same capabilities)

## What this plan delivers

A registry of the lab's instruments that the scheduler, the transfer designer, the twins and later the device gateway all read from:

- **Instrument kinds:** the model (Hamilton STAR, Opentrons Flex, Echo 650, a plate reader model), with specs, mounts, sites and the capabilities it can offer.
- **Equipment kinds:** the parts that attach to instruments: Flex pipettes, gripper and modules, STAR carriers, heads, adapters.
- **Registered instruments:** the real machine in the lab (serial, room, name "Flex 1"), with its **current configuration**: what is installed where, versioned with full history.
- **State:** status (ready, in use, maintenance, out of service), last service and calibration due, live state later from twins or the gateway.

An agent can register a new instrument from a model name or datasheet, or describe a configuration change ("we moved the heater-shaker to C1"), and a person confirms it.

## Starting point: echo650-twin

echo650-twin's `DATA_MODEL.md` and `CONFIGURATION_MODEL.md` already solve the hard part, and this plan adopts their shape:

- **One equipment graph for fixed and swappable instruments.** The instrument is the root node; modules, pipettes, carriers and adapters are nodes attached to named **mounts**. A mount's layout is fixed, slots (Flex deck A1 to D3, pipette mounts left and right), a rail (STAR's 54 tracks, a carrier chooses its start track) or a free surface. A STAR and a Flex differ only in their definitions and number of nodes.
- **Resolving a configuration** gives the sites (where labware can sit), installation claims (a thermocycler takes A1 and B1; a 96-channel head takes both mounts), capability providers with their limits, and validation issues. The resolved result is derived, never edited.
- **Capabilities come from the resolved instrument, not the model name.** An uninstalled gripper can't move plates; a different pipette changes volume limits and channel patterns.
- **Separate layers that are easy to blur:** installed equipment, operating defaults (A4S seal at 175 °C for 3 s), per-run setup (which plate is on which site), runtime state (current temperature) and simulation parameters (heating rate). Override order for defaults: kind default, instrument profile, saved method value, explicit call.
- echo650-twin's STAR and Flex validators (footprint overlap, carrier overlap, allowed module slots, pipette mount combinations) are ported as the configuration validators.

What changes here: echo650-twin stores definitions in code packages and documents in SQLite. Here they become records with history, confirmed by a person, with the kinematics, collision shapes and visuals staying in the twin packages (see I1 and I2).

## Proposed model

| Layer | Record | Holds |
| --- | --- | --- |
| Kind | Instrument kind (`ink_`, `INK-0001`) | Manufacturer, model, category, specs, mounts with their layouts and who can change them, built-in sites, capability providers with limits, operating settings schema, footprint and utilities, optional twin model and driver IDs |
| Kind | Equipment kind (`eqk_`, `EQK-0001`) | Carriers, modules, pipettes, heads, grippers, adapters: what mount they attach to, what they occupy, sites and capabilities they add |
| Instance | Instrument (`ins_`, `INS-0001`) | Name, serial, room and bench, owner, status, current configuration (the equipment graph), operating profile, service and calibration dates |
| Instance | Equipment item (`eqp_`, `EQP-0001`), only if I4 is B | Serial-bearing parts that move between instruments (a Flex pipette, a heater-shaker) with their own calibration |
| State | Instrument state | Status, current configuration version, live state from the twin or gateway later |

**Capabilities** (liquid transfer, dispense, aspirate, move labware, seal, peel, read absorbance, fluorescence or luminescence, incubate, shake, centrifuge, heat or cool, wash, image, store) are contracts: meaning, inputs, outputs and units. Each instrument or equipment kind declares which it provides and its limits (volume range and quantum, temperature range, wavelengths, labware it accepts). Method steps in digital SOPs (012) name capabilities; binding to a machine happens later (000 idea 1.5).

**Site compatibility** uses labware geometry from 007: a site accepts footprint classes with height and skirt limits, plus explicit allow and deny lists for known exceptions.

## Operations (first cut)

| Operation | Agents |
| --- | --- |
| `instruments.draft_kind`, `instruments.draft_equipment_kind` | direct (drafts) |
| `instruments.register` (new instrument of a kind, with a starting configuration) | proposed |
| `instruments.change_configuration` (place, move or remove equipment; typed changes, validated against the whole graph) | direct on drafts, proposed on active instruments |
| `instruments.set_operating_values`, `instruments.set_status`, `instruments.log_service` | proposed |
| `instruments.resolve` (sites, claims, capabilities and issues for a configuration or a proposed change) | read |
| `instruments.find_capable` (which instruments can do capability X with these parameters and this labware) | read |
| `instruments.get`, `instruments.search`, `instruments.history` | read |

## Screens

- **Instrument list:** every instrument with its lamp (ready, busy, maintenance), room, what it can do, and calibration due.
- **Instrument page:** a 2D top-down deck view drawn from the resolved configuration (Flex slots, STAR tracks and carriers), installed equipment, capabilities with their limits in plain words, service history, and configuration history with a diff between versions.
- **Configuration change:** the deck view in design mode. The agent proposes a change ("put the magnetic block in D2"), the page shows what moves, what becomes invalid (for example a method whose layout needs the old slot) and the confirm button.

## Round 1 decisions

Wali chose A, B, A, B, A, A for I1 to I6 on 2026-09-29, the recommended option each time.

## Round 1 questions and answers

| # | Question | Options | Recommendation and why |
| --- | --- | --- | --- |
| I1 | Are instrument and equipment kinds data or code? | A) Records (data) with typed schemas, so an agent can add a new plate reader from a datasheet; twin and driver code attach optionally by ID · B) Code packages only, like echo650-twin | **A.** Most instruments in a lab will never have a twin or a driver, but the scheduler and designers still need to know what they can do. Kinds with a twin or driver name the package that implements them, and that package's validators still run. |
| I2 | How much of echo650-twin's definition model do we adopt now? | A) All of it: frames, joints, collision shapes, visuals, configuration graph · B) The configuration graph, mounts, sites, capability providers and operating profiles now; frames, joints, collision and visuals stay in twin packages and arrive with the twin port (015) · C) Only specs and a capability list | **B.** B is what the registry, transfer designer and scheduler need, and it maps one-to-one onto echo650-twin's `CONFIGURATION_MODEL.md`. Motion and rendering are twin concerns. |
| I3 | What is an instrument's configuration? | A) What is physically installed now, including STAR carriers and Flex modules and pipettes, versioned; each mount says who can change it (factory, service engineer, operator between runs, robot) and roughly how long it takes; a method's deck layout (016) is checked against it and a mismatch becomes a proposed change with its time cost · B) Only the fixed hardware; carriers and modules belong to each method's layout | **A.** It matches reality: Venus and Opentrons protocols both declare what they need, and the machine has what it has. The scheduler can then see that switching the Flex from a thermocycler run to a heater-shaker run costs an operator time, for example 10 minutes (an estimate until we measure it). |
| I4 | Do swappable parts get their own records? | A) Every installed part is a record · B) Only parts with a serial that can move between instruments (Flex pipettes, gripper, modules) are records; carriers and adapters are nodes that just name their kind · C) Nothing is a record; serials are fields on nodes | **B.** A pipette moved from Flex 1 to Flex 2 keeps its identity and calibration; a plate carrier doesn't need its own history. Every node names its kind and optionally the item it is, so there is one shape. |
| I5 | Where are capability contracts defined? | A) In code (`packages/schema`), versioned with the app, because twins, compilers and the gateway implement them; limits per kind are data · B) As lab-editable records | **A.** A capability is a promise code has to keep; a lab editing its meaning would silently break simulation and execution. Adding one is a small PR, and agents can propose it. |
| I6 | Do manual work and people appear here? | A) Yes: manual stations (bench, biosafety cabinet, hand multichannel, manual plate sealer) are instrument kinds whose capabilities are done by a person, and the scheduler (019) adds operator availability · B) No, only automated instruments | **A.** Most ELISA steps are manual. Without manual stations the first end-to-end ELISA can't be scheduled, and a digital SOP step can bind to "a person at the bench" as easily as to the STAR. |
| I7 | Which instruments do we model first? | Answered by Wali 2026-09-29 (in the seed-data thread) | **The lab's own instruments:** Opentrons Flex, Labcyte/Beckman Echo 650, Hamilton STAR, Hamilton Vantage, Formulatrix MANTIS, Dispendix PreciseDrop II, Tecan Spark Cyto, BlueCatBio washer, Analytik Jena CyBio FeliX, Analytik Jena qTOWER, Bio-Rad thermocyclers, HighRes FlexPod, HighRes MicroSpin, HighRes LidValet and PlateOrient, Thermo Cytomat 10 C, plus the manual stations from I6. This adds capabilities beyond the first list: delid and relid, rotate plate, qPCR, cell imaging, centrifugal washing. The FeliX has exchangeable heads and the Vantage is modular, so both use swappable mounts like the Flex. |
| I8 | Where do workcells and mobile pods go? | Answered by Wali 2026-09-29: yes, and workcells are configured from the instruments we have | **A, extended.** A workcell is a design document built from registered instruments: which instruments and FlexPods it contains, where each pod docks, the transport robot, and which sites that robot can reach. An agent drafts it, a person confirms it, and the scheduler (019) uses confirmed versions only. It gets its own step, 008d, with a deck-style layout view. |
| I9 | Can an instrument belong to more than one workcell? | Answered by Wali 2026-09-29: A | **A.** An instrument is in at most one physically active workcell at a time; draft workcells can plan other arrangements from the same instruments. An instrument that is not in the active workcell is available standalone (a person loads it, or it runs on its own), and the scheduler books it that way. Confirming a workcell that pulls in a standalone instrument shows what bookings and methods that affects. |

## Round 2: workcells (008d)

Asked and answered 2026-09-30. Wali's direction: a workcell is just a combination of instruments. We list which instruments are in it and map them to the digital twin; the twin is the physical layout. No 2D layout, coordinates, docks or reach tables in the registry.

### Model (from the answers)

- **Workcell** (`wcl_`, `WCL-0001`), a design document (I8): a name, the **member instruments** (registered instruments, I9), for each member the **device in the twin** it maps to and whether it is **also usable by hand** (I15), and the **twin workcell** it maps to (an echo650-twin workcell definition, by ID, like `twin` on instrument kinds). An agent drafts it, a person confirms it, and the scheduler reads confirmed versions only.
- **Everything physical lives in the twin:** positions, robots, reach, grips, move times, handoff nests, lids and orientation. The registry stores none of it and never asks a person to type it (I11, I12). Several robots in one workcell with handoffs are allowed (I14); the twin models them.
- **Checks on confirm:** every member is a registered, confirmed instrument; no member is in another active workcell (I9); every member maps to a device in the twin workcell, and the twin's devices map back to members, once the twin port (015) can list them. Until 015 a twin mapping is recorded as given and marked unchecked.
- **Moving things:** rearranging the workcell is a change to the twin, and changing who is a member is a new workcell version. Nothing tracks whether positions have been re-taught (I13).
- **Screens:** the workcell page lists the members in plain words (what each can do, its status, whether it can be used by hand) with a link to the twin's 3D view once 015 lands. No 2D layout view (I10 note, I11).
- **What the scheduler gets (019):** the members, which of them can also be booked by hand, and the twin workcell ID; workcell segments (019c) are planned by the twin's workcell scheduler, so 019c's in-workcell detail needs the twin port (015).

### Answers

| # | Question | Answer (Wali, 2026-09-30) |
| --- | --- | --- |
| I10 | What does the FlexPod setup look like today? | The workcell is the **FlexPod** (with the PlateOrient and two 12-position stackers mounted on it), the **Echo 650, PreciseDrop, LidValet, Mantis, A4S sealer, XPeel and MicroSpin**. The seed is corrected to match: the Spark Cyto and Cytomat leave the workcell, the Mantis joins it, and the A4S and XPeel are added as instrument kinds. |
| I11 | What is a workcell record? | A list of member instruments mapped to the digital twin (the model above). No 2D layout; the physical layout is the 3D twin from echo650-twin. |
| I12 | How is robot reach described? | Not entered by people and not stored in the registry: reach and move times come from the digital twin. |
| I13 | Docking and re-teaching? | No docks, and no enforcing or tracking of re-teaching; that can't be enforced in the lab. |
| I14 | More than one robot in a workcell? | Yes (modelled in the twin). |
| I15 | Can a person use a workcell instrument by hand? | Yes, set per member: the scheduler can book an "also usable by hand" member for manual use when the workcell isn't using it. |

## Defaults I'm assuming (say if any is wrong)

- Storage-only units (a manual -80 freezer, a fridge) are inventory locations in 010, not instruments. An automated store or incubator that the scheduler must plan around (Cytomat, Liconic) is an instrument that exposes storage sites.
- Booking and calendars are the scheduler's (019). 008 keeps status and service dates only.
- Hardware connection details (IP addresses, drivers) wait for the device gateway (022).
- Readable instrument names like "FLX-01" in the mockup come from a short name field on the instrument; the record name stays `INS-0001`.
- Every configuration and operating value an agent fills is marked as assumed until a person confirms it; specs imported from echo650-twin keep its verified, estimated and unknown labels.

## Proposed split

- **008a:** kinds, equipment kinds, capability catalog, configuration graph and resolver with ported STAR and Flex validators, seed kinds from echo650-twin.
- **008b:** registered instruments, configuration history and change operations, status and service log.
- **008c:** instrument list and page, 2D deck view, agent-drafted configuration changes.
- **008d:** workcells (round 2): the `workcell` design document with members, twin mapping and hand use; `workcells` operations (draft, change members, confirm, get, search, which workcell an instrument is in) with the I9 check; the workcell page listing members; the seed corrected per I10 (A4S and XPeel kinds and instruments, FlexPod stackers, Mantis in, Spark Cyto and Cytomat out). One PR, or two if the seed correction is split out.
