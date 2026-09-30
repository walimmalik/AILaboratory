import re
from html.parser import HTMLParser

from science.convert.model import Converted, Passage, Section, UnsupportedMediaType

# Passages are cut at paragraph ends, aiming for this many characters (about 200 words).
TARGET = 1200


def _passages(blocks: list[str]) -> list[Passage]:
    """Joins paragraphs into passages of about TARGET characters, never splitting one."""
    passages: list[Passage] = []
    current = ""
    for block in blocks:
        block = block.strip()
        if not block:
            continue
        if current and len(current) + len(block) + 2 > TARGET:
            passages.append(Passage(text=current))
            current = block
        else:
            current = f"{current}\n\n{block}" if current else block
    if current:
        passages.append(Passage(text=current))
    return passages


def _paragraphs(text: str) -> list[str]:
    """Splits on blank lines, keeping fenced code blocks and tables whole."""
    blocks: list[str] = []
    current: list[str] = []
    fenced = False
    for line in text.splitlines():
        if line.strip().startswith("```"):
            fenced = not fenced
        if not fenced and not line.strip():
            if current:
                blocks.append("\n".join(current))
                current = []
            continue
        current.append(line)
    if current:
        blocks.append("\n".join(current))
    return blocks


_HEADING = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")


def read_markdown(text: str) -> Converted:
    sections: list[Section] = []
    warnings: list[str] = []
    front = re.match(r"^---\r?\n(.*?)\r?\n---\r?\n", text, re.S)
    if front:
        sections.append(Section(heading=["Front matter"], passages=[Passage(text=front.group(1))]))
        text = text[front.end() :]
    path: list[tuple[int, str]] = []
    body: list[str] = []
    fenced = False

    def flush() -> None:
        passages = _passages(_paragraphs("\n".join(body)))
        if passages:
            sections.append(Section(heading=[h for _, h in path], passages=passages))
        body.clear()

    for line in text.splitlines():
        if line.strip().startswith("```"):
            fenced = not fenced
        match = None if fenced else _HEADING.match(line)
        if match:
            flush()
            level = len(match.group(1))
            path[:] = [(lvl, h) for lvl, h in path if lvl < level]
            path.append((level, match.group(2)))
        else:
            body.append(line)
    flush()
    if not sections:
        warnings.append("No text found")
    return Converted(converter="markdown", sections=sections, warnings=warnings)


_BLOCK = {
    "p",
    "li",
    "pre",
    "blockquote",
    "tr",
    "dt",
    "dd",
    "caption",
    "figcaption",
    "div",
    "section",
    "article",
    "table",
    "ul",
    "ol",
    "dl",
    "br",
    "hr",
}
_SKIP = {"script", "style", "nav", "footer", "noscript", "template", "svg", "head"}


class _Html(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.sections: list[Section] = []
        self.path: list[tuple[int, str]] = []
        self.blocks: list[str] = []
        self.text: list[str] = []
        self.skip = 0
        self.heading: tuple[int, list[str]] | None = None
        self.title: list[str] = []
        self.in_title = False

    def _end_block(self) -> None:
        line = re.sub(r"[ \t\r\f\v]+", " ", "".join(self.text)).strip()
        if line:
            self.blocks.append(line)
        self.text = []

    def _flush(self) -> None:
        self._end_block()
        passages = _passages(self.blocks)
        if passages:
            self.sections.append(Section(heading=[h for _, h in self.path], passages=passages))
        self.blocks = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _SKIP:
            self.skip += 1
        elif tag == "title":
            self.in_title = True
        elif re.fullmatch(r"h[1-6]", tag):
            self._flush()
            self.heading = (int(tag[1]), [])
        elif tag in ("td", "th"):
            if "".join(self.text).strip():
                self.text.append(" | ")
        elif tag in _BLOCK:
            self._end_block()

    def handle_endtag(self, tag: str) -> None:
        if tag in _SKIP:
            self.skip = max(0, self.skip - 1)
        elif tag == "title":
            self.in_title = False
        elif self.heading and re.fullmatch(r"h[1-6]", tag):
            level, words = self.heading
            heading = re.sub(r"\s+", " ", "".join(words)).strip()
            self.heading = None
            if heading:
                self.path = [(lvl, h) for lvl, h in self.path if lvl < level]
                self.path.append((level, heading))
        elif tag in _BLOCK:
            self._end_block()

    def handle_data(self, data: str) -> None:
        if self.in_title:
            self.title.append(data)
        elif self.skip:
            return
        elif self.heading:
            self.heading[1].append(data)
        else:
            self.text.append(data)


def read_html(text: str) -> Converted:
    parser = _Html()
    parser.feed(text)
    parser.close()
    parser._flush()
    warnings = [] if parser.sections else ["No text found"]
    return Converted(converter="html", sections=parser.sections, warnings=warnings)


def read_code(text: str, name: str) -> Converted:
    """Code as passages of whole blocks (split at blank lines), under the file name."""
    passages = _passages(_paragraphs(text))
    return Converted(
        converter="code",
        sections=[Section(heading=[name], passages=passages)] if passages else [],
        warnings=[] if passages else ["No text found"],
    )


def read_text(text: str) -> Converted:
    passages = _passages(_paragraphs(text))
    return Converted(
        converter="text",
        sections=[Section(heading=[], passages=passages)] if passages else [],
        warnings=[] if passages else ["No text found"],
    )


CODE_TYPES = {"text/x-python", "application/x-python", "application/javascript", "text/javascript"}


def convert(media_type: str, name: str, data: bytes) -> Converted:
    """Sections and passages of a file, or UnsupportedMediaType for types without a reader yet."""
    if media_type in ("application/pdf",) or "wordprocessingml" in media_type:
        raise UnsupportedMediaType(
            f"{name} ({media_type}) needs the Docling conversion, which comes with plan 011b-2"
        )
    if not (
        media_type.startswith("text/") or media_type in CODE_TYPES or media_type.endswith("json")
    ):
        raise UnsupportedMediaType(f"{name} ({media_type}) has no text to read")
    text = data.decode("utf-8", errors="replace")
    if media_type == "text/markdown":
        return read_markdown(text)
    if media_type == "text/html":
        return read_html(text)
    if media_type in CODE_TYPES or media_type.endswith("json"):
        return read_code(text, name)
    return read_text(text)
