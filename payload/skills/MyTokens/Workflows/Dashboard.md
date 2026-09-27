# Dashboard: the current state, openable

Deliverable: a self-contained HTML dashboard on disk, opened for the user.

```bash
bun ~/.myos/skills/MyTokens/Tools/TokenLog.ts dashboard --days 30   # prints the path
open ~/.myos/MYOS/MEMORY/OBSERVABILITY/TOKENS/dashboard.html
```

The tool generates the whole page deterministically (summary cards, output-per-day and
cache-read-per-day charts, by-model table, top sessions folded one row per session):
regenerating costs no model tokens, which is the point of a token dashboard. Don't rebuild it by hand in HTML; if
the layout needs changing, change `buildDashboard()` in `Tools/TokenLog.ts` in the myos
repo.

A custom look comes from an optional `theme.css` next to the store
(`MEMORY/OBSERVABILITY/TOKENS/theme.css`): when present, the tool inlines it after the
base styles, so every regeneration stays free and styled. Write it by hand against the
dashboard's selectors (`body`, `h1/h2`, `.card`, `table`, the two `figure svg rect`
chart fills). No theme file, no problem: the dashboard falls back to its plain built-in
style, light and dark.

A shareable snapshot for someone else is a different artifact: build it from
`report --json` on request and say it is a snapshot rather than the living dashboard.
