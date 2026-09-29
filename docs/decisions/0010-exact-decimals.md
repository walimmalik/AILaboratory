# 0010: Exact decimals for quantities

- Status: accepted
- Date: 2026-09-29
- Plan: 002 (decision T2)

## Context

Volume tracking subtracts small amounts many times; floating point drifts.

## Options

1. Exact decimals: decimal strings in schemas, Postgres `numeric`, decimal.js in TypeScript, `decimal.Decimal` in Python
2. Floating point

## Decision

Option 1. A `Quantity` value is a decimal string (`"12.5"`), never a JavaScript number.

## Consequences

All quantity arithmetic goes through `packages/domain`. Agents and API clients send numbers as strings in quantities.
