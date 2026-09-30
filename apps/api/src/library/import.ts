import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type {
  DocumentAttributes,
  DocumentFile,
  DocumentType,
  EvidenceInput,
  RecordEnvelope,
} from '@ailab/schema';
import { parse } from 'yaml';
import { z } from 'zod';
import type { OperationRegistry } from '../operations/registry.ts';
import type { RecordContext } from '../records/service.ts';
import { sharePolicyFor } from './kinds.ts';

/**
 * Bulk import of a folder into the library (plan 011a): a folder with a `manifest.json` like
 * `docs/sop-library`, or a folder of Markdown SOPs with front matter like `seed/sops/own`. Every
 * file goes through `files.upload` and every document through `library.add`, as drafts.
 */

const MEDIA_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.py': 'text/x-python',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

export function mediaTypeOf(path: string): string {
  return MEDIA_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

export interface ImportFile {
  /** Its path inside the folder, kept as the file's source. */
  path: string;
  bytes: Uint8Array;
}

export interface ImportItem {
  key: string;
  label: string;
  attributes: Omit<DocumentAttributes, 'files'>;
  /** The first is the original. */
  files: ImportFile[];
  /** Where its metadata came from, e.g. "manifest.json, elisa-xia". */
  reference: string;
}

export interface ImportPlan {
  items: ImportItem[];
  /** Listed but without files in the folder, e.g. manuals kept on one laptop. */
  missing: { key: string; reason: string }[];
}

const ManifestItem = z.looseObject({
  id: z.string().min(1),
  kind: z.enum(['sop', 'literature', 'automation', 'manual', 'web_page', 'note']),
  title: z.string().min(1),
  assay: z.string().min(1).nullish(),
  authors: z.string().min(1).nullish(),
  year: z.number().int().nullish(),
  doi: z.string().min(1).nullish(),
  source: z.url().nullish(),
  license: z.string().min(1),
  local_files: z.array(z.string().min(1)).min(1),
});
const Manifest = z.looseObject({ items: z.array(ManifestItem) });

const TYPE: Record<z.infer<typeof ManifestItem>['kind'], DocumentType> = {
  sop: 'sop',
  literature: 'paper',
  automation: 'protocol_code',
  manual: 'vendor_manual',
  web_page: 'web_page',
  note: 'note',
};

async function readIfThere(path: string) {
  const found = await stat(path).then(
    (s) => s.isFile(),
    () => false,
  );
  return found ? new Uint8Array(await readFile(path)) : undefined;
}

/** Reads a folder with a `manifest.json` (the `docs/sop-library` format). */
export async function readManifestFolder(folder: string): Promise<ImportPlan> {
  const manifest = Manifest.parse(
    JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8')),
  );
  const plan: ImportPlan = { items: [], missing: [] };
  for (const item of manifest.items) {
    const reference = `manifest.json, ${item.id}`;
    const files: ImportFile[] = [];
    for (const path of item.local_files) {
      const bytes = await readIfThere(join(folder, path));
      if (bytes) files.push({ path, bytes });
    }
    if (files.length === 0) {
      plan.missing.push({
        key: item.id,
        reason: `${item.local_files.join(', ')} not in the folder`,
      });
      continue;
    }
    const doi = item.doi?.replace(/^https?:\/\/(dx\.)?doi\.org\//, '');
    plan.items.push({
      key: item.id,
      label: item.title,
      attributes: {
        type: TYPE[item.kind],
        ...(item.authors ? { authors: [item.authors] } : {}),
        ...(item.year ? { published: String(item.year) } : {}),
        ...(doi && /^10\.\d{4,9}\/\S+$/.test(doi) ? { doi } : {}),
        ...(item.source ? { url: item.source } : {}),
        license: { name: item.license, sharePolicy: sharePolicyFor(item.license) },
        ...(item.assay ? { assays: [item.assay] } : {}),
      },
      files,
      reference,
    });
  }
  return plan;
}

const FrontMatter = z.looseObject({
  key: z.string().min(1),
  title: z.string().min(1),
  version: z.union([z.string(), z.number()]).optional(),
});

/** Reads a folder of Markdown SOPs with front matter (the `seed/sops/own` format). */
export async function readMarkdownFolder(
  folder: string,
  license: { name: string; sharePolicy: 'shareable' | 'lab_private' },
): Promise<ImportPlan> {
  const plan: ImportPlan = { items: [], missing: [] };
  for (const name of (await readdir(folder)).filter((n) => n.endsWith('.md')).sort()) {
    const bytes = new Uint8Array(await readFile(join(folder, name)));
    const text = new TextDecoder().decode(bytes);
    const head = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    const meta = FrontMatter.safeParse(head ? parse(head[1] as string) : undefined);
    if (!meta.success) {
      plan.missing.push({ key: name, reason: 'no front matter with key and title' });
      continue;
    }
    plan.items.push({
      key: meta.data.key,
      label: meta.data.title,
      attributes: {
        type: 'sop',
        ...(meta.data.version !== undefined ? { version: String(meta.data.version) } : {}),
        license,
      },
      files: [{ path: basename(name), bytes }],
      reference: name,
    });
  }
  return plan;
}

export interface ImportReport {
  added: string[];
  existing: string[];
  missing: { key: string; reason: string }[];
  /** Documents turned into searchable text this run. */
  parsed: string[];
  /** Documents whose text isn't readable yet, and why (a PDF before Docling, no science service). */
  unparsed: { key: string; reason: string }[];
}

/**
 * Uploads each item's files, adds it as a draft document and parses its text when a reader can. A
 * document the lab already has (same title) is left alone, except that it is parsed if it wasn't
 * yet, so the import can run again once the science service is up.
 */
export async function importIntoLibrary(
  registry: OperationRegistry,
  ctx: RecordContext,
  plan: ImportPlan,
  reason: string,
): Promise<ImportReport> {
  const run = async <T>(operation: string, input: unknown): Promise<T> => {
    const result = await registry.execute(ctx, operation, input);
    if (result.status !== 'done') throw new Error(`${operation} was ${result.status}, not done`);
    return result.output as T;
  };
  const report: ImportReport = {
    added: [],
    existing: [],
    missing: [...plan.missing],
    parsed: [],
    unparsed: [],
  };
  const parse = async (document: RecordEnvelope) => {
    const read = await run<{ parse?: unknown }>('library.read', { document: document.id });
    if (read.parse) return;
    try {
      await run('library.parse', { document: document.id });
      report.parsed.push(`${document.name} ${document.label}`);
    } catch (error) {
      report.unparsed.push({
        key: `${document.name} ${document.label}`,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  };
  for (const item of plan.items) {
    const earlier = (
      await run<{ records: RecordEnvelope[] }>('records.list', {
        kind: 'document',
        search: item.label,
        limit: 50,
      })
    ).records.find((r) => r.label === item.label);
    if (earlier) {
      report.existing.push(`${earlier.name} ${item.label}`);
      await parse(earlier);
      continue;
    }
    const files: DocumentFile[] = [];
    for (const [i, f] of item.files.entries()) {
      const mediaType = mediaTypeOf(f.path);
      const { file } = await run<{ file: RecordEnvelope }>('files.upload', {
        name: basename(f.path),
        mediaType,
        base64: Buffer.from(f.bytes).toString('base64'),
        source: { from: 'folder', path: f.path },
        reason,
      });
      files.push({
        file: file.id,
        role: i === 0 ? 'original' : mediaType.startsWith('image/') ? 'supplement' : 'alternate',
      });
    }
    const evidence: Record<string, EvidenceInput> = Object.fromEntries(
      [...Object.keys(item.attributes), 'files'].map((key) => [
        key,
        { source: 'imported', reference: item.reference },
      ]),
    );
    const document = await run<RecordEnvelope>('library.add', {
      label: item.label,
      ...item.attributes,
      files,
      evidence,
      reason,
    });
    report.added.push(`${document.name} ${item.label}`);
    await parse(document);
  }
  return report;
}
