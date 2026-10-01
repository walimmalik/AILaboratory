# 0055: The assistant's core toolset and page context

- Status: accepted
- Date: 2026-10-01
- Plan: 004e (step 004e-5, second part; decision R6, as recommended)

## Context

The in-app assistant got one tool per operation, about 40k tokens of schemas on every turn, growing with every plan; `records.kinds` returned every kind's schema at once and was cut off before the kind the model wanted; and the assistant knew the page's path but not which record or version the person was looking at. Plan 004b chose one tool per operation and said to revisit it past a few dozen operations. There are now about 130.

## Options

A) A core toolset (records read and readiness, `review.list`, `skills.get`, every calculator) plus `describe_operations` and `run_operation` for the rest, plus the full tools of the namespaces the current page belongs to. B) Keep one tool per operation and trim schemas. C) Describe-then-run only, like MCP. Wali chose A.

## Decision

- **Named tools each turn:** the core (`records.get`, `list`, `readiness`, `history`, `diff`, `kinds`, `links`, `create` and `update`; `review.list`; `skills.list` and `skills.get`; `operations.describe`), every calculator, every operation of the modules the person's page belongs to, and every operation of the modules this conversation already used. The last keeps earlier calls replaying under their own names and keeps a module at hand once the model has worked in it. People-only and `assistant.*` operations are never offered.
- **`run_operation {operation, input}`** runs any other operation. It is stored under the operation's own ID, so the ledger, the assistant panel and "Waiting for you" read it as the operation it ran. When an earlier call's operation isn't a named tool in a later turn, the call replays as `run_operation`.
- **`operations.describe {namespace?, ids?, calculators?}`** is a read operation (also usable over REST and MCP's `run_operation`) that lists operations with their input and output JSON Schemas.
- **Pages map to modules.** A library page maps by its path (`/sops` to `sops`, `/plate-maps` to `platemaps`, `layouts` and `transfers`), and a record page maps by the record's kind.
- **`records.kinds`** takes `summary: true` (kinds, prefixes, sections and keyed lists, no schemas) and `kinds: [...]` (only those, refusing unknown names). With neither, it still returns everything, which is what the web app reads.
- **Page context** carries the record a page shows, with its name and the version on screen, and the assistant sees "it shows WDG-0001 (wdg_…) at version 3".

## Consequences

- A turn on the Activity page names 28 tools, about 40k characters of schema, instead of about 125 tools and 270k characters. On a module's page it names that module's tools too.
- Cheap models that ignore `run_operation` can still do the common work (records, review, calculators, the page's module).
- Selection (wells or rows picked on a page) is not in the page context yet: no page selects anything an agent can act on. It joins the context with the plate map screens (014).
