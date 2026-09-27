---
name: Writing
version: 1.0.1
description: The myos house writing style, plus the runnable gate that enforces it. Short words, short sentences, no em dashes, English roots over Latin ones. Covers updates, plans, show and ad copy, decision records, docs, commit messages and any prose myos hands to a human. USE WHEN write, draft, rewrite, edit, polish, audit writing, check style, tone, sounds like AI, remove em dashes, make this terser, update, broadcast, announcement, release note, README. NOT FOR code comments and identifiers (those follow the language's conventions), or the exhaustive AI-detection catalogue (that is MYOS/DOCUMENTATION/Writing/AIWritingPatterns.md).
---

# Writing

myos writes one way. This skill is that way, written down, plus a checker that proves it.

The rules live in `StyleRules.md`. Read it before writing anything longer than a couple of
sentences. It is short on purpose.

## The gate

```bash
bun ~/.myos/skills/Writing/Tools/StyleCheck.ts <path...>          # report
bun ~/.myos/skills/Writing/Tools/StyleCheck.ts --fix <path...>    # rewrite em dashes
bun ~/.myos/skills/Writing/Tools/StyleCheck.ts --hints <path...>  # also suggest shorter words
```

Exit code 0 means clean. The checker only ever edits punctuation; word choice needs a reader.

Three profiles, chosen with `--profile`:

| Profile | For | Rules |
|---|---|---|
| `prose` (default) | anything a human reads: updates, READMEs, pages, posts | all of them |
| `docs` | reference documentation | no inline-header-bullet or heading-case rule, because a definition list is real structure there |
| `dashes` | files mirrored from an external upstream source that should stay close to it | em dashes only |

## Workflows

| Intent | Workflow |
|---|---|
| "does this read like AI", "check the style", "audit this doc" | `Workflows/Audit.md` |
| "rewrite this", "make it terser", "fix the writing" | `Workflows/Rewrite.md` |

## Default behaviour

This skill is not something Harry has to remember. `~/.myos/CLAUDE.md` carries the short version
of the rules in always-loaded context, so every myos session already writes this way. Load this
skill when the piece is long enough to be worth auditing, or when someone asks why.

## Escape hatches

A file that quotes bad writing on purpose opts out of the vocabulary rules:

```markdown
<!-- stylecheck-disable: vocab, copula-avoidance -->
<!-- stylecheck-disable: all -->
```

Entries match rule ids by prefix. A single line opts out with a trailing
`<!-- stylecheck-ignore -->`, which is for proper nouns: a release named "Comprehensive
Knowledge Store" keeps its name. The em dash rule cannot be switched off.

## Gotchas

- The checker masks fenced code, inline code, link targets and bare URLs before it looks at
  anything. An em dash inside a regex or a shell example is code and stays put. This also means
  a raw `grep` for em dashes will report more than the checker does, and the difference is code.
- `--fix` is idempotent. Run it twice and the second run changes nothing, which is what makes it
  safe to re-run over a fresh batch of files lifted from upstream.
- The fixer picks its punctuation from context: a colon after a defined term or before a list, a
  semicolon before an independent clause, a comma otherwise, parentheses for a short aside
  between two dashes. It gets this right most of the time, not all of the time. Read the diff on
  anything a person will read.
- Some words the AI-patterns catalogue bans are ordinary technical vocabulary here: the CLI
  `harness`, the `_` `underscore` prefix, a runtime `substrate`, Meadows `leverage points`, the
  `Comprehensive` effort tier. The checker knows about these. If you hit a new one, narrow the
  rule rather than switching it off.
- Word choice is never auto-fixed. Every replacement in the vocabulary tables costs meaning if
  applied blind, which is why the checker reports and stops.
