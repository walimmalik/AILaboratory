import base64

from fastapi.testclient import TestClient

from science.convert import convert
from science.convert.readers import TARGET
from science.main import app

SOP = """---
key: sop-coat
title: Coat a plate
---

# Coat a plate

Dilute the capture antibody to 2 ug/mL in PBS.

## Coating

1. Add 100 uL per well.
2. Seal and incubate overnight at room temperature.

```
# not a heading
```

## Blocking

Block with 300 uL reagent diluent for 1 h.
"""


def test_markdown_keeps_headings_front_matter_and_code_blocks() -> None:
    result = convert("text/markdown", "coat.md", SOP.encode())
    assert result.converter == "markdown"
    headings = [s.heading for s in result.sections]
    assert headings == [
        ["Front matter"],
        ["Coat a plate"],
        ["Coat a plate", "Coating"],
        ["Coat a plate", "Blocking"],
    ]
    coating = result.sections[2].passages[0].text
    assert "100 uL per well" in coating
    assert "# not a heading" in coating


def test_long_text_is_cut_at_paragraphs() -> None:
    paragraph = "word " * 100
    result = convert("text/plain", "long.txt", "\n\n".join([paragraph] * 12).encode())
    passages = result.sections[0].passages
    assert len(passages) > 1
    assert all(len(p.text) <= TARGET for p in passages)


def test_html_reads_headings_lists_and_tables_and_skips_scripts() -> None:
    html = """<html><head><title>T</title><script>var x = 1;</script></head><body>
    <nav>Menu</nav>
    <h1>Transformation</h1><p>Thaw cells on ice.</p>
    <h2>Heat shock</h2><ul><li>42 C for 45 s</li><li>Ice 2 min</li></ul>
    <table><tr><th>Step</th><th>Time</th></tr><tr><td>Recover</td><td>1 h</td></tr></table>
    </body></html>"""
    result = convert("text/html", "t.html", html.encode())
    assert [s.heading for s in result.sections] == [
        ["Transformation"],
        ["Transformation", "Heat shock"],
    ]
    text = result.sections[1].passages[0].text
    assert "42 C for 45 s" in text
    assert "Step | Time\n\nRecover | 1 h" in text
    assert "var x" not in str(result)
    assert "Menu" not in str(result)


def test_code_goes_under_its_file_name() -> None:
    code = "from opentrons import protocol_api\n\n\ndef run(protocol):\n    pass\n"
    result = convert("text/x-python", "serial.py", code.encode())
    assert result.converter == "code"
    assert result.sections[0].heading == ["serial.py"]


def test_the_endpoint_converts_and_refuses_pdf_until_docling() -> None:
    client = TestClient(app)
    ok = client.post(
        "/convert",
        json={
            "name": "a.md",
            "mediaType": "text/markdown",
            "base64": base64.b64encode(b"# A\n\nB").decode(),
        },
    )
    assert ok.status_code == 200
    assert ok.json()["sections"][0] == {
        "heading": ["A"],
        "pageFrom": None,
        "pageTo": None,
        "passages": [{"text": "B", "page": None}],
    }
    pdf = client.post(
        "/convert", json={"name": "a.pdf", "mediaType": "application/pdf", "base64": "JVBERg=="}
    )
    assert pdf.status_code == 415
    assert "Docling" in pdf.json()["detail"]
    both = client.post(
        "/convert", json={"name": "a", "mediaType": "text/plain", "text": "a", "base64": "YQ=="}
    )
    assert both.status_code == 422
