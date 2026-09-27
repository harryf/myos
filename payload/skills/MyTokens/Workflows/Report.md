# Report: consumption over time

Deliverable: a picture of token consumption in chat, sized to the question. "How many
tokens this week" gets the headline numbers; "which models did I use for what" gets the
by-model and by-activity view. Always name the window and the number of sessions behind
it.

Getting the data:

- `bun ~/.myos/skills/MyTokens/Tools/TokenLog.ts report --days <N>` (it syncs first;
  default 14). `--json` when you need to compute rather than quote. The output already
  folds in the rtk savings block when rtk is installed.
- `rtk gain --history` adds per-command savings the embedded block omits. If rtk is
  missing, say so; installing it is usually recommendation number one.

Reading it for the user:

- Lead with output tokens (the expensive class) and its trend, not the raw cache volume.
- The by-model table answers "which models were used"; the activities list maps
  consumption to the prompts that triggered it. Quote activity prompts back verbatim so
  the user recognises the work.
- Sessions still running are counted mid-flight; flag today's numbers as still growing.
- Big `subOut` on an activity means subagent fan-out; name it, since it is invisible in
  the main conversation.

Offer the dashboard (`Dashboard.md`) when the question is about trends, and Advise
(`Advise.md`) when the subtext is "this feels like too much".
