import { idPrefixPattern, namePrefixPattern } from '@ailab/schema';
import { ulid } from 'ulid';

/** A new internal ID: `<prefix>_<ulid>`. */
export function newId(prefix: string): string {
  if (!idPrefixPattern.test(prefix)) throw new Error(`Invalid ID prefix "${prefix}"`);
  return `${prefix}_${ulid()}`;
}

/** A readable name: `PLT-000345`. Grows past `width` digits instead of wrapping. */
export function formatName(prefix: string, counter: number, width: number): string {
  if (!namePrefixPattern.test(prefix)) throw new Error(`Invalid name prefix "${prefix}"`);
  if (!Number.isSafeInteger(counter) || counter < 1) throw new Error(`Invalid counter ${counter}`);
  return `${prefix}-${String(counter).padStart(width, '0')}`;
}
