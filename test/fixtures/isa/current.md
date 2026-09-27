---
phase: climbing
progress: 1/4
task: Add a --json flag to the report command
slug: 20260928-090000_report-json-flag
started: 2026-09-28T09:00:00+02:00
updated: 2026-09-28T09:20:00+02:00
---

# report --json ISA

## Problem

The report command prints a table only; a script that wants the numbers has to parse text.

## Goal

`bun Tools/Report.ts --json` prints the same data as one JSON object and exits 0.

## Claims

- [x] C1: `Report.ts` accepts `--json` and prints valid JSON to stdout.
- [ ] C2: The JSON object has the keys `sessions`, `days` and `totals` (after: C1).
- [ ] C3: `--json` with `--days 7` filters the same way the table does (after: C2).
- [ ] A1: Anti: no table text appears on stdout when `--json` is set.

## Not yet specified

- Whether the JSON should carry per model buckets or only totals; decide once a consumer exists.

## Test Strategy

| isc | type | check | threshold | tool |
|---|---|---|---|---|
| C1 | bash | `bun Tools/Report.ts --json \| jq .` exits 0 | exit 0 | bash |
| C2 | bun-test | keys present | 3 keys | bun test |
| C3 | bun-test | filtered count equals table count | equal | bun test |
| A1 | bash | stdout has no pipe characters | zero | rg |

## Decisions

- 2026-09-28 09:05: JSON goes to stdout, diagnostics to stderr, so `jq` works without flags.

## Verification

- C1: bash `bun Tools/Report.ts --json | jq . >/dev/null` exit 0.
