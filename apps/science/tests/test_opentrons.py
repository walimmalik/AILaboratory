import ast
import json
from pathlib import Path

from fastapi.testclient import TestClient

from science.main import app
from science.opentrons import ProtocolRequest, check, render

FIXTURES = Path(__file__).parent / "fixtures"


def request() -> dict:
    return json.loads((FIXTURES / "flex-protocol-request.json").read_text())


def test_writes_the_golden_protocol() -> None:
    written = render(ProtocolRequest.model_validate(request()))
    golden = FIXTURES / "flex-protocol.py"
    assert written == golden.read_text()


def test_the_protocol_passes_the_simulator_with_the_tips_it_plans() -> None:
    response = TestClient(app).post("/opentrons/protocol", json=request())
    assert response.status_code == 200
    body = response.json()
    assert body["check"]["ok"] is True, body["check"]
    assert body["check"]["tips"] == 3
    assert body["check"]["commands"] > 4
    assert "TRANSFERS = [" in body["protocol"]


def test_custom_labware_and_an_eight_channel_pipette_on_one_nozzle() -> None:
    plate = json.loads((FIXTURES / "custom-plate-definition.json").read_text())
    body = request()
    body["pipette"] = {"loadName": "flex_8channel_1000", "mount": "left", "nozzles": "single"}
    body["labware"][1] = {
        "id": "elisa",
        "label": "Custom plate",
        "slot": "D3",
        "loadName": plate["parameters"]["loadName"],
        "definition": plate,
    }
    response = TestClient(app).post("/opentrons/protocol", json=body)
    assert response.status_code == 200
    assert response.json()["check"]["ok"] is True, response.json()["check"]


def test_reports_what_the_simulator_refuses() -> None:
    body = request()
    body["transfers"] = [
        {**body["transfers"][0], "newTip": True} for _ in range(97)
    ]  # one rack holds 96 tips
    response = TestClient(app).post("/opentrons/protocol", json=body)
    assert response.status_code == 200
    result = response.json()["check"]
    assert result["ok"] is False
    assert "OutOfTips" in result["problem"]


def test_refuses_requests_that_are_not_data_it_knows() -> None:
    client = TestClient(app)
    bad_slot = request()
    bad_slot["labware"][0]["slot"] = "E9"
    assert client.post("/opentrons/protocol", json=bad_slot).status_code == 422
    bad_pipette = request()
    bad_pipette["pipette"]["loadName"] = "p300_single_gen2"
    assert client.post("/opentrons/protocol", json=bad_pipette).status_code == 422
    same_slot = request()
    same_slot["labware"][1]["slot"] = same_slot["labware"][0]["slot"]
    assert client.post("/opentrons/protocol", json=same_slot).status_code == 422
    unknown = request()
    unknown["transfers"][0]["to"]["labware"] = "nowhere"
    assert client.post("/opentrons/protocol", json=unknown).status_code == 422
    extra = request()
    extra["code"] = "import os"
    assert client.post("/opentrons/protocol", json=extra).status_code == 422


def test_text_from_the_request_stays_data() -> None:
    body = request()
    body["name"] = 'x""" + __import__("os").system("echo hi") + """'
    body["labware"][1]["label"] = "Plate', __import__('os')) #"
    protocol = render(ProtocolRequest.model_validate(body))
    names = {node.id for node in ast.walk(ast.parse(protocol)) if isinstance(node, ast.Name)}
    assert "__import__" not in names
    assert check(protocol).ok
