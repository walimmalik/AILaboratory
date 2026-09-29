# 0003: React and Vite for the web app

- Status: accepted
- Date: 2026-09-29
- Plan: 000 (decision D3)

## Context

The core UI is component-heavy design documents (plate maps, Gantt charts, workflow canvases, readiness panels) plus embedded 3D twins.

## Options

1. React + Vite with a headless component kit
2. Vanilla JS, as echo650-twin uses
3. Next.js

## Decision

Option 1. The component kit is chosen when the first real screens land (plan 004). Three.js twins embed inside a React wrapper (plan 015).

## Consequences

A static single-page app served by nginx in containers; all data through the API. No server-side rendering.
