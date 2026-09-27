---
name: Trim
version: 1.0.2
description: "Reduces an always-on myos context file that is over its byte budget via a human-gated pass: exact duplicates and superseded entries first, then semantic merges and relocations, never dropping a directive and keeping every change reversible. USE WHEN /trim, trim the context, this file is too big, reduce a doctrine file, context file over budget, file is NN% full, statusline file went red, prune an always-loaded file, shrink CLAUDE.md, shrink PROJECTS.md. NOT FOR general code refactoring, trimming video or audio (use Remotion), or removing AI writing patterns from prose (use Writing)."
---

# Trim

Reduce an always-on context file back under its byte budget. This is what you DO when the statusline shows a file at `NN% FULL` in red: `/trim <file>` walks the reduction, safest cuts first, never dropping a rule.

## Workflow Routing

| Trigger | Workflow |
|---------|----------|
| `/trim <file>`, "trim PROJECTS.md", "this file is too big", "file went red", "reduce a doctrine file" | `Workflows/Trim.md` |

## Quick Reference

- **Target resolution:** a bare name (`CLAUDE`, `PROJECTS`) resolves against `MYOS/TOOLS/context-budgets.json` plus `MYOS/USER/PROJECTS.md`. No arg → trim whichever file is worst (`bun MYOS/TOOLS/BudgetCheck.ts --json` → highest %).
- **Order is safest-first:** (1) show state and where the weight sits, (2) mechanical removals (zero risk), (3) semantic trims (human-gated), (4) safety gate, (5) re-check budget. Full steps: `Workflows/Trim.md`.
- **One tool it orchestrates, never reimplement:** `MYOS/TOOLS/BudgetCheck.ts` (bytes, cap, percent).
- **Three semantic moves:** MERGE overlapping rules, TIGHTEN verbose ones, RELOCATE rarely-used detail to an on-demand reference (leave a stub + pointer). For `PROJECTS.md` the relocation target is `MYOS/USER/PROJECTS/<slug>.md`: the index keeps one paragraph per live project.
- **The invariant:** a trim never drops a distinct directive. If a merge would, keep the original.

## Gotchas

- **Know where the file is versioned before editing.** System files (CLAUDE.md, the system prompt, the Algorithm) come from the myos repo's `payload/`: edit there and reinstall, or the next upgrade puts the old text back. `MYOS/USER/**` is not in the repo: copy the file to `<file>.bak-<date>` before the first write.
- **The file can change mid-edit.** Another session may append to PROJECTS.md while you work. If a Write/Edit reports "modified since read", RE-READ before writing. Never write from a stale read.
- **Semantic merges must never drop a directive.** Before applying any merge/tighten, confirm every proper noun, path, tool name, and imperative from the originals survives in the result. If one is missing, the merge is wrong; keep the original. Mechanical removals (exact duplicates, entries marked superseded) are always safe; semantic edits are the risky class.
- **`bun`/`bunx` only, never `npm`/`npx`.**

## Examples

```
/trim PROJECTS
# → shows 11.2K/6K (187% FULL), 70% of it in three closed projects → no duplicates
#   → ranks semantic trims (relocate the three histories to PROJECTS/<slug>.md, tighten two
#   paragraphs) → applies approved ones behind the safety gate → re-checks: 5.1K/6K (85%)

/trim
# → no arg: BudgetCheck picks the worst file, then the same walkthrough
```

## Execution Log

After completing the workflow, append a single JSONL entry:

```bash
echo '{"ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","skill":"Trim","workflow":"Trim","input":"8_WORD_SUMMARY","status":"ok|error","duration_s":SECONDS}' >> ~/.myos/MYOS/MEMORY/SKILLS/execution.jsonl
```
