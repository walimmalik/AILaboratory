import {
  labwareExportOpentrons,
  type OperationContract,
  type OutputFile,
  platemapsExport,
} from '@ailab/schema';

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
export function fileSize(file: OutputFile): string {
  const bytes = new TextEncoder().encode(file.text).length;
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
