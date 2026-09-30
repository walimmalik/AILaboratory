# 0032: Containers inherit the strictest handling rules of their contents

- Status: accepted
- Date: 2026-09-30
- Plan: 010

## Context

Plan 010 says a container inherits the handling rules of everything in it, the strictest rule wins, and every rule shows its source (000 idea 1.7). Rules are written on products (009), entity kinds and entities (010a); a well holds lots and samples (010c). The scheduler (019) needs one answer per plate: how long it may be out, how cold, whether light matters. "Strictest" needs a meaning for each rule type in the 009 vocabulary.

## Options

1. Merge per rule type into one effective rule with all its sources: one answer for the scheduler, and nothing is hidden.
2. List every rule unmerged and let the scheduler pick: nothing lost, but each consumer re-implements "strictest".
3. Store the effective rules on the container and update them on each ledger event: fast reads, but a second copy of the contents that can drift.

## Decision

Option 1, computed on read by `inventory.effective_rules` from the current well contents, with the merging in `@ailab/domain` (`mergeHandlingRules`, `mergeStorage`):

- A lot brings its product's rules and storage temperature. A sample brings its entity's rules and its entity kind's.
- Time limits (max time out of storage, use within, stable after opening or preparation): the shortest wins. Rests (equilibrate, reconstitute): the longest wins. Freeze-thaw limit: the fewest cycles.
- Temperature ranges (keep cold, thaw, storage): the narrowest, i.e. the highest minimum and the lowest maximum. Ranges that don't overlap are reported as a conflict rather than resolved.
- Read windows merge per named step, to the narrowest window.
- Present-or-not rules (light, mix before use, hygroscopic) appear once. Advice is never merged, only identical advice folds.
- A merged rule is enforced when any source enforces it. When one source's values are the merged values, its wording is kept; otherwise the text is generated and says it is the narrowest of its sources.
- Each effective rule lists every source rule with its record, the lots and samples that brought it, and their wells as blocks.

## Consequences

- The scheduler and the container page read one list, enforced rules first, and can always show where a limit came from.
- Nothing is stored, so rules are always current with the ledger and the records; a large plate costs one read of its wells plus a record read per distinct lot or sample.
- Not covered yet: rules from a recipe's ingredients or a kit's components (only a product's own rules count), freeze-thaw counting from location history, and rules that start with a step (after thawing, after opening). These come with the scheduler (019).
