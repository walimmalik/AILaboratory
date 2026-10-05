import { mediaTypeOf } from '@ailab/domain';
import {
  type DocumentAttributes,
  type DocumentType,
  type FileAttributes,
  filesUpload,
  libraryAdd,
  libraryMentions,
  libraryMine,
  libraryParse,
  libraryRead,
  librarySearch,
  MAX_FILE_BYTES,
  type Mention,
  type RecordEnvelope,
} from '@ailab/schema';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useSearch } from '@tanstack/react-router';
import { type ReactNode, useEffect, useState } from 'react';
import { api } from '../api.ts';
import type { DocumentSection, DocumentsSearch } from '../lib/document-search.ts';
import { recordQuery } from '../queries.ts';
import { Head, page } from './AreaHead.tsx';
import { DocumentMentions, mentionsQuery } from './Mentions.tsx';
import { RecordList } from './Records.tsx';

/** Library screens (plan 011d): the document list with text search, and a document's page. */

const typeWords: Record<DocumentType, string> = {
  sop: 'SOP',
  vendor_manual: 'Vendor manual',
  paper: 'Paper',
  protocol_code: 'Protocol code',
  web_page: 'Web page',
  note: 'Note',
};

const roleWords = {
  original: 'Original',
  alternate: 'Other form',
  supplement: 'Supplement',
  earlier_revision: 'Earlier revision',
} as const;

const licenses = [
  { name: 'All Rights Reserved', sharePolicy: 'lab_private' },
  { name: 'CC BY 4.0', sharePolicy: 'shareable' },
  { name: "The lab's own", sharePolicy: 'shareable' },
] as const;

const fileUrl = (id: string) => `/api/v1/files/${id}`;

function bytesWords(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A search snippet with its matches, which the API marks as [[word]], highlighted. */
export function Snippet({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let at = 0;
  text.split(/\[\[(.*?)\]\]/).forEach((part, i) => {
    if (i % 2 === 1) parts.push(<mark key={at}>{part}</mark>);
    else if (part) parts.push(part);
    at += part.length + (i % 2 === 1 ? 4 : 0);
  });
  return <>{parts}</>;
}

export function DocumentsPage() {
  const confirmed = useQuery({
    queryKey: ['library', 'mentions', { status: 'confirmed' }],
    queryFn: () => api.run(libraryMentions, { status: 'confirmed', limit: 500 }),
  });
  const counts = new Map<string, number>();
  for (const m of confirmed.data?.mentions ?? [])
    counts.set(m.document, (counts.get(m.document) ?? 0) + 1);
  const of = (r: RecordEnvelope) => r.attributes as Partial<DocumentAttributes>;
  const search = useSearch({ from: '/app/documents' });
  const navigate = useNavigate({ from: '/documents' });
  const words = search.words ?? search.q ?? '';
  const query = search.q ?? '';
  const mode = search.mode ?? 'text';
  const updateSearch = (changes: Partial<DocumentsSearch>) =>
    void navigate({ search: (previous) => ({ ...previous, ...changes }), replace: true });
  const [adding, setAdding] = useState(false);
  return (
    <>
      <Head
        page={page('document')}
        lede="SOPs, vendor manuals, papers and protocol code as published, searchable by their text, with what each one mentions."
        actions={
          <button
            type="button"
            className="btn"
            aria-expanded={adding}
            onClick={() => setAdding(!adding)}
          >
            Add documents
          </button>
        }
      />
      {adding && <AddDocuments onClose={() => setAdding(false)} />}
      <div className="toolbar">
        <fieldset className="segmented">
          <legend className="sr-only">Document search mode</legend>
          <button
            type="button"
            aria-pressed={mode === 'text'}
            onClick={() => updateSearch({ mode: 'text' })}
          >
            Document text
          </button>
          <button
            type="button"
            aria-pressed={mode === 'titles'}
            onClick={() => updateSearch({ mode: 'titles' })}
          >
            Titles
          </button>
        </fieldset>
      </div>
      {mode === 'text' && (
        <section className="block" aria-label="Document text search">
          <header>
            <h2>Document text</h2>
          </header>
          <div className="body">
            <p className="muted">Searches the text of available documents.</p>
            <form
              className="toolbar"
              aria-label="Search document text"
              onSubmit={(event) => {
                event.preventDefault();
                updateSearch({ q: words.trim() || undefined });
              }}
            >
              <label htmlFor="document-text-search">Words or phrase</label>
              <input
                id="document-text-search"
                className="field grow"
                type="search"
                placeholder='Words or "a phrase"'
                value={words}
                onChange={(event) => {
                  updateSearch({ words: event.target.value, q: undefined });
                }}
              />
              <button type="submit" className="btn" disabled={!words.trim()}>
                Search the text
              </button>
              <button
                type="button"
                className="link-btn"
                disabled={!words && !query}
                onClick={() => {
                  updateSearch({ words: '', q: undefined });
                }}
              >
                Clear
              </button>
            </form>
            {query && <Passages query={query} />}
          </div>
        </section>
      )}
      <div hidden={mode !== 'titles'}>
        <RecordList
          title="Documents"
          kind="document"
          placeholder="Find by title or name"
          empty="No documents yet. Add files, or load the seed lab."
          noMatch="No title has those words."
          filters={{
            search: search.title ?? '',
            status: search.status ?? 'current',
            onChange: (filters) => updateSearch({ title: filters.search, status: filters.status }),
          }}
          columns={[
            {
              header: 'Type',
              cell: (r) => (of(r).type ? typeWords[of(r).type as DocumentType] : '—'),
            },
            {
              header: 'Assay',
              cell: (r) => of(r).assays?.join(', ') || '—',
              filled: (r) => !!of(r).assays?.length,
            },
            {
              header: 'Version',
              cell: (r) => of(r).version ?? '—',
              filled: (r) => !!of(r).version,
            },
            {
              header: 'License',
              cell: (r) => {
                const license = of(r).license;
                if (!license) return '—';
                return license.sharePolicy === 'lab_private'
                  ? `${license.name}, lab only`
                  : license.name;
              },
            },
            {
              header: 'Confirmed mentions',
              cell: (r) => counts.get(r.id) ?? 0,
              filled: (r) => !!counts.get(r.id),
              className: 'num',
            },
          ]}
        />
      </div>
    </>
  );
}

/** Passages for the submitted text query. Editing the input clears this view. */
function Passages({ query }: { query: string }) {
  const hits = useQuery({
    queryKey: ['library', 'search', query],
    queryFn: () => api.run(librarySearch, { text: query, limit: 20 }),
  });
  return (
    <section className="passages" aria-label="Passages found" aria-live="polite">
      <p className="muted">
        {hits.isFetching || hits.isPending
          ? `Searching for “${query}”…`
          : hits.error
            ? `Search failed for “${query}”.`
            : `${hits.data?.hits.length ?? 0} ${hits.data?.hits.length === 1 ? 'passage' : 'passages'} with “${query}”`}
      </p>
      {hits.error && (
        <>
          {!hits.isFetching && <p className="error-text">{hits.error.message}</p>}
          <button
            type="button"
            className="btn small"
            disabled={hits.isFetching}
            onClick={() => void hits.refetch()}
          >
            Try again
          </button>
        </>
      )}
      {!hits.error && hits.data?.hits.length === 0 && (
        <p className="empty">
          No passage has all those words. Try the words the source would use, or "or" between
          alternatives.
        </p>
      )}
      {!hits.error && hits.data && hits.data.hits.length > 0 && (
        <ol className="hits">
          {hits.data.hits.map((hit) => (
            <li key={hit.passage.id}>
              <p className="hit-doc">
                <Link
                  to="/records/$id"
                  params={{ id: hit.document.id }}
                  search={{ section: hit.passage.section }}
                  hash="document-text"
                >
                  {hit.document.label}
                </Link>{' '}
                <span className="muted">
                  {hit.passage.heading.join(' › ')}
                  {hit.passage.page ? `, page ${hit.passage.page}` : ''}
                </span>
              </p>
              <p className="snippet">
                <Snippet text={hit.snippet} />
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** The file's bytes as base64, for files.upload. */
function base64Of(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

/** Upload files, each as a draft document, and make the readable ones searchable. */
function AddDocuments({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [type, setType] = useState<DocumentType>('sop');
  const [license, setLicense] = useState(0);
  const [results, setResults] = useState<ReactNode[]>([]);
  const add = useMutation({
    mutationFn: async () => {
      const lines: ReactNode[] = [];
      for (const file of files) {
        if (file.size > MAX_FILE_BYTES) {
          lines.push(`${file.name}: larger than 50 MB, not added.`);
          continue;
        }
        const stored = await api.run(filesUpload, {
          name: file.name,
          mediaType: file.type || mediaTypeOf(file.name),
          base64: await base64Of(file),
        });
        const document = await api.run(libraryAdd, {
          label: file.name.replace(/\.[^.]+$/, ''),
          type,
          license: licenses[license] ?? licenses[0],
          files: [{ file: stored.file.id, role: 'original' }],
        });
        let text = 'added as a draft';
        try {
          await api.run(libraryParse, { document: document.id });
          const mined = await api.run(libraryMine, { document: document.id });
          text += `, searchable, ${mined.added} mentions proposed`;
        } catch (error) {
          text += `; not searchable yet: ${error instanceof Error ? error.message : String(error)}`;
        }
        lines.push(
          <>
            <Link to="/records/$id" params={{ id: document.id }}>
              {document.name} {document.label}
            </Link>{' '}
            {text}.
          </>,
        );
        setResults([...lines]);
      }
      setResults(lines);
    },
    onSettled: () => {
      setFiles([]);
      void queryClient.invalidateQueries({ queryKey: ['records'] });
      void queryClient.invalidateQueries({ queryKey: ['library'] });
    },
  });
  return (
    <section className="block" aria-label="Add documents">
      <header>
        <h2>Add documents</h2>
      </header>
      <div className="body">
        <form
          className="toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            setResults([]);
            add.mutate();
          }}
        >
          <input
            className="field grow"
            type="file"
            multiple
            aria-label="Files"
            onChange={(e) => setFiles([...(e.target.files ?? [])])}
          />
          <select
            className="field"
            aria-label="Type"
            value={type}
            onChange={(e) => setType(e.target.value as DocumentType)}
          >
            {Object.entries(typeWords).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            className="field"
            aria-label="License"
            value={license}
            onChange={(e) => setLicense(Number(e.target.value))}
          >
            {licenses.map((l, i) => (
              <option key={l.name} value={i}>
                {l.name}
                {l.sharePolicy === 'lab_private' ? ' (lab only)' : ''}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="btn primary"
            disabled={files.length === 0 || add.isPending}
          >
            {add.isPending ? 'Adding…' : files.length > 1 ? `Add ${files.length}` : 'Add'}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </form>
        <p className="muted">
          Each file becomes a draft document for you to check and confirm. Markdown, HTML, code and
          text become searchable now; PDF and Word files are stored and wait for the PDF reader.
        </p>
        {add.error && <p className="error-text">{add.error.message}</p>}
        {results.length > 0 && (
          <ul className="plain">
            {results.map((line, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: lines are appended in order, never moved
              <li key={i}>{line}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** A document's page: its files, its text by section with mentions marked, what it mentions. */
export function DocumentBlocks({
  record,
  section,
}: {
  record: RecordEnvelope;
  section?: DocumentSection | undefined;
}) {
  const mentions = useQuery(mentionsQuery({ document: record.id })).data?.mentions ?? [];
  return (
    <>
      <FilesBlock record={record} />
      <TextBlock key={record.id} record={record} mentions={mentions} section={section} />
      <DocumentMentions mentions={mentions} />
    </>
  );
}

function FilesBlock({ record }: { record: RecordEnvelope }) {
  const files = (record.attributes as Partial<DocumentAttributes>).files ?? [];
  const records = useQueries({ queries: files.map((f) => recordQuery(f.file)) });
  return (
    <section className="block" aria-label="Stored files">
      <header>
        <h2>Stored files</h2>
        <span className="state muted num">{files.length}</span>
      </header>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>File</th>
              <th>Role</th>
              <th>Type</th>
              <th>Size</th>
            </tr>
          </thead>
          <tbody>
            {files.map((f, i) => {
              const file = records[i]?.data;
              const a = file?.attributes as Partial<FileAttributes> | undefined;
              return (
                <tr key={f.file}>
                  <td>
                    <a href={fileUrl(f.file)} target="_blank" rel="noreferrer">
                      {a?.originalName ?? f.file}
                    </a>
                  </td>
                  <td>
                    {roleWords[f.role]}
                    {f.revision ? ` (${f.revision})` : ''}
                  </td>
                  <td className="muted">{a?.mediaType ?? '—'}</td>
                  <td className="num">{a?.size === undefined ? '—' : bytesWords(a.size)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Passage text with the words its mentions cite underlined (proposed ones in agent ink). */
export function markMentions(text: string, mentions: readonly Mention[]): ReactNode[] {
  const lower = text.toLowerCase();
  const spans: { from: number; to: number; mention: Mention }[] = [];
  for (const m of mentions) {
    const from = lower.indexOf(m.text.toLowerCase());
    if (from < 0 || m.status === 'rejected') continue;
    const to = from + m.text.length;
    if (spans.some((s) => from < s.to && to > s.from)) continue;
    spans.push({ from, to, mention: m });
  }
  spans.sort((a, b) => a.from - b.from);
  const out: ReactNode[] = [];
  let at = 0;
  for (const s of spans) {
    if (s.from > at) out.push(text.slice(at, s.from));
    const what = s.mention.what;
    const title =
      what.type === 'record'
        ? what.label
        : what.type === 'assay'
          ? `Assay: ${what.assay}`
          : what.parameter;
    out.push(
      <mark
        key={s.mention.id}
        className={s.mention.status === 'proposed' ? 'mention proposed' : 'mention'}
        title={s.mention.status === 'proposed' ? `${title} (not yet confirmed)` : title}
      >
        {text.slice(s.from, s.to)}
      </mark>,
    );
    at = s.to;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

export function TextBlock({
  record,
  mentions,
  section: requestedSection,
}: {
  record: RecordEnvelope;
  mentions: Mention[];
  section?: DocumentSection | undefined;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate({ from: '/records/$id' });
  const hash = useLocation({ select: (location) => location.hash });
  const section = requestedSection ?? 0;
  const outline = useQuery({
    queryKey: ['library', 'read', record.id],
    queryFn: () => api.run(libraryRead, { document: record.id }),
  });
  const sections = outline.data?.outline ?? [];
  const available = typeof section === 'number' && sections.some((item) => item.index === section);
  const passages = useQuery({
    queryKey: ['library', 'read', record.id, section],
    queryFn: () => {
      if (typeof section !== 'number') throw new Error('The requested section is unavailable.');
      return api.run(libraryRead, { document: record.id, section });
    },
    enabled: Boolean(outline.data?.parse) && available,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['library'] });
  const parse = useMutation({
    mutationFn: () => api.run(libraryParse, { document: record.id }),
    onSuccess: refresh,
  });
  const mine = useMutation({
    mutationFn: () => api.run(libraryMine, { document: record.id }),
    onSuccess: refresh,
  });
  const parsed = outline.data?.parse;
  const error =
    parse.error ?? mine.error ?? outline.error ?? (available ? passages.error : undefined);
  const targetReady = !outline.isPending && (!available || !passages.isPending);
  // The router's hash scroll may precede asynchronous record/text loading. Reveal the target
  // when that read settles, and only for an explicit source-hit anchor or section navigation.
  useEffect(() => {
    if (hash === 'document-text' && requestedSection !== undefined && targetReady)
      document.getElementById('document-text')?.scrollIntoView({ block: 'start' });
  }, [requestedSection, hash, targetReady]);
  return (
    <section id="document-text" className="block" aria-label="Text">
      <header>
        <h2>Text</h2>
        <span className="state muted num">
          {parsed ? `${parsed.sections} sections · ${parsed.passages} passages` : 'not read yet'}
        </span>
      </header>
      <div className="body">
        <div className="toolbar">
          <button
            type="button"
            className="btn small"
            disabled={parse.isPending}
            onClick={() => parse.mutate()}
          >
            {parsed ? 'Read the text again' : 'Read the text'}
          </button>
          {parsed && (
            <button
              type="button"
              className="btn small"
              disabled={mine.isPending}
              onClick={() => mine.mutate()}
            >
              Find mentions
            </button>
          )}
          {mine.data && (
            <span className="muted">
              {mine.data.added === 0 ? 'Nothing new found.' : `${mine.data.added} proposed.`}
            </span>
          )}
        </div>
        {error && <p className="error-text">{error.message}</p>}
        {requestedSection !== undefined && !outline.isPending && !outline.error && !available && (
          <p className="error-text">
            The requested section is unavailable in this document's current text. Choose a section
            below, or return to Documents and search again.
          </p>
        )}
        {parsed && parsed.warnings.length > 0 && (
          <p className="muted">{parsed.warnings.join(' ')}</p>
        )}
        {parsed && sections.length > 0 && (
          <div className="places">
            <ul className="tree" aria-label="Sections">
              {sections.map((s) => (
                <li key={s.index}>
                  <button
                    type="button"
                    className="link-btn"
                    aria-pressed={section === s.index}
                    onClick={() =>
                      void navigate({
                        search: (previous) => ({ ...previous, section: s.index }),
                        replace: true,
                      })
                    }
                  >
                    {s.heading.join(' › ') || 'Start'}
                  </button>
                  {s.pageFrom ? (
                    <span className="muted">
                      {' '}
                      p. {s.pageFrom}
                      {s.pageTo && s.pageTo !== s.pageFrom ? `–${s.pageTo}` : ''}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            <div className="passages">
              {available && passages.isPending && <p className="muted">Loading section…</p>}
              {(available ? (passages.data?.passages ?? []) : []).map((p) => (
                <p key={p.id} className="passage">
                  {markMentions(
                    p.text,
                    mentions.filter((m) => m.passage === p.id),
                  )}
                </p>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
