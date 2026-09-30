# 0034: Library text as sections and passages, searched in Postgres

- Status: accepted
- Date: 2026-09-30
- Plan: 011 (S3, S4, S5)

## Context

Plan 011 chose Docling in the science service for conversion (S3), hybrid full-text plus pgvector search over passages (S4) and a local embedding model by default (S5). Docling and the embedding models download their weights from Hugging Face once, which the cloud build environment can't reach, and S5 asks for the model's license and quality to be checked on the test set on the laptop first. Markdown, HTML and code need no models.

## Options

1. Build it in two steps: the passage store, plain readers, keyword search and reading now; Docling (PDF, DOCX) and embeddings next, once checked on the laptop.
2. Wait and build everything at once.

## Decision

Option 1, as 011b-1 and 011b-2.

- The science service has `POST /convert` (`apps/science/src/science/convert`): Markdown by ATX headings (front matter as its own section, fenced code kept whole), HTML by h1 to h6 (scripts, styles, navigation and footers left out, table rows as `a | b`), code as whole blocks under the file name, plain text by paragraphs. Paragraphs join into passages of about 1,200 characters, never split. PDF and DOCX answer 415 until 011b-2.
- The API calls it through a `Converter` (`SCIENCE_URL`, default `http://localhost:8001`); an unreachable service is the new `unavailable` error (HTTP 503).
- The library owns two tables: `library_parses` (one row per document and file: converter, counts, warnings, when and by whom) and `library_passages` (heading path, section and passage order, page, text, and a generated `tsvector` of heading and text with a GIN index).
- `library.parse` replaces a file's passages in one transaction, so it can run again. `library.search` uses `websearch_to_tsquery('english', …)` (all words, "phrases", -exclusions, or), ranks with `ts_rank_cd` and highlights with `ts_headline`, over each document's current original only (earlier revisions and alternate forms would repeat hits), with filters for type, assay and document. `library.read` gives the outline, a section or a page range.
- Imports and the seed parse what they can and report the rest.

## Consequences

- Search is keyword search until 011b-2 adds the embedding column and merges the two rankings; "how long do we block" needs the words that are in the text until then.
- PDFs, most of the test set, are stored and listed but not searchable until 011b-2.
- A later converter change only needs `library.parse` run again.
