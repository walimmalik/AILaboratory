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
    for (const other of this.#kinds.values()) {
      if (other.idPrefix === idPrefix) throw new Error(`ID prefix "${idPrefix}" is already used`);
      if (other.namePrefix === namePrefix) {
        throw new Error(`Name prefix "${namePrefix}" is already used`);
      }
    }
    this.#kinds.set(kind, definition);
    return this;
  }

  get(kind: string): KindDefinition {
    const definition = this.#kinds.get(kind);
    if (!definition) throw new RecordError('unknown_kind', `Unknown record kind "${kind}"`);
    return definition;
  }
}
