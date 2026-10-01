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

An SOP links the records it names: its source document (`digitized_from`), role defaults (`uses`), prerequisite SOPs (`requires`), solution recipes (`made_with`, which must be products) and every other document it cites (`cites`, which must be library documents). A draft that an SOP links to can't be deleted.

`sops.calculate` works out an SOP's variables for a run: given inputs replace defaults, record variables use their typical value until bound, and each result says where it came from (`input`, `default`, `typical`, `computed`, `missing`). Each input is given once, in a known unit of the same kind as the variable's default and limits (a plain number where those are plain numbers), and within its `min` and `max`; anything else is refused. A formula that uses a name no variable declares is reported as an error, not as missing.

| Operation | Does | Agents |
| --- | --- | --- |
| `sops.evaluate` | Works out formulas over named values (calculator) | read |
| `sops.draft` | Drafts an SOP | direct (drafts) |
| `sops.calculate` | Works out an SOP's variables for a run (calculator) | read |
| `sops.answer_question` | Answers an open question or accepts its suggestion | people only |
| `sops.check_citations` | Checks each cited quote against its library document | read |
| `sops.review` | Runs the AI review cycle on a draft | direct |
| `sops.reviews` | Lists the review rounds kept with an SOP | read |
| `sops.suggest` | The assistant fills in a value, a step's settings, a new step from a sentence, or the steps from the source; writes nothing | direct |

`sops.suggest` is the editor's fill-in (ADR 0046). It takes the SOP as edited (`attributes`, unsaved) and exactly one of `value`, `step`, `newStep` or `steps`, and asks the assistant's model through one tool (`sop_value` or `sop_steps`). The answer is checked before it is returned: a value must parse as a `SopVariable`, a formula must work out with `evaluateVariables` (waiting on a value with none yet is allowed), a value read from a material must name one of the SOP's materials; a step must parse as a `SopStep`, use only the SOP's materials and values (in `uses`, parameters and backtick names), keep its id when it is being filled, and a new step gets the next free `sN`. A refused answer goes back to the model with the reason once (two turns in all), and each answer may take 45 seconds (90 for drafting every step); past that the operation says the assistant did not answer in time. Nothing is written; the editor shows the suggestion in agent ink with the model's reason until the person changes it, with how long it has waited and a Cancel. Saved untouched, a suggested step or value keeps `assumed` evidence with the note "suggested by the assistant (model): reason", so it stays unverified, and its section waits for the one Confirm, like an agent's value (review 2026-10-01 I11); changed first, it is the person's. Code: `apps/api/src/sops/suggest.ts`.

## Binding roles and reading values (012b)

A material role is filled by a record of a kind that fits its type: labware by a labware type or a container (read through to its labware type), a reagent or solution by a product or lot, an entity by an entity or sample, an instrument by an instrument kind, an instrument or an equipment kind, a consumable by a labware type, product or lot.

A record variable reads its `readFrom` field from the role's record: a lot's certificate value for that field (falling back to its product's typical value), a product's typical lot value (shown as typical), or any attribute by dotted path (`deadVolume`, `workingVolume.max`). A ratio or missing field is a problem in words, and the variable falls back to the SOP's typical value when it has one.

`sops.calculate` takes `bindings` (a record per role for this run; otherwise each role's default) as well as `inputs`, and returns each role's record with any misfit, and each variable with where it came from (`input`, `record`, `typical`, `default`, `computed`, `missing`), the record and field it was read from, and any problem. Readiness blocks on defaults that don't fit their role and warns about record variables their default can't provide.

## Open questions and citations (012c)

An open question (G6) blocks confirming until a person settles it with `sops.answer_question`: an `answer` in their words (status `answered`) or `acceptSuggestion` (status `accepted_suggestion`, the suggestion becomes the answer). Agents can't call it. It is an ordinary record update, so the change is in the SOP's history.

`sops.check_citations` reads each cited document's passages through `library.read` and looks for each quote, ignoring spacing and case: `matches` (in the cited passage, or anywhere when no passage is named), `found_elsewhere` (in another passage, named in `foundIn`), `not_found`, or `unparsed` (the document has no text yet). It is how a digitizer or reviewer checks its own quotes before a person reads the draft. `library.read` takes `passages` (ids) to read cited passages back.

## The review cycle (012c, ADR 0038)

`sops.review` has the assistant's model review a draft in rounds (default 2). The reviewer sees the SOP, the failing readiness checks, the citation problems and the source's passages. It changes the draft only through tools: `sop_fix` (a JSON pointer, a value or `remove`, a reason, a passage), `sop_ask` (an open question with a suggestion) and `sop_finish`. A change is kept only if the SOP stays valid and its references hold; refused changes go back to the model and are kept with the round. Each round's changes land as one record update by "<agent> (reviewer)", with evidence `stated` for cited fixes and `assumed` otherwise. The round (model, versions, findings with before and after, refused changes, summary) is stored in `sop_reviews` and listed by `sops.reviews`. A round with no findings ends the cycle. Code: `apps/api/src/sops/review.ts`, with the citation helpers in `citations.ts`.

## The digitizing benchmark (012c)

`seed/sop-benchmark/` holds one expectation per test document (`SopExpectation`): the materials, steps (by action, with the values they must state and words they must contain), values and unclear spots a correct digitization has, with where the expectation came from (`basis`, e.g. the LabOP model) and whether a person has checked it. `sops.score` (a calculator, `scoreSop` in `packages/domain/src/sop-benchmark.ts`) scores one SOP against one expectation: per section the share found (recall), for materials and steps the share of the draft that matches (precision), for steps how much of the order is kept, and what is missing; overall is the mean recall. Quantities match by value in any unit of the same dimension, from parameters, resolved variables or the step's words.

`pnpm --filter @ailab/api sop:benchmark` finds every SOP drafted from a benchmark document (by the document's title), scores its current version and, when it was reviewed, the version before the first review round, and prints a Markdown table (drafter, review rounds, overall, before review, each section) for a PR description, with what each SOP misses. Digitizing stays the agent's job (the sops skill), so the benchmark runs with whichever model digitized. Code: `apps/api/src/sops/benchmark.ts` and `src/sop-benchmark.ts`.

## The lab's own SOPs (012a)

The seed loader drafts one SOP per file in `seed/sops/own/`. Materials come from the front matter's `uses` (labware, reagents, entities, instruments), each a role named after its seed key, with its default bound to the lab's record of the same seed label when the lab has it. Variables come from the front matter as defaults (values that aren't numbers, such as a 1:5 split ratio, go into the notes). The numbered list becomes the steps, in the SOP's own words with its bold title, each with the action the front matter's `actions` list names for it in order (`add`, `wash`, `serial_dilute`, `read`…; `manual` for steps that are advice or done by hand). The loader refuses an action that isn't one, or a list whose length differs from the number of steps. Analysis, before-you-start, handling and timing sections go into analysis and notes. Each SOP links to its library document of the same title. Values marked estimated in the seed are marked assumed. Running the seed again skips SOPs the lab has by title.

`sops.calculate` can also work out an earlier `version` of the SOP and read a binding's record at its `version`, which is how an experiment computes what it pinned (ADR 0039, `experiments.calculate`).

## Screens (012d)

`apps/web/src/pages/Sops.tsx`: the SOPs page (`/sops`, in the Library menu) lists SOPs with their assay, step count and open questions. An SOP's record page (`SopPage.tsx`, ADR 0046) reads top to bottom:
- **Readiness:** the failing checks with "Fix in …" links, values that are an agent's estimate, **Edit**, and one **Confirm** (`records.confirm`) that confirms every part as it stands; parts held by a failing check are named and wait. Confirming a draft with nothing failing makes it active. Each part's state is under technical details.
- **At the bench:** the numbered steps in plain words with their parameters, each variable parameter shown with its value from `sops.calculate`. A number that comes from a value keeps the value's color (blue, dotted underline) and a material its own (orange), so what is variable reads at a glance; a Numbers / Names switch shows the values' names instead. Hovering, focusing or tapping one opens a card: its formula and the values it uses as they are now, its value and where it came from (usual, typical until a lot is picked, read from a record), its kind and source passage; a material's type, requirements, usual record and the values it gives. The run values table is folded, and marks typical and missing values in agent ink. Each step's source quote is folded too. Print shows only this block.
- **Questions to settle:** each open question with the agent's suggestion, "Accept the suggestion" or an answer in the person's words (`sops.answer_question`). Settled questions are folded.
- **Checks against the source:** "Check the quotes" (`sops.check_citations`) and, on drafts, "Have the reviewer check it" (`sops.review`). The reviewer's changes are listed in agent ink as "Step 2 (Wash), volume: 400 µL → 300 µL", with the reason.

- **Details:** the parts (overview, materials, values, steps, layout, analysis, timing, questions), a line each with who confirmed it, opened in place.

**Edit** opens the whole SOP as one form with one Save at the bottom of the window (`records.update`, with where the values came from beside it, and the same stale-version check as any editor, `useFieldEdits` and `SaveBar` in `SectionEditor.tsx`). Its blocks: overview; materials, one line each (name, type, what any choice must meet, the usual record from the kinds that fit the type, `MATERIAL_KINDS`), with the values each gives and More (technical name, sources, Remove), then solutions; values; steps, numbered and all open, with move and remove; plate layout, timing and analysis. Questions, the source and what it derives from are not edited here. "Fix in …" opens the form at that part. The assistant fills in on request (`sops.suggest`): "Fill in with the assistant" on an empty or broken value and on each step, "Write it with the assistant" from a sentence under the steps, and "Draft the steps from the source" when there are none and the SOP has a source document (without one the editor says so). What comes back shows in agent ink with its reason until someone changes it; while it is asked, the editor shows the seconds waited, the limit and Cancel.

Values and steps have editors of their own built on one highlighted text box ([ADR 0046](../decisions/0046-sop-text-and-one-confirm.md); `apps/web/src/pages/SopEditors.tsx`, `SopText.tsx`, `apps/web/src/lib/sop-text.ts`):
- **The box** is a textarea with transparent text over a mirror that paints the same characters. As you type, the SOP's values light up blue and its materials orange, matched by lab name, longest first, at word edges; a name that is not one is underlined amber. A pick list under the caret offers the names that fit (and in a formula, functions and, after `Material.`, that material's fields); Tab or Enter takes one. Hovering a name opens its card.
- **A value** is one line: its name, `=`, and the box. What is written decides its kind: a number, an amount or a list (`8`, `100 µL`, `1, 2, 4`) is a usual value, or chosen each run with "Ask each run"; `Capture antibody.working concentration` is read from that material; anything else is a formula, `Wells × Well volume × 1.1`, stored as `wells * well_volume * 1.1`, so agents still read and write technical names. `*` and `/` show as × and ÷. Under the box: the result from `sops.evaluate` with the values as edited (never worked out in the browser), the kind in two small words, and More (the unit to give a result in, ask each run with at least and at most, a typical value for one read from a material, a note, the technical name, the number of source passages, Remove). A new value's technical name follows its lab words; an existing one keeps its name. A mistyped name says which it most likely means, with a button to use it; a material's field inside a longer formula says to add it as a value of its own.
- **A step** is one line (action, short name, how many times), then its words in the same box. Values and materials in the words are stored as `` `name` `` and shown by lab name, matched as written. The materials it uses and the settings its words state (one volume, time, temperature, speed, concentration or wavelength, from a value or an amount, or "room temperature") are read from the words and listed under them; what the words never stated is kept. Settings, what it makes, grouping, a prerequisite SOP, the id and sources are under More.

The SOP's parts are titled Values and Steps in readiness (their ids stay `variables` and `procedure`).

## Not yet

Dead volume per pipetting instrument kind (007 L4) as a field to read; expectations for the lab's own and the OpenWetWare SOPs (only InterLab so far, and not yet hand-checked); a separate reviewer model setting; keeping or reverting single reviewer fixes on the page.
