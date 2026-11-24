---
type: implementation-progress
repos:
  - identifier: "abdwhb-png/decoding-discontinuity-proto"
    sha: "cf757669701104f835a29fb1f0941d1c78ce3304"
flow: tdd
status: phase-1-awaiting-manual-verification
date: "2026-11-19"
---

> November 19 continuation: this is the phase-one checkpoint, preserved as recorded. The user subsequently authorized all phases; the consolidated current state is in [09-implementation-complete.md](09-implementation-complete.md). Statements below that phases 2–6 or runtime publication were unstarted describe this earlier checkpoint.

# Implementation Progress: Durable Sources Operations

Scope: phase 1 of the [implementation outline](06-structure-outline-sources-evaluator.md). The cited commit is the baseline; implementation remains uncommitted in the primary checkout on `sources-workflow-no-legacy`. Existing unrelated configuration, verification-report and archive changes were preserved. Work ran locally without implementation or review delegation, following the project's stricter delegation boundary.

## Implemented behavior

The common Sources factory now declares the actual Node action as a static scheduled target for discovery, acquisition, qualification submission and targeted checks. `execution/operations.claim` commits authorization, job scheduling and waiting ownership atomically. Repeated dispatch returns the retained reference. `beginScheduledExecution` permits one start in the original generation; adoption rebinding cannot authorize starting the old job again.

```text
Pi dispatch -> claim + schedule + retain waiting -> existing native wait checkpoint
Scheduled Sources action -> executeScheduledOperation in the shared executor
  begin once -> execute Sources work in this action -> retain result -> wake Pi
```

The Sources action executes its body directly. The shared `executeScheduledOperation` function owns start/result/failure settlement in `execution/operations.ts`; it does not schedule a wrapper action or await another long-running Sources action. This keeps the existing execution ownership checker unchanged. The first implementation's direct domain references to result settlement were rejected by that checker and were refactored into the existing executor owner.

The request schema adds optional scheduled-job ownership and start time. `operationHasStarted` gives Sources reservations, effect retention, observation staging and provider-call admission one rule for inline running work and started scheduled waiting work. Queued cancellation cancels the owned job. Running and waiting effects hold sequential admission and requested-pause settlement. Saved-material inspection keeps its existing registered path; common read operations remain available during a scheduled wait.

The action retains known terminal outcomes through the existing result owner and classifies unexpected failures through existing uncertain-effect handling. Worker loss stays unknown and neither duplicate delivery nor polling starts another attempt. Domain, provider and preparation authorities remain responsible for adoption and billing. Existing running records remain readable/executable through their prior contract.

## Test-first evidence

| Regression | Observed RED | Correction and checked outcome |
| --- | --- | --- |
| Dispatch returns before documentary I/O | `pnpm exec vitest run src/__tests__/convex/sources/documentary-control-integration.test.ts -t 'Sources returns a durable wait'` failed with `synchronous_io` instead of `waiting`. | Atomic scheduled claim returns waiting before the external fetch; the actual action then persists the qualification and one result. Duplicate action delivery during held I/O returns without another receipt or reservation. |
| Malformed scheduled declaration | `pnpm exec vitest run src/__tests__/convex/execution/operation-contracts.test.ts -t 'scheduled effects require'` failed because an invalid target did not throw. | Contract validation rejects malformed targets, dual executors and scheduled declarations on non-durable operations. |
| Adoption generation differs from execution generation | `pnpm exec vitest run src/__tests__/convex/sources/documentary-control-integration.test.ts -t 'rebinding result adoption'` failed with `true` instead of `false`. | The one-time start requires the original request generation; result adoption cannot restart old work. |
| Requested pause during scheduled work | The extended Sources battery finished with 696 passes and one failure in `sources-pause-admission.test.ts`: the dossier paused before engaged waiting work drained. | The pause owner now includes waiting work. The focused Sources pause and framed workflow tests pass while retaining their original state/generation assertions. |

The four I/O families have real registered-operation integration coverage. Additional cases verify transaction rollback, repeated waiting consultation, duplicate start, another effect while waiting, current-state reads, stale generation, queued cancellation, expired/lost worker, and completion observed before later consultation. Existing transport controls still cover late receipt settlement without adoption. Test drivers now explicitly enter or finish the real scheduled action rather than assuming dispatch itself returns a final result; their domain assertions remain in place. Inline saved-material claim assertions still expect `execute`.

## Verification run

| Check | Result and boundary |
| --- | --- |
| Extended Sources + operation-result battery | 696/697 passed before the pause correction. The [raw report](phase1-extended-tests-before-pause-fix.json) preserves that failure; the complete battery was not rerun after the correction. |
| Outline suites plus cancellation, operation contracts/results/conformance, dispatch, Workbench effects and framed research control | 141/141 passed; zero pending/todo tests. [Raw report](phase1-targeted-tests.json). |
| After moving scheduled lifecycle into the executor | `pnpm exec vitest run src/__tests__/convex/sources/documentary-control-integration.test.ts src/__tests__/convex/sources/sources-discovery.test.ts src/__tests__/convex/execution/operation-conformance.test.ts --reporter=dot`: 41/41 passed. |
| Sources boundaries, requested pause and framed workflow after the refactor | `pnpm exec vitest run src/__tests__/convex/sources/sources-boundaries.test.ts src/__tests__/convex/sources/sources-pause-admission.test.ts src/__tests__/convex/workflows/framed-research-control.test.ts --reporter=dot`: 15/15 passed. |
| TypeScript | `pnpm typecheck` passed; [output](phase1-typecheck.log). After the lifecycle refactor, `pnpm convex:check` passed again. |
| Changed-file diagnostics | `pnpm exec biome check` over the 33 changed production/test TypeScript files passed without diagnostics after formatting and import organization. |
| Architecture and resource checks | `node --experimental-strip-types scripts/check-imports.ts`, `node --experimental-strip-types scripts/check-execution-boundaries.ts`, and `pnpm resource-policy:check` passed. No checker allowlist was changed. |
| Documentation and patch integrity | `pnpm docs:check`: 43 Markdown files, 292 local links, zero errors. Separate artifact link/fence checks and `git diff --check` passed. |

The passing counts overlap and must not be added together. Filtered RED/probe runs excluded unrelated tests by name; no `.skip`, `.only` or retry was introduced. No default/CI test called a paid provider. The controlled long-response test retains its existing real elapsed delay through Node timers while scheduled fixture jobs stay under deterministic timer control.

### Workflow diagnostics remain visible

The cancellation tests emit Workflow generation-mismatch diagnostics. The framed workflow test also logs a monitor restart and `source_preparation/stale_execution` when it drains all scheduled timers after Resume. A focused rerun reproduced the diagnostics while the scenario passed its declared outcome. Its test uses `finishAllScheduledFunctions(vi.runAllTimers)`, crossing later preparation deadlines; the stack reaches `researchWorkflow.ts`'s discovery-preparation step. This is evidence of expired work refusing continuation, not evidence of a successful Sources preparation. The component's generation-mismatch branch explicitly logs and returns for an obsolete completion. No logger was suppressed and no assertion was weakened. Antedating these diagnostics against the baseline was not verified; broader Workflow cleanup is not claimed delivered by this phase.

## Publication and manual verification remain pending

`node --experimental-strip-types scripts/local-dev.ts dev:status --json` reported no managed processes and no listeners on the configured Convex, site or web ports. No backend was started, synchronized or stopped. Consequently, a successful watcher push and actual runtime delivery have not been demonstrated. `convex-test` action drivers prove the persisted integration contract, not the physical Convex action lifetime, scheduler delivery or release of the original Pi worker.

The outline's manual review of retained traces is not confirmed. The actual runtime check remains in phase 6, including work beyond the former five-minute interruption and a cancelled/stale result. Phase 1's automated items can be checked, but its overview/heading stays incomplete until manual verification is confirmed under the selected RPI workflow. Phases 2–6 remain unstarted; interrupted visible-output capture, accounting policy/refusal reconciliation, milestone capture, independent continuation and performance measurements remain pending.

## Documentation and scope review

`context/TECH.md` now owns the shared scheduled-operation contract and the Sources factory binding; `docs/ROADMAP.md` records implemented offline behavior separately from pending publication/runtime qualification and later corrections. These are approved contract/status updates, not a new normative document or a session log. `PRODUCT.md`, visual design, historical raw evidence, dependencies and provider settings were untouched. Searches of historical design/notes found no explicit `sourcesMissionActions.execute` synchronous contract requiring a supersession edit; dated failure reports remain valid evidence of their recorded revision. No tracked document links to the local artifacts.

No commit, push, deployment, paid replay or provider/logging change occurred. The reason for the historical 45,867-token generation remains unknown. No claim about capture improvement, model usefulness or runtime performance follows from this phase.
