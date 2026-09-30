/** Media types the library knows by file extension (plan 011), for uploads and folder imports. */
const MEDIA_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  html: 'text/html',
  htm: 'text/html',
  md: 'text/markdown',
  txt: 'text/plain',
  py: 'text/x-python',
  json: 'application/json',
  csv: 'text/csv',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

/** A file's media type from its name, e.g. "DY206.pdf" is application/pdf; unknown is binary. */
export function mediaTypeOf(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  const extension = dot > 0 ? base.slice(dot + 1) : '';
  return MEDIA_TYPES[extension.toLowerCase()] ?? 'application/octet-stream';
}
