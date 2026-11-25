# Journal coverage after executor retirement

Date: 2026-11-25. Starting revision: `2fc44facfd80b693d3184645f11880f775c20e87`. The reported failures concern its predecessor `e1b8e1779063957295e478f0be841f06a829b618`; the intervening commit changes only composer browser-test synchronization.

## Confirmed cause

The [first browser shard](https://github.com/Decode-Disc/agentic-resilience-workb/actions/runs/45612331353/job/139198784305) failed three journal cases that requested fresh `ai-sdk` missions. The [second shard](https://github.com/Decode-Disc/agentic-resilience-workb/actions/runs/45612331353/job/139198784205) failed the corresponding `convex-agent` cases. Each shard passed its other eight cases. The backend logs identify `generation_backend_unknown` from `requireSupportedMissionBackend` during fixture activation, before execution. Retrying did not change that outcome.

The mission admission owner requires `pi-durable` version 1 and the Pi execution runtime. The browser test still enumerated the retired executors across inspection, validation and conversation. This was an obsolete execution matrix, not a failure to read a retained journal. Running the original validation/AI SDK case locally reproduced the same activation refusal before any provider generation.

## Correction and preserved contracts

The browser matrix now exercises the three mission definitions through Pi at desktop width and conversation at mobile width. It retains its request/reply snapshot, operation-result, keyboard, queue/steering, reconnection, unchanged persisted snapshot and zero-provider assertions. Branches that interpreted newly generated legacy-provider requests are removed with their invalid execution cases. The separate large fragmented native-journal browser scenario remains in place.

Two administrator integration cases explicitly characterize the preserved read path for recorded `ai-sdk` version 1 and `convex-agent` version 2 invocations. They read exact request and reply content through the authenticated journal API, verify backend identity, and compare mission/invocation state, provider calls and scheduled work before and after inspection. Revoking the administrator must prevent further access. These cases use real Convex storage and handlers, with no internal mocks. They establish the generic retained-record read contract; they are not a migration rehearsal for every historical provider format.

No production admission, journal reader, backend selection or execution fence changes. The existing admission/resume regressions continue to require refusal of retired executors without creating work or taking authority.

## Verification

```sh
pnpm test:e2e e2e/invocation-journal.spec.ts --workers=2 --reporter=list
pnpm exec vitest run src/__tests__/convex/admin/invocation-journal.test.ts src/__tests__/convex/execution/backend-default.test.ts --maxWorkers=1
pnpm exec tsc --noEmit
pnpm docs:check
```

The administrator journal and backend admission/resume suites passed 15 cases, including both historical identities. All four browser cases passed with two workers in 3.8 minutes, preserving the existing 240-second test and 180-second mission-poll budgets. The final frontend/test typecheck, focused Biome check and documentation check passed. No whole-project build or unrelated browser suite was rerun for this test-only change. Checks use the existing local backend and labelled simulations; no paid provider qualification, cloud cutover or data migration is part of this correction.
