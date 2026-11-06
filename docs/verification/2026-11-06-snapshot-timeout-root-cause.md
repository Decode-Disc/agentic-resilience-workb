# Snapshot timeout root cause — 2026-11-06

Subsequent [throughput and deadline tuning](2026-11-06-local-runtime-throughput-tuning.md) tests the proposed headroom and replaces the earlier one-phase policy with native concurrency and a ten-second local deadline. The five-second attempt and its remaining expirations are retained separately; the diagnosis below remains historical evidence.

## Established mechanism

The local Convex execution limit is an adjusted monotonic elapsed-time deadline, not a per-thread CPU-time allowance. Linux scheduling delays consume that budget while a function is executing. The previous watcher correction limits foreground concurrency inside Convex and extends its admission queue; it cannot reserve CPU time against other host processes. That distinction explains why that correction cannot prevent this reproduced timeout.

The exact `execution/fixtures:qualificationSnapshot` path now has a zero-provider reproduction. With a single request in flight and controlled CPU contention, it times out after executing only 52–70 milliseconds on its main isolate thread while that thread spends approximately 1.0–1.5 seconds waiting in the Linux run queue. Six initially inspected failures have native user times of 1.006–1.063 seconds, zero document reads and no OCC retries. Several have zero major page faults. The same requests reach their fixture guard without timing out after contention is removed. A lightweight native query succeeds under the same controlled contention. Database scans, paid inference and paging are therefore unnecessary to produce this failure.

This establishes a causal mechanism for the observed failure class on the actual endpoint. The historical paid request has the same one-second, zero-read symptom, but its exact thread scheduling trace was not captured: the identity of its competing process and any additional paging contribution cannot be recovered from the retained history. This investigation does not turn a controlled reproduction into a claim about every past timeout.

## Tight reproduction and controls

The initial exact-endpoint loop produced seven execution timeouts in 64 requests at concurrency sixteen. Eight requests at concurrency four and sixteen requests at concurrency eight passed, so unconstrained bursts alone were not a stable signal. The reduced command makes the trigger repeatable:

```sh
python3 .local-runtime/snapshot-root-cause-20261106/cpu-control.py final-red 16
```

Observed output: `{"label":"final-red","burners":16,"probeExit":1}`, followed by `All affinities restored; all load processes stopped.` The command exits one because the underlying probe asserts `Exact qualificationSnapshot execution timeout reproduced`. Three sequential requests fail in each of three controlled series. The driver constrains only the backend's threads and its temporary load processes to one existing CPU, creates bounded competing computation and restores every original backend thread affinity in `finally`. Temporary load is capped at ten seconds; it neither changes persistent runtime settings nor exercises a provider. The diagnostic driver's forked children initially inherited its interruption handler; resetting those child handlers removed that harness-cleanup error before the final repeated checks. Backend affinity restoration was independently verified across all 40 remaining threads.

Controls use the same driver with the competing load removed, or the lightweight native read-only sandbox query substituted:

```sh
python3 .local-runtime/snapshot-root-cause-20261106/cpu-control.py final-green 0
python3 .local-runtime/snapshot-root-cause-20261106/cpu-control.py bare-starved 16
```

Both exit zero. In a recorded normal series the snapshot prefix completes in 127–233 milliseconds, with 110–181 milliseconds isolate CPU and 0.05–6.73 milliseconds run-queue wait. Under contention the initial three failures use 70.2/57.9/52.0 milliseconds isolate CPU against 1,526/1,314/1,072 milliseconds waiting. A second series records 56.2/53.2/53.0 milliseconds CPU against 1,075/1,001/1,075 milliseconds waiting; two of those three have no major page fault.

The replay imports the installed Convex HTTP client and calls the deployed function using the original retained CCC arguments. Fixture flags remain disabled and paid contexts remain closed: successful probes reach `Local browser test slot required`, rather than reading the dossier. This is intentionally sufficient for the reproduced pre-read failure, not a claim to have completed the protected snapshot or browser workflow. Native history confirms the timeout boundary independently. No identity impersonation, authorization bypass, paid dispatch or database write is used.

## Hypotheses distinguished

- Expensive initialization is a measured amplifier, not a sufficient standalone explanation: the same module succeeds under normal CPU availability. A browser-target esbuild closure of the actual fixture module contains 1,206 inputs totaling 5,251,426 source bytes. One direct chain is `execution/fixtures.ts` → `integrations/modelInput.ts` → AI SDK; the fixture file imports `agentInputByteLength`, which the polling query does not use. Other exports and the shared authorization/schema graph are initialized in that module too. A read-only native sandbox replay of the bundled initialization has 169.6 milliseconds native user time versus 28.9 milliseconds for the bare query in the sampled pair. These standalone bundle measurements are supporting evidence, not a claim that their layout equals Convex's deployed bundle layout.
- CPU starvation is causal in the controlled single-request experiment: changing only available CPU scheduling produces repeatable timeout/pass outcomes and the expected per-thread run-queue measurements. Paging is not necessary, as demonstrated by failures without a major fault. The post-paid-run swapped-memory observation alone had not established this mechanism.
- Incorrect accounting of the admission queue is not demonstrated. The pinned timeout implementation explicitly pauses the user timer while releasing/reacquiring a concurrency permit; the reduced failure does not require a concurrent request queue. Its unpaused deadline continues across OS preemption. The relevant source is [the pinned timeout implementation](https://github.com/convex/convex-backend/blob/1447815c8c697c55a35ab0fff64aa7580ca01cc8/crates/isolate/src/timeout.rs), especially its running-deadline calculation and permit-reacquisition pause.

Native `perf` sampling also worked without a restart, but the installed backend lacks useful symbols and the available perf build lacks DWARF unwinding. Its aggregate CPU split was approximately 66% isolate threads and 33% V8 background workers; it cannot identify a particular JavaScript function. The separate Node inspector profile identifies parsing, Zod initialization and validator construction in the standalone import closure. Neither profile is substituted for the decisive native timeout and Linux scheduling measurements. Raw stack-containing perf data is kept privately outside the checkout and excluded from the shareable evidence selection; only aggregate reports are retained there.

## Correction boundary and current state

No production fix is claimed in this diagnosis. The application candidate remains `b630601598884ee017c34962a52fef828617b51ce9a977596209d0fae8e79b44`; source fingerprints match the failed paid candidate. The one-second execution deadline and one-phase/ten-second watcher defaults remain unchanged. Original affinities are restored, temporary load processes are stopped and the existing backend responds with no active native worker. No dependency change, backend restart, provider activation or paid call was made.

The smallest local correction to test is a bounded development execution-time allowance with scheduling headroom, for example five seconds, against this same red command and the original free protected workflow. That is a local resource policy change, not an increase to model/search/spending allowances. It must remain explicit and bounded; a longer deadline does not make an expensive function efficient or establish production performance. An alternative is guaranteed CPU capacity. Reducing the polling module's unnecessary dependency initialization is also viable, but requires its own measured before/after result rather than assuming that removing one import eliminates all alternate dependency paths. None of these alternatives has been applied or certified by this diagnosis.

The previous tests proved an internal oversubscription failure mode on a different inspection query. They did not establish a general runtime fix. This report replaces that overly broad attribution with an exact-endpoint, single-request reproduction and distinguishes scheduling starvation from the import-cost amplifier. Another paid qualification is unnecessary to validate this correction boundary.

## Retained evidence

The [verified archive](../../scripts/evaluations/archives/20261106T151159691Z-snapshot-timeout-root-cause-20261106/record.json) preserves 64 files (10,208,300 uncompressed bytes): diagnostic scripts and outcomes, per-thread measurements, selected native history, public pinned timeout source, compiled import replays and dependency metadata, source modules and these reports before this archive-metadata append. Packing, restoration and every selected SHA-256 were verified by the repository archive command. Raw stack-containing perf data remains in the private external diagnostic directory with mode 600 and was explicitly excluded. The archive is local-only. Documentation and whitespace checks pass; the existing TECH word-count warning is advisory. Full application tests/build and a new protected/paid workflow were not run for this diagnostic-only result.
