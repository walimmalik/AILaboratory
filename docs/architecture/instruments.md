# Instruments

Instrument kinds, equipment kinds, the capability catalog and resolving a configuration (plan 008, ADR 0025); registered instruments, equipment items and configuration changes (008b, ADR 0026). Screens (008c) and workcells (008d, ADR 0047).

## Pieces

| Piece | Where |
| --- | --- |
| Attribute schemas (kinds, mounts, sites, capability providers and limits), capability catalog, configuration and resolved configuration | `packages/schema/src/instruments.ts` |
| Operations: `instruments.capabilities`, `instruments.resolve`, `instruments.register`, `instruments.change_configuration`, `instruments.set_status`, `instruments.log_service` | `packages/schema/src/operations/instruments.ts`, `apps/api/src/instruments/operations.ts` |
| Kinds `instrument_kind`, `equipment_kind`, `instrument` and `equipment_item`, with sections and readiness checks | `apps/api/src/instruments/kinds.ts` |
| Resolver | `packages/domain/src/instruments.ts` |
| Seed loader for `seed/instrument-library.yaml` (sources from `seed/instruments.yaml`) | `apps/api/src/instruments/seed.ts`, `apps/api/src/seed.ts` |
| Workcells: kind `workcell` with its checks, and `workcells.draft`, `workcells.change_members`, `workcells.of_instrument` | `packages/schema/src/workcells.ts`, `apps/api/src/instruments/workcell-kind.ts`, `apps/api/src/instruments/workcells.ts` |
| Skill | `skills/instruments/SKILL.md` |

## Model

| Record | Sections | Attributes |
| --- | --- | --- |
| Instrument kind (`INK-0001`) | Identity | `manufacturer`, `model`, `variants`, `category`, `performedBy`, `footprint`, `weight`, `controlInterfaces`, `twin`, `notes` |
| | Mounts and sites | `mounts`, `sites` |
| | Capabilities | `capabilities` |
| Equipment kind (`EQK-0001`) | Identity | `manufacturer`, `model`, `role`, `serialized`, `notes` |
| | Fit, mounts and sites | `fits`, `placement`, `mounts`, `sites` |
| | Capabilities | `capabilities` |

- A **mount** is where equipment attaches: `fixed` (one place), `slots` (named places such as A1 to D3, or left and right) or `rail` (numbered tracks). It lists the fit tags it accepts, who changes it and how long a change takes.
- A **site** is where labware sits, with what it accepts (SBS, families, maximum height, allow and deny lists) and its capacity. A site on a mount place is covered when equipment is placed there.
- A **capability provider** names a catalog capability, its limits and optionally its sites.
- An equipment kind's `placement` says which slots it may use, what else it takes (`alsoClaims`, e.g. `{"B1": ["A1"]}`) and how many tracks it takes on a rail.

| Instrument (`INS-0001`) | Identity | `kind`, `variant`, `shortName`, `serial`, `room`, `notes` |
| | Installed equipment | `configuration` |
| | Status and service | `status`, `lastService`, `calibrationDue` |
| Equipment item (`EQP-0001`) | Identity | `kind`, `serial`, `calibrationDue`, `notes` |

## Registered instruments

- `instruments.register` checks the starting configuration and creates a draft (status `ready`).
- `instruments.change_configuration` applies `place`, `move`, `remove` and `set_item` changes together and refuses the result if it doesn't resolve. Configuration nodes may name the `equipment_item` they are; an item can be installed on one instrument at a time, found from the configurations that name it. The rule lives on the `instrument` kind (ADR 0041): its `related` hook resolves the configuration on every write, so `records.create`, `records.update` and an approved proposal are refused a configuration that doesn't resolve just as the instrument operations are, and readiness shows a `configuration_resolves` blocker when something the instrument relies on has changed since (for example, its item was installed elsewhere). Both paths use one resolver, `apps/api/src/instruments/resolve.ts`.
- `instruments.set_status` and `instruments.log_service` change status and the last service; history is the log.

## Resolving

`instruments.resolve` takes an instrument kind and a configuration (`{equipment: [{id, kind, parent?, mount, placement, item?}]}`), or a registered `instrument`, and returns:

- `claims`: the slots or tracks each piece takes;
- `sites`: every place labware can sit, with covered deck slots left out;
- `capabilities`: from the instrument and each placed piece, with limits and `performedBy`;
- `issues`: errors (the configuration can't exist) and warnings (a draft kind); `valid` is true when there are no errors.

Parents are placed before their children, so nothing is placed on equipment that failed.

## Rules

- Capabilities mean what the catalog says; kinds only add limits (I5).
- Every check names its source. Blockers: mount and slot names unique, sites on real mounts and slots, capability sites listed, extra slots only for allowed slots. Warnings: limits the catalog expects, manufacturer and model, a kind that can do nothing, a manual station set to machine.

## Workcells

A workcell (`WCL-0001`, ADR 0047) lists the registered instruments that work together, each with the device it maps to in the echo650-twin workcell (`twin`) and whether people can also use it by hand. Positions, robots, reach and move times live in the twin and are never stored here. Writes refuse members that aren't instruments in the lab, members listed twice and two members on one twin device. Readiness blocks confirming until every member is a confirmed instrument, no member is in another confirmed workcell (I9; drafts may share instruments to plan other arrangements) and the twin workcell and every twin device are named; a warning says the mapping is recorded as given until the twin connection (015) can check it. `workcells.of_instrument` says which confirmed workcell uses an instrument, and which drafts plan it; an instrument in no confirmed workcell is standalone.

## Seed

`seed/instrument-library.yaml` holds the lab's instrument and equipment kinds in the library's shape. Each entry names its research entry in `seed/instruments.yaml`, whose first source URL becomes datasheet evidence for every attribute except those the entry lists under `assumed` (estimates and layout choices nobody has checked yet), which load as assumed. Manual stations have no research entry, so all their values are assumed. The loader creates what the lab doesn't have yet, matched by kind and label, and leaves the rest alone.

The file's `instruments` list is the demo lab's registered instruments (from the `instances` in `seed/instruments.yaml`): name, short name, serial, room and variant, with configurations whose nodes name kinds by key. They go in through `instruments.register`, so each configuration is checked on the way in, and load as assumed.

The file's `workcells` list names member instruments by key, each with its echo650-twin device ID (from the twin's catalog: `echo650`, `precisedrop`, `mantis`, `a4s`, `xpeel`, `imported-microspin`, and the FlexPod's `orient` and `lidvalet` sites as `flexpod.orient` and `flexpod.lidvalet`). `loadSeedWorkcells` drafts each through `workcells.draft` once its instruments are registered, with the twin mapping and hand use marked assumed; the seed then confirms it like everything else (ADR 0044). The A4S and XPeel models have no research entry yet, so their values carry no datasheet evidence.

## Screens

The web app (008c) has three library pages: Instruments (the lab's registered instruments with an availability lamp and calibration due), Instrument models and Equipment. An instrument's page shows its deck, one drawing per mount with what is installed on each slot or run of tracks, and what it can do with its limits, both from `instruments.resolve`. Changes go through the same operations an agent uses. See [web-app.md](web-app.md).

Workcells (008d-3) have their own library page. A workcell's page lists its instruments in plain words (what each can do from its model, its availability lamp, and "also by hand" or "workcell only"), says positions and reach come from the twin, and keeps the twin workcell and device IDs under technical details. An instrument's page says which confirmed workcell it is in, or that it stands alone (`workcells.of_instrument`).
