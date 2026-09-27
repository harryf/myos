---
task: Rotate the deploy credential in CI
slug: 20260814-101500_rotate-deploy-credential
effort: E2
phase: complete
progress: 6/6
mode: algorithm
started: 2026-08-14T10:15:00+02:00
updated: 2026-08-14T10:40:00+02:00
---

# Rotate deploy credential ISA

## Problem

The deploy token in CI is older than the ninety day policy allows.

## Goal

A new deploy token is active in CI, the old one is revoked, and a deploy succeeds with the new token.

## Criteria

- [x] ISC-1: A new token exists in the provider with the same scope as the old one.
- [x] ISC-2: The CI secret `DEPLOY_TOKEN` holds the new value.
- [x] ISC-3: A deploy run started after the secret change succeeds.
- [x] ISC-4: The old token is revoked in the provider.
- [x] ISC-5: A deploy run with the old token fails with 401.
- [x] ISC-6: Anti: the token value never appears in any log line of the run.

## Test Strategy

| isc | type | check | threshold | tool |
|---|---|---|---|---|
| ISC-1, 4 | api | provider token list | present, revoked | curl |
| ISC-2 | ci | secret updated timestamp | after 10:15 | gh secret list |
| ISC-3, 5 | ci | run conclusion | success, failure | gh run view |
| ISC-6 | log | token substring absent | zero | rg |

## Decisions

- 2026-08-14 10:20: Rotate before revoke so a failed deploy never leaves CI without a working token.

## Changelog

- conjectured: revoking first is safe because deploys are rare. refuted_by: a scheduled deploy fired during the window in a dry run. learned: rotate then revoke, always. criterion_now: ISC-4 is ordered after ISC-3.

## Verification

- ISC-1: curl provider API, token id tok_new listed with scope deploy.
- ISC-2: `gh secret list` shows DEPLOY_TOKEN updated 2026-08-14T08:22Z.
- ISC-3: `gh run view 1234` conclusion success.
- ISC-4: curl provider API, tok_old status revoked.
- ISC-5: `gh run view 1235` conclusion failure, log shows 401.
- ISC-6: `rg tok_` over both run logs: none.
