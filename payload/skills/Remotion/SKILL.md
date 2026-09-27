---
name: Remotion
version: 1.2.11
description: "Creates programmatic video with React via Remotion: compositions, sequences, and motion graphics animated with useCurrentFrame() and rendered to MP4. USE WHEN video, animation, motion graphics, video rendering, React video, render video, animate content, make a short, create animations, video overlay, explainer video, animated explainer, content to video, programmatic video. NOT FOR static images, diagrams, or illustrations, tight-cut filler removal from raw recordings, or audio-only podcast cleaning."
effort: medium
---

# Remotion

## What It Does

Creates video programmatically with React. You describe the composition in code; Remotion renders it to MP4. Every frame is driven by `useCurrentFrame()` rather than CSS animation, so the output is deterministic and reproducible. Each project carries its own theme module (colours, fonts, spacing), and output is staged to `~/Downloads/` for preview first.

## The Problem

Making a short explainer or motion-graphics clip the usual way means a video editor, a timeline, and a lot of manual keyframing: slow, hard to version, and impossible to regenerate when the content changes. If the script changes, you redo the edit by hand. Building video as code fixes that: the composition is a React component, animation is a function of the frame number, and re-rendering after an edit is one command.

## How It Works

Define a composition as React, animate with `useCurrentFrame()`, render with `bunx remotion render`. Rendering is CPU-intensive, so it runs in the background. See the Quick Reference below for the render command and the pattern files.

## Workflow Routing

| Workflow | Trigger | File |
|----------|---------|------|
| ContentToAnimation | "animate this", "create animations for", "video overlay", "content to video", "make a short" | `Workflows/ContentToAnimation.md` |

## Quick Reference

- **Theme:** use the project's own theme module (for example `src/theme.ts` in the project); myos ships no theme
- **Audio:** narration is recorded by Harry; captions come from local Whisper (`~/bin/transcribe --words` or whisper.cpp)
- **Critical:** NO CSS animations - use `useCurrentFrame()` only
- **Output:** Always to `~/Downloads/` first
- **CLI:** `bunx` always (never `npx`)

**Render command:**
```bash
bunx remotion render {composition-id} ~/Downloads/{name}.mp4
```

## Full Documentation

- **Common patterns:** `Patterns.md` - code examples, presets
- **Critical rules:** `CriticalRules.md` - what NOT to do
- **Detailed reference:** `Tools/Ref-*.md` - 30 pattern files covering core Remotion, Lambda, captions and the content pipeline

## Tools

No shipped scripts. Render with `bunx remotion render` inside the project; a project that needs a post-pass (loudness, codec params) keeps its own `scripts/Render.ts`.

## Links

- Remotion Docs: https://remotion.dev/docs
- GitHub: https://github.com/remotion-dev/remotion

## Gotchas

- **React-based video: component patterns differ from web React.** Remotion has specific composition, sequence, and timing APIs.
- **Rendering is CPU-intensive.** Use `run_in_background: true` for render commands.
- **Output goes to ~/Downloads/ first** for preview. Same as images.
- **NOT for static images**: illustrations, diagrams and thumbnails are made another way.

## Examples

**Example 1: Create animated explainer**
```
User: "create a video showing how the Algorithm works"
→ Builds React composition with Remotion
→ Defines sequences, animations, timing
→ Renders to MP4 in background
→ Output to ~/Downloads/ for preview
```

## Execution Log

After completing any workflow, append a single JSONL entry:

```bash
echo '{"ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","skill":"Remotion","workflow":"WORKFLOW_USED","input":"8_WORD_SUMMARY","status":"ok|error","duration_s":SECONDS}' >> ~/.myos/MYOS/MEMORY/SKILLS/execution.jsonl
```

Replace `WORKFLOW_USED` with the workflow executed, `8_WORD_SUMMARY` with a brief input description, and `SECONDS` with approximate wall-clock time. Log `status: "error"` if the workflow failed.
