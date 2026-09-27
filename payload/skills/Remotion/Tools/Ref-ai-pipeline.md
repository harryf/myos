---
name: ai-pipeline
description: Combine generated or supplied images, recorded narration and captions into a Remotion composition
metadata:
  tags: pipeline, generation, b-roll, content, narration, captions
---

# Content to Remotion pipeline

Gather the ingredients (scene images, narration audio, captions), then compose and render in Remotion. Narration is recorded by a person, not synthesised: myos carries no text to speech vendor.

## Pipeline

```
Topic/Script
    │
    ├── scene images (photos, screenshots, generated stills) ──► scene-N.png in /public
    ├── narration recorded by hand ────────────────────────────► narration.wav in /public
    └── local Whisper on narration.wav ────────────────────────► Caption[]
            │
            └── Remotion composition ──► MP4 via bunx remotion render
```

## Step 1: Scene images

Save every image into the project's `/public` directory so `staticFile()` resolves them.

## Step 2: Narration

Record the script (phone voice memo or any recorder), export WAV or M4A, clean it if needed, and put it in `public/`. Normalise loudness once (for example `ffmpeg -i in.m4a -af loudnorm=I=-16 public/narration.wav`).

## Step 3: Transcribe for captions

Get word-level timings locally, either with `~/bin/transcribe --words` or with `@remotion/install-whisper-cpp` (see `Ref-transcribe-captions.md`), and write `public/captions.json` as `Caption[]`.

## Step 4: Compose

```tsx
import { AbsoluteFill, Sequence, staticFile, useVideoConfig } from 'remotion';
import { Audio } from '@remotion/media';
import { createTikTokStyleCaptions } from '@remotion/captions';
import captionsJson from '../public/captions.json';

export const NarratedVideo: React.FC = () => {
  const { fps } = useVideoConfig();
  const { pages } = createTikTokStyleCaptions({
    captions: captionsJson,
    combineTokensWithinMilliseconds: 1200,
  });

  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      <Sequence from={0} durationInFrames={3 * fps}>
        <img src={staticFile('scene-1.png')} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </Sequence>
      <Sequence from={3 * fps} durationInFrames={3 * fps}>
        <img src={staticFile('scene-2.png')} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </Sequence>

      <Audio src={staticFile('narration.wav')} />

      <AbsoluteFill style={{ justifyContent: 'flex-end', padding: 80 }}>
        {pages.map((page, i) => {
          const start = (page.startMs / 1000) * fps;
          const next = pages[i + 1];
          const end = next ? (next.startMs / 1000) * fps : start + 60;
          return (
            <Sequence key={i} from={start} durationInFrames={end - start}>
              <div style={{ fontSize: 72, fontWeight: 700, color: 'white', textAlign: 'center' }}>
                {page.tokens.map((t) => t.text).join('')}
              </div>
            </Sequence>
          );
        })}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
```

## Step 5: Render

```bash
bunx remotion render NarratedVideo ~/Downloads/narrated-video.mp4 --codec=h264
```

## Related references

- `Ref-transcribe-captions.md`: local transcription options
- `Ref-display-captions.md`: TikTok-style caption rendering
- `Ref-images.md`: `<Img>` component specifics
- `Ref-audio.md`: audio control (volume, trim, loop)
