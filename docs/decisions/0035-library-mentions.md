# 0035: Library mentions as reviewed rows beside the passages

- Status: accepted
- Date: 2026-09-30
- Plan: 011 (S6)

## Context

Plan 011 S6 makes the library mineable: after parsing, what each passage mentions (registry records, the assay type, stated parameters as quantities) is proposed, each tied to its passage, and a person confirms in bulk. Queries such as "which SOPs use DY206?" or "what blocking times do our ELISAs use?" then read confirmed mentions. A document can have hundreds of mentions, and parsing again replaces its passages.

## Options

1. A library-owned `library_mentions` table, one row per mention with its status, reviewed in bulk by `library.review_mentions`.
2. Record links (`records.link`) from the document to each record, one per mention, reviewed through the record proposals flow.
3. Mentions inside the document record's attributes.

## Decision

Option 1.

- `library_mentions` holds the document, file, passage id, section, heading path, page, the words as written, what it mentions (`record` with its id, `assay`, or `parameter` with a name and a quantity with its unit), how it was found (`catalog_number`, `name`, `synonym`, `model`, `agent`), status (`proposed`, `confirmed`, `rejected`) and who proposed and reviewed it.
- `library.mine` is deterministic: `packages/domain/src/mentions.ts` matches the names, catalog numbers, instrument models and entity synonyms of the lab's products, labware types, instrument kinds and entities (not archived) at word boundaries, with spaces and dashes interchangeable; names shorter than 4 characters and codes shorter than 3 are ignored, and one passage names a record once, preferring the catalog number.
- Agents add what matching can't with `library.propose_mentions` (a record, the assay, or a parameter as a quantity), citing the passage and the words as written; each words must appear in its passage.
- `library.review_mentions` confirms or rejects in bulk and is for people only. `library.mentions` lists by document, record, parameter name or status.
- Parsing again deletes the document's proposed mentions; confirmed and rejected ones stay, and the same words under the same heading are not proposed again.
- Proposing links to drafts of records the lab doesn't have yet is left to the agent (draft the record, then propose the mention).

## Consequences

- Hundreds of mentions per document don't fill the record history or the Review page; they are reviewed where they are read (record pages, and the document page in 011d).
- A reviewed mention keeps the passage id it was found in, which a later parse replaces; its heading, page and words still say where it is.
- Confirmed mentions aren't record links, so `records.links` doesn't list them; "Mentioned in" on a record page reads `library.mentions`.
