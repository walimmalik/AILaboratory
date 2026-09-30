# Library and files

The lab's reading shelf (plan [011](../plans/011-sop-library.md)): stored files, documents (SOPs, manuals, papers, protocol code, web pages), their text, search and mentions. Decisions: [ADR 0033](../decisions/0033-file-store.md).

## Where things live

| Concern | Code |
| --- | --- |
| File schema, media types, size limit | `packages/schema/src/files.ts` |
| Operation contracts | `packages/schema/src/operations/files.ts` |
| File store (local folder, in memory) | `apps/api/src/files/store.ts` |
| File kind | `apps/api/src/files/kinds.ts` |
| Operations | `apps/api/src/files/operations.ts` |
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

## Not yet

Documents, folder import and the seed loader (rest of 011a); conversion, sections and search (011b); mining (011c); screens (011d). Removing stored bytes nobody references.
