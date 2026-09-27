---
phase: complete
progress: 3/3
task: add a --json flag to the token report
slug: 20260928-091500_tokenlog-report-json
started: 2026-09-28T09:15:00+02:00
updated: 2026-09-28T09:32:00+02:00
---

## Goal

"Give the token report a --json mode I can pipe into jq." `TokenLog.ts report --json` prints one JSON object and nothing else.

## Claims

- [x] C1: `bun TokenLog.ts report --json` exits 0 and its stdout parses with `jq -e .`.
- [x] C2: The object has the keys `totals`, `byModel` and `activities` (after: C1).
- [x] A1: Anti: no table text (the "Top sessions" heading) appears on stdout when `--json` is set.

## Verification

- C1: bash: `bun TokenLog.ts report --json | jq -e . > /dev/null; echo $?` → `0`
- C2: bash: `bun TokenLog.ts report --json | jq -r 'keys[]'` → `activities byModel ... totals`
- A1: rg: `bun TokenLog.ts report --json | rg -c "Top sessions"` → no match (exit 1)
