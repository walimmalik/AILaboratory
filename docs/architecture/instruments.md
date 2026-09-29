# Instruments

Instrument kinds, equipment kinds, the capability catalog and resolving a configuration (plan 008, ADR 0025); registered instruments, equipment items and configuration changes (008b, ADR 0026). Screens arrive in 008c and workcells in 008d.

## Pieces

| Piece | Where |
| --- | --- |
| Attribute schemas (kinds, mounts, sites, capability providers and limits), capability catalog, configuration and resolved configuration | `packages/schema/src/instruments.ts` |
| Operations: `instruments.capabilities`, `instruments.resolve`, `instruments.register`, `instruments.change_configuration`, `instruments.set_status`, `instruments.log_service` | `packages/schema/src/operations/instruments.ts`, `apps/api/src/instruments/operations.ts` |
| Kinds `instrument_kind`, `equipment_kind`, `instrument` and `equipment_item`, with sections and readiness checks | `apps/api/src/instruments/kinds.ts` |
| Resolver | `packages/domain/src/instruments.ts` |
| Seed loader for `seed/instrument-library.yaml` (sources from `seed/instruments.yaml`) | `apps/api/src/instruments/seed.ts`, `apps/api/src/seed.ts` |
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
- `instruments.change_configuration` applies `place`, `move`, `remove` and `set_item` changes together and refuses the result if it doesn't resolve. Configuration nodes may name the `equipment_item` they are; an item can be installed on one instrument at a time, found from the configurations that name it.
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

## Seed

`seed/instrument-library.yaml` holds the lab's instrument and equipment kinds in the library's shape. Each entry names its research entry in `seed/instruments.yaml`, whose first source URL becomes datasheet evidence for every attribute except those the entry lists under `assumed` (estimates and layout choices nobody has checked yet), which load as assumed. Manual stations have no research entry, so all their values are assumed. The loader creates what the lab doesn't have yet, matched by kind and label, and leaves the rest alone.

The file's `instruments` list is the demo lab's registered instruments (from the `instances` in `seed/instruments.yaml`): name, short name, serial, room and variant, with configurations whose nodes name kinds by key. They go in through `instruments.register`, so each configuration is checked on the way in, and load as assumed.
