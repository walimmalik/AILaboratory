# Opentrons labware definitions

Copies of the Opentrons labware definitions (schema version 2) that `seed/labware.yaml` names by load name, so the seed loader can fill in where wells sit without a network. Each file is `shared-data/labware/definitions/2/<load name>/<version>.json` from https://github.com/Opentrons/opentrons (branch `edge`), unchanged.

The loader only uses a definition when the seed marks the entry's `opentrons_load_name` as verified and the definition describes the same family and grid. Tube racks are left out: the seed's tubes are tubes, not racks.

Opentrons shared-data is licensed under the Apache License 2.0 (https://www.apache.org/licenses/LICENSE-2.0). Copyright Opentrons Labworks, Inc.
