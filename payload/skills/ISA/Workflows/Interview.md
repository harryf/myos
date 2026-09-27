# Interview Workflow

Fill in or deepen the prose sections of an existing ISA by asking Harry, one question at a time. Where Grill discovers a shape that does not exist yet, Interview fills a shape that does.

## When to invoke

- From Scaffold's ambiguity check (at most three questions).
- After any scaffold when CheckCompleteness reports gaps.
- Harry directly: "interview me on this ISA", or on one section of it.

## Inputs

| Input | Required | Description |
|---|---|---|
| isa_path | yes | The ISA to deepen |
| section | no | Only that section; otherwise walk every thin section |
| max_questions | no | Default 8 |

## Procedure

1. **Read the ISA.** Note which sections are present, thin or missing. A legacy ISA (`effort:` in frontmatter) is deepened in its own shape.
2. **Queue questions** in section order, only for thin or missing sections:

| Section | Questions |
|---|---|
| Problem | "What is broken right now?" / "Who feels it most?" |
| Vision | "When this is done, what makes you say wow?" / "What would make a friend tell another friend?" |
| Out of Scope | "What would be tempting to add but distract from the core?" |
| Principles | "What must this respect however it is built?" |
| Constraints | "What must never change?" / "What should nobody ever try?" |
| Goal | "In one or two sentences, what is the verifiable done state?" |
| Claims | "What check would prove C<n>?" / "Is C<n> one probe, or two?" |
| Test Strategy | "What command or tool would verify C<n>?" |
| Features | "What slices would you split this into, each testable on its own?" |

3. **Ask one question per turn.** Plain conversation, no numbering, Harry's own earlier words where they fit.
4. **Write back after every answer.** Edit the ISA immediately so the document fills as he answers.
5. **Stop** when the required sections are no longer thin, at `max_questions`, when Harry says done, or after two answers in a row that add nothing.
6. **Run CheckCompleteness** at the end; report remaining gaps without blocking.

If Harry is in a hurry, drop to Problem, Goal, Claims and Test Strategy and note the rest in `## Remaining Work`.

## Failure modes

- **Abandoned midway:** keep what was written; add a Decisions line: "interview paused at <section>, N answered".
- **An answer contradicts the ISA:** the new answer wins; log a `refined:` Decision naming what changed.
- **Aspirational answers:** ask "what would prove that?"; if there is no answer, the claim is not hard to vary yet: say so in Decisions.
