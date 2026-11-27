---
type: research-questions
repos:
  - identifier: "Decode-Disc/agentic-resilience-workb"
    sha: "4c93c661e3a6b66d20f1dd7bacd5dbbba4a293e7"
flow: tdd
---

# Research Questions: Qualification Latency Optimization

```text
68m 47s total (examiner + discovery)
├── 32m 24s  Convex harness & V8/Node local overhead   (Q1, Q2, Q3, Q4)
├── 16m 18s  OpenRouter model receipts (118 calls)
├──  7m 21s  Automated reviewer (52 turns)
├──  5m 45s  Duplicate Vitest preflight (2 x 245 tests) (Q5)
└──  6m 59s  Preflight fail/relaunch, exports, SEC/Exa  (Q6)
```

## Key Context Pointers

- Measured traces and summaries:
  - `/home/abdwhb/.cache/workbench-evaluations/ccc-40a65cc1-requalification-20261127/timing-and-revision-evidence.md`
  - `/home/abdwhb/.cache/workbench-evaluations/ccc-40a65cc1-requalification-20261127/qualification-contract-review.md`
- Convex V8 hot-path modules: `convex/execution/piStore.ts`, `convex/execution/piControl.ts`, `convex/execution/invocationLifecycle.ts`, `convex/execution/operations.ts`, `convex/execution/context.ts`, `convex/providerCalls.ts`, `convex/modelConfiguration.ts`
- Convex Node worker and Pi integration: `convex/execution/piWorker.ts`, `convex/integrations/piMission.ts`, `convex/integrations/piStorage.ts`, `convex/integrations/piNativeInput.ts`, `convex/integrations/piInvocation.ts`, `convex/execution/invokeAgentModel.ts`, `convex/resourcePolicy.ts`
- Campaign preflight and runner: `scripts/evaluations/workbench-browser/protocol.ts`, `scripts/evaluations/workbench-browser/campaign.ts`, `scripts/evaluations/workbench-browser/qualify.ts`, `scripts/evaluations/workbench-browser/scenarios.ts`, `convex/qualificationCampaigns.ts`, `convex/qualificationCampaignPolicy.ts`
- Architectural invariants: `context/TECH.md`, `PRODUCT.md`

## Questions

1. **V8 bundle coupling and import graph:** In `convex/execution/piStore.ts`, `piControl.ts`, `invocationLifecycle.ts`, `operations.ts`, `context.ts`, and `providerCalls.ts`, which exact static imports pull in the shared ~703 KB super-chunk, `typebox@1.3.27` (691 KB), `zod@4.4.3` with its locales (425 KB), `@convex-dev/auth` + `jose` (229 KB), and `exa-js` + `zod@3.25.76` (186 KB)? Which of those dependencies are actually needed at runtime by each hot-path module, and how does `convex-local-backend` evaluate or cache V8 modules across calls?
2. **Per-turn Convex RPC sequence in `piMission` and `invokeAgentModel`:** Across one full turn (`inv.createdAt -> rec.createdAt -> rec.completedAt -> inv.completedAt -> op.completedAt -> next inv.createdAt`), what is the exact ordered list of `ctx.runQuery`, `ctx.runMutation`, and `ctx.runAction` calls in `convex/integrations/piMission.ts`, `piStorage.ts`, `piNativeInput.ts`, `piInvocation.ts`, and `convex/execution/invokeAgentModel.ts`? Which calls are duplicated within the same turn (such as `context.build`, `settleRetainedOperations`, `syncInputs`, and `piStore.renew`), and what invariants or failure-recovery guarantees do each of them enforce?
3. **Non-scheduled vs. scheduled operation dispatch:** In `convex/execution/operations.ts` and `convex/integrations/piMission.ts`, why do local non-scheduled operations (`consult_mission_state`, `consult_run_state`, `adjust_framing`, `search_available_material`, `read_in_context`) route through `ctx.runAction(internal.execution.operations.dispatch)` instead of a direct query/mutation path, and what exact authority, fencing, or adoption checks depend on that boundary?
4. **Worker lifecycle on `sched=True` operations (`pi_slice_complete`):** In `convex/integrations/piMission.ts` (`waitOperation`, `drainRetainedOperations`, `finally`) and `convex/execution/piControl.ts` (`prepare`, `schedulePiMission`, `closeWorker`, `unchangedScheduledWait`), how does a `waiting` scheduled operation trigger `pi_slice_complete`, what happens during `piWorker.run` cold restart and `openMissionPiStorage` log replay, and what invariants govern whether a worker yields immediately versus waiting briefly for fast scheduled operations (such as `read` at ~3 s)?
5. **Preflight validation identity and caching:** In `scripts/evaluations/workbench-browser/protocol.ts` (`validationIdentity`, lines 390–434) and `scripts/evaluations/workbench-browser/campaign.ts`, what inputs compose `validationIdentity` and `candidateHash`, what causes two lots on the exact same commit to recompute the 245-test Vitest battery (~172 s each), and what contract in `convex/qualificationCampaigns.ts` or `convex/qualificationCampaignPolicy.ts` verifies preflight results?
6. **Campaign runner orchestration and scenario entry points:** In `scripts/evaluations/workbench-browser/campaign.ts`, `qualify.ts`, `scenarios.ts`, and `convex/qualificationInitialFixtureSetup.ts`, how are scenarios sequenced (serial vs. concurrent constraints, shared visitor/execution slots, shared budget ledger), how much time goes to export/inspection/archive/cleanup, and what initial-fixture or mid-workflow entry points already exist for testing later stages (such as the documentary examiner)?
7. **Baseline measurement harness:** What existing local simulation tests or scripts exercise the full `piWorker` / `piMission` / `operations` loop against `convex-local-backend` (zero paid calls) so before-and-after RPC counts, per-call V8 latency, and turn wall time can be measured deterministically?
