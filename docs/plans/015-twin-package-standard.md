# 015: Twin package standard (v1)

- Status: accepted by Wali 2026-10-01 (plan 015 round 2, T7 to T12 all A). "Data only" means no runnable code in a package; the 3D model (`model.glb`) is always part of it. Field names and the exact JSON Schema are settled by the first implementation (the echo650-twin standardization, then 015a); anything that changes the meaning of this page goes back to Wali.
- Built from: the 2026-10-01 review of how echo650-twin's twins are built (summarized in [plan 015](015-digital-twins.md), round 2). It reuses the parts of echo650-twin that already work: its regenerate-and-compare check, STAR's pure planner, FlexPod's motion timing, the calibration overlay, the A4S evidence table, workcell-v2's access descriptors, and the unused schema models (duration models, provenance, capability contracts).

## What a twin is

A twin is **one uploaded package** that describes one instrument model. A person uploads it, the app checks it and reports anything missing in plain words, and a person confirms it, the same as any other design in the app. Each upload is a new version, and older versions are kept.

```
hamilton-star/                   (a folder or a .zip)
  twin.json      the description: identity, parts, sites, state, commands, timing, evidence (data)
  model.glb      the 3D model; every moving part is a named node
  evidence.md    optional: the evidence table in readable form
```

There is no code in the package. Behaviour that needs code, such as the STAR's pipetting planner, the FlexPod arm's reach, Cytomat storage or the A4S heater, comes from a **behaviour template** that lives in the app and is tested there. A twin names its template (T7).

## Sections of `twin.json`

| Section | Holds | Replaces in echo650-twin |
| --- | --- | --- |
| `identity` | Twin ID (`hamilton.star`) and version; manufacturer and model (matched to an instrument kind in the registry); behaviour template; fidelity note | catalog entry, `definitionVersions` allowlist, `fidelity` |
| `frame` | Metres, Y up, +Z front, footprint | `units`, `up`, `front`, `dimensions` |
| `parts` | Each moving part: GLB node name, motion (slide or turn between named positions, e.g. door closed/open), followers | `components`, `bindings`, `rotations`, `followers` |
| `sites` | Where labware sits: ID, pose, plate formats accepted (from the app's labware types), and for robot-loaded sites the access poses (approach, contact, lift, withdraw) with the commands to run first and after (open door, extend nest) | `d.flexpod.sites`, `native-access-recipes.js`, `sitePose` branches |
| `options` | What can differ between machines of this model (Flex modules per slot, STAR carriers, FeliX head, Tempo block), as a schema the registry configuration is mapped onto (T3) | per-device `config.js`, `devices.mjs` configuration |
| `state` | Named state, typed: door `closed/open`, plate present, seal `unsealed/sealed`, lid on/off, temperature in °C, tape remaining | engine private fields |
| `commands` | Each command: the **capability** it implements from the lab app's catalogue (`seal`, `read_absorbance`, `transfer`…), or `internal` (open door); parameters with unit-suffixed names and ranges; **preconditions** on state (door closed, plate present); **effects** on state and plates (seal → `sealed`); its **phases**; failure outcomes it can simulate (tape break) | `commands` + imperative `check()` + engine phase code |
| `timing` | Every phase's duration as one typed model (below), with min, typical and max, and provenance for every number | 9 mechanisms |
| `evidence` | Sources (`id`, title, URL or document, page); every number and rule can cite source IDs; assumptions; unknowns | `sources`, `assumptions`, evidence docs |

### Timing models (T8)

All in seconds. Each model is computed before anything animates, so the scheduler and agents get times without playing the twin. The animation then follows those times.

| Model | Duration | Example |
| --- | --- | --- |
| `fixed` | a number | A4S film cut 0.35 s |
| `per_item` | setup + count × per item, where the count comes from a parameter (wells, columns, plates, drops) | PreciseDrop: per well move + dispense |
| `flow` | volume ÷ rate (+ settle) | STAR aspirate 200 µL at 100 µL/s |
| `motion` | from distance, speed, acceleration and settle (the FlexPod formula) | FlexPod arm move, STAR gantry |
| `thermal` | temperature change ÷ rate (+ hold) | A4S heat to 175 °C at 15 °C/s |
| `setting` | taken from a parameter | A4S dwell 3 s, centrifuge 60 s, incubation 30 min |
| `sum` | phases in order; a command's time is the sum of its phases | |

Every number (a speed, a rate, a fixed time) carries:

```json
{ "typical": 0.35, "min": 0.3, "max": 0.4, "unit": "s",
  "provenance": "vendor", "sources": ["a4s-manual:p12"], "note": "Cut cycle from the operator manual" }
```

Calibration from real logs (019 S13) overrides `typical`, `min` and `max` by a stable key (`<twin>.<command>.<phase>`). It keeps the original as the base and records where the new value came from, as echo650-twin's `lab-action-timing/1` does now.

### Provenance (T9)

One list for every value, timing or not:

- `measured`: from the lab's own logs or a stopwatch, with the runs it came from
- `vendor`: from a manual, datasheet or vendor statement, with the page
- `derived`: computed from other cited values, with the formula
- `estimated`: a guess, with who made it and why
- `unknown`: not known yet; the app warns wherever it is used

### Behaviour templates (T7)

Templates are code in the app with their own tests. They are chosen by name and set up only by the package's data:

| Template | Covers | Code it carries |
| --- | --- | --- |
| `station` | Plate goes in, a process runs, plate comes out: readers, washers, sealers, peelers, centrifuges, thermocyclers, qPCR | Load/run/unload, preconditions and effects from data. Most twins need nothing more. |
| `storage` | Plate hotels and incubators (Cytomat, stackers) | Racks and slots, fetch and store |
| `dispenser` | Bulk dispensers (MANTIS, PreciseDrop, WellJet, Combi) | Per-well or per-column patterns, channels, liquid ledger |
| `acoustic` | Echo | Source/destination pairs, drop counts, liquid ledger |
| `liquid_handler` | STAR, Vantage, Flex, FeliX | Deck, channels and heads, tips, the pipetting planner (STAR's `plan`), liquid ledger |
| `plate_robot` | FlexPod arm, AutoPod, ACell | Reach, inverse kinematics, moves between sites' access poses |

A twin that needs something no template does gets a new template or option, added to the app by a reviewed PR. Its package still contains no code.

## Checks on upload (T12)

The upload is refused, with a plain list of every problem, when:

- `twin.json` doesn't match the schema (closed: no unknown fields)
- a part names a GLB node that isn't in `model.glb`, or a moving GLB node has no part
- a command's capability isn't in the lab app's catalogue, or a parameter has no unit
- a phase has no timing model, a number has no provenance, or `min ≤ typical ≤ max` fails
- a robot-loaded site has no access poses
- a precondition or effect names state that isn't declared
- the behaviour template doesn't exist, or the package lacks what that template needs (a `liquid_handler` needs a deck)

Warnings (accepted, shown on the twin's page):

- values marked `estimated` or `unknown`
- capabilities the instrument kind lists that no command implements
- options the registry has that the twin can't represent

Example messages, in the app's plain language:

- "The 'cut film' step has no time. Add a timing model for it."
- "Door position 'open' moves node `star_door`, but model.glb has no node with that name."

The same checker ships as a command Wali can run in echo650-twin before uploading, so problems are found there first.

## Example (shortened): A4S sealer

```json
{
  "identity": { "id": "azenta.a4s", "version": "1.0.0", "manufacturer": "Azenta Life Sciences", "model": "A4S",
                "template": "station", "fidelity": "Sealing cycle timing from the operator manual; heater ramp estimated." },
  "frame": { "units": "m", "up": "Y", "front": "+Z", "footprintM": [0.41, 0.3, 0.6] },
  "parts": [
    { "id": "drawer", "node": "a4s_drawer", "slide": { "fromM": [0,0,0], "toM": [0,0,0.18] }, "positions": ["in", "out"] }
  ],
  "sites": [
    { "id": "nest", "on": "drawer", "accepts": ["sbs"], "access": { "when": { "drawer": "out" }, "approach": "…", "contact": "…", "lift": "…", "withdraw": "…" } }
  ],
  "state": { "plate": "present|absent", "seal": "unsealed|sealed|indeterminate", "heaterC": "number" },
  "commands": {
    "seal": {
      "capability": "seal",
      "parameters": { "temperatureC": { "min": 100, "max": 200 }, "dwellSeconds": { "min": 0.5, "max": 12 } },
      "requires": [ { "state": "plate", "is": "present", "message": "There is no plate in the sealer." } ],
      "effects": [ { "state": "seal", "becomes": "sealed" } ],
      "phases": [
        { "id": "heat", "timing": { "model": "thermal", "rateCPerS": { "typical": 15, "provenance": "estimated", "note": "Not in the manual" } } },
        { "id": "drawer_in", "timing": { "model": "fixed", "seconds": { "typical": 1.8, "min": 1.5, "max": 2.2, "provenance": "estimated" } }, "moves": { "drawer": "in" } },
        { "id": "press", "timing": { "model": "setting", "parameter": "dwellSeconds" } },
        { "id": "cut", "timing": { "model": "fixed", "seconds": { "typical": 0.35, "provenance": "vendor", "sources": ["a4s-manual:p12"] } } },
        { "id": "drawer_out", "timing": { "model": "fixed", "seconds": { "typical": 1.8, "provenance": "estimated" } }, "moves": { "drawer": "out" } }
      ]
    }
  },
  "evidence": { "sources": [ { "id": "a4s-manual", "title": "A4S Operator Manual", "pages": "…" } ], "assumptions": [ "…" ] }
}
```
