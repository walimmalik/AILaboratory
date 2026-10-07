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

/** Literal record links have toId; workspace presentation references have id instead. */
function linkRelations(source: string): Set<string> {
  const found = new Set<string>();
  for (const object of source.matchAll(/\{[^{}]*\btoId(?:\s*:|\s*[,}])[^{}]*\}/g))
    for (const relation of object[0].matchAll(/relation:\s*['"]([a-z_]+)['"]/g))
      if (relation[1]) found.add(relation[1]);
  return found;
}

/** Every persisted relation, including kind-local and shared link helpers. */
function declaredRelations(): Set<string> {
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) {
        const source = readFileSync(path, 'utf8');
        for (const relation of linkRelations(source)) found.add(relation);
        // The memory kind's named() helper returns id/relation intermediates; its links
        // declaration maps them to toId/relation. Retain coverage of that owning helper.
        if (path === join(import.meta.dirname, '..', 'memory', 'kinds.ts'))
          for (const relation of source.matchAll(/relation:\s*['"]([a-z_]+)['"]/g))
            if (relation[1]) found.add(relation[1]);
      }
    }
  };
  walk(join(import.meta.dirname, '..'));
  return found;
}

describe('relation words', () => {
  it('checks persisted links and shared helpers while excluding view categories', () => {
    const source = `
      const detail = { id: selected, relation: 'workspace_category' };
      defineKind({ links: a => [
        { toId: a.record, relation: 'unsupported_link' },
      ] });
      const memoryLinks = a => [{ toId: a.memory, relation: 'shared_helper_relation' }];
    `;
    expect([...linkRelations(source)].sort()).toEqual([
      'shared_helper_relation',
      'unsupported_link',
    ]);
  });
  it('name every relation a kind declares, from both ends', () => {
    const declared = [...declaredRelations(), ...FROM_VALUES];
    expect(declared.filter((r) => !(r in RELATION_WORDS))).toEqual([]);
    const unused = Object.keys(RELATION_WORDS).filter((r) => !declared.includes(r));
    expect(unused).toEqual([]);
  });
});
