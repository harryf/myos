# Rewrite

Take a piece of writing and put it in the house style. Keep every fact. Lose the padding.

## Steps

1. Read `../StyleRules.md`.

2. Find the core point and write it in one sentence. If you cannot, the piece has no core point
   and no amount of editing will give it one. Say that and ask what the point is.

3. Fix punctuation by machine first, so you spend your attention on words:

   ```bash
   bun ~/.myos/skills/Writing/Tools/StyleCheck.ts --fix <path>
   ```

   Read the diff. The fixer picks its punctuation from context and is right most of the time,
   not all of the time.

4. Now the passes that need a reader:

   - Delete every sentence that only says the subject matters.
   - Swap Latin words for English ones from the table in `StyleRules.md`, except where the Latin
     word is the precise technical term.
   - Break up any run of same-length sentences. Short ones carry weight; use them.
   - Replace vague attribution with a named source, or make the claim outright.
   - Turn inline-header bullet lists into prose or a table.
   - Where a status is claimed, link the evidence.

5. Re-run the gate. It must exit 0 before you hand the piece back.

6. Show the person the rewrite, and say what you cut and why in a line or two. Do not show a
   diff of every word.

## What not to do

Do not smooth out every irregularity. Prose edited until it is perfectly even reads as machine
output, which is the thing this whole skill exists to avoid. Uneven pacing, a fragment, an
opinion stated plainly: keep them.

Do not change quoted material, someone else's words, or anything inside a code block.

Do not rewrite a document that was only asked to be audited. That is `Audit.md`.
