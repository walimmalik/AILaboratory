# 011: SOP and literature library

- Status: accepted. Round 1 (S1 to S6) accepted by Wali 2026-09-29, all as recommended (note on S5 below).
- Depends on: 002 (records, links, history), 003 (operations), 004c (draft-and-confirm), 007 to 010 (the registries that mined mentions link to)
- Feeds: 012 (digital SOPs are built from library documents and cite their passages), 005 (lab memory reuses the same search), 009 (SDS and CoA files use the file store), 013 (experiments tag the SOPs and papers they follow), 020 (analysis methods cite papers)

## What this plan delivers

The lab's reading shelf, searchable by people and agents:

- **Documents:** SOPs, vendor manuals, papers, robot protocol code and web pages, each with its original file, its text split into sections with page anchors, and metadata (title, authors, version, source, DOI, license).
- **A file store** for originals and derived files. It is the first place the app stores files, so SDS and CoA files (009) use it too.
- **Search:** keyword and meaning-based search over passages, with filters (type, assay, linked record) and every hit pointing to its page and heading.
- **Mining:** an agent reads each document and proposes links to what it mentions (products with catalog numbers, labware, instruments, cell lines, assay type) plus the key parameters it states, each tied to the passage it came from. A person confirms. Then "which SOPs use TMB?" or "what blocking times do our ELISAs use?" is a query, not a reading job.

Digital SOPs (structured, variablized procedures) are plan 012. This plan is about holding, reading and finding sources.

## Starting point

- `docs/sop-library/` in the repo (PR #8): 12 openly licensed SOPs, 7 papers, 4 GitHub-hosted protocol code items with licenses, and `manifest.json` (source, license, format, sha256, why picked, what it tests). Three Promega manuals are All Rights Reserved and stay on Wali's laptop (`C:\dev\sop-library`).
- The set deliberately includes messy SOPs (OpenWetWare transformation and TENS miniprep: hedged amounts, contradictions), long ones (73-step ELISA), code (Opentrons, LabOP) and one protocol in four forms (iGEM InterLab: DOCX, PDF, LabOP model, generated Markdown, plate map image), which is the ground truth for 012.
- `seed/sops/own/`: 11 short lab SOPs in Markdown with variables in front matter. They load here as documents and are the first things 012 digitizes.
- Postgres runs as `pgvector/pgvector:pg17` already. The science service (FastAPI) has no document libraries yet.
- 009 left SDS files as links "until the app has file attachments".

## Proposed model (assuming the recommended answers)

| Layer | Record | Holds |
| --- | --- | --- |
| Kind | **Document** (`doc_`, `DOC-0001`) | Type (SOP, vendor manual, paper, protocol code, web page, note), title, authors or vendor, version or revision date, DOI or URL, license and share policy, assays and tags, files, status. One record per source; a new revision is a new version of the same record |
| Instance | **File** (`fil_`, `FIL-0001`) | sha256, size, media type, original name, where it came from; the bytes live in the file store, addressed by hash |
| State | **Parsed text** | Sections (heading path, page range), passages (chunks) with text, page and heading, full-text index and embedding; tables kept as tables; figures kept as images with captions |
| State | **Mentions** | What a passage mentions (a product, labware type, instrument kind, entity, assay type, parameter with a quantity) and the proposed or confirmed link to a registry record |

## Operations (first cut)

| Operation | Agents |
| --- | --- |
| `files.upload`, `files.get` (bytes or a signed link) | direct |
| `library.add` (from an uploaded file, a URL or DOI, or a folder with a manifest), `library.update`, `library.add_revision` | direct on drafts, proposed on active |
| `library.parse` (runs conversion and indexing; re-runnable) | direct |
| `library.search` (passages, with filters), `library.get`, `library.read` (a section or page range as text) | read |
| `library.mine` (propose mentions and links), `library.confirm_mentions` | direct / people |
| `library.where_mentioned` (every document that mentions a record) | read |

## Screens

- **Library:** a dense list with type, assay, version, license, number of confirmed links; a search box that returns passages with the hit highlighted.
- **Document page:** the original (PDF viewer or rendered text) beside its sections, with mentions underlined and linked; a side list of what it mentions (confirmed in normal ink, proposed in agent ink); versions with a text diff.
- **Record pages gain "Mentioned in"**: a product or labware page lists the documents and passages that mention it.

## Round 1 answers

Wali chose A for S1 to S6 on 2026-09-29.

- **S5, embeddings.** Local model by default. Wali would also use a cheap hosted model (for example a Google embedding model through OpenRouter) if one is available. So embeddings go through a small provider interface, like the chat model adapters (004b): `local` (science service) or `openai-compatible` (OpenRouter or similar), chosen in `.env`. One provider is active per lab; the model name is stored with every vector and switching re-embeds everything, so results never mix models. A hosted provider sends passage text out of the machine, including lab-private manuals; the settings note says so. Whether OpenRouter serves embeddings, and at what price, is checked before 011b.

## Round 1 questions (as asked)

Recommended option in bold.

| # | Question | Options | Recommendation and why |
| --- | --- | --- | --- |
| S1 | Is a library document the same thing as a digital SOP? | A) Two records: the **document** is the source as published (file plus extracted text, versioned when the source is revised); the **digital SOP** (012) is a structured design built from it, linked back with a passage anchor per step and value · B) One record: an SOP document is structured in place, and papers simply never get structured · C) Only digital SOPs; the original file is an attachment on one | **A.** Provenance stays clean (the vendor text never changes under you), one source can yield several digital SOPs (the Promega manual gives a 96-well and a 384-well version), and papers and manuals live here without pretending to be procedures. When a vendor revises a manual, the digital SOPs built from the old revision get flagged. |
| S2 | Where do files live? | A) A content-addressed file store (bytes named by sha256) on a Docker volume now, behind one interface that can switch to S3-compatible storage (MinIO) on the cluster; each file is a `fil_` record · B) In Postgres (bytea or large objects) · C) MinIO in the compose stack from day one | **A.** Simple on your laptop, the database stays small and fast to back up, identical files are stored once, and the hash doubles as the sha256 check `manifest.json` already uses. The interface keeps the move to the cluster a configuration change. |
| S3 | How is a PDF, DOCX or web page turned into text? | A) The science service converts it with Docling (MIT, IBM): headings, reading order, tables as tables, page numbers, OCR for scanned pages, figures cut out as images with captions; plain readers for Markdown and code. The result is stored as sections and passages · B) Send the whole file to a multimodal model and let it read it · C) Plain text extraction (pypdf), no structure | **A.** Section and page anchors are what make citations and 012's "this value came from page 4" possible, tables carry most SOP parameters, and it runs locally (the Promega manuals never leave your machine). A model reads the Docling output later when digitizing, and can look at a figure image when it needs to (plate map pictures). Docling downloads its layout models once; that happens on your laptop, since the cloud policy blocks it. |
| S4 | How does search work? | A) Hybrid: Postgres full-text search plus pgvector similarity over passages, merged into one ranking, with filters (type, assay, linked record, license); each hit is a passage with its page and heading · B) Full-text only now, meaning-based search later · C) Meaning-based only | **A.** Keyword search finds "DY206" and "TMB" exactly; meaning-based search finds "how long do we block" when the text says "incubate with reagent diluent for 1 h". Both are in the database we already run, so no new service. Lab memory (005) reuses the same search. |
| S5 | Which model makes the embeddings for meaning-based search? | A) A small open model run locally in the science service (for example bge-small-en-v1.5 or nomic-embed-text, both permissively licensed and fine on a CPU for a library this size); the model name is stored with each vector and changing model re-embeds in a background job · B) An embeddings API (OpenAI-compatible, or OpenRouter if it offers one), paid per call · C) No embeddings (only if S4 is B) | **A.** Private manuals stay on the machine, it costs nothing, results are reproducible, and it runs offline. A few thousand passages embed in minutes on a laptop. I will check the exact model's license and quality on the test set before building. |
| S6 | What does "mineable" mean in this plan? | A) After parsing, an agent extracts mentions (products with catalog numbers, labware, instruments, cell lines and organisms, assay type) and stated parameters (volumes, concentrations, times, temperatures, speeds, as quantities with units), each tied to its passage, and proposes links to registry records or drafts of missing ones; a person confirms links in bulk. Queries across the library then use confirmed links and parameters · B) Search only; values are pulled out only when a document is digitized in 012 · C) A full knowledge graph of claims and relations between papers | **A.** It makes the library answer lab questions ("which of our SOPs use DuoSet DY206", "what TMB times appear across our ELISAs") and gives 012 a head start, since most materials are already matched. C is a research project of its own. Mentions an agent proposes stay in agent ink until confirmed. |

## Defaults I'm assuming (say if any is wrong)

- One document kind for SOPs, manuals, papers, code and web pages, with a type field and type-specific metadata (DOI and journal for papers, vendor and part numbers for manuals, language and API version for code).
- Licensing is recorded per document with a share policy: All Rights Reserved and non-commercial items are lab-private, are never written to `seed/` or any export, and are still searchable inside the lab.
- Ways in: upload in the app (drag and drop, several at once), an agent through MCP (upload or URL), and bulk import of a folder with a `manifest.json` like `docs/sop-library`. Fetching by URL or DOI works where the network allows (your laptop, not the cloud sandbox).
- The seed loads `seed/sops/own/` and the committed `docs/sop-library` items; the Promega manuals load from your laptop folder, never from the repo.
- Robot protocol code (Opentrons, LabOP, PyLabRobot) is stored and searchable as text now; understanding it as a procedure is 012's job.
- Documents are never deleted once active; superseded revisions stay readable.

## Proposed split

- **011a:** file store and `fil_` records, document kind, upload and folder import, seed loader. Built (ADR 0033).
- **011b:** conversion in the science service, sections and passages, full-text and embeddings, `library.search` and `library.read`.
- **011c:** mining (mentions, proposed links, bulk confirm), "mentioned in" on record pages.
- **011d:** library and document screens, agent skill.
