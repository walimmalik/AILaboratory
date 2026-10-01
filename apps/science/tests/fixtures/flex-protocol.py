"""TFP-0001 v2 buffer

Flex: buffer and standards into the ELISA plate. From transfer plan TFP-0001 version 2, group
buffer, on Flex 1 with the Flex 1-Channel 1000 uL (left mount).

Written by AILaboratory and checked in the Opentrons simulator (opentrons 10.0.0) before
export; not run on a robot by AILaboratory. Flow rates are the pipette's defaults.
"""

import json

from opentrons import protocol_api
from opentrons.protocol_api import SINGLE

metadata = {"protocolName": 'TFP-0001 v2 buffer', "author": "AILaboratory"}
requirements = {"robotType": "Flex", "apiLevel": '2.20'}

TRASH = {'kind': 'trash_bin', 'slot': 'A3'}
PIPETTE = {'load_name': 'flex_1channel_1000', 'mount': 'left', 'nozzles': 'all'}
# load name, slot
TIP_RACKS = [
    ('opentrons_flex_96_filtertiprack_1000ul', 'C1'),
]
# id, label, slot, load name
LABWARE = [
    ('reservoir', 'Reagent diluent (RES-000001)', 'D2', 'nest_12_reservoir_15ml'),
    ('elisa', 'ELISA plate', 'D3', 'corning_96_wellplate_360ul_flat'),
]
# Custom definitions for labware Opentrons doesn't name, by id
DEFINITIONS = {}
# source, source well, destination, destination well, volume (uL), new tip
TRANSFERS = [
    ('reservoir', 'A1', 'elisa', 'A1', 100.0, True),
    ('reservoir', 'A1', 'elisa', 'B1', 100.0, False),
    ('reservoir', 'A2', 'elisa', 'A1', 50.0, True),
    ('reservoir', 'A2', 'elisa', 'B1', 250.0, True),
]


def run(protocol: protocol_api.ProtocolContext) -> None:
    if TRASH["kind"] == "waste_chute":
        protocol.load_waste_chute()
    else:
        protocol.load_trash_bin(TRASH["slot"])
    tip_racks = [protocol.load_labware(name, slot) for name, slot in TIP_RACKS]
    labware = {}
    for key, label, slot, load_name in LABWARE:
        if key in DEFINITIONS:
            labware[key] = protocol.load_labware_from_definition(DEFINITIONS[key], slot, label)
        else:
            labware[key] = protocol.load_labware(load_name, slot, label=label)
    pipette = protocol.load_instrument(PIPETTE["load_name"], PIPETTE["mount"], tip_racks=tip_racks)
    if PIPETTE["nozzles"] == "single":
        pipette.configure_nozzle_layout(style=SINGLE, start="H1", tip_racks=tip_racks)
    for source, source_well, destination, destination_well, volume, new_tip in TRANSFERS:
        if new_tip and pipette.has_tip:
            pipette.drop_tip()
        if not pipette.has_tip:
            pipette.pick_up_tip()
        pipette.transfer(
            volume,
            labware[source][source_well],
            labware[destination][destination_well],
            new_tip="never",
        )
    if pipette.has_tip:
        pipette.drop_tip()
