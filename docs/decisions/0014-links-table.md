# 0014: A links table for references between records

- Status: accepted
- Date: 2026-09-29
- Plan: 002 (decision T6)

## Context

Deep linking must work in both directions: what a record points to, and where it is used.

## Options

1. A `record_links` table maintained by the record service
2. References only inside attributes

## Decision

Option 1. Each kind declares how to read links from its attributes; the record service keeps `record_links` in sync on every write. New links must target an existing, non-archived record in the same lab.

## Consequences

"Where is this used" is one indexed query. Records with inbound links cannot be deleted.
