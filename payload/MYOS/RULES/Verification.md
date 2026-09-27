---
version: 1.0.0
---

# Verification rules

Provenance: adapted from LifeOS RULES/Verification.md v2.2.1.

This file is the one home of the seven incident derived verification rules. The system prompt keeps the core (no claim without tool evidence, "should work" is forbidden, confidence requires source) and points here; Algorithm claims 8 and 16 bind these rules into runs. Load it when checking web or UI output, when a claim is about appearance, when deleting or replacing live infrastructure, when something must expire or propagate, or when the verifier is unavailable. `hooks/VerificationGate.hook.ts` enforces it from the transcript.

Web output is checked in a real browser before Harry sees it. Interceptor is preferred when its extension is connected; Claude-in-Chrome (the `mcp__claude-in-chrome__*` tools) is the accepted fallback, and VerificationGate counts both. A curl 200 is not verification. Headless automation that paints differently from Harry's browser is not verification either.

## The seven rules

1. Modality fidelity. The probe exercises the same path the user takes. A web or UI claim closes only on a real browser navigation to the actual URL. A curl, a DOM read of a different page or a check of a sibling path is a different request and proves nothing about what the browser renders; curl and a browser can receive different pages.

2. An unavailable verifier means DEFER, never substitute. When no browser tool is connected, a web claim is not verified. Say "deployed, not browser checked", mark the claim `[DEFERRED-VERIFY]`, and do not claim live, works or shipped. Fix the tool, wait, or hand the step to Harry; never relabel weaker evidence as verification.

3. Appearance is not existence. A DOM read proves an element exists at some coordinates, not how it looks. Any claim about appearance (an image renders, is centred, the right colour, readable contrast, "looks right") closes only on a pixel image I actually opened and looked at; a blank or uniform frame is not a look. Contrast and native form controls need a real screenshot or a `getComputedStyle` probe, never a DOM reconstruction. View every asset before wiring it in. A shipped UI change is checked at a phone width (390 px or less) as well as desktop, or the claim says "desktop only" out loud.

4. Reproduce before fixing. For any reported UI or page bug, open the page first: before reading code, before theories, before fixes. Check console errors and network 404s. For a command or script bug, run the failing command first. Code analysis without reproduction is speculation.

5. Temporal fidelity. For cache mediated surfaces (DNS, certificates, CDN caches, negative caches) a probe right after the change rides warm caches and proves nothing about steady state. A DNS, certificate or routing claim closes on the provider's records API or the authoritative name server (`dig @<zone-ns>`), never only on a request that went through a resolver cache. If only runtime probes exist, the claim stays `[DEFERRED-VERIFY]` until a re-probe after the TTL, with the follow up named before the run closes.

6. Restore parity on replace or delete. Changing or deleting anything that serves live traffic or produces a flowing metric needs four things: the flow's baseline captured before (a rate over a stated window); what the resource owns, listed from the provider's authority API before the op (a dependent record that "already exists" is no evidence it survives the delete); the authority listed again after the op; and post change evidence that the flow continues at the baseline rate within a stated tolerance. One synthetic event landing is an example and never closes parity. A safety step written as prose in Decisions becomes a claim with a falsifier before the op runs. Metered pipelines stay `[DEFERRED-VERIFY]` until a delayed check against the baseline.

7. Cache fidelity. A cache can sit between the probe and the truth in three places. On the response path, a health endpoint answers `no-store` (`Cache-Control` and `CDN-Cache-Control`), and that header is itself a claim. On the deploy path, one probe reads whichever edge copy answered; repeat until N identical results in a row, and never report a fix on one probe. On the data path, an app's own storage reads may be cached, so expiry is made structural (rotate the key or the query) rather than trusted to a TTL. A mock cannot reproduce a cache: unit tests over a fake store prove the logic, never the deployment.

## Evidence spans the claim

When a claim covers a container (a site, a data set, a folder of files), the container passing is not evidence for its members. The probe set touches every member type the user consumes, one rendered or executed instance each, and a deterministic sweep covers the rest where one exists. A shell page and an HTTP 200 prove nothing on a single page app.

## Briefing a verifier

A verification brief carries the steps to run and the evidence to return, never the result it is expected to find. A verifier told what a pass looks like reasons its way to that pass. A second look (Algorithm claim 11) restates the goal and the claims, not the build plan.
