# 0006: Org and lab IDs on every record from day one

- Status: accepted
- Date: 2026-09-29
- Plan: 000 (decision D6)

## Context

This starts as Wali's personal project and should later move into an academic lab, possibly with several labs sharing one deployment.

## Options

1. Single lab now, but every record carries `org_id` and `lab_id`
2. Single-tenant, add tenancy later

## Decision

Option 1. Authentication stays behind one module (local accounts now) so SSO can replace it later.

## Consequences

Every query and operation is scoped by lab. Moving the project into a real lab is a data import, not a schema change.
