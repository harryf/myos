# Seed Workflow

Draft a project ISA from an existing repository (README, config, tests, recent commits) for a project that predates its ISA, without inventing anything.

## When to invoke

- The Algorithm, when a non-trivial task lands in a repo with no `ISA.md`.
- "seed an ISA for ~/Code/personal/<repo>"

## Inputs

| Input | Required | Description |
|---|---|---|
| project_path | yes | Repository root; the ISA is written to `<root>/ISA.md` |
| name | no | Defaults to the directory name |
| dry_run | no | Default false; true prints the draft instead of writing |

## Procedure

1. **Refuse if `ISA.md` exists.** Report `status: exists` and suggest Interview. Seed never overwrites.
2. **Read, in this order:** `README.md` (Vision, Goal, sometimes Problem); `CLAUDE.md` and any `docs/` overview; `package.json` and runtime config (`tsconfig.json`, `bunfig.toml`, `_config.yml`, `wrangler.toml`: Constraints); the last 30 commits (`git log --oneline -30`: what is active); existing spec-shaped files (`SPEC.md`, `PLAN.md`, acceptance lists: cite them in Decisions); test files (candidate claims); the top-level layout (candidate features).
3. **Draft Problem and Vision** from the README. A dry README leaves Vision out and adds a `## Remaining Work` line "author Vision"; never fabricate.
4. **Draft Out of Scope** from explicit "not", "non-goals", "we don't" text. Nothing found: leave it out and note it in Remaining Work.
5. **Draft Constraints** from the runtime and deploy facts (bun only, GitHub Pages, a Jekyll build, a cron job that must keep working).
6. **Draft Goal** in one to three sentences naming the deliverable.
7. **Draft claims.** Each existing test name is a candidate claim; split to one probe each. With no tests, draft six to ten conservative claims (builds, type checks, deploys, the most obvious behaviour from the README). Always at least one anti claim from Out of Scope or a known regression. Ids `C<n>` and `A<n>` from 1.
8. **Features** when the layout has clear vertical slices: `### F<n> · <name>` with a `Why:` line and the claims nested.
9. **Test Strategy** rows for every claim with an obvious probe (the build command, the test command, a curl); others get a `manual` row that says what Harry checks.
10. **Decisions:** one line: "Seeded from README, config, tests and the last 30 commits on <date>; run Interview to fill Principles and sharpen Vision and Goal."
11. **Frontmatter:**

```yaml
---
phase: scoping
progress: 0/<claim count>
task: project ISA for <name>
project: <name>
started: <ISO-8601>
updated: <ISO-8601>
---
```

12. **Write and report** `status: created`, the sources read, the sections drafted and skipped, the claim count, and `review_required: true`. A seed is a draft until Harry has read it; offer Interview next.

## What Seed does not do

- Invent: an empty source means an absent section, not a plausible paragraph.
- Run CheckCompleteness: a fresh seed is partial by design and would fail.
- Commit: Harry decides when the ISA enters git.

## Failure modes

- **No README and no CLAUDE.md:** abort; Scaffold from a prompt instead.
- **Huge history:** sample the last 100 commits, never walk everything.
