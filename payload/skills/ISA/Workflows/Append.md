# Append Workflow

The canonical writer for the two append-only sections of an ISA: `## Decisions` and `## Verification`. It keeps their entry shapes clean across sessions and projects, and it keeps claim checkmarks and `progress` in step with the evidence.

There is no Changelog or Learning section in myos format v1, so there is nothing to append there: git is the change history, and a belief that changed is a `refined:` Decision.

## When to invoke

- Any phase, when a non-obvious decision is made: "append decision to <isa>: <text>"
- Verify, when a claim's probe passed: "append verification to <isa>: C3 <probe> <output>"
- Harry adding an entry by hand.

## Entry shapes

### Decision

```
- 2026-09-28 09:40: <decision and why>
- 2026-09-28 10:05: refined: <what changed in the Goal or the claim set, and why>
- 2026-09-28 10:30: DEAD END: tried <X>, failed because <Y>; do not retry
```

A changed belief carries what was believed, what broke it, and what the claims say now, in one `refined:` line or two. Required: text and timestamp.

### Verification

```
- C3: bash: `bun Tools/Report.ts --json | jq -e .totals` → `{"out": 1500, ...}` (exit 0)
- C7: screenshot: Claude-in-Chrome, 390 px frame, no horizontal scroll; saved verification/c7.png
- A1: rg: `rg -c '\|' out.txt` → 0
```

One entry per claim: the id, the probe type (one of the Test Strategy types), and the quoted output or a pointer to the saved artifact. Keep the quote short: the line that proves it, not a log dump. Required: an id that exists in the claims, a probe type, and evidence.

## Procedure

1. **Read the ISA.** If it is legacy (`effort:` in frontmatter), append in its own shape (its Verification may be `## Log`, its claims `## Criteria`); do not convert.
2. **Find or create the section.** `## Decisions` sits after Test Strategy, `## Verification` after Decisions, `## Remaining Work` (if any) last. Never create `## Changelog` or `## Learning`.
3. **Validate.** Refuse to write and name the missing piece when: a Decision has no text; a Verification entry names an id not in the claims, has no probe type, or has no evidence. A refused entry is better than a silent half entry.
4. **Append** at the end of the section, keeping prior entries. Set frontmatter `updated` to now.
5. **Verification only:** flip the claim from `[ ]` to `[x]` and recompute `progress: M/N` over live claims. A `[DEFERRED-VERIFY]` claim stays deferred until its live probe runs.
6. **Return** the exact text appended and the path.

## Failure modes

- **Concurrent edits:** re-read before writing if the file changed since it was read; never write from a stale read.
- **Malformed file** (no way to tell where a section starts): abort and name the structural problem.
