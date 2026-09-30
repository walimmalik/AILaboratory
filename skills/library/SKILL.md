---
name: ailab-library
description: Store and read files in AILaboratory (PDFs, DOCX, Markdown, robot code, images) through its MCP tools; the start of the SOP and literature library.
---

# Files and the library in AILaboratory

A **file** (`file`, `FIL-0001`) is stored bytes with what they are: `mediaType`, `originalName`, `size`, `sha256` and where they came from. The same bytes are stored once per lab.

## Storing

- `files.upload` with `{name, mediaType, text}` for text (Markdown, code, CSV, HTML) or `{name, mediaType, base64}` for anything else, up to 50 MB. Give the real media type (`application/pdf`, `text/markdown`, `text/x-python`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`). Add `source: {from: "url", url}` when you fetched it, `{from: "folder", path}` from an imported folder, or `{from: "derived", file}` for something cut from another file.
- The result says `stored: false` when the lab already had those bytes; use the returned record, don't upload again.
- A file attached in the assistant arrives as text in the conversation; upload it with `files.upload` when the lab should keep it.

## Reading

- `files.get` with `{id}` returns the text of a text file or the base64 of anything else; `as: "none"` for the record alone. Don't read a large PDF as base64 to answer a question: document text and search arrive with the library (plan 011b).
- People open a file in the app at `/api/v1/files/<id>`.

A file's bytes never change. A revised SOP or manual is a new upload.
