# 0060: Transfer executions and reruns

- Status: accepted
- Date: 2026-10-01
- Plan: 016 (016b-2b)

## Context

`transfers.import_report` (016b-2) reads an Echo transfer report against a confirmed plan and records what really moved in the inventory ledger, but nothing recorded that the plan had run. The plan kept reserving its full draw on top of what the ledger already took off (Codex review 2026-10-01, C11), and the transfers that failed, came up short or never ran were only listed in the reply. ADR 0045 said recording a plan's run would end its reservations; it didn't say how, or what happens to the transfers that didn't go as planned.

Wali's choices (2026-10-01): the import records that the plan ran, completely or with exceptions. Failed and missing transfers are rerun whole and short ones topped up with the rest in whole droplets. The rerun is a plan a person confirms, still linked to the experiment and its design, redoing only the subset. Transfers the instrument did that the plan didn't have are reported, never rerun. Which transfers failed and which are rerun is logged.

## Options

For the execution:

1. Mark the plan itself (an `executions` list on the plan, or archive it): the design record would change every time it runs, and archiving would block a later survey import.
2. A record per execution, `transfer_run` (`TRN-0001`), made by the import. It pins the plan version it ran and lists each exception. The plan stays as confirmed.

For the rerun:

1. A proposal object to approve, separate from plans.
2. A draft transfer plan with `rerunOf: {plan, run}`. It has the same plates (the containers used on the day), experiment, plate maps, groups, methods, instruments, device limits and reasons, with only the transfers to redo. A person confirms it like any plan.

## Decision

Option 2 in both cases.

- Kind, instance, state: the plan is the design, a `transfer_run` is one execution of it, and the ledger holds the state. A `transfer_run` is made only by `transfers.import_report`, active from the start. Its outcome is never edited; only the link to its rerun is added.
- An execution lists its exceptions transfer by transfer: group, place in the group, wells, outcome (`short`, `failed`, `not_run`), planned and actual volume. For each it also says what the rerun moves (`rerun`), or why it is not rerun (`note`, e.g. the rest is less than one droplet). Rows the plan doesn't have go in `unplanned` and are never rerun.
- Rerun volumes: failed and not-run transfers are redone at the planned volume. A short one gets the planned volume less what moved, rounded to the nearest whole step of its group's device (`fitVolume`). If that is under one step or out of range, it is not rerun.
- An intermediate plate that the rerun only draws from was made in the execution, so in the rerun it is a source, with the container used on the day.
- A confirmed plan with an execution no longer reserves. What moved is in the ledger, and what didn't belongs to the rerun plan, which reserves once a person confirms it. A report is read once: a second import of the same file is refused, naming its execution.
- A rerun plan's own execution can have exceptions and its own rerun. The chain is the `rerunOf` and `rerun` links.

## Consequences

- Reservations are honest after a run, with no stored reservation table (ADR 0045 holds).
- Every failed or short well and what was done about it is on record, linked from the plan, the report file and the rerun. That is what the lab memory detectors (plan 005) will read.
- A plan that ran is still confirmed and can be exported or surveyed again. Running it a second time on purpose is a new execution, and that plan no longer reserves.
- Only Echo reports produce executions for now. Opentrons and the other worklists (016b-3 and later) record theirs the same way when they read a run log.
