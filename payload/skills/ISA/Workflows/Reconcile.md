# Reconcile Workflow

Deterministic merge of an ephemeral feature file back into the master ISA, keyed on stable claim ids. Without it, parallel feature work drifts from master, the same "code drifts from spec" problem the ISA exists to prevent.

## When to invoke

- A worker (a subagent, a parallel session) finished a feature against an ephemeral file.
- "reconcile <ephemeral-path> into <master-path>"

## Inputs

| Input | Required | Description |
|---|---|---|
| ephemeral_path | yes | `MEMORY/WORK/<slug>/_ephemeral/<feature>.md` |
| master_path | yes | The master ISA it was derived from |
| dry_run | no | Default false; true reports the plan without writing |

## Procedure

1. **Read both.** The ephemeral file must start with the `<!-- EPHEMERAL FEATURE FILE: derived from ... -->` marker; abort if not. Reconcile only merges what Scaffold's ephemeral mode produced.
2. **Plan the claim merge.** For each claim in the ephemeral file:
   - `[x]` there and `[ ]` in master: flip in master.
   - `[x]` in both, or `[ ]` in the ephemeral: nothing.
   - the id does not exist in master: **abort**, id stability violation. The ephemeral file cannot mint ids.
3. **Stage Verification.** Every flipped claim needs its ephemeral `## Verification` entry (probe type and quoted output); stage it for master's `## Verification`. A flip without evidence is a soft warning in the report: the flip stands, the Algorithm's verify step catches it.
4. **Stage Decisions.** Ephemeral Decisions entries go to master's `## Decisions` prefixed `[from <feature>]:`, timestamps kept.
5. **Frontmatter.** Recompute `progress: M/N`, set `updated` to now. Leave `phase` alone; closing is not Reconcile's call.
6. **Apply** (unless dry run) through the Append workflow's shapes, in this order: frontmatter, claim checkmarks, Verification, Decisions.
7. **Archive.** `mv <ephemeral> <ephemeral_dir>/.archive/<feature>-<YYYY-MM-DD>.md`. Never deleted.
8. **Report.**

```yaml
status: applied | dry_run | aborted
claims_checked: [C12, C13, C15]
verification_added: 3
decisions_added: 2
archived_to: MEMORY/WORK/<slug>/_ephemeral/.archive/board-2026-09-28.md
errors:
  - claim: C99
    reason: not in master
```

## Rules

- **No conflicts to resolve.** An id exists in master and the merge is mechanical, or it does not and the merge aborts.
- **Structural changes go first.** If the worker split C7 into C7.1 and C7.2, Harry (or the main session) edits master first; Reconcile only flips existing ids.
- **Stale ephemeral.** If master moved on structurally, abort and say so: re-extract, or port by hand.
- **Idempotent.** A second run applies nothing and says so.
