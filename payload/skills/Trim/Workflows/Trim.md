# Trim Workflow

**Goal:** get one always-on context file back under its byte budget without dropping a single directive. Safest cuts first; the human approves every judgment call.

## Step 0: Resolve the target

- Arg given (`/trim PROJECTS`): match it against `path` basenames in `MYOS/TOOLS/context-budgets.json`, plus `MYOS/USER/PROJECTS.md` (the index CLAUDE.md imports, budgeted at 6 KB inside the total).
- No arg: `bun MYOS/TOOLS/BudgetCheck.ts --json` → pick the row with the highest `pct` (or the first `over`).

## Step 1: Show the state (grounding, not a claim)

```bash
bun MYOS/TOOLS/BudgetCheck.ts --json | jq '.rows[] | select(.path|test("<NAME>"))'
wc -c <resolved-path>
```

Report: `<file>: <bytes>/<cap> (<pct>% FULL)`, and where the weight actually sits: per-section byte counts beat a single total (a long closed-project history or an append-only tail is usually the answer). State how many bytes must come out to clear the cap (with a little headroom, e.g. target ≤85%). That number is the goal for this run.

## Step 2: Mechanical wins first (zero risk, before any judgment call)

Look for entries that are provably redundant: exact duplicates, entries explicitly marked superseded, and text that repeats something already in the file body word for word. Show them, then remove them on approval. Re-check BudgetCheck. Often this alone clears enough that Step 3 is unnecessary; stop here if the file is back under cap.

## Step 3: Semantic reductions (human-gated; the judgment part)

Read the file. Build a RANKED list of candidate trims, each with the exact target text and estimated bytes saved. Three moves, in decreasing safety:

- **RELOCATE** (safest): rarely-referenced detail (long mechanism explanations, enumerations, examples, closed project histories) → an on-demand file, leaving a one-line stub + pointer. Doctrine detail goes under `MYOS/DOCUMENTATION/…`; a project's history goes to `MYOS/USER/PROJECTS/<slug>.md`. Nothing is lost; it just stops loading every turn.
- **TIGHTEN**: a verbose multi-sentence rule → one plain-language sentence carrying the same directive. Kill throat-clearing, dated war-story prose, and intensifier-only restatements, never the instruction itself.
- **MERGE**: two or more rules that say overlapping things in different words → one rule that carries every distinct directive from all of them.

Rank by `bytes_saved × safety` (relocate/tighten above merge). Present the list; the human picks which to apply (or "all safe ones"). Apply one at a time.

## Step 4: Safety gate (runs before every semantic write, non-negotiable)

A trim edits live doctrine. Before writing any merge/tighten:

1. **Coverage check**: enumerate every proper noun, file path, tool/command name, env-var name, and imperative verb in the ORIGINAL text. Confirm each survives in the replacement. A missing one = the edit drops a directive → **abort this edit, keep the original.**
2. **Re-read** the replacement as the file's reader: does it still compel the same behavior? If weaker, it's a bad trim.
3. Relocate edits: confirm the moved content landed verbatim in the target file AND the stub points to it before deleting from the source.

Mechanical removals (Step 2) skip this gate. Only Step 3 semantic edits need it.

## Step 5: Keep it reversible and re-verify

- **System files** (system prompt, CLAUDE.md, the Algorithm) ship from the myos repo's `payload/`. Make the edit there, commit it in that repo, and reinstall; an edit made only in `~/.myos` is overwritten by the next upgrade.
- **USER files** (`MYOS/USER/**`, PROJECTS.md and friends) are not in the repo. Copy the file to `<file>.bak-<date>` before the first write, and say where the backup is.
- Re-run `bun MYOS/TOOLS/BudgetCheck.ts` and report the new `NN% FULL`. If still over cap, name how much remains and offer to continue.

## Output shape

Lead with the before→after: `PROJECTS 187% → 85% (−6.1K)`. Then a short list of what was removed/merged/relocated, and the commit SHA or backup path. If any candidate was declined by the safety gate, say which and why. Never claim the file was trimmed without the re-run BudgetCheck number as evidence.
