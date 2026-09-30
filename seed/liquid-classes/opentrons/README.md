# Opentrons liquid classes

Opentrons' built-in liquid classes (water, 50% glycerol, 80% ethanol), each `shared-data/liquid-class/definitions/1/<name>/1.json` from https://github.com/Opentrons/opentrons (branch `edge`), unchanged. `seed/liquid-classes.yaml` says which pipettes and tip racks the lab has; the loader makes one class per liquid, pipette and tip rack from them.

Opentrons shared-data is licensed under the Apache License 2.0 (https://www.apache.org/licenses/LICENSE-2.0). Copyright Opentrons Labworks, Inc.
