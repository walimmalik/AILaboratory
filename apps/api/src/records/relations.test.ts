import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { RELATION_WORDS } from '@ailab/schema';
import { describe, expect, it } from 'vitest';

/** Relations a kind sets from a value rather than a literal, with where the value comes from. */
const FROM_VALUES = [
  'follows_up', // an experiment's followsUp.relation
  'repeats_with_changes',
  'prefer', // a memory's effect
  'avoid',
];

/** Every `relation: '…'` a kind declares in the API's source. */
function declaredRelations(): Set<string> {
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name))
        for (const m of readFileSync(path, 'utf8').matchAll(/relation: '([a-z_]+)'/g))
          found.add(m[1] as string);
    }
  };
  walk(join(import.meta.dirname, '..'));
  return found;
}

describe('relation words', () => {
  it('name every relation a kind declares, from both ends', () => {
    const declared = [...declaredRelations(), ...FROM_VALUES];
    expect(declared.filter((r) => !(r in RELATION_WORDS))).toEqual([]);
    const unused = Object.keys(RELATION_WORDS).filter((r) => !declared.includes(r));
    expect(unused).toEqual([]);
  });
});
