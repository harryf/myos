# myos ISA format v1 (frozen 2026-09-27)

The ISA (Ideal State Artifact) is the one document that says what done is for a thing: a project, a session of work, a decision. It is the ideal state written as testable claims, the test harness for them, the done condition and the system of record, in one file. This page is the file shape contract that every myos reader agrees on: the ISA skill (writes it), the ISA gates in `hooks/` (read it), `ISASync` (mirrors its frontmatter to `work.json`), `MigrateMemory` and `ContextSearch` (index it).

myos v1 is LifeOS ISA format v2.21.0 with two things removed: the `## Changelog` section (git and `## Decisions` carry the error correction trail) and the Bunker execution tier column. Nothing else is invented here.

## Two homes

- Project ISA: `<project>/ISA.md` for anything with persistent identity (a repo, an app, a tool, myos itself). Tasks read, extend and refine this one file.
- Task ISA: `MYOS/MEMORY/WORK/<slug>/ISA.md` for one shot work that belongs to no persistent thing.

Same format in both. `slug` is `YYYYMMDD-HHMMSS_kebab-task`.

## Frontmatter

Two fields are load bearing, the rest recommended:

```yaml
---
phase: climbing          # required: starting | scoping | climbing | learn | complete
progress: 3/8            # required: closed claims / total claims
task: eight word task description
slug: 20260928-090000_kebab-task
started: 2026-09-28T09:00:00+02:00
updated: 2026-09-28T09:20:00+02:00
project: myos            # project ISAs only
iteration: 2             # only when a completed ISA is reopened
---
```

Never written on new ISAs: `effort`, `effort_source`, `mode`, `algorithm_config`, `response_mode`. An ISA that carries any of them is a legacy ISA (see below).

## Sections, in this order

Empty sections never appear. Conditional sections are marked.

| # | Section | Holds | Conditional |
|---|---|---|---|
| 1 | `## Problem` | what is broken or missing now | |
| 2 | `## Vision` | what euphoric surprise looks like, as a concrete scene | |
| 3 | `## Out of Scope` | what this ideal state does not include, in prose | |
| 4 | `## Language` | project glossary; a term enters only after it caused a confusion | project ISAs, when needed |
| 5 | `## Principles` | substrate independent truths the work must respect | |
| 6 | `## Constraints` | immovable mandates that bound the solution space | |
| 7 | `## Dependencies` | cross ISA needs, one line each | when another ISA is depended on |
| 8 | `## Goal` | the hard to vary spine, one to three sentences naming verifiable done | |
| 9 | `## Claims` | the atomic testable claims (see below); or `## Features` blocks instead | one of the two |
| 10 | `## Not yet specified` | fog: in scope questions too dim to be claims yet | when fog exists |
| 11 | `## Bridge Criteria` | cross ISA integration claims verified across the seam | when Dependencies exist |
| 12 | `## Test Strategy` | one row per claim: `isc \| type \| check \| threshold \| tool` | |
| 13 | `## Decisions` | timestamped decisions, dead ends, refinements (`refined:` prefix) | |
| 14 | `## Verification` | evidence per claim: probe type and quoted output | |
| 15 | `## Remaining Work` | work the ISA still owes that was never a claim of this run | when non empty |

Trivial work needs `## Goal` and `## Claims` at minimum. Substantial work and every project ISA carry the full non conditional set (1, 2, 3, 5, 6, 8, 9, 12, 13, 14). `CheckCompleteness` enforces that; `ISAGate` reads it at `phase: complete`.

Legacy heads still parse: `## Criteria` and `## ISC Criteria` for Claims, `## Log` for Verification.

## Claims

```
- [ ] C1: `Report.ts` accepts `--json` and prints valid JSON to stdout.
- [ ] C2: The object has the keys sessions, days and totals (after: C1).
- [x] A1: Anti: no table text appears on stdout when `--json` is set.
- [ ] ISC-7: legacy long form ids are also valid.
- [ ] C3: [DROPPED 2026-09-28, see Decisions]
```

- One claim is one binary tool probe. Split until a single tool call returns yes or no. If no tool can be named, the claim is not atomic yet.
- Ids are stable forever. Splits become `C4.1`, `C4.2` with the parent kept. Drops become tombstones. Never renumber.
- Short ids `C<n>` (claims) and `A<n>` (anti claims) are the convention; `ISC-<n>` is accepted. An `A` prefix or an `Anti:` prefix marks an anti claim; at least one anti claim is required.
- `Antecedent:` prefix names a precondition for an experiential goal (design, writing, anything that has to land); at least one when the goal is experiential.
- Markers: `- [ ]` open, `- [x]` closed with evidence in `## Verification`, `- [DEFERRED-VERIFY]` closed in intent but the live probe is impossible now; it carries a follow up id and can never become `[x]` without the probe.
- Ordering edges are a trailing `(after: C1, C2)` parenthetical. Optional, only when the order is real. A dropped blocker counts as resolved.
- Feature blocks: when work has distinct features, `## Features` replaces the flat `## Claims` section and holds `### F<n> · <name>` blocks with one `Why:` line each and the claims nested under them. `F0 · Cross-cutting` is reserved for claims that span features. One ISA uses one of the two shapes, never both. Ids stay global.

## Test Strategy and verifier classes

```
| isc | type | check | threshold | tool |
|---|---|---|---|---|
| C1 | bash | `bun Tools/Report.ts --json \| jq .` exits 0 | exit 0 | bash |
| A1 | rg | stdout has no pipe characters | zero | rg |
```

The `type` decides who can say no:

- deterministic: `bash`, `bun-test`, `curl`, `rg`, `screenshot`, `file`, `sql`. A tool says no. Only these rows may ever block a gate.
- judged: `eval`. A rubric bound model says no; a failure reopens the claim and raises a finding, it never blocks.
- attested: `manual`. The principal says no; the row carries a dated verdict and an evidence pointer.

An unavailable verifier means DEFER (`RULES/Verification.md`), never a pass.

## Conventions

- Pre build probe run: before building, run the deterministic probes for claims that might already hold. A probe that passes before the work exists means the claim was already true (delete it) or the probe cannot fail (fix it).
- Unclaimed work check at close: read the diff against the claim set; additions no claim asked for are named in `## Decisions` or become claims. Advisory.
- Fog graduates: when work sharpens an entry in `## Not yet specified` it becomes a claim or a Decisions line killing it.
- The AI is the only writer. Hooks read the ISA; `IsaFrontier` style locks, if ever added, live under `MEMORY/STATE`, never beside the ISA.

## Legacy ISAs (before 2026-09-28)

Harry's 122 migrated ISAs and any ISA whose frontmatter has an `effort:` key are twelve section ISAs (Problem, Vision, Out of Scope, Principles, Constraints, Goal, Criteria, Test Strategy, Features, Decisions, Changelog, Verification) with `ISC-N` ids. They stay readable by every parser (`isa-utils.ts` accepts the legacy heads), `ContextSearch` indexes them, `ISASync` mirrors them. The three ISA gates (`ISAGate`, `ISACloseGate`, `ISAFoldGate`) and `ISAStaleWriteGuard` skip them: `hooks/lib/gates.ts` `isLegacyIsa()` is the one test, and it is `effort:` present. Reopening a legacy ISA does not convert it; a new run on the same thing writes a new ISA in this format.

## Golden fixtures

`test/fixtures/isa/current.md` (this format) and `test/fixtures/isa/legacy.md` (twelve section). Every parser and gate test uses them; nobody invents a third shape in a test.
