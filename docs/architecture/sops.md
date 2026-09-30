# Digital SOPs

Plan: [012](../plans/012-digital-sops.md). A lab SOP as a structured, versioned design document the app and agents compute with. Built so far: the expression language and its calculator ([ADR 0036](../decisions/0036-sop-expressions.md)) and the SOP record ([ADR 0037](../decisions/0037-sop-record.md)), plan 012a.

## Where things live

| Concern | Code |
| --- | --- |
| Expression language: parsing, units, evaluation, sets of variables | `packages/domain/src/expressions.ts` |
| SOP schema | `packages/schema/src/sops.ts` |
| SOP kind: sections, reference checks, readiness | `apps/api/src/sops/kinds.ts` |
| Operation contracts | `packages/schema/src/operations/sops.ts` |
| Operations | `apps/api/src/sops/operations.ts` |
| Binding roles and reading record values | `apps/api/src/sops/resolve.ts` |
| Citation checks | `apps/api/src/sops/citations.ts` |
| Review cycle, and its table `sop_reviews` | `apps/api/src/sops/review.ts` |
| Seed loader for `seed/sops/own/` | `apps/api/src/sops/seed.ts`, run by `pnpm --filter @ailab/api seed` |
| Agent skill | `skills/sops/SKILL.md`, and a row in `skills/calculators/SKILL.md` |

## Formulas (012a, ADR 0036)

A formula reads named variables and numbers with units: `n_samples * replicates * well_volume + dead_volume`, `roundup(total * 1.1, 0.5 mL)`, `final_conc * final_volume / stock_conc`. Units are checked (a volume plus a time is refused), arithmetic is exact, and `+`/`-` convert to the left side's unit. Functions: `ceil`, `floor`, `round`, `roundup(x, step)`, `rounddown(x, step)`, `min`, `max`, `sum`, `count`.

`sops.evaluate` takes a set of variables, each with a value (a decimal string, a quantity or a list) or a formula, and an optional unit for a formula's result. It evaluates them in dependency order and returns each value, or why it has none: an error, the variables it waits for, or the circle it is in.

## The SOP record (012a, ADR 0037)

An SOP (`SOP-0001`) is confirmed in eight sections: overview (purpose, scope, safety, assays, the library document it came from, the SOP it is derived from), materials (roles with requirements and a default record; solutions to prepare), variables (`input`, `default`, `record` read from a material's field, `computed` by formula), procedure (typed steps with the roles they use and produce, parameters, repeats, groups, prerequisite SOPs), plate layout (a spec, not a well map), analysis, timing windows (min, max, target against the end of another step, with source and whether the scheduler enforces it) and open questions. Anything can cite library passages.

Writes are refused when names repeat or a step, parameter, layout, timing rule or question refers to something the SOP doesn't have, or a unit or linked record is unknown. Readiness blocks on no steps, broken formulas, timing that isn't a time and open questions, and warns about steps without a citation when the SOP has a source.

`sops.calculate` works out an SOP's variables for a run: given inputs replace defaults, record variables use their typical value until bound, and each result says where it came from (`input`, `default`, `typical`, `computed`, `missing`).

| Operation | Does | Agents |
| --- | --- | --- |
| `sops.evaluate` | Works out formulas over named values (calculator) | read |
| `sops.draft` | Drafts an SOP | direct (drafts) |
| `sops.calculate` | Works out an SOP's variables for a run (calculator) | read |
| `sops.answer_question` | Answers an open question or accepts its suggestion | people only |
| `sops.check_citations` | Checks each cited quote against its library document | read |
| `sops.review` | Runs the AI review cycle on a draft | direct |
| `sops.reviews` | Lists the review rounds kept with an SOP | read |

## Binding roles and reading values (012b)

A material role is filled by a record of a kind that fits its type: labware by a labware type or a container (read through to its labware type), a reagent or solution by a product or lot, an entity by an entity or sample, an instrument by an instrument kind, an instrument or an equipment kind, a consumable by a labware type, product or lot.

A record variable reads its `readFrom` field from the role's record: a lot's certificate value for that field (falling back to its product's typical value), a product's typical lot value (shown as typical), or any attribute by dotted path (`deadVolume`, `workingVolume.max`). A ratio or missing field is a problem in words, and the variable falls back to the SOP's typical value when it has one.

`sops.calculate` takes `bindings` (a record per role for this run; otherwise each role's default) as well as `inputs`, and returns each role's record with any misfit, and each variable with where it came from (`input`, `record`, `typical`, `default`, `computed`, `missing`), the record and field it was read from, and any problem. Readiness blocks on defaults that don't fit their role and warns about record variables their default can't provide.

## Open questions and citations (012c)

An open question (G6) blocks confirming until a person settles it with `sops.answer_question`: an `answer` in their words (status `answered`) or `acceptSuggestion` (status `accepted_suggestion`, the suggestion becomes the answer). Agents can't call it. It is an ordinary record update, so the change is in the SOP's history.

`sops.check_citations` reads each cited document's passages through `library.read` and looks for each quote, ignoring spacing and case: `matches` (in the cited passage, or anywhere when no passage is named), `found_elsewhere` (in another passage, named in `foundIn`), `not_found`, or `unparsed` (the document has no text yet). It is how a digitizer or reviewer checks its own quotes before a person reads the draft. `library.read` takes `passages` (ids) to read cited passages back.

## The review cycle (012c, ADR 0038)

`sops.review` has the assistant's model review a draft in rounds (default 2). The reviewer sees the SOP, the failing readiness checks, the citation problems and the source's passages. It changes the draft only through tools: `sop_fix` (a JSON pointer, a value or `remove`, a reason, a passage), `sop_ask` (an open question with a suggestion) and `sop_finish`. A change is kept only if the SOP stays valid and its references hold; refused changes go back to the model and are kept with the round. Each round's changes land as one record update by "<agent> (reviewer)", with evidence `stated` for cited fixes and `assumed` otherwise. The round (model, versions, findings with before and after, refused changes, summary) is stored in `sop_reviews` and listed by `sops.reviews`. A round with no findings ends the cycle. Code: `apps/api/src/sops/review.ts`, with the citation helpers in `citations.ts`.

## The lab's own SOPs (012a)

The seed loader drafts one SOP per file in `seed/sops/own/`. Materials come from the front matter's `uses` (labware, reagents, entities, instruments), each a role named after its seed key, with its default bound to the lab's record of the same seed label when the lab has it. Variables come from the front matter as defaults (values that aren't numbers, such as a 1:5 split ratio, go into the notes). The numbered list becomes the steps, each a `manual` step in the SOP's own words with its bold title, until the digitizer types them. Analysis, before-you-start, handling and timing sections go into analysis and notes. Each SOP links to its library document of the same title. Values marked estimated in the seed are marked assumed. Running the seed again skips SOPs the lab has by title.

## Not yet

Dead volume per pipetting instrument kind (007 L4) as a field to read; the benchmark (rest of 012c); a separate reviewer model setting; the SOP page (012d).
