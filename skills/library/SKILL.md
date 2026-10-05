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

- `files.get` with `{id}` returns the text of a text file or the base64 of anything else; `as: "none"` for the record alone. Don't read a large PDF as base64 to answer a question; use the library's text (below).
- People open a file in the app at `/api/v1/files/<id>`.

A file's bytes never change. A revised SOP or manual is a new upload.

## Documents

A **document** (`document`, `DOC-0001`) is a source as published, with its files: an SOP, vendor manual, paper, protocol code, web page or note.

- `library.add` with `{label, type, license: {name, sharePolicy}, files: [{file, role: "original"}], authors?, vendor?, version?, published?, doi?, url?, journal?, partNumbers?, language?, assays?, tags?, notes?, evidence?}` drafts one. Upload the files first. Exactly one file is the `original`; the DOCX of a PDF is an `alternate`, a plate map image a `supplement`. `published` is `"2018"`, `"2018-05"` or a date; `doi` has no `https://doi.org/`.
- Set `sharePolicy: "lab_private"` for All Rights Reserved, vendor and non-commercial documents; say where values came from in `evidence` (e.g. `{"doi": {"source": "datasheet", "reference": "<url>"}}`), or they show as assumed.
- A person confirms each section (Source, License, Files, Topics). Before adding, check `records.list` with `kind: "document"` and a `search` so you don't add the same source twice.
- `library.parse` with `{document}` turns its original into searchable sections and passages (Markdown, HTML, code and text now; PDF and DOCX not yet). Run it after `library.add` and after a new revision.
- `library.add_revision` with `{document, expectedVersion, file, version?, published?}` when the source is revised: the old file stays as an earlier revision. On a confirmed document it is a proposal.

## Searching and reading

- `library.search` with `{text}` finds passages containing all the words (stemmed: "blocking" finds "block"), best first. Quote a phrase (`"room temperature"`), exclude with `-word`, use `or` between alternatives. Filter with `type` (`sop`, `paper`…), `assay` or `document`. Each hit has the document, heading path, page, a snippet with matches in `[[ ]]` and an exact `source` reference to the selected historical version/file/converted snapshot. Keep that reference with the passage; a later revision or reparse cannot change its text.
- Search matches words, not meaning, for now: try the words the source would use (`"reagent diluent"`, `"1 hour"`) and synonyms with `or`.
- `library.read` with `{document}` discovers the current original and returns its outline and `source`; add `section` (an index from the outline), `pages: {from, to}` or `passages: [id]` to read text. For exact evidence use `{source}` from a parse/read/search result instead of `{document}`. Choose one selector, never both. Exact reads verify historical file membership, bytes and snapshot identity and reject missing snapshots/passages instead of using newer text. Empty sections remain in the outline.
- `library.parse` returns the exact `source` it converted, even if the document gains a revision while conversion is running. Changed conversion of the same bytes creates a new snapshot and keeps the old one readable. Converter provenance and warnings participate in snapshot identity even when the text stays the same: inspect returned warnings before using the new snapshot as evidence, and keep an old reference's own conversion facts. An unavailable source attachment (`parse.status: "unavailable"`) is explicitly unchecked: opening it does not claim text was verified, and asking for its passages fails. Do not turn it into a checked citation or silently adopt a later parse.
- Current digital SOP source/citation fields and selection UI have not adopted this exact producer contract yet. Do not claim an existing free-string SOP revision pins an edition or rewrite a confirmed SOP to infer a pin. Historical retained parses lack headings for old empty sections when those were never stored; the API labels that limitation instead of reconstructing deleted history.

## Mentions

- People see a document's text, files and mentions on its page, and "Mentioned in" on every record the library mentions; the Documents page searches the text and takes uploads.

- After `library.parse`, run `library.mine` with `{document}`: it proposes the products, labware, instruments and entities the text names, by catalog number, name, model or synonym. Imports and the seed do this already.
- Then read the document (`library.read`) and add what matching missed with `library.propose_mentions`: the assay (`{passage, text: "sandwich ELISA", assay: "ELISA"}`), stated parameters as quantities (`{passage, text: "block for 1 hour", parameter: {name: "blocking time", value: {value: "1", unit: "h"}}}`), and records named differently (`{passage, text, record}`). `text` is the words exactly as written in that passage. Up to 200 per call.
- A person confirms or rejects them (`library.review_mentions`); you can't. Say what you proposed and that it waits for review: the document shows up on the Review page with its count.
- Answer "which SOPs use DY206?" with `library.mentions {record}` and "what blocking times do our ELISAs use?" with `library.mentions {parameter: "blocking time"}`. Proposed mentions are not confirmed yet: say so when you use them.
