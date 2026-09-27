# Scaffold Workflow

Write a fresh ISA from a prompt, at the right home, with the sections the work's substance requires. Shape: `~/.myos/MYOS/DOCUMENTATION/IsaFormat.md`.

## When to invoke

- The Algorithm at run start: `Skill("ISA", "scaffold from prompt: <request>")`
- Harry directly: "make an ISA for this"
- Ephemeral feature mode: `Skill("ISA", "extract feature <F-id or name> as ephemeral file from <master-isa-path>")`
- Grill's handoff: the Shape and Key Decisions from `grill.md` become the prompt.

## Inputs

| Input | Required | Description |
|---|---|---|
| prompt | yes | The request, verbatim or distilled |
| substance | no | A steer ("trivial", "substantial", "go heavy"); default is judged from the prompt |
| project | no | A project root; the ISA is `<root>/ISA.md` (read and extended, never overwritten) |
| ephemeral_feature | no | Produce a feature excerpt instead of a full ISA |

## Output

- `<project-root>/ISA.md` when a project is named or the cwd is a repo with an ISA
- `~/.myos/MYOS/MEMORY/WORK/<slug>/ISA.md` otherwise (`slug` = `YYYYMMDD-HHMMSS_kebab-task`)
- `~/.myos/MYOS/MEMORY/WORK/<slug>/_ephemeral/<feature>.md` in ephemeral mode

## Procedure

### Step 1: Read the shape

Read `../Examples/project.md` (substantial) or `../Examples/trivial.md` (trivial) for headers and tone. If the target project already has an `ISA.md`, read it: a new task extends it, it does not replace it. If that ISA has `effort:` in its frontmatter it is legacy: extend it in its own shape, or start a task ISA in the new format and say why.

### Step 2: Keep Harry's words, then derive

If the prompt states the goal outright (a metric and threshold, "I want X", "until X", or a direct instruction about the system), copy that sentence verbatim, in quotes, as the first sentence of `## Goal`. Skip this when the candidate is under six words or carries no content ("make it good"); log the skipped candidate in `## Decisions`. With several candidates, the first becomes the quote and the rest become Constraints.

Then derive what is left: wants beyond the quote (Vision, the rest of Goal), explicit and implied not-wants (Out of Scope), domain mandates (Constraints), truths the work must respect (Principles).

### Step 3: Could I be wrong about what done means?

If the goal supports two readings that lead to materially different builds, ask up to three targeted questions before writing more than the Goal, one per turn, writing each answer back before the next. For trivial work, state the pick instead: `Picking X over Y because R; redirect if wrong.` A whole reply of `proceed` means "use reasoned defaults": log a Decisions line naming the defaults taken.

| Thinnest section | Question |
|---|---|
| Vision or Goal | "When this is done, what makes you say wow?" |
| Out of Scope | "What would be tempting to add but distract from the core?" |
| Constraints | "What must not change, whatever we build?" |
| Test Strategy | "What check would prove it landed?" |
| Goal (sparse) | "What is the smallest version that still counts as done?" |

### Step 4: Frontmatter

```yaml
---
phase: scoping
progress: 0/<claim count>
task: eight word task description
slug: YYYYMMDD-HHMMSS_kebab-task
started: <ISO-8601 with offset>
updated: <ISO-8601 with offset>
project: <name>          # project ISAs only
---
```

Nothing else. No `effort`, `mode` or similar keys.

### Step 5: Write the sections substance requires

| Substance | Sections |
|---|---|
| Trivial | Goal, Claims |
| Substantial, and every project ISA | Problem, Vision, Out of Scope, Principles, Constraints, Goal, Claims or Features, Test Strategy, Decisions (start it with the scaffold's own choices), Verification (header only until a claim closes; the one section allowed to start empty) |

Add `## Language`, `## Dependencies`, `## Not yet specified`, `## Bridge Criteria` and `## Remaining Work` only when their condition holds (see the spec table). Never write `## Changelog` or `## Learning`.

Claims layout, pick one:

- flat `## Claims` when the work has no distinct features (most task ISAs);
- `## Features` blocks when it does (most project ISAs):

```markdown
### F1 · Board
Why: Sarah marks a flat and sees it on her phone a second later, without logging in.

- [ ] C4: A tap on Nice writes one row to the Grist table within 2 s.
- [ ] A2: Anti: an anonymous visitor cannot delete a row (HTTP 403).
```

Ids are global across the ISA, never per feature.

### Step 6: Hold fog as fog

Surface in Vision or Goal whose shape is genuinely unknown goes in `## Not yet specified` as `- fog: <question>: <what must resolve first>`. Graduation test: statable with a falsifier → a claim (even if blocked); statable but not yet probe-able → fog; beyond the vision → Out of Scope.

### Step 7: Split every claim

| Test | Split when |
|---|---|
| "and", "with" | it joins two verifiable things |
| Independent failure | part A can pass while B fails |
| Scope words | "all", "every", "complete": enumerate |
| Boundary | it crosses UI, API, data: one per boundary |
| No nameable probe | you cannot say which tool would verify it |

### Step 8: Anti claims and antecedents

At least one anti claim (what must NOT happen), usually derived from Out of Scope and from regressions worth guarding. When the goal is experiential (a page, a flyer, a video, a piece of writing), at least one `Antecedent:` claim naming a precondition that reliably produces the experience.

### Step 9: Test Strategy

One row per leaf claim, in the five columns `isc | type | check | threshold | tool`. Deterministic types where possible; `eval` and `manual` rows say who judges. Where the probe is a runnable test, write it so it fails before the build.

### Step 10: Check and return

Run `CheckCompleteness.md` on substantial ISAs (a trivial ISA gets a one line shape check instead). Fill any hard gap. Return the absolute path.

## Ephemeral feature mode

1. Read the master ISA and find the feature block (`### F<n> · <name>`).
2. Write `MEMORY/WORK/<slug>/_ephemeral/<feature>.md` holding: Goal and Vision (read only context), the relevant Constraints, the feature's claims with their ids unchanged, their Test Strategy rows, and an empty `## Verification`.
3. First line: `<!-- EPHEMERAL FEATURE FILE: derived from <master-path>. Reconcile via Skill("ISA", "reconcile <this-path> into <master-path>"). Do not hand-edit master from this file. -->`
4. If a claim id in the feature does not exist in master, abort: that is a master error.

## Failure modes

- **Substance mismatch:** the steer says trivial but the work is clearly substantial (or the reverse). Say so; Harry's call wins, but the mismatch is never silent.
- **Coverage gap:** a subsystem named in Vision or Goal with no claim and no fog entry. Decompose it, hold it as fog, or record the omission in Decisions.
