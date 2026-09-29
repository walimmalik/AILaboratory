# packages

Shared libraries live here, one folder per package. Packages export TypeScript source under the `source` condition (used by tests, tsx and typecheck) and built `dist/` otherwise.

| Package | Plan | Purpose |
| --- | --- | --- |
| `schema` | 002 | Single source of truth for record, document and operation schemas |
| `domain` | 002 | Pure domain logic (units, volume math, plate geometry), no I/O |
| `client` | 003 | Typed API client built from the operation contracts |
| `twin` | 015 | Instrument digital twins, ported from echo650-twin |
| `scheduler` | 019 | Scheduling and simulation, ported from echo650-twin |
