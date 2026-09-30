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

## Documents

A **document** (`document`, `DOC-0001`) is a source as published, with its files: an SOP, vendor manual, paper, protocol code, web page or note.

- `library.add` with `{label, type, license: {name, sharePolicy}, files: [{file, role: "original"}], authors?, vendor?, version?, published?, doi?, url?, journal?, partNumbers?, language?, assays?, tags?, notes?, evidence?}` drafts one. Upload the files first. Exactly one file is the `original`; the DOCX of a PDF is an `alternate`, a plate map image a `supplement`. `published` is `"2018"`, `"2018-05"` or a date; `doi` has no `https://doi.org/`.
- Set `sharePolicy: "lab_private"` for All Rights Reserved, vendor and non-commercial documents; say where values came from in `evidence` (e.g. `{"doi": {"source": "datasheet", "reference": "<url>"}}`), or they show as assumed.
- A person confirms each section (Source, License, Files, Topics). Before adding, check `records.list` with `kind: "document"` and a `search` so you don't add the same source twice.
- `library.add_revision` with `{document, expectedVersion, file, version?, published?}` when the source is revised: the old file stays as an earlier revision. On a confirmed document it is a proposal.
