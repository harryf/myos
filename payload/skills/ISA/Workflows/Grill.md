# Grill Workflow

A relentless, checkpointed discovery interview that interrogates a half-formed idea until its shape is clear, then hands the shape to Scaffold. Where Interview fills a known ISA structure, Grill discovers a structure that does not exist yet. Harry invokes it; the Algorithm never runs it on its own.

## When to invoke

- "grill me on <topic>", or `/grill-me <topic>` where that command exists.
- Before Scaffold, when the idea is too unformed to scaffold a strong ISA.
- To refresh a spec: "grill me again on <slug>, here is what changed".

Not for filling thin sections of an existing ISA: that is Interview.

## Inputs

| Input | Required | Description |
|---|---|---|
| topic | yes | The idea, plan or decision to interrogate |
| slug | no | WORK dir to use; derived from the topic if absent |
| max_questions | no | Default 12 |

## Procedure

### Step 1: The checkpoint file

Create `~/.myos/MYOS/MEMORY/WORK/<slug>/grill.md` (absolute path, the same dir Scaffold will write the ISA into, even when invoked from inside another repo) with three sections: **Shape and Key Decisions**, **Q&A Log**, **Open Flags**.

### Step 2: Shape check, only if the kind is unclear

If it is unclear what kind of thing this is (a skill, a hook, a CLI, a page, a doc), propose two or three candidate shapes and ask the questions that prune to one. Skip when obvious.

### Step 3: Walk the design tree

Resolve parents before leaves. Per decision:

- One question per call through **AskUserQuestion**, never batched. Put your recommended answer first, marked "(Recommended)", beside the real alternatives, so Harry confirms or overrides in one step. Use a free-text question only when the answer space is truly open.
- Never a bare open ask: lead with where you would land and why.
- When the code or the files can answer it, read them instead of asking.
- On a low-confidence or high-stakes call, add a one-line strongest objection to your own recommendation.

### Step 4: Checkpoint after every turn

Append the Q&A pair to the log, promote settled decisions into Shape and Key Decisions, and put "needs outside input" items under Open Flags, immediately. The file survives a long session's context loss.

### Step 5: Pre-mortem into draft claims

Before closing: "imagine this shipped and failed: what went wrong?" Turn each failure mode into a draft binary claim (and at least one draft anti claim) under Shape and Key Decisions.

### Step 6: Stop

When the shape is clear enough to scaffold, at `max_questions`, or after two low-signal answers in a row.

### Step 7: Hand off

Offer, in order: (1) Scaffold from the Shape and Key Decisions plus the draft claims, into the same WORK dir (or the project's `ISA.md`); (2) a task per Open Flag; (3) updating any skill or doc this session showed to be wrong, through CreateSkill.

## grill.md shape

```
# Grill: <topic>
## Shape and Key Decisions
- <settled decision>: <rationale>
- claim: <binary claim from the pre-mortem>
## Q&A Log
### Q1: <question>
**Recommended:** <rec>  **Answer:** <answer>
## Open Flags
- [ ] <unknown>: needs <who or what>
```

## Failure modes

- **Abandoned midway:** the partial file is still useful; add an Open Flag saying where it paused.
- **Answers stay aspirational:** ask "what would prove that?"; if nothing, it is an Open Flag, not a decision.
- **The topic is already well formed:** say so and go straight to Scaffold; never invent questions to reach a count.

_Adapted from Matt Pocock's `grill-me` skill (github.com/mattpocock/skills, MIT). This version checkpoints every turn to the WORK dir and adds the pre-mortem pass before handing off to Scaffold._
