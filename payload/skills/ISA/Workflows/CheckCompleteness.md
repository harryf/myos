# CheckCompleteness Workflow

Score an existing ISA against myos format v1 and the substance gate, and return pass or fail with a gap report. Shape: `~/.myos/MYOS/DOCUMENTATION/IsaFormat.md`.

## When to invoke

- After Scaffold, and before `phase: complete`.
- Harry directly: "is this ISA complete?", "audit this ISA".
- From Interview, at its end.

## Inputs

| Input | Required | Description |
|---|---|---|
| isa_path | yes | The ISA to score |
| substance | no | `trivial` or `substantial`; default judged from Goal and blast radius. A project ISA is always `substantial` |
| strict | no | Default true; false turns hard gaps into warnings (mid-interview) |

## Step 0: Legacy check

If the frontmatter has an `effort:` key, the ISA is legacy (twelve sections, `## Criteria`, `## Changelog`, `ISC-N`). Report `status: legacy, not scored` and stop. Legacy ISAs are exempt from this format by design.

## Step 1: Parse

Frontmatter (`phase` and `progress` must exist; abort with a clear error if not) and section headers. Legacy heads still count: `## Criteria` or `## ISC Criteria` for Claims, `## Log` for Verification.

## Step 2: Required sections

| Substance | Required |
|---|---|
| Trivial | Goal, Claims |
| Substantial | Problem, Vision, Out of Scope, Principles, Constraints, Goal, Claims or Features, Test Strategy, Decisions, Verification |

Conditional, required only when the condition holds: Language (a term caused confusion), Dependencies (another ISA is depended on), Not yet specified (fog exists), Bridge Criteria (Dependencies exist), Remaining Work (work is owed).

Classify each: `present` (header and content; length is never graded), `missing`, or `empty` (acceptable only for Verification before any claim closes).

## Step 3: Claim quality

- **Order.** Sections appear in the spec order; out of order is a soft fail.
- **One shape.** `## Claims` or `## Features`, never both (hard).
- **Forbidden sections.** `## Changelog` or `## Learning` on a new ISA (hard): git carries history, Decisions carries reasoning.
- **Granularity.** Every claim names one binary probe; compound "and/with" claims fail (hard).
- **Ids.** `C<n>`, `A<n>`, `ISC-<n>`, split children `C4.1`; unique; tombstones valid; no renumbering gaps (hard).
- **Anti claims.** At least one (`A<n>` id or `Anti:` prefix): soft on trivial, hard on substantial.
- **Antecedent.** At least one `Antecedent:` claim when the goal is experiential (hard).
- **Test Strategy coverage.** Every leaf claim has a row with the five columns `isc | type | check | threshold | tool` (hard on substantial).
- **Verifier classes.** Row types are deterministic (`bash`, `bun-test`, `curl`, `rg`, `screenshot`, `file`, `sql`), judged (`eval`) or attested (`manual`); anything else is a soft fail.
- **Closed claims have evidence.** Every `[x]` claim has a `## Verification` entry with probe type and quoted output (hard at `phase: complete`). A `[DEFERRED-VERIFY]` claim carries a follow up id and is never counted as closed.
- **Coverage.** Every subsystem named in Vision or Goal has a claim, or a fog entry while the ISA is not complete, or a Decisions line explaining the omission (hard on substantial).
- **Fog at close.** At `phase: complete`, a non empty `## Not yet specified` is a hard fail.
- **Progress.** `progress: M/N` matches the count of `[x]` over live (non tombstone) claims (soft).
- **Frontmatter hygiene.** `effort`, `mode`, `algorithm_config`, `response_mode` on a new ISA make it look legacy to every gate (hard).
- **Backlog, advisory.** Report open claims plus open `## Remaining Work` items; never fail on it.

## Step 4: Report

```yaml
status: pass | fail | legacy
substance: substantial
sections:
  Problem: present
  Out of Scope: missing
  Verification: empty
gaps:
  - where: Out of Scope
    severity: hard
    reason: required for substantial work
claims:
  total: 14
  closed: 9
  anti: 2
  antecedent: true
  test_strategy_orphans: 0
  id_violations: 0
  fog_entries: 0
backlog: 5
```

`status: pass` only with zero hard gaps. Before close, hard gaps block `phase: complete`; fill them first.
