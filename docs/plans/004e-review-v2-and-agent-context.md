# 004e: Review v2 and agent context

- Status: in planning. Added by Wali on 2026-09-30 after the human interaction review; decisions R1 to R12 below are open.
- Extends: [004 Agent shell](004-agent-shell.md) (004c draft and confirm, 004d one Review page), ADRs [0021](../decisions/0021-draft-and-confirm.md), [0022](../decisions/0022-one-place-to-review.md), [0024](../decisions/0024-lab-calculators.md)
- Goes before: 013c (run recording needs change sets), 014a (plate maps need finer evidence), 016a (transfer volumes need checkable calculations), 017 (one confirm per design). 013b is already in flight and is not held for it.
- Roadmap change chosen with it: 005 lab memory moves before 017.
- Source: the review of `main` at b122731, kept in the project files at `reviews/ux-2026-09-30/` (ranked list in `review.md`, details in `ux-walkthrough.md` and `intent-and-parity.md`, 60 screenshots). Finding numbers below refer to `review.md`.

## Why

The review found the foundations sound (one execution path, preview by rollback, derived confirmation, readiness with sources, exact calculators) and three problems that plans 013 to 020 would multiply:

1. **Review will not survive the designers.** `review.list` stops at 200 drafts without saying so (`apps/api/src/operations/review-operations.ts:8`); after the seed, every labware type, product and instrument was missing from Review and the nav showed no count. Items are not grouped, addressed or batchable, and 017 alone makes an experiment, several plate maps, transfer plans and a workflow per ask.
2. **Evidence is per top-level attribute.** ADR 0021 deferred finer evidence "to the first deep kind". SOPs were that kind and nothing was decided: one changed step marks the whole procedure changed and assumed. Plate maps would mark whole plates.
3. **Agents are under-equipped and screens speak in storage terms.** The in-app assistant gets no skill (ADR 0024 says it should), about 40k tokens of tool schemas on every turn, and a `records.kinds` result cut off before the schemas it is told to read. Screens show 61 of 81 operations as raw IDs and render structured values as "key value · key value" walls with nested IDs.

## Proposed scope

| Step | Delivers |
| --- | --- |
| 004e-1 Honest counts and plain words | `review.list` totals and per-kind counts ("showing 200 of 335"), nav counts from counts; plain verbs and a one-line description on every operation contract, with a CI check; nested IDs resolved to linked names everywhere; per-kind section renderers (SOP procedure as bench steps, variables and materials as tables, instrument configuration as linked equipment) |
| 004e-2 Evidence by path | ADR and record service change for R4, R5 and R12; SOP steps first |
| 004e-3 Review v2 | R1 to R3: tiers, addressees, groups, change sets, batch confirm, dense rows, Discard on agent drafts; stored record summary and readiness summary (R9); library mentions move into Review |
| 004e-4 What changed | R8: seen marker, `records.diff`, history naming the operation, `activity.list` filters, a small "Today" home page |
| 004e-5 Agent context | R6, R7: skills served by the API and MCP, a small core toolset with load-on-demand, `records.kinds` filter and summary mode, page context with record, version and selection; stale skill lines fixed |
| 004e-6 People parity | R10, R11: Archive, Restore this version, Discard draft, a generic Calculators page; a person's own edit confirms what they typed |

Screen fixes that need no decision (lot to container "Where it is", SOP bench steps with values inline, active records leading with content, plate contents legend, laptop-width tables, ledger failure reasons, small word leaks) are listed in `review.md` section C and go in as small PRs alongside, without waiting for this plan.

## Round 1: decisions

Recommendations in bold.

| # | Question | Options | Recommendation and why |
| --- | --- | --- | --- |
| R1 | Shape of the Review queue | A) One queue in three tiers: **needs you** (blocks something: a run soon, a re-plan of your bookings, a failed transfer), **to confirm** (no deadline), **for your information** (auto-applied re-plans, drift notes, "out of date" notices, folded into a digest). Items carry an addressee (`for`), and only "needs you" counts in the nav · B) Keep one flat list, add totals, paging and kind groups · C) A, without addressees until there is more than one person using the app | **A.** 019 re-plans and 020 drift notes have nowhere else to go, and a count that includes everything stops meaning anything. Addressees are cheap now and hard to add after 013's owners exist. |
| R2 | What an agent's multi-step ask becomes | A) **A change set:** one proposal holding ordered operations with references inside it (`$1.id`), previewed together by rollback, confirmed or rejected as one, applied atomically · B) Separate proposals sharing a group id, with a "Confirm all in group" button · C) Keep one proposal per operation | **A.** 013 E7 (one run from notes is step actuals, deviations and inventory events together) and 017 need all-or-nothing; B can leave half a run recorded. Preview by rollback (ADR 0017) already works over several operations. |
| R3 | Batch confirm | A) **"Confirm all N" on a group or filtered list when every item has no assumed values, no failing check and no changed confirmed values;** people only; each record still gets its own confirmation record · B) No batch confirm; faster review pages instead · C) Batch confirm anything, with a warning | **A.** 133 vendor liquid classes and 31 imported labware types should be one press when nothing in them is a guess; anything with a guess still opens. |
| R4 | Evidence granularity | A) **Evidence and confirmation keyed by path** (`/steps/s3/volume`, `/plates/2/wells/B7`) for kinds that declare it, using stable item ids, not array indexes; derived content (explicit wells generated from layout rules) is `calculated` and is not reviewed item by item: the person confirms rules and overrides · B) Sections over sub-documents only (one section per step group); evidence stays per attribute · C) Keep per top-level attribute | **A.** B still marks a whole plate changed when one well moves. Keyed by id so reordering steps doesn't reset confirmations. SOP steps adopt it first; 014a is built on it. |
| R5 | Where a value came from | A) **Add evidence sources `record` (copied from a confirmed record, with id, version and path), `template` (a confirmed template's default) and `memory` (a confirmed lab memory, used once 005 lands). Only `assumed` and `stated` show in agent ink;** the others say "from ASY-0003 v2" in normal ink · B) Keep the current sources and use `imported` for these · C) Decide in 017 | **A.** 012b bindings, 017 template fills and 018 code-built graphs would otherwise turn nearly everything violet, and the real guesses get lost. |
| R6 | Tools the in-app assistant sees | A) **A core toolset (records read and readiness, `review.list`, `skills.get`, every calculator) plus `describe_operations` and `run_operation` for the rest, plus the full tools of the namespaces the current page belongs to** · B) Keep one tool per operation, trim schemas · C) Describe-then-run only, like MCP | **A.** Today's 40k tokens per turn grows with every plan; A keeps named tools where cheap models need them. Revisits the 004b default ("revisit past a few dozen operations"). |
| R7 | How agents get skills | A) **`skills.list` and `skills.get` operations, the same skills as MCP resources, the calculators skill in the assistant's system prompt** (as ADR 0024 requires), and a CI check that every operation and calculator appears in a skill · B) Put all skills into the system prompt · C) Leave skills in the repo for outside agents only | **A.** Only agents with the repo checked out see skills today; B costs as much as the tool list. |
| R8 | "What changed since I last looked" | A) **A per-person seen marker per record (set when its review opens), `records.diff {id, from?, to?}` in plain words defaulting to "since you last looked", history rows that name the operation ("the reviewer fixed step 3"), `activity.list` filters (record, actor, conversation, since, mine), and a small "Today" home page built on them** · B) Diff against confirmed values only, as now · C) A without the home page | **A.** Design is iterative; after "add a third replicate" the person must see what that turn changed, and nothing in a draft is confirmed yet. Plan 004 C4 promised "or first drafted". `/` is the raw ledger today. |
| R9 | Summaries | A) **Each kind declares `summarize(attributes)`; the one-line summary and a readiness summary (ready, blockers, assumed, sections left, including `related` checks) are stored on the record at write time; `records.list` returns summaries by default** · B) Compute both on read · C) Summaries only in the web app | **A.** Review, lists, links and agents all need the first line, and Review's "ready" today skips `related` checks and can disagree with the record page. Stored makes batch confirm (R3) cheap and consistent. |
| R10 | A person's own edits | A) **Values a person types are confirmed by that person;** the section needs review only for agent values left in it · B) Keep ADR 0021: any edit sends the section back to review | **A.** Pressing Confirm on what you just typed is the click-heavy pattern to avoid. Needs R4 to be exact per field. |
| R11 | People parity | A) **Archive, Restore this version and Discard draft on the record page, Discard on agent drafts in Review, one generic Calculators page rendered from calculator contracts, and a CI rule that every agent write has a UI caller or an allowlisted reason** · B) Only the record actions · C) Leave as is | **A.** Today a person asks the assistant, it proposes, and the person confirms their own request. The generic page costs nothing per calculator. |
| R12 | Checked calculations | A) **Calculator outputs carry a calculation handle; `calculated` evidence must reference one and the record service checks the value against it** · B) The handle is optional and shown when present · C) Leave to 016a | **A, built in 004e-2 with evidence.** "Numbers come from calculators" can't be checked today; 016, 017 and 019 lean on it hardest. |

## Proposed UI rules (to add to the wiki once R1 to R12 are chosen)

1. What you confirm is what you read: each kind renders a section in its lab form, never as a field dump, and any ID at any depth shows as a linked name.
2. Up front: blockers, guesses and what changed since you last looked; everything confirmed or derived folds to one line, and empty fields hide.
3. Agent ink is rare: only values an agent guessed or was told.
4. One queue, one count: everything waiting for a person is a Review item with an addressee; a truncated list always says its total.
5. One intent, one confirm: what an agent does for one ask is confirmed or rejected as one.
6. Confirm rules, not rows: derived content is marked calculated and not reviewed item by item.
7. A person's own edit is their confirmation.
8. People are never slower than agents: anything an agent can propose, a person can do on the page it concerns.
9. Plain words are part of the contract: no screen shows an operation ID, and a failure shows its reason on the row.
10. A person never edits JSON for a value whose shape the schema knows.
11. Every record answers "where is it" and "what's in it" on its own page; a grid of wells has a contents legend and a search.
12. Every fix is a choice with a consequence, and a "Fix in…" link goes where the fix is made.
13. Show state only when it isn't the default, and a check's source is the reason in lab words.
14. Laptop width is the normal case: tables scroll rather than clip, with the assistant open.
15. Agents discover, then load: a small core toolset plus calculators, with skills and module tools served on demand.

## Amendments this implies for later plans

Listed per plan in `reviews/ux-2026-09-30/intent-and-parity.md`, Part 3. The main ones: 013 derives the running and analysing stages and records a run as one change set; 014 confirms rules, not wells; 016 shows exceptions first; 017 is one Review item with one confirm; 018 reviews only the agent's joins; in 019 picking an option card is the confirm; 020 accepts exclusions in bulk. Each is raised with its plan when that plan is next touched, not changed here.
