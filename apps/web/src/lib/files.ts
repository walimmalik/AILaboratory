import {
  FileAttributes,
  FileId,
  labwareExportOpentrons,
  type OperationContract,
  type OutputFile,
  platemapsExport,
  transfersExport,
} from '@ailab/schema';

/** A file already stored by the API; its bytes are fetched through the file endpoint. */
export interface StoredFile {
  id: string;
  name: string;
  size: number;
  group: string;
}

/** Operations whose output is a file a person saves, by operation ID. */
const withFiles: OperationContract[] = [
  labwareExportOpentrons as OperationContract,
  platemapsExport as OperationContract,
];
const byId = new Map(withFiles.map((c) => [c.id, c]));

/** The file an operation's output holds, or undefined when it isn't one (or doesn't parse). */
export function fileOf(operationId: string, output: unknown): OutputFile | undefined {
  const contract = byId.get(operationId);
  if (!contract?.file) return undefined;
  const parsed = contract.output.safeParse(output);
  return parsed.success ? contract.file(parsed.data) : undefined;
}

/** All downloadable files from a validated completed operation output. */
export function filesOf(operationId: string, output: unknown): (OutputFile | StoredFile)[] {
  const inline = fileOf(operationId, output);
  if (inline) return [inline];
  if (operationId !== transfersExport.id) return [];
  const parsed = transfersExport.output.safeParse(output);
  if (!parsed.success) return [];
  return parsed.data.files.flatMap(({ file, filename, group }) => {
    const attributes = FileAttributes.safeParse(file.attributes);
    if (
      file.kind !== 'file' ||
      file.status !== 'active' ||
      !FileId.safeParse(file.id).success ||
      !attributes.success ||
      attributes.data.originalName !== filename ||
      attributes.data.source.from !== 'export' ||
      attributes.data.source.record !== parsed.data.plan.id ||
      attributes.data.source.version !== parsed.data.plan.version
    )
      return [];
    return [{ id: file.id, name: filename, size: attributes.data.size, group }];
  });
}

/** Saves a file through the browser. */
export function download(file: OutputFile) {
  const url = URL.createObjectURL(new Blob([file.text], { type: file.mediaType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** "12 KB", "1.4 MB". */
export function fileSize(file: OutputFile | StoredFile): string {
  const bytes = 'text' in file ? new TextEncoder().encode(file.text).length : file.size;
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
