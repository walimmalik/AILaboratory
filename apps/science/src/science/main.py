import base64
import binascii

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, model_validator

from science.convert import Converted, UnsupportedMediaType, convert

app = FastAPI(title="AILaboratory science service")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "science"}


class ConvertRequest(BaseModel):
    name: str = Field(min_length=1)
    media_type: str = Field(alias="mediaType", min_length=1)
    base64: str | None = None
    text: str | None = None

    @model_validator(mode="after")
    def one_content(self) -> "ConvertRequest":
        if (self.base64 is None) == (self.text is None):
            raise ValueError("Give the content as either base64 or text")
        return self


@app.post("/convert")
def convert_file(request: ConvertRequest) -> Converted:
    """Sections and passages of a library file (plan 011b)."""
    if request.text is not None:
        data = request.text.encode("utf-8")
    else:
        try:
            data = base64.b64decode(request.base64 or "", validate=True)
        except binascii.Error as error:
            raise HTTPException(
                status_code=422, detail="The content is not valid base64"
            ) from error
    try:
        return convert(request.media_type, request.name, data)
    except UnsupportedMediaType as error:
        raise HTTPException(status_code=415, detail=str(error)) from error
