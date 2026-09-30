from pydantic import BaseModel, Field


class Passage(BaseModel):
    """A stretch of text short enough to search and cite, with the page it is on when known."""

    text: str
    page: int | None = None


class Section(BaseModel):
    """A part of a document under one heading path, e.g. ["Protocol", "Coating"]."""

    heading: list[str] = Field(default_factory=list)
    page_from: int | None = Field(default=None, alias="pageFrom")
    page_to: int | None = Field(default=None, alias="pageTo")
    passages: list[Passage]

    model_config = {"populate_by_name": True, "serialize_by_alias": True}


class Converted(BaseModel):
    converter: str
    sections: list[Section]
    warnings: list[str] = Field(default_factory=list)


class UnsupportedMediaType(Exception):
    """The file is a type no reader here handles yet."""
