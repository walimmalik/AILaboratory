import { z } from 'zod';

/** Crockford base32, as used by ULIDs. */
const ULID = '[0-9A-HJKMNP-TV-Z]{26}';

/** Internal ID prefixes: lowercase letters, 2 to 5 characters. */
export const idPrefixPattern = /^[a-z]{2,5}$/;

/** Readable name prefixes: uppercase letters, 2 to 5 characters. */
export const namePrefixPattern = /^[A-Z]{2,5}$/;

/** Any internal record ID: `<prefix>_<ulid>`. */
export const recordIdPattern = new RegExp(`^[a-z]{2,5}_${ULID}$`);

export const RecordId = z
  .string()
  .regex(recordIdPattern, 'must be a record ID like lw_01J9Z3K8Q4…');
export type RecordId = z.infer<typeof RecordId>;

/** A record ID with a specific prefix, e.g. `recordIdOf('lw')` for labware. */
export function recordIdOf(prefix: string) {
  if (!idPrefixPattern.test(prefix)) throw new Error(`Invalid ID prefix "${prefix}"`);
  return z.string().regex(new RegExp(`^${prefix}_${ULID}$`), `must be a ${prefix}_ record ID`);
}

/** Readable record name: `PREFIX-000123`. */
export const RecordName = z.string().regex(/^[A-Z]{2,5}-\d+$/, 'must be a name like PLT-000345');
export type RecordName = z.infer<typeof RecordName>;
