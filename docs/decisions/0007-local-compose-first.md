# 0007: Local Docker Compose first, internal Docker cluster later

- Status: accepted
- Date: 2026-09-29
- Plan: 000 (decision D7)

## Context

Development and testing happen on Wali's PC (Windows assumed). Production will be an internal Docker cluster in the lab.

## Options

1. Local Docker Compose first, deploy later
2. Cloud deployment from day one

## Decision

Option 1. Every service has a Dockerfile from the start; `docker compose up --build` runs the full stack.

## Consequences

Deployment to the internal cluster is its own later plan. Everything must run in containers and on Windows.
