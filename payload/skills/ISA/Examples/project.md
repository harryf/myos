---
phase: climbing
progress: 4/9
task: shared board for the flat finder page
slug: 20260928-100000_flat-finder-board
project: sarah_flat
started: 2026-09-28T10:00:00+02:00
updated: 2026-09-28T11:40:00+02:00
---

## Problem

The flat finder page shows every listing but keeps no memory: Sarah cannot save a flat she likes, and Harry cannot see which ones she has contacted. Favourites live in one phone's local storage and vanish with it.

## Vision

Sarah taps Nice on a studio at breakfast; by lunch Harry opens the same page on his laptop and sees it in the Interested column with her note. Nobody logged in, nothing was lost when she switched phones.

## Out of Scope

Accounts and passwords. Notifications of any kind. Editing listings. A map on phones.

## Principles

- The page stays one static file; state lives in one shared table.
- A failed write is visible and retried, never silently dropped.

## Constraints

- The page is published by `~/bin/publish` to a private GitHub Pages path; no server of our own.
- The Grist document is the only shared store; anonymous visitors may add and edit rows but never delete rows or change structure.

## Goal

"Sarah and I see the same board." A status set on one device shows on any other device within one refresh, and survives a lost phone.

## Features

### F1 · Board writes
Why: a tap is recorded once in the shared table, even on a flaky connection.

- [x] C1: A tap on Nice sends one PUT upsert keyed on ListingId (HTTP 200).
- [x] C2: A write made offline is queued and sent when the browser comes back online.
- [ ] A1: Anti: an anonymous DELETE on the Flats table returns 403.

### F2 · Board view
Why: the board reads the same on a phone and a laptop.

- [x] C3: The My board tab shows three columns: Interested, In contact, Done.
- [x] C4: A row set in Grist appears on the board after a refetch.
- [ ] C5: At 390 px the board has no horizontal scroll.
- [ ] C6: Antecedent: each card shows the note under the title, so Sarah recognises her own words at a glance.

### F0 · Cross-cutting
Why: publishing must not break what already works.

- [ ] C7: `bun Tools/registry.test.ts` passes after the change.
- [ ] A2: Anti: the published page makes zero map tile requests at 390 px.

## Test Strategy

| isc | type | check | threshold | tool |
|---|---|---|---|---|
| C1 | curl | anonymous PUT to `/records?onmany=all` | HTTP 200 | curl |
| C2 | screenshot | offline stub, tap, go online, queue drains | queue empty | Claude-in-Chrome |
| A1 | curl | anonymous DELETE on a test row | HTTP 403 | curl |
| C3 | screenshot | My board tab at 1280 px | three column headings | Interceptor |
| C4 | curl | add a row, reload, read the card | card present | curl |
| C5 | screenshot | 390 px frame, `scrollWidth <= clientWidth` | true | Claude-in-Chrome |
| C6 | manual | Harry reads three cards on his phone | "yes" | manual |
| C7 | bun-test | `bun test Tools/registry.test.ts` | 0 fail | bun |
| A2 | screenshot | network log at 390 px | 0 tile requests | Claude-in-Chrome |

## Decisions

- 2026-09-28 10:20: Upsert keyed on ListingId rather than row ids, so two devices never create duplicate rows.
- 2026-09-28 11:05: refined: C2 was "writes never fail"; a queue plus a visible "not saved yet" line is what is testable.
- 2026-09-28 11:30: DEAD END: headless Brave hangs on this machine; screenshots go through the real browser.

## Verification

- C1: curl: `PUT .../records?onmany=all` → `HTTP/2 200`
- C2: screenshot: Claude-in-Chrome, offline stub; queue length 1 → 0 after `online`; saved verification/c2.png
- C3: screenshot: Interceptor, 1280 px; headings "Interested", "In contact", "Done"
- C4: curl: added ff-1234 as Interested → card present after reload

## Remaining Work

- Tell Sarah the board is shared with Harry: in person, not in the page.
