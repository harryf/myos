# The test suite

Regression cover for every tool and hook myos ships. `bun test` runs it; CI runs it on every push
and the release workflow runs it again on the tagged commit, so a script cannot regress into a
release unnoticed.

```bash
bun test                                  # everything
bun test test/tools/MergeSettings.test.ts  # one file
bun test -t "pass@k"                       # by name
bun Tools/TestCoverageCheck.ts             # the tool ⇔ test parity gate
```

Nothing here needs a network, a model or a credential. A run takes about 40 seconds.

## What it covers

Every tool script under `Tools/`, `payload/MYOS/TOOLS/`, `payload/skills/*/Tools/`, plus
`payload/MYOS/statusline.ts` and every hook entrypoint in `payload/hooks/` (`*.hook.ts` and
`*.hook.sh`; `lib/` and `handlers/` are covered through the hooks that own them). `test/corpus.ts`
holds one row per script and says what a test can honestly assert about it:

| kind | meaning |
|---|---|
| `static` | deterministic logic, tested for real behaviour against fixtures |
| `gated` | real work needs something this machine may not have, so the live path is skipped when it is absent |
| `llm` | the main path calls a model, so only the deterministic parts around it are tested |
| `exempt` | nothing worth asserting, with a stated reason |

`bun Tools/TestCoverageCheck.ts` fails when the corpus and the filesystem disagree: a new tool
with no row, a row pointing at a deleted tool, a row naming a test file that does not exist, or a
test file no row points at. Add the row in the same commit as the tool, exactly like INVENTORY.md.

Whole-system validation (skills invoking, agents dispatching, the Algorithm loading, model
routing, the memory loop) lives in `Tools/ReleaseCheck.ts`, run by hand before a release and never
by CI or `bun test`, because its live probes cost model calls. Its deterministic parts are tested
in `test/gates/ReleaseCheck.test.ts` like any other gate.

## Hook tests

Hooks are subprocesses wired to Claude Code lifecycle events, and two of them can reach a model
(`PromptProcessing` names sessions by inference; `MemoryReviewFire` spawns the detached memory
reviewer), so `test/hooks/harness.ts` adds three guarantees on top of the shared harness:

- **Every hook runs as a real subprocess** against a myos-shaped sandbox HOME (`myosHome()`),
  fed the same JSON-on-stdin payloads Claude Code sends (`events.*`, transcript builders).
- **Every run has a hard timeout that kills the child.** A hook that hangs fails its test loudly
  instead of hanging `bun test` (the fake-stdin trap DEVELOPMENT.md documents).
- **A sparse PATH (`sparsePath()`) makes the dangerous branch unreachable**: with only `bun` (and
  named stubs) on PATH and `homedir()` inside the sandbox, `claude`, `security` and friends
  cannot resolve, so inference and network paths fail fast into the fallback code the tests
  actually assert.

Cross-hook properties (every hook file registered in `settings.template.json` or explicitly
listed as a sub-hook, SessionEnd ordering, `bun`-prefixed registration) live in
`test/hooks/HookContract.test.ts`. The silent-unwiring failure it guards against is real: the
memory loop once shipped with its trigger hook simply not registered.

## Optional tests

A test that needs ffmpeg, ImageMagick, whisper, codex, rembg, a browser, or a vendor key skips when
that thing is absent, and the run prints why:

```
Optional tests skipped (12): dependency not present:
  · Art FillFrame (real crop): ImageMagick not on PATH (brew install imagemagick)
  · PerplexitySearch (live search): PERPLEXITY_API_KEY not set: the live-search path cannot be exercised
```

The ledger exists because `bun test` reports a skip count and nothing else, and "3 skip" reads like
a pass. A gap should be a decision somebody made, not something nobody noticed.

Argument handling, guard paths and clean failure are tested for those tools whatever is installed.
Only the part that genuinely needs the dependency is skipped.

Two dependencies are worth installing, because they unlock about 50 real tests:

```bash
bun install                                  # yaml + handlebars, for the Evals and Prompting tools
bun install --cwd payload/skills/Evals       # the rest of the Evals stack
```

`bun test` does not auto-install the way `bun run` does, which is why the repo carries a dev-only
`package.json`. It is not shipped: `payload/` has no root manifest and needs none.

One consequence to know: a `node_modules` directory at the root turns bun's auto-install **off** for
everything under it, so a tool importing a package the dev manifest does not carry (the image-model
SDKs in `skills/Art/Tools`, Remotion's peers) cannot load and its tests skip. That is why the gates
ask with an actual import (`canImport`) rather than with the resolver, which answers optimistically:
it resolves packages it has never fetched.

## Writing a test

Read `payload/MYOS/DOCUMENTATION/Testing/TestingDoctrine.md` first: one shared harness, a parallel
`test/` tree, no `process.env`, disposable scopes, no retries, no per-test timeouts.

`test/harness.ts` has what you need:

```ts
import { bunExe, gate, haveBin, repoPath, run, tempDir, tempHome } from "../harness.ts";

using dir = tempDir("my-test", { "input.json": "{}" });      // removed at end of scope
using home = tempHome("my-test");                             // scratch $HOME with a ~/.myos in it
const result = await run([bunExe(), repoPath(TOOL)], { env: home.env() });
const skip = gate("label", haveBin("ffmpeg"), "ffmpeg not on PATH");
```

Three rules the harness enforces for you:

- **Never `process.env`.** `run` passes a scrubbed environment with `HOME` pointed at a sandbox, so
  a tool that resolves `~/.myos` writes there and not into the real install.
- **`os.homedir()` is fixed at process start in Bun**, so an in-process `HOME` override does not
  move it. Anything resolving paths through `os.homedir()` has to be tested in a subprocess.
- **A tool that writes inside its own tree** (`import.meta.dir`-relative state) is imported from
  `tempCopy(...)`, a disposable copy, so payload/ stays clean.

Name each test after the behaviour it protects, not the function it calls, and say why the
behaviour matters when that is not obvious. `Anti:` tests assert the bad thing does not happen: no
model spawned, no file written, no input modified.

When a tool behaves differently from its own documentation, pin the behaviour and say so in the
test (search for `DOCUMENTED MISMATCH` and `DOCUMENTED LIMIT`). Then whichever side gets corrected,
the test says which one moved.
