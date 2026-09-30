import { idPrefixPattern, type KindDefinition, namePrefixPattern } from '@ailab/schema';
import { RecordError } from './errors.ts';

/** The kinds the record service accepts. Each registry module registers its kinds at startup. */
export class KindRegistry {
  readonly #kinds = new Map<string, KindDefinition>();

  register(definition: KindDefinition): this {
    const { kind, idPrefix, namePrefix, nameWidth } = definition;
    if (this.#kinds.has(kind)) throw new Error(`Kind "${kind}" is already registered`);
    if (!idPrefixPattern.test(idPrefix)) throw new Error(`Invalid ID prefix "${idPrefix}"`);
    if (!namePrefixPattern.test(namePrefix)) throw new Error(`Invalid name prefix "${namePrefix}"`);
    if (!Number.isInteger(nameWidth) || nameWidth < 1) throw new Error(`Invalid name width`);
    const mine = [namePrefix, ...(definition.otherNamePrefixes ?? [])];
    for (const prefix of mine) {
      if (!namePrefixPattern.test(prefix)) throw new Error(`Invalid name prefix "${prefix}"`);
    }
    for (const other of this.#kinds.values()) {
      if (other.idPrefix === idPrefix) throw new Error(`ID prefix "${idPrefix}" is already used`);
      const taken = mine.find((p) => namePrefixesOf(other).includes(p));
      if (taken) throw new Error(`Name prefix "${taken}" is already used`);
    }
    this.#kinds.set(kind, definition);
    return this;
  }

  list(): KindDefinition[] {
    return [...this.#kinds.values()].sort((a, b) => a.kind.localeCompare(b.kind));
  }

  get(kind: string): KindDefinition {
    const definition = this.#kinds.get(kind);
    if (!definition) throw new RecordError('unknown_kind', `Unknown record kind "${kind}"`);
    return definition;
  }
}

/** Every readable name prefix a kind names its records with. */
export function namePrefixesOf(kind: KindDefinition): string[] {
  return [kind.namePrefix, ...(kind.otherNamePrefixes ?? [])];
}
