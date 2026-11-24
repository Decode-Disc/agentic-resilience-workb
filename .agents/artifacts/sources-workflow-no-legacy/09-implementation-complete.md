---
type: implementation
flow: tdd
status: implemented-and-locally-verified
date: "2026-11-19"
---

# Sources execution and evaluator implementation

All six phases of the approved [technical design](04-tdd-sources-evaluator.md) and [outline](06-structure-outline-sources-evaluator.md) are implemented in the primary checkout on `sources-workflow-no-legacy`, based on `cf757669701104f835a29fb1f0941d1c78ce3304`. The user explicitly requested continuous implementation of all phases and code-reviewer review. No commit, push, remote deployment or paid qualification was performed. Unrelated working changes were preserved. The package manager performed a no-change bootstrap during disposable CLI initialization; package manifests and lockfile have no task diff.

## Delivered behavior

The four Sources I/O families declare their actual scheduled Node action through the common operation factory. Claim/schedule/wait is atomic; one start claim precedes reservation and I/O, duplicate delivery cannot start another attempt, and the shared executor owns the retained result and Pi wake. Queued revision failures settle before execution; historical inline running requests remain settleable. Waiting effects engage admission and pause boundaries.

Structured one-shot calls capture native visible deltas before SDK object enrichment. Text is packed ahead of partial parsing; journal appends keep one bounded tail and one write in flight, independently of packed-fragment identity. Canonical complete text and known usage are retained before schema validation, including invalid outputs. Capture failures preserve known receipts; drain/seal share the existing ten-second grace. HTTP abort owns transport cancellation, avoiding the installed provider's discarded cancellation Promise. Late diagnostics retain an engaged call's facts without granting adoption authority. Open committed prefixes remain protected and inspectable after worker loss; purge deletes their private fragments through the retained-text owner. Hidden reasoning is excluded.

New campaign preparation pins known-final accounting before mandate hashing. Application grant, protocol and relay route agree explicitly. Proven loopback non-dispatch binds invocation, generation and exact wire hash; the relay retains proof before acknowledgement, strips private headers upstream, rejects redirects and preserves uncertainty when proof is missing or changed. Financial reservations release only on confirmed non-dispatch; the application attempt remains counted. Conflicting charges stay blocked through SSE closure and ledger restart. Missing historical conflict counters stay uninitialized during late settlement and cannot authorize another call or independent continuation.

The evaluator records saved framing immediately and hydrates the first confirmed Sources input once per immutable invocation/hash. A proven refused attempt can yield the pointer to the next attempt; unknown dispatch remains inconclusive. Request bodies stay outside recurring polling metadata. Review receives separate references for saved framing, actual dispatched input and completed preparation. Both backend and browser paths retain a case failure and continue independent cases only after whole-lot execution/accounting/relay/publication/authority checks. Unsafe continuation leaves later cases explicitly unrun and preserves the failed lot verdict.

Measured large-log replay justified the conditional readiness optimization. Before claiming a writer, `piControl.prepare` may defer an unchanged research-only scheduled wait with matching authority, generation, observation frontier and owned pending/in-progress job, provided no other work/result/rebind needs processing. Conversation steering, observations, results, terminal work and uncertainty take the normal path. There is no second task cache.

## Test-first evidence

The phase-one record preserves its original RED/GREEN evidence. Additional raw regressions and results are under [validation](validation/). The initial broader run found 38 failures across 1,886 tests: most remaining fixtures/drivers still assumed JSON or synchronous Sources completion; it also exposed loss of canonical invalid output and late receipt capture. Those regressions were corrected through the real consuming boundaries. Assertions about domain outcome, provenance, exact text, costs and cancellation were retained. One approval fixture supplied the latest definition version for a pinned older mission; it now consumes the actual admitted mission version.

| Regression | Intended RED | Implemented correction |
| --- | --- | --- |
| Interrupted native structured stream | Persisted visible prefix absent | Capture before enrichment, append/seal storage and protected readers. |
| Worker crash with committed open prefix | Protected read rejected `retained_text_incomplete` | Explicit incomplete diagnostic projection with immutable-prefix cursors. |
| Private diagnostic cleanup | Text/fragments remained after dossier purge | Bounded owned deletion in retainedText, invoked before dropping invocation ownership. |
| Stalled append or seal | Receipt remained stalled past the existing grace | Bounded shared cleanup, preserving known usage/cost and typed failure. |
| Invalid complete object | Original canonical reply missing after schema rejection | Retain text/receipt before awaiting object validation. |
| Omitted accounting policy | Prepared mandate omitted the pin | Canonical normalization before hashing/authorization. |
| Contradictory terminal SSE charge before HTTP EOF | Reported charge appeared reconciled | Conflict survives terminal-close, restart and continuation folding. |
| Legacy accounting without conflict counters | Another call was admitted | Fail-closed admission while factual settlement preserves uninitialized state. |
| Refused first input | HTTP 400 treated as observed; later actual input could be missed | Non-dispatch precedence and pointer advancement only past proven non-dispatch. |
| Settled independent backend case | Runner stopped immediately | Common safety assessment, original failure retained and later unsafe cases explicitly unrun. |
| Unchanged scheduled research fallback | Another writer was claimed before log replay | Fenced readiness check; observation/result regressions require immediate normal claim. |

The attempted separate baseline approval run failed in Workflow component initialization (`platform` unavailable), before the contract under investigation; it is not evidence that the assertion passed or failed on baseline. The version mismatch above was established from the admitted mission and fixture arguments. Three pre-existing chained-assertion warnings in comparison tests were verified against HEAD and retained; no lint rule or assertion was weakened.

## Local runtime and resource evidence

The [runtime probe](sources-runtime-verification.mjs) targeted a fresh anonymous deployment at `http://127.0.0.1:35120`, with no provider credentials or historical dataset. [Its fixture](sources-runtime-probe-fixture.ts.txt) creates owned invitation/context/campaign authority through real backend functions. [Instrumentation](runtime-instrumentation.patch) holds loopback I/O after the real Sources reservation and stops the deterministic simulator after its first result; it does not manufacture an operation result. These are backend probes, not browser evaluation or provider-quality evidence.

| Runtime check | Observed result |
| --- | --- |
| [Long scheduled I/O](sources-runtime-verification.json) | 317,139 ms; original Pi worker released; duplicate action returned without another start; one I/O and one successful retained/adopted result; no provider receipt. |
| [Readiness fallback](sources-runtime-readiness.json) | 92,374 ms; writer epoch 1 and log sequence 14 remained unchanged throughout fallback polls; completion still woke Pi and adopted the result. |
| [Cancellation during I/O](sources-runtime-cancellation.json) | Generation advanced to 5; late `stale_execution` observation retained without adoption; one I/O and no provider receipt. |
| Final local publication | Watcher publication is verified separately from typechecking; the final watcher-ready timestamp is recorded in the validation closeout. |

Two probe failures are preserved. The initial HTTP gate was silent and lost its connection around five minutes, correctly retaining an unknown outcome; the corrected gate emits activity and respects transport inactivity controls. A second probe lacked simulation campaign authority and received a real documentary persistence refusal; the valid deterministic mandate was then added. The first cancellation probe incorrectly expected a cancelled late result to be completed; the contract retains it as observed without adoption, and the corrected assertion requires that exact state. These failed probes are not production success evidence.

[The resource replay](sources-resource-replay.mjs) imports the installed SDK, real transport, retained-text module and Pi storage. [Raw measurements](sources-resource-replay.json) pin protected input hashes and sizes. The same retained real response is replayed slowly and in bursts; an expanded valid fixture repeats retained material to exercise packed storage. Measurements use Convex-test persistence and boundary-sampled heap, not production database or network latency.

| Measurement | Observation |
| --- | --- |
| Expanded visible text | 135,682 UTF-8 bytes / 530 native deltas. |
| Partial object enrichment | 530 parses and 36,047,654 bytes of logical partial snapshots became 3 parses and 320,132 bytes. |
| Burst replay | Approximately 779 ms unbatched versus 235 ms with production packing/capture; sampled heap growth about 137 MB versus 35 MB. |
| Slow replay | Approximately 1,299 ms versus 1,199 ms; capture retained 530 bounded appends but only 3 packed fragments. |
| Storage amplification | Slow delivery rewrote approximately 15.9 MB of bounded header/tail images. Packing prevents tiny storage fragments and growing manifests; it does not eliminate slow-arrival write cost. |
| Actual Pi log | 34,856 bytes; replay samples approximately 1–3 ms. |
| Valid admitted-large Pi log | 33,352,830 bytes / 1,024 commits / 16 pages; replay samples approximately 58–123 ms. Twenty unchanged fallbacks would read 667,056,600 bytes. |
| Repeated runner observation | Two snapshots transferred 1,512 bytes of metadata; a 25,000-byte retained request was hydrated once, with one artifact and no fragmented-text reads for that inline payload. |

The unbatched comparator represents the rejected enriched-stream design, not historical non-streaming production. CPU, heap and timings are local observations with explicit workload and sampling limits; remaining SDK buffering and slow-arrival storage amplification are not claimed eliminated. The ten-second stall regressions exercise actual wall time and preserve terminal receipt fields, independently of runtime inactivity/deadline policy.

## Final validation and scope

The complete affected integration battery passed **1,886/1,886**, with zero failed, pending or skipped tests; its [raw report](validation/sources-integration-complete.json) includes execution, Sources, integrations, protected diagnostic inspection/purge and framed workflow controls. The four Node protocol suites passed **195/195**. Full frontend/scripts/backend TypeScript, production build, changed-file Biome, import/ownership/resource-policy and documentation checks passed. Biome retains three verified pre-existing comparison-test warnings; TECH retains its advisory word-count warning. The [independent code review](08-code-review.md) concluded **APPROVE** with no outstanding findings, including 128 independently run targeted tests. These counts overlap and are not added.

The final local watcher reported functions ready at 12:31:06 local time after the final backend changes. All six temporary fixture/provider variables were confirmed absent through the installed CLI's documented get behavior; [the sanitized check](validation/runtime-environment-cleanup.json) retains no values. The task-owned backend was stopped through its runtime owner, all three probe listeners were verified closed, and both task-created worktrees were removed. Other worktrees, the primary deployment and unrelated changes were preserved. Tool-owned port reservations remain under the runtime owner's existing policy. The primary checkout stays on the task branch with reviewable uncommitted changes. [The source manifest](validation/source-manifest.json) pins 73 code/test files with digest `a8013e8a6333d7bc77e63b13db89e5034ba22b97eec39dbcb2c2c6ab859fd4e7`. Focused checks and protocol evidence remain distinguishable from the broader suite. No tests invoke paid providers. Browser CI, live provider streaming compatibility, OpenRouter/Arize reception/correlation and analytical usefulness remain unqualified. The historical 45,867-token text has not been recovered and its cause remains unknown.

`context/TECH.md` owns the durable/capture/accounting/evaluator contracts; `docs/ROADMAP.md` owns delivery state. PRODUCT and frozen ADRs were not rewritten. Searches found no explicit old scheduled-action or generateText contract in the historical design owners requiring replacement. The original dated failure report remains valid for its recorded revision. No tracked reference links to local artifacts. Task-owned runtime cleanup and preservation of the primary environment were verified above.


The validated implementation outcome notification was accepted under the stable project/event/key receipt in `completion-notification-receipt.json`; API acceptance does not establish device display. No implementation acceptance or paid qualification is inferred from that delivery.


## Commit closeout

The user authorized committing the implementation. Commit `64e8c2287fc090091a524dd8c9272ffe87314806` (`fix: make Sources durable and preserve evaluator evidence`) contains 76 task files. Pre-existing changes, evaluation archives and local RPI artifacts remain outside the commit. Documentation checks and staged patch checks passed before the commit; no source changed after the validated manifest. No push was performed. The commit notification receipt is retained in `commit-notification-receipt.json`.
