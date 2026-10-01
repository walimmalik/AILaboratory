"""Writes an Opentrons Flex protocol from a transfer plan group's data and checks it.

The API sends data only (plan 016b-3): which pipette, the deck, the tip racks and the transfers.
The protocol is one fixed program with that data written in as Python literals, so nothing a
caller sends is run as code. The check runs the protocol in Opentrons' own simulator in a
separate process, with a time limit.
"""

import json
import subprocess
import sys
import textwrap
from importlib.metadata import version
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel

API_LEVEL = "2.20"
SIMULATION_SECONDS = 300

Slot = Annotated[str, Field(pattern=r"^[A-D][1-3]$")]
Well = Annotated[str, Field(pattern=r"^[A-Z]{1,2}[0-9]{1,3}$")]
LoadName = Annotated[str, Field(pattern=r"^[a-z0-9_.]+$", max_length=200)]
Key = Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")]
Text = Annotated[str, Field(min_length=1, max_length=2000)]


class Model(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


class Pipette(Model):
    load_name: Literal[
        "flex_1channel_50", "flex_1channel_1000", "flex_8channel_50", "flex_8channel_1000"
    ]
    mount: Literal["left", "right"]
    nozzles: Literal["all", "single"] = Field(
        description="single: an 8-channel pipette picks up one tip, at its H1 nozzle"
    )


class TrashBin(Model):
    kind: Literal["trash_bin"]
    slot: Slot


class WasteChute(Model):
    kind: Literal["waste_chute"]


class TipRack(Model):
    load_name: LoadName
    slot: Slot


class Labware(Model):
    id: Key
    label: Text
    slot: Slot
    load_name: LoadName
    definition: dict | None = Field(
        default=None, description="A custom labware definition, for labware Opentrons doesn't name"
    )


class Place(Model):
    labware: Key
    well: Well


class Transfer(Model):
    from_: Place = Field(alias="from")
    to: Place
    volume: float = Field(gt=0, le=100_000, description="Microlitres")
    new_tip: bool


class ProtocolRequest(Model):
    name: Text
    description: Text
    pipette: Pipette
    trash: TrashBin | WasteChute = Field(discriminator="kind")
    tip_racks: list[TipRack] = Field(min_length=1, max_length=11)
    labware: list[Labware] = Field(min_length=1, max_length=11)
    transfers: list[Transfer] = Field(min_length=1, max_length=20_000)

    @model_validator(mode="after")
    def one_place_each(self) -> "ProtocolRequest":
        slots = [r.slot for r in self.tip_racks] + [item.slot for item in self.labware]
        if isinstance(self.trash, TrashBin):
            slots.append(self.trash.slot)
        elif "D3" in slots:
            raise ValueError("The waste chute takes D3")
        if len(set(slots)) != len(slots):
            raise ValueError("Each deck slot holds one thing")
        ids = [item.id for item in self.labware]
        if len(set(ids)) != len(ids):
            raise ValueError("Each labware id is used once")
        named = {t.from_.labware for t in self.transfers} | {t.to.labware for t in self.transfers}
        if not named <= set(ids):
            raise ValueError(f"Transfers name labware not loaded: {sorted(named - set(ids))}")
        return self


class Check(Model):
    ok: bool
    simulator: str = Field(description="The Opentrons package that simulated it")
    commands: int = Field(description="Commands in the simulated run log")
    tips: int = Field(description="Tips the simulated run picked up")
    problem: str | None = None


class ProtocolResult(Model):
    protocol: str
    check: Check


def _literal(value: object) -> str:
    """A Python literal for JSON-like data; strings through repr, so they stay data."""
    if isinstance(value, str):
        return repr(value)
    if isinstance(value, bool) or value is None:
        return repr(value)
    if isinstance(value, int | float):
        return repr(value)
    raise TypeError(f"Not a literal: {type(value).__name__}")


def _row(values: tuple) -> str:
    return "(" + ", ".join(_literal(v) for v in values) + ")"


TEMPLATE = '''"""{name}

{description}

Written by AILaboratory and checked in the Opentrons simulator (opentrons {simulator}) before
export; not run on a robot by AILaboratory. Flow rates are the pipette's defaults.
"""

import json

from opentrons import protocol_api
from opentrons.protocol_api import SINGLE

metadata = {{"protocolName": {protocol_name}, "author": "AILaboratory"}}
requirements = {{"robotType": "Flex", "apiLevel": {api_level}}}

TRASH = {trash}
PIPETTE = {pipette}
# load name, slot
TIP_RACKS = [
{tip_racks}
]
# id, label, slot, load name
LABWARE = [
{labware}
]
# Custom definitions for labware Opentrons doesn't name, by id
DEFINITIONS = {definitions}
# source, source well, destination, destination well, volume (uL), new tip
TRANSFERS = [
{transfers}
]


def run(protocol: protocol_api.ProtocolContext) -> None:
    if TRASH["kind"] == "waste_chute":
        protocol.load_waste_chute()
    else:
        protocol.load_trash_bin(TRASH["slot"])
    tip_racks = [protocol.load_labware(name, slot) for name, slot in TIP_RACKS]
    labware = {{}}
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
'''


def _docstring_text(text: str) -> str:
    """Text safe inside the module docstring: no quote runs or backslashes that would end it."""
    return text.replace("\\", "/").replace('"""', "''")


def render(request: ProtocolRequest) -> str:
    """The protocol as Python source. Every value from the request is a literal."""
    trash = (
        {"kind": "waste_chute"}
        if isinstance(request.trash, WasteChute)
        else {"kind": "trash_bin", "slot": request.trash.slot}
    )
    pipette = {
        "load_name": request.pipette.load_name,
        "mount": request.pipette.mount,
        "nozzles": request.pipette.nozzles,
    }
    definitions = [
        f"    {_literal(item.id)}: json.loads({_literal(json.dumps(item.definition))}),"
        for item in request.labware
        if item.definition is not None
    ]
    return TEMPLATE.format(
        name=_docstring_text(request.name),
        description=textwrap.fill(_docstring_text(request.description), 96),
        simulator=version("opentrons"),
        protocol_name=_literal(request.name),
        api_level=_literal(API_LEVEL),
        trash="{" + ", ".join(f"{_literal(k)}: {_literal(v)}" for k, v in trash.items()) + "}",
        pipette="{" + ", ".join(f"{_literal(k)}: {_literal(v)}" for k, v in pipette.items()) + "}",
        tip_racks="\n".join(f"    {_row((r.load_name, r.slot))}," for r in request.tip_racks),
        labware="\n".join(
            f"    {_row((item.id, item.label, item.slot, item.load_name))},"
            for item in request.labware
        ),
        definitions="{\n" + "\n".join(definitions) + "\n}" if definitions else "{}",
        transfers="\n".join(
            f"    {_row((t.from_.labware, t.from_.well, t.to.labware, t.to.well))[:-1]}, "
            f"{_literal(t.volume)}, {_literal(t.new_tip)}),"
            for t in request.transfers
        ),
    )


def check(protocol: str) -> Check:
    """Runs the protocol in Opentrons' simulator, in its own process."""
    try:
        done = subprocess.run(
            [sys.executable, "-m", "science.opentrons.simulate"],
            input=protocol,
            capture_output=True,
            text=True,
            timeout=SIMULATION_SECONDS,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return Check(
            ok=False,
            simulator=version("opentrons"),
            commands=0,
            tips=0,
            problem=f"The simulation took longer than {SIMULATION_SECONDS} seconds",
        )
    lines = done.stdout.strip().splitlines()
    try:
        return Check.model_validate_json(lines[-1])
    except (IndexError, ValueError):
        return Check(
            ok=False,
            simulator=version("opentrons"),
            commands=0,
            tips=0,
            problem=f"The simulator stopped without a result: {done.stderr.strip()[-500:]}",
        )
