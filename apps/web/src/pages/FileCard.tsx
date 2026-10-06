import type { OutputFile } from '@ailab/schema';
import { useState } from 'react';
import { download, fileSize, type StoredFile } from '../lib/files.ts';

/** An operation's inline or stored file: Download both, Copy inline text only. */
export function FileCard({ file }: { file: OutputFile | StoredFile }) {
  const [copied, setCopied] = useState<'yes' | 'failed'>();
  const stored = 'id' in file;
  const copy = () => {
    if (!('text' in file)) return;
    void navigator.clipboard.writeText(file.text).then(
      () => setCopied('yes'),
      () => setCopied('failed'),
    );
  };
  return (
    <div className="file-card">
      <span className="mono">{file.name}</span> <span className="muted">{fileSize(file)}</span>
      <span className="file-actions">
        {stored ? (
          <a className="btn" href={`/api/v1/files/${file.id}?download=1`}>
            Download
          </a>
        ) : (
          <>
            <button type="button" className="btn" onClick={() => download(file)}>
              Download
            </button>
            <button type="button" className="btn" onClick={copy}>
              {copied === 'yes' ? 'Copied' : 'Copy'}
            </button>
          </>
        )}
      </span>
      {copied === 'failed' && <span className="error-text"> The browser refused to copy.</span>}
    </div>
  );
}
