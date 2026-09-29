"""MOCK example, not run on a robot. IL-6 ELISA standard curve on the Opentrons Flex.

Shape of what the transfer designer (plan 016) writes for the Flex: a 7-point 2-fold
standard series made in a dilution plate, then standards, blanks and samples added in
duplicate to the ELISA plate. Tip use is set here, since we write the protocol (016 T5).
Checked in Opentrons' simulator before export (016 defaults). Volumes follow
seed/sops/own/elisa-il6-duoset.md; labware load names are estimated.
"""

from opentrons import protocol_api

metadata = {"protocolName": "TFP-0001 IL-6 ELISA standards and samples (mock)"}
requirements = {"robotType": "Flex", "apiLevel": "2.20"}

WELL_VOLUME_UL = 100
STANDARD_TOP = "A1"  # 600 pg/mL in reagent diluent, made by hand
STANDARD_POINTS = 7
SAMPLES = 8  # excerpt; the real plan fills columns 3 to 12


def run(protocol: protocol_api.ProtocolContext) -> None:
    trash = protocol.load_trash_bin("A3")
    tips = protocol.load_labware("opentrons_flex_96_tiprack_1000ul", "B3")
    reservoir = protocol.load_labware("nest_12_reservoir_15ml", "C1")  # A1 reagent diluent
    tubes = protocol.load_labware("opentrons_24_tuberack_eppendorf_1.5ml_safelock_snapcap", "C2")
    dilution = protocol.load_labware("corning_96_wellplate_360ul_flat", "D1", label="Dilution plate")
    elisa = protocol.load_labware("corning_96_wellplate_360ul_flat", "D2", label="ELISA plate PLT-000301")
    p1000 = protocol.load_instrument("flex_1channel_1000", "left", tip_racks=[tips])
    p1000.trash_container = trash

    diluent = reservoir["A1"]
    top = tubes[STANDARD_TOP]

    # 1. Diluent into dilution wells B1..H1 (one tip, dispensing into empty wells).
    p1000.pick_up_tip()
    for row in "BCDEFGH":
        p1000.transfer(250, diluent, dilution[f"{row}1"], new_tip="never")
    p1000.drop_tip()

    # 2. Top standard into A1, then 2-fold serial dilution down column 1 (new tip per step).
    p1000.transfer(500, top, dilution["A1"], new_tip="always")
    for upper, lower in zip("ABCDEF", "BCDEFG"):
        p1000.transfer(
            250,
            dilution[f"{upper}1"],
            dilution[f"{lower}1"],
            mix_after=(3, 200),
            new_tip="always",
        )
    # H1 stays diluent only: the blank.

    # 3. Standards and blank into ELISA columns 1 and 2 (duplicate).
    for row in "ABCDEFGH":
        p1000.distribute(
            WELL_VOLUME_UL,
            dilution[f"{row}1"],
            [elisa[f"{row}1"], elisa[f"{row}2"]],
            new_tip="always",
        )

    # 4. Samples from tubes A2 onward into columns 3 and 4 (duplicate).
    for i in range(SAMPLES):
        tube = tubes.wells()[i + 4]
        row = "ABCDEFGH"[i]
        p1000.distribute(
            WELL_VOLUME_UL,
            tube,
            [elisa[f"{row}3"], elisa[f"{row}4"]],
            new_tip="always",
        )
