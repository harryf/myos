# Review: analyse one session and get better

Deliverable: a review of a single session, in chat: what it cost and where, what could
have been done differently, and which myos skills were missed. Two to four concrete
recommendations, each anchored to a specific activity with its evidence; not an audit of
everything. End by offering to save the durable takeaways to myos memory: that is the
loop where the user gets better at myos by using it.

Getting the data:

1. `bun ~/.myos/skills/MyTokens/Tools/TokenLog.ts session <id>` (any unique prefix,
   taken from the report or dashboard). It prints per-activity cost, models, attributed
   skills, subagent share, the session's tool histogram, the transcript path and the
   resume command.
2. When the transcript still exists, read it selectively: the user prompts plus the
   spans of the expensive activities. The per-activity table says where to look; never
   reread the whole transcript.

What to look for:

- **Fat activities vs their prompt.** A one-line question that cost 100k output tokens
  had a multiplier: retries, whole-file reads, redundant searching, a report
  regenerated instead of edited. Name it.
- **The tool histogram maps to skills.** Repeated prose-edit loops say Writing; a long
  hunt through old sessions says ContextSearch; hand-driven browser checks say
  Interceptor; a hand-built launchd plist says Scheduler; a CLI grown by trial and error
  says CreateCLI.
- **Missed thinking skills.** Analysis redone from another angle mid-session is
  IterativeDepth ground; a plan that collapsed later points at
  RedTeam before building. Read the skill list (`ls ~/.myos/skills/` and each `SKILL.md` description) with the
  session in mind: the obscure skills are exactly the ones users never think to reach
  for, and naming them against a real moment in their own session is how they get
  discovered.
- **The skills column.** `attributionSkill` shows which skills actually ran. A session
  doing skill-shaped work with an empty skills column is the strongest signal.
- **Model fit.** Fable or Opus output spent on mechanical work that
  `MYOS/TOOLS/Inference.ts` (Haiku/Sonnet) or fast mode could carry.
- **Subagent share.** High `subOut` is fine for verification and breadth, waste for
  work one context could hold.

Framing the output:

- Each recommendation names the activity ("the 120k-token dashboard rework at 14:32"),
  the cheaper route, and the exact trigger phrase to say next time ("look at this from
  every angle" for IterativeDepth).
- Cost is one axis, not the axis: a change that saves tokens and worsens the outcome is
  not a recommendation. Say when the spend was worth it.
- Offer to save the takeaways to memory so future sessions apply them without being
  asked. A finding that recurs across reviews is a candidate for changing myos itself
  (a skill, hook or doc) in the myos repo, not for telling the user again.
