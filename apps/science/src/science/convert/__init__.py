"""Turning library files into sections and passages (plan 011b).

Plain readers for Markdown, HTML, code and text live here. PDF and DOCX go through Docling
(011b-2), which needs its layout models downloaded once on the machine that runs it.
"""

from science.convert.model import Converted, Passage, Section, UnsupportedMediaType
from science.convert.readers import convert

__all__ = ["Converted", "Passage", "Section", "UnsupportedMediaType", "convert"]
