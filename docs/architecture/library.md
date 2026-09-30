# Library and files

The lab's reading shelf (plan [011](../plans/011-sop-library.md)): stored files, documents (SOPs, manuals, papers, protocol code, web pages), their text, search and mentions. Decisions: [ADR 0033](../decisions/0033-file-store.md).

## Where things live

| Concern | Code |
| --- | --- |
| File schema, media types, size limit | `packages/schema/src/files.ts` |
| Document schema | `packages/schema/src/library.ts` |
| Operation contracts | `packages/schema/src/operations/files.ts`, `operations/library.ts` |
| File store (local folder, in memory) | `apps/api/src/files/store.ts` |
| File kind | `apps/api/src/files/kinds.ts` |
| Document kind, share policy from a license | `apps/api/src/library/kinds.ts` |
| Operations | `apps/api/src/files/operations.ts`, `apps/api/src/library/operations.ts` |
| Folder import (manifest or Markdown with front matter) | `apps/api/src/library/import.ts`, command `library:import` |
| Download route | `GET /v1/files/:id` in `apps/api/src/app.ts` |
| Agent skill | `skills/library/SKILL.md` |

## Files (011a)

Bytes live in a content-addressed store, named by their sha256, so identical files are stored once. `FILE_STORE_DIR` sets the folder (default `apps/api/data/files`; the `files` volume at `/data/files` in compose). A `file` record (`fil_`, `FIL-0001`) is created active and holds `sha256`, `size` in bytes, `mediaType`, `originalName` and `source`: `upload`, `url` (with the URL), `folder` (with its path in an imported folder) or `derived` (from another file, linked `derived_from`). The bytes never change; the record service refuses a new hash or size.

- `files.upload` takes `base64` or `text`, up to 50 MB. The same bytes again in the same lab return the existing record with `stored: false`.
- `files.get` returns the record with `text` (text types: `text/*`, JSON, XML, YAML, code) or `base64`, or `as: "none"` for the record only.
- `GET /api/v1/files/<id>` serves the bytes to the lab (`?download=1` to save). Anything other than a PDF or a PNG, JPEG, GIF or WebP image is served sandboxed.
- The ledger keeps an upload's name and size, never its content.

| Operation | Does | Agents |
| --- | --- | --- |
| `files.upload` | Stores a file and returns its record | direct |
| `files.get` | A file's record and its content | read |

## Documents (011a, S1)

A `document` (`doc_`, `DOC-0001`) is a source as published: an SOP, vendor manual, paper, protocol code (Opentrons, LabOP, PyLabRobot), web page or note. It holds `type`, `authors`, `vendor` (a vendor record, for manuals), `version`, `published` (a year, year-month or date), `doi`, `url`, `journal`, `partNumbers`, `language` (for code), `license` (`name`, `url`, `sharePolicy`), `assays`, `tags`, `notes` and `files`: stored files, each with a role (`original`, `alternate` for the same content in another form, `supplement` for a figure or data file, `earlier_revision`). Sections: Source, License, Files, Topics.

- Refused: a file that isn't a stored file of this lab, a file listed twice, two originals, a vendor that isn't a vendor record.
- Readiness: a blocker when no file is the original; warnings when a license that reads as restrictive (All Rights Reserved, non-commercial, private use) is marked shareable, and when protocol code isn't stored as text.
- `lab_private` documents are searchable in the lab and never written to `seed/` or an export.
- A new revision is a new version of the same record (`library.add_revision`): the new file becomes the original and the old one stays as an `earlier_revision` with its version. Digital SOPs (012) built from the old revision keep citing it.

| Operation | Does | Agents |
| --- | --- | --- |
| `library.add` | Drafts a document with its files and metadata | direct (drafts) |
| `library.add_revision` | A new revision's file becomes the original | direct on drafts, proposed on confirmed |

Editing uses `records.update`; confirming uses review, section by section.

## Importing folders

`importIntoLibrary` uploads each file (`files.upload`, source `folder` with its path) and drafts each document (`library.add`, every value marked `imported` from its manifest entry or file), skipping documents the lab already has by title, so it can run again. Two folder formats:

- A `manifest.json` like `docs/sop-library`: `items` with `id`, `kind` (`sop`, `literature`, `automation`, `manual`, `web_page`, `note`), `title`, `authors`, `year`, `doi`, `source`, `license`, `assay` and `local_files` (the first is the original; images are supplements, other forms alternates). The share policy follows the license. Items whose files aren't in the folder are reported, not drafted.
- Markdown SOPs with front matter (`key`, `title`, `version`) like `seed/sops/own`, with a license given for the whole folder.

The seed loads `seed/sops/own` (the lab's own, shareable) and `docs/sop-library` (the three Promega manuals are reported missing). `pnpm --filter @ailab/api library:import --folder <path>` imports any other folder, such as the Promega manuals on the laptop (`C:\dev\sop-library`, which has the same manifest); a Markdown folder also needs `--license`.

## Not yet

Fetching a document by URL or DOI; conversion, sections and search (011b); mining (011c); screens (011d). Removing stored bytes nobody references.
