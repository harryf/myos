# Audit

Judge a piece of writing against the house style and report. Read-only. Change nothing unless
the person asks for a rewrite, which is `Rewrite.md`.

## Steps

1. Read `../StyleRules.md` if it is not already in context.

2. Run the gate. Pick the profile from what the file is: `prose` for anything a human reads,
   `docs` for reference documentation, `dashes` for a file lifted from upstream.

   ```bash
   bun ~/.myos/skills/Writing/Tools/StyleCheck.ts --hints --profile prose <path>
   ```

   For text that is not on disk yet (a draft in the conversation), write it to a scratch file
   first. The checker reads files, not stdin.

3. Read the piece yourself. The checker catches vocabulary and punctuation. It cannot see the
   things that matter more:

   - sentences that exist only to say the subject matters
   - a conclusion that restates the opening
   - claims of status with no evidence behind them
   - uniform sentence length, which is the strongest AI signal of all
   - synonym cycling where repeating one noun would be clearer
   - structure that is scaffolding rather than meaning: three headings in 300 words

4. When the piece is long or the stakes are high, read
   `~/.myos/MYOS/DOCUMENTATION/Writing/AIWritingPatterns.md` and work its P0 and P1 tiers.

## Report

```
Style audit: <path>
  Gate:     N error, N warn, N hint     (or "clean")
  Reads as: <one sentence on how it lands>
  P0        <credibility problems: invented status, vague attribution>
  P1        <AI smell: vocabulary, uniform rhythm, formulaic structure>
  P2        <polish>
  Verdict:  ship as is | fix the P0/P1 list | rewrite from the core point
```

When a piece trips five or more vocabulary rules across three or more categories and every
paragraph is the same length, patching words will not save it. Say so, state the core point in
one sentence, and offer to rebuild from there.
