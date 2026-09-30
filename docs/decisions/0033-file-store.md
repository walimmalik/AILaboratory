# 0033: Content-addressed file store and file records

- Status: accepted
- Date: 2026-09-30
- Plan: 011 (S2)

## Context

The SOP and literature library (011) is the first part of the app that keeps files: PDFs, DOCX, HTML, Markdown, robot code and images. SDS and CoA files (009) and later instrument exports need the same. Wali chose S2 A: bytes in a content-addressed store on a Docker volume behind one interface that can move to S3-compatible storage on the cluster, each file a `fil_` record.

## Options

1. Bytes named by their sha256 in a folder (a Docker volume), a `file` record per lab per hash: small database, identical files stored once, the hash doubles as the integrity check `docs/sop-library/manifest.json` already uses.
2. Bytes in Postgres (bytea): one backup, but a large, slow database.
3. MinIO in compose from day one: another service to run on a laptop for no gain yet.

## Decision

Option 1.

- `FileStore` (`apps/api/src/files/store.ts`) has `put(bytes) → sha256` and `get(sha256)`. `LocalFileStore` writes `ab/cd/<sha256>` under `FILE_STORE_DIR` (default `apps/api/data/files`; `/data/files` on the `files` volume in compose), writing to a temporary name and renaming so readers never see half a file. `MemoryFileStore` is for tests. An S3-compatible store later is another implementation.
- A `file` record (`fil_`, `FIL-0001`, created active) holds `sha256`, `size`, `mediaType`, `originalName` and `source` (upload, URL, a path in an imported folder, or derived from another file). Its bytes never change; a revised document is a new file. The record service refuses a change of hash or size.
- `files.upload` takes base64 or UTF-8 text, up to 50 MB. The same bytes uploaded again in the same lab return the existing record (`stored: false`); another lab gets its own record over the same stored bytes.
- `files.get` returns text for text types and base64 otherwise. `GET /api/v1/files/<id>` serves the bytes to signed-in people and tokens of the lab. PDFs and common images are served as they are; every other type is served with `Content-Security-Policy: sandbox` and `nosniff`, so an uploaded HTML or SVG file can never act as the app.
- The activity ledger keeps an upload's name and size, not its content.
- Agents upload directly (a file is a fact, not a design); what the file becomes (a library document) is where review happens.

## Consequences

- Backing up the lab means the database and the files volume together.
- Deleting bytes is not possible yet: a stored hash may be shared by several labs' records. Garbage collection of unreferenced bytes waits until something needs it.
- Uploads go through JSON (base64), which costs a third more bytes on the wire; fine up to 50 MB. A streaming upload route can come with the library screens if needed.
