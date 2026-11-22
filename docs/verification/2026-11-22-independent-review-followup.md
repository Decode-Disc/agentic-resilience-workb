# Independent review follow-up verification

Date: 2026-11-22. Reviewed range: `6043a64a..1148f13e`. Branch: `sources-workflow-no-legacy`. The five findings from the six independent review lanes are addressed in the working tree; no commit or Git-history change is authorized by this follow-up. Deterministic regression and static validation passed.

## Corrections

- Research control observations and code-owned confirmations read authority and lifecycle facts without evidence hydration. Pause, `/pause`, interruption and worker closure retain their state changes when a capture is missing; interruption also survives an exhausted evidence reader. Journal observations explicitly mark Sources progress as not loaded for a control transition. Analytical queries still refuse missing captures and exhausted read capacity.
- The Sources protocol gate precedes both loaded and database preparation paths. Authenticated Workbench snapshot and standalone consultation now agree that legacy dossiers have no Sources mission projection.
- `SourceReviewReads` caches raw latest/status lookup promises per source, then derives unrestricted and admitted views independently. Actual queries and returned documents consume the existing capacity. An unadmitted committed capture does not hide pending work in preparation progress.
- Profile generation merges both previously active and historical measurements under the exact SDK tuple. The canonical merge rejects conflicting measurements; newly active keys remain excluded from the historical-only output. The current generated catalogue remains unchanged.
- Terminal storage exhaustion during worker admission uses `blockNativeSettlement`, preserving the failure event, paused conversation queue, refusal to resume an unsettled queue and waiting-owner notification. Nonterminal storage failure retains its existing behavior.

All corrections extend existing owners. No new execution layer, resource ceiling, dependency, schema or agent-definition version is introduced. `context/TECH.md` describes the control projection and transaction-local evidence reads; this report owns dated validation evidence.

## Reproduction and regression evidence

The new projection tests first failed with `capture_unavailable`, `source_review_capacity` and the legacy snapshot mismatch. The capture-read tests first failed on duplicated queries through authenticated `api.workbench.snapshot`. Profile carry-forward lost the older retained key, and terminal storage admission omitted the settlement event. All intended failures were observed before their fixes. Initial setup failures in the performance fixture were corrected before recording its RED measurements.

The three owning suites (`research-state`, `pi-recovery`, `pi-input-capacity`) passed all 91 tests. Additional fix-removal checks made the worker-close regression fail with `capture_unavailable` and the storage-admission child-notification regression fail because its settlement event was missing; both owners were restored. Tests use real Convex state, transitions, storage admission and workflow notification, with no mocked internal business collaborators. A transparent database observer measures the real snapshot handler.

## Capture-read measurements

The same persisted fixture document shapes were replayed before and after the cache correction, at 5 and 60 sources. Queries and returned bytes below cover capture index queries, including empty results; they exclude direct gets and other tables. Assertions also check snapshot inventory and preparation progress independently.

| Sources | Capture state | Queries before → after | Returned document bytes before → after |
| --- | --- | --- | --- |
| 5 | Reserved | 30 → 15 | 8,630 → 4,315 |
| 5 | Unavailable | 40 → 20 | 8,660 → 4,330 |
| 5 | Unadmitted committed + reserved | 20 → 15 | 12,985 → 8,650 |
| 5 | None | 10 → 5 | 0 → 0 |
| 60 | Reserved | 360 → 180 | 103,660 → 51,830 |
| 60 | Unavailable | 480 → 240 | 104,020 → 52,010 |
| 60 | Unadmitted committed + reserved | 240 → 180 | 155,970 → 103,900 |
| 60 | None | 120 → 60 | 0 → 0 |

Reproduce the measurements with `CAPTURE_READ_PERF_OUTPUT=/tmp/capture-reads pnpm exec vitest run src/__tests__/convex/execution/research-state.test.ts -t 'authenticated snapshot reuses' --maxWorkers=1`. Logical read reductions do not establish deployed latency, physical billing or live-provider reliability.

## Validation boundary

The final related regression run passed 9 suites and 167 tests: `research-state`, `pi-recovery`, `operation-conformance`, `approval-catalog`, `framed-research-control`, `source-captures`, `sources-workspace`, `sources-mission` and `sources-completion`. Together with the unchanged final profile-capacity suite from the 91-test owning run, 10 distinct suites and 180 tests passed. The final run followed the raw-read cache cleanup and removal of unused evidence-reader arguments from transition callers.

`pnpm typecheck`, focused Biome lint across all 12 changed TypeScript files, the execution-boundary checker, import checker, resource-policy check, agent-skill check, documentation check and `git diff --check` passed. Documentation retains the existing advisory TECH word-count warning. Final formatting validation is limited to the changed files. Full-project tests, lint and application build were not run for this bounded backend correction. No browser session, build, deployment, backend synchronization or live-provider qualification is part of this follow-up. The local runtime status showed an existing backend on port 3210 and no managed development watcher; the running service was preserved. The updated functions have not been qualified on that backend. No fresh independent review was launched for these fixes.
