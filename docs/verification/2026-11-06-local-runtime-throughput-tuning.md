# Local runtime throughput and timeout tuning — 2026-11-06

## Selected policy

The local watcher now preserves native isolate concurrency instead of imposing one foreground CPU phase, and defaults the execution deadline to ten seconds. Admission waits remain bounded at ten seconds. Explicit native overrides remain effective, including a chosen concurrency or execution deadline. This changes neither cloud settings nor provider/model/spending allowances. An execution deadline is an upper bound, not a fixed wait before a successful response.

The user requested a tested compromise that avoids making processing slower through contention. Native concurrency gave much lower latency for lightweight work than the added one-phase limit, with normal throughput in the same observed range as four phases. Ten seconds was selected after five seconds still failed the original pre-read regression. Native worker-pool bounds remain active; no extra executor, adaptive scheduler or application architecture was introduced.

## Comparable experiments

The existing local watcher was restarted sequentially on the same binary, deployment, ports and retained database. Worker admission was held while measuring and no provider call was authorized. Full historical CCC and Adobe snapshots were checked before each configuration. The workload then mixed 24 real snapshot queries with deliberately distinct invalid fixture keys and eight lightweight native sandbox queries. The scope refusals force uncached execution through module initialization and owner/document reads without granting execution authority. Their expected refusal is not a benchmark failure. This measures that lookup/guard path, not complete successful snapshot throughput or analytical results.

Each configuration received two normal bursts with at most eight snapshot requests in flight. Light requests arrived at 100 ms intervals. A degraded run repeated the same workload with the backend on one CPU competing with one bounded load process. An extreme run used sixteen competing processes on that CPU and three sequential guarded reads. Every control restored original thread affinities and stopped its load processes in `finally`. Cold database startup was allowed to finish before measurement; its duration is not included in query throughput.

| Foreground policy / deadline | Normal probes/s, combined | Slowest normal light probe | Degraded probes/s | Slowest degraded light probe | Degraded expirations | Extreme expirations |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 phase / 5 s | 7.79 | 2,712 ms | 2.30 | 9,012 ms | 0 | 3/3 |
| 2 phases / 5 s | 14.66 | 1,258 ms | 3.92 | 4,452 ms | 0 | 3/3 |
| 4 phases / 5 s | 20.34 | 889 ms | 3.43 | 4,595 ms | 0 | 2/3 |
| Native / 5 s | 20.29 | 206 ms | 2.75 | 741 ms | 0 | 0/3 |
| Native / 10 s | 17.88 | 310 ms | 3.63 | 747 ms | 0 | 0/3 |

Normal combined throughput is 64 responses divided by the two batch durations. The light maximum has sixteen observations per configuration; it is not a production percentile guarantee. The normal ranges overlap: four phases yielded 18.37–22.80 probes/s, native/five seconds 18.71–22.16, and native/ten seconds 16.65–19.29. Shared-host variation and two repetitions do not establish a causal healthy-throughput penalty from changing the deadline. The source only changes the timeout upper bound. Native concurrency was chosen for interactive responsiveness and avoidance of unnecessary serialization, not because it won every throughput measure: two phases retained more batch throughput on the severely capacity-restricted CPU.

The lightweight witness is the native read-only sandbox endpoint, not a measured browser page render. All configurations completed their normal and degraded batches without execution or queue expirations. An intentionally saturated host can still exceed any finite deadline; this is bounded local development tolerance, not a reliability rate or a production SLA.

## Original regression and parallel progress

The first extreme native/five-second guarded batch passed, but the subsequent original pre-read replay after fixture-flag restoration expired twice out of three calls. The retained failures show a five-second execution timeout with approximately 233–253 ms isolate CPU and 4.9–5.2 seconds waiting in the run queue. This failed experiment remains separate; the first passing batch was not treated as sufficient repair evidence.

With native concurrency and ten seconds, the same pre-read replay passes all three calls under the same controlled load. The calls take approximately 6,847/4,140/4,974 ms, with 315/196/240 ms isolate CPU and 6,097/3,818/4,644 ms run-queue wait. The expected disabled-fixture guard is reached; this verifies the original failure prefix without reopening a context or invoking a provider. It does not imply that arbitrary CPU deprivation can never time out.

A separate real CPU-bound readonly query sums one billion sine evaluations. It is terminated with `Function execution timed out (maximum duration: 10s)` after approximately 10.12 seconds. While it runs, five lightweight queries complete in 65.6/32.1/20.8/17.1/18.9 ms, all before the slow query finishes. Thus the selected longer deadline remains enforced and does not globally serialize healthy work behind that slow query.

Raw outcomes, the fixed benchmark hash, protocol and targeted ten-second addendum are under `.local-runtime/runtime-tuning-20261106`. No normal/degraded case or failed five-second replay was removed from the comparison. No provider work, database business mutation, dependency upgrade or backend-version upgrade was used for the experiment.

## Implementation and verification

The existing `runNativeWatcher` in `scripts/local-dev.ts` is the sole startup owner changed: its forced foreground limit is removed and its native execution-time default is ten seconds. `nativeEnvironment` still carries explicit overrides. The seven focused CLI cases check native default concurrency, explicit zero/three overrides, queue inheritance/override and default/explicit execution deadlines through the actual launcher and existing fake native CLI. The interim five-second RED/GREEN result is retained. The final ten-second RED has six intended failures against the five-second implementation and one passing explicit override. After the correction, `pnpm test src/__tests__/config/local-runtime.test.ts` passes all 63 cases without skipped tests.

Scoped `pnpm exec biome check scripts/local-dev.ts src/__tests__/config/local-runtime.test.ts` passes. The technical reference was revised in place because it owns these local process defaults; The roadmap replaces its outdated no-reproduction statement with this capability-level result and the remaining historical/paid gaps. PRODUCT and cloud resource policy remain unchanged. The earlier diagnosis and one-phase experiment receive dated supersession links below rather than rewritten raw outcomes. No application build is required for these standalone tooling defaults. The native campaign supplies its own mandatory type/domain/protocol checks and protected browser coverage.

The running measured instance already has the equivalent explicit native concurrency value zero and ten-second deadline from the final experiment. CLI regression tests establish the new defaults for future starts without those overrides. A further database cold restart solely to convert equivalent explicit values to implicit defaults was not needed. The existing deployment identity and database were preserved; resource settings are passed at process startup.

## Protected zero-provider qualification

The fresh campaign is retained at `/home/abdwhb/.local/share/agentic-resilience-workbench/runtime-tuning-free-20261106`. It preserves the CCC/Adobe battery and sets all provider allowances to zero. Candidate `1b6bb0f6275f2b00e39344893a305b84eec636ba7996ce765ec28e3834516692` passes the mandatory type, 59 Node protocol, 104 Convex domain, lint, import and execution-ownership checks. The host launcher is archived explicitly because the existing application fingerprint scope does not include `scripts/local-dev.ts`.

Both protected browser scenarios complete: `sources_prepared`, idle execution, completed Sources, a settled unchanged native conversation after follow-up and one independently hash-verified 269-byte simulation capture each. Both handoffs retain three unfinished needs and remain explicitly partial. CCC also covers pause, mobile navigation, reconnection and resume. The runner reports complete cleanup/export and no diagnostics. Accounting reports zero real model/search/acquisition calls, USD0 and zero pending, unknown or overrun entries. Native failure-history inspection from the first case start through the final checks returns zero failures, including zero execution or queue timeouts.

Assessment `1acbfd5de92ea8d0d7ce85375485099782cc03f5c7cf40a2cd6eac897e6e97fe` passes documentary handoff and continuation mechanics and remains inconclusive for evidence interpretation and truthful live wording: the scripted Workbench response repeats generic framing/Start guidance. Simulation does not certify live model quality. Runner/assessment exit code two preserves that distinction. The campaign is closed with its lot finished and no active lot. Fresh checks verify restored fixture/Workbench flags, released publication and no active native worker. Original CPU affinities are verified on all 43 remaining backend threads, and all load processes have stopped. The backend and frontend remain running with native concurrency zero, execution deadline ten seconds and ten-second admission waits.

The [native assessment archive](../../scripts/evaluations/archives/20261106T160733659Z-campaign-runtime-tuning-free-20261106-lot-1-assessment/record.json) preserves the full frozen application candidate, scenario evidence and judgment. The resource comparison, defaults, failed five-second attempt and supplemental final state are preserved separately below. No new paid qualification, commit or push was performed; the existing closed paid mandates remain closed. Review of the change and evidence was local, without a delegated reviewer.


## Verified supplement

The [verified final supplement](../../scripts/evaluations/archives/20261106T161740601Z-local-runtime-throughput-tuning-20261106/record.json) preserves 153 files (1,162,356 uncompressed bytes): measured outcomes and protocol, failed and passing regressions, final CLI tests, safe watcher-readiness summaries, comparison HTML, exact changed owners and roadmap status, pre-change task snapshots and free-campaign preparation/final state. The native archiver packed, restored and verified all selected hashes. Raw watcher logs were excluded; the complete candidate/case exports remain in the native assessment archive. Replays depend on retained local fixture identities, and these exports are not a complete database backup. Storage is local-only. The earlier preliminary snapshot remains intact. Final documentation and whitespace checks pass with the existing advisory TECH word warning.

## Subsequent paid qualification — 2026-11-06

The user subsequently authorized one fresh bounded [paid CCC/Adobe qualification](2026-11-06-runtime-tuning-paid-qualification.md) on the same candidate and measured runtime. Both protected scenarios, documentary handoffs and follow-ups complete without execution or queue timeout. Adobe exercises successful invalid-completion correction; partial-result interpretation and publication defects still block semantic acceptance. The earlier no-paid-run statement describes the preceding tuning experiment, not this later separately authorized lot. Full outcomes, corrected wire-based attribution, costs and cleanup belong to that qualification report.
