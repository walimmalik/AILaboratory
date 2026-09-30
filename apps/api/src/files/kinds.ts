import {
  defineKind,
  type FileAttributes,
  FileAttributes as FileAttributesSchema,
} from '@ailab/schema';

/**
 * A stored file (plan 011a): what the bytes are and where they came from. Created active by
 * `files.upload`. The bytes never change: a new revision is a new file.
 */
export const file = defineKind({
  kind: 'file',
  idPrefix: 'fil',
  namePrefix: 'FIL',
  nameWidth: 4,
  attributes: FileAttributesSchema,
  links: (a) =>
    a.source.from === 'derived' ? [{ toId: a.source.file, relation: 'derived_from' }] : [],
  related: async (a, { current }) => {
    const before = current?.attributes as FileAttributes | undefined;
    if (before && (before.sha256 !== a.sha256 || before.size !== a.size)) {
      return { invalid: ["A file's bytes don't change; upload the new version as a new file"] };
    }
    return {};
  },
});

export const fileKinds = [file];
