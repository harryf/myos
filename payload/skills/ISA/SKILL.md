---
name: ISA
version: 1.1.2
description: "Owns the Ideal State Artifact: the one document holding a project's or task's ideal state as testable claims, in the frozen myos ISA format v1. Scaffolds a new ISA, interviews to deepen one, grills a half-formed idea into shape through checkpointed discovery, scores completeness, reconciles feature excerpts into the master, seeds a project ISA from a repo, and appends Decisions and Verification entries. USE WHEN ISA, ISC, claims, ideal state, project specification, hill-climb, articulating done, fog, not yet specified, grill me, discovery interview, is this ISA complete. NOT FOR creating new skills (use CreateSkill)."
effort: medium
---

# ISA: Ideal State Artifact

## What it does

The ISA is the one document that says what done is for a thing: a project, a session of work, a decision, a page, a show. It is the ideal state written as testable claims, the test harness for them, the done condition and the system of record, in one file. This skill writes and maintains it. The file shape is fixed by `~/.myos/MYOS/DOCUMENTATION/IsaFormat.md` (myos ISA format v1); where this skill and the spec disagree, the spec wins and this skill is fixed to match.

Every ISA shares one target above its specific one: euphoric surprise in the person using the result. `## Vision` is where that target takes a concrete shape for this piece of work.

## The problem

Work that starts without a written, testable definition of done drifts: the goal at the end is not the goal at the start, claims stay vague enough that anything passes, and decisions get forgotten and argued again. Across sessions nothing records what was verified. The ISA fixes done as atomic claims with stable ids, each with a probe that can say no, and keeps the record of what was decided and what was proven.

## Two homes

- Project ISA: `<project>/ISA.md` for anything with persistent identity (a repo, a site, a tool, myos itself).
- Task ISA: `~/.myos/MYOS/MEMORY/WORK/<slug>/ISA.md` for one shot work, `slug` = `YYYYMMDD-HHMMSS_kebab-task`.

## The body (myos format v1)

Sections in this order. Empty sections never appear; conditional ones appear only when their condition holds.

| # | Section | Holds | Conditional |
|---|---|---|---|
| 1 | `## Problem` | what is broken or missing now | |
| 2 | `## Vision` | what euphoric surprise looks like, as a concrete scene | |
| 3 | `## Out of Scope` | what this ideal state does not include, in prose | |
| 4 | `## Language` | glossary; a term enters only after it caused a confusion | project ISAs, when needed |
| 5 | `## Principles` | truths the work must respect however it is built | |
| 6 | `## Constraints` | immovable mandates that bound the solution space | |
| 7 | `## Dependencies` | cross ISA needs, one line each | when another ISA is depended on |
| 8 | `## Goal` | the hard to vary spine, one to three sentences | |
| 9 | `## Claims` or `## Features` | the atomic claims, flat or in feature blocks | one of the two |
| 10 | `## Not yet specified` | fog: in scope questions too dim to be claims yet | when fog exists |
| 11 | `## Bridge Criteria` | cross ISA claims verified across the seam | when Dependencies exist |
| 12 | `## Test Strategy` | `isc \| type \| check \| threshold \| tool`, one row per claim | |
| 13 | `## Decisions` | timestamped decisions, dead ends, `refined:` entries | |
| 14 | `## Verification` | evidence per claim: probe type and quoted output | |
| 15 | `## Remaining Work` | work still owed that was never a claim of this run | when non empty |

There is **no `## Changelog` and no `## Learning` section**: git carries the change history, `## Decisions` carries the reasoning (a changed belief is a `refined:` Decision).

Frontmatter: `phase` and `progress` are required; `task`, `slug`, `started`, `updated` recommended; `project` on project ISAs; `iteration` only on a reopened ISA. Never write `effort`, `effort_source`, `mode`, `algorithm_config` or `response_mode` on a new ISA.

## Completeness by substance

| Substance | Required |
|---|---|
| Trivial (mechanical, one probe, minutes) | Goal, Claims |
| Substantial (multi claim build, real blast radius), and every project ISA | Problem, Vision, Out of Scope, Principles, Constraints, Goal, Claims or Features, Test Strategy, Decisions, Verification, plus each conditional section whose condition holds |

A project ISA is always scored as substantial, however small the current task. `CheckCompleteness` enforces this; the ISA gates read it at `phase: complete`.

## Claims in one screen

```
- [ ] C1: `Report.ts` accepts `--json` and prints valid JSON to stdout.
- [ ] C2: The object has the keys sessions, days and totals (after: C1).
- [ ] A1: Anti: no table text appears on stdout when `--json` is set.
- [ ] C3: [DROPPED 2026-09-28, see Decisions]
```

- One claim is one binary tool probe. If no tool can be named, split further.
- Ids are `C<n>` and `A<n>` (anti); `ISC-<n>` is accepted. Ids are stable forever: splits become `C4.1`, `C4.2` with the parent kept; drops become tombstones; never renumber.
- At least one anti claim on every real build. At least one `Antecedent:` claim when the goal is experiential (a page, a flyer, a piece of writing, anything that has to land).
- `- [DEFERRED-VERIFY]` is a claim closed in intent whose live probe is impossible now; it never becomes `[x]` without the probe.
- `(after: C1)` at the end of a line is an ordering edge, only when the order is real.
- Feature blocks (`### F<n> · <name>`, one `Why:` line, claims nested) replace the flat list when the work has distinct features; `F0 · Cross-cutting` holds spanning claims. Features are vertical slices, each verifiable on its own.

## Verifier classes in Test Strategy

- deterministic (`bash`, `bun-test`, `curl`, `rg`, `screenshot`, `file`, `sql`): a tool says no. Only these may block a gate.
- judged (`eval`): a rubric bound model says no; a failure reopens the claim, never blocks.
- attested (`manual`): Harry says no; the row carries a dated verdict and an evidence pointer.

A screenshot row names the tool that took it: Interceptor when the extension is connected, Claude-in-Chrome otherwise (both count as evidence in myos). An unavailable verifier means DEFER, never a pass.

## Workflow routing

| Intent | Workflow |
|---|---|
| "scaffold", "create an ISA", "new ISA for this", "extract feature as ephemeral" | `Workflows/Scaffold.md` |
| "interview me on the ISA", "fill in", "deepen" | `Workflows/Interview.md` |
| "grill me", "discovery interview", "figure out the shape" | `Workflows/Grill.md` |
| "check", "audit", "score this ISA", "is it complete?" | `Workflows/CheckCompleteness.md` |
| "reconcile", "merge the feature file back" | `Workflows/Reconcile.md` |
| "seed", "bootstrap an ISA from this repo" | `Workflows/Seed.md` |
| "append decision", "append verification", "record that C3 passed" | `Workflows/Append.md` |

Examples: `Examples/trivial.md` (Goal and Claims only) and `Examples/project.md` (a substantial project ISA with feature blocks). Copy their headers; the spec wins on shape.

## Gotchas

- **Legacy ISAs are exempt.** Any ISA whose frontmatter has an `effort:` key is a pre 2026-09-28 twelve section ISA (`## Criteria`, `## Changelog`, `ISC-N` ids). Read it, index it, append to it in its own shape, but never convert it and never score it against this format. A new run on the same thing writes a new ISA.
- **Id stability is what makes Reconcile work.** Renumbering breaks ephemeral merges silently; the symptom is "the worker's checkmarks didn't land in master".
- **Fog is not a claim.** A question you cannot yet state with a falsifier goes in `## Not yet specified`, never in a speculative claim written to look complete. Coverage is judged at close: at `phase: complete` the fog section must be empty (each entry became a claim or a Decisions line killing it).
- **Pre build probe run.** Before building, run the deterministic probes for claims that might already hold. A probe that passes before the work exists means the claim was already true (delete it) or the probe cannot fail (fix it).
- **Unclaimed work check at close.** Read the diff against the claim set; additions no claim asked for are named in `## Decisions` or become claims.
- **Probe at the seam.** A probe attaches where the thing meets its consumer (the CLI output, the rendered page, the HTTP response), never internals.
- **The AI is the only writer.** Hooks read the ISA; none write it.

## Relationship to the Algorithm

The Algorithm (`~/.myos/MYOS/ALGORITHM/LATEST`) invokes this skill at run start to scaffold or read the ISA and at close to check it. The skill works the same when Harry calls it directly.
