import {
  type CheckResult,
  DocumentAttributes,
  defineKind,
  type FileAttributes,
} from '@ailab/schema';

const PLAN = 'Library (plan 011)';

const check = (
  id: string,
  label: string,
  severity: CheckResult['severity'],
  problem: string | undefined,
  fix: string,
  section: string,
): CheckResult => ({
  id,
  label,
  severity,
  source: PLAN,
  section,
  passed: problem === undefined,
  ...(problem ? { message: problem } : {}),
  fix,
});

/** Licenses that keep a document inside the lab (plan 011 defaults). */
export function sharePolicyFor(license: string): 'shareable' | 'lab_private' {
  return /all rights reserved|non-?commercial|\bnc\b|private use|proprietary/i.test(license)
    ? 'lab_private'
    : 'shareable';
}

/**
 * A library document (plan 011a, S1): the source as published, with its files. One record per
 * source; a new revision is a new version of it.
 */
export const document = defineKind({
  kind: 'document',
  idPrefix: 'doc',
  namePrefix: 'DOC',
  nameWidth: 4,
  attributes: DocumentAttributes,
  links: (a) => [
    ...a.files.map((f) => ({ toId: f.file, relation: 'has_file' })),
    ...(a.vendor ? [{ toId: a.vendor, relation: 'published_by' }] : []),
  ],
  sections: [
    {
      id: 'source',
      title: 'Source',
      fields: [
        'type',
        'authors',
        'vendor',
        'version',
        'published',
        'doi',
        'url',
        'journal',
        'partNumbers',
        'language',
      ],
    },
    { id: 'license', title: 'License', fields: ['license'] },
    { id: 'files', title: 'Files', fields: ['files'] },
    { id: 'topics', title: 'Topics', fields: ['assays', 'tags', 'notes'] },
  ],
  related: async (a, { get }) => {
    const invalid: string[] = [];
    const seen = new Set<string>();
    for (const f of a.files) {
      if (seen.has(f.file)) invalid.push(`${f.file} is listed twice`);
      seen.add(f.file);
      const record = await get(f.file);
      if (record?.kind !== 'file') invalid.push(`${f.file} is not a stored file in this lab`);
    }
    if (a.vendor && (await get(a.vendor))?.kind !== 'vendor') {
      invalid.push(`${a.vendor} is not a vendor in this lab`);
    }
    const originals = a.files.filter((f) => f.role === 'original');
    if (originals.length > 1) invalid.push('Only one file can be the original');
    const original = originals[0] ? await get(originals[0].file) : undefined;
    const media = (original?.attributes as FileAttributes | undefined)?.mediaType;
    const suggested = sharePolicyFor(a.license.name);
    return {
      invalid,
      checks: [
        check(
          'has_original',
          'Its original file is stored',
          'blocker',
          originals.length === 1 ? undefined : 'No file is marked as the original',
          'Upload the source with files.upload and add it with role "original"',
          'files',
        ),
        check(
          'share_policy_matches_license',
          'Sharing matches the license',
          'warning',
          a.license.sharePolicy === 'shareable' && suggested === 'lab_private'
            ? `"${a.license.name}" reads as a license that keeps it in the lab`
            : undefined,
          'Set the share policy to lab_private unless the license allows sharing',
          'license',
        ),
        check(
          'code_is_text',
          'Protocol code is stored as text',
          'warning',
          a.type === 'protocol_code' && media && !/^text\/|json|xml|yaml/.test(media)
            ? `Its original is ${media}`
            : undefined,
          'Store the code file itself (text/x-python, text/markdown…) as the original',
          'files',
        ),
      ],
    };
  },
});

export const libraryKinds = [document];
