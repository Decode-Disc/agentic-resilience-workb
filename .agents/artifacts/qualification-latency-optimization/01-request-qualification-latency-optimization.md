---
type: request
repos:
  - identifier: "Decode-Disc/agentic-resilience-workb"
    sha: "4c93c661e3a6b66d20f1dd7bacd5dbbba4a293e7"
---

# Original Request: Qualification Latency Optimization

Reduce wall-clock duration of live qualification lots without weakening authorization, generation fencing, persist-before-adopt guarantees, evidence provenance, or campaign validation integrity.

In the measured two-lot CCC requalification (`examiner` + `discovery`, commit `40a65cc1`), total wall time was 68m 47s while actual LLM model receipts accounted for only 16m 18s (24% of total, 33% of the 49m 05s spent in scenarios). The user requested a TDD workflow covering both:

1. **Convex harness and bundle latency (~32m 24s in scenarios):** eliminate or cut down the ~200–300 ms per-RPC V8 module evaluation cost (2.73 MB transitive JS closure across hot-path execution modules), the ~20–25 sequential Convex RPCs per turn in `piMission` / `piStorage` / `invokeAgentModel` / `operations`, and the systematic `pi_slice_complete` Node worker teardown and cold restart on every scheduled operation.
2. **Campaign preflight and runner latency (~12m 21s outside scenarios/reviews + serial execution):** avoid redundant reruns of the identical 245-test Vitest domain battery across lots when validation inputs are equivalent, and examine scenario entry points, orchestration, and export/cleanup overhead in the campaign runner.

## Source Pointers

- Measured baseline reports:
  - `/home/abdwhb/.cache/workbench-evaluations/ccc-40a65cc1-requalification-20261127/timing-and-revision-evidence.md`
  - `/home/abdwhb/.cache/workbench-evaluations/ccc-40a65cc1-requalification-20261127/qualification-contract-review.md`
- Convex execution harness and hot-path modules:
  - `convex/integrations/piMission.ts`
  - `convex/integrations/piStorage.ts`
  - `convex/integrations/piNativeInput.ts`
  - `convex/integrations/piInvocation.ts`
  - `convex/execution/piWorker.ts`
  - `convex/execution/piControl.ts`
  - `convex/execution/piStore.ts`
  - `convex/execution/invocationLifecycle.ts`
  - `convex/execution/invokeAgentModel.ts`
  - `convex/execution/operations.ts`
  - `convex/execution/context.ts`
  - `convex/providerCalls.ts`
  - `convex/resourcePolicy.ts`
- Campaign preflight and runner:
  - `scripts/evaluations/workbench-browser/campaign.ts`
  - `scripts/evaluations/workbench-browser/protocol.ts`
  - `scripts/evaluations/workbench-browser/qualify.ts`
  - `scripts/evaluations/workbench-browser/scenarios.ts`
  - `convex/qualificationCampaigns.ts`
  - `convex/qualificationCampaignPolicy.ts`
  - `convex/qualificationInitialFixtureSetup.ts`
- Reference contracts:
  - `PRODUCT.md`
  - `context/TECH.md`
  - `docs/ROADMAP.md`
