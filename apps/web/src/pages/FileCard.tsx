import type { OutputFile } from '@ailab/schema';
import { useState } from 'react';
import { download, fileSize } from '../lib/files.ts';

/** A file an operation returned: its name and size, with Download and Copy. */
export function FileCard({ file }: { file: OutputFile }) {
  const [copied, setCopied] = useState<'yes' | 'failed'>();
  const copy = () =>
    navigator.clipboard.writeText(file.text).then(
      () => setCopied('yes'),
      () => setCopied('failed'),
    );
  return (
    <div className="file-card">
      <span className="mono">{file.name}</span> <span className="muted">{fileSize(file)}</span>
      <span className="file-actions">
        <button type="button" className="btn" onClick={() => download(file)}>
          Download
        </button>
        <button type="button" className="btn" onClick={copy}>
          {copied === 'yes' ? 'Copied' : 'Copy'}
        </button>
      </span>
      {copied === 'failed' && <span className="error-text"> The browser refused to copy.</span>}
    </div>
  );
}
