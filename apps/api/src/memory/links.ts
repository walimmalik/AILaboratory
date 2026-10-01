import type { HandlingRule, TimingRule } from '@ailab/schema';

/**
 * Handling rules and timing windows from lab memory name the memory (005a, M1). The kinds that
 * hold them link to it, so the memory must exist in the lab and not be retired when it is named.
 */
export const memoryLinks = (
  rules: readonly (Pick<HandlingRule, 'source'> | Pick<TimingRule, 'memory'>)[] | undefined,
) =>
  (rules ?? []).flatMap((r) => {
    const memory = 'source' in r ? r.source.memory : r.memory;
    return memory ? [{ toId: memory, relation: 'from_memory' }] : [];
  });
