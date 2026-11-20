# Native response continuation after a host-side wait

Verified November 20, 2026 on `sources-workflow-no-legacy`. This correction addresses the unfinished publication identified in the [interrupted task-method comparison](2026-11-19-task-method-qualification-interrupted.md). The separately implemented campaign controller validator was preserved. No paid qualification or model call was made for this correction.

## Confirmed cause

The failed campaign retained its final Workbench draft and four successful provider receipts. Its response-coherence operation later adopted `configuration_unavailable`. Native session `s578g1yj2pfwe0d0gdpstgdwvs8jgxeb`, commit 80, instead recorded generation task 30 as terminal with `model_error / execution_interrupted` and its initial submission as unanswered. Convex still had an active turn and running mission, while the native session had no generation left to resume. These retained states establish the divergent boundary; the incorrect experimental controller binding explains the unavailable check but does not justify losing continuation.

`piMission.ts` raised `pi_slice_complete` when completion needed a host-side operation. Its stream adapter then immediately returned a synthetic error message. Aborting the outer action context did not synchronously abort Pi's native generation task. Worker cleanup awaited an outstanding preview persistence call before closing the native harness, allowing Pi to commit that synthetic error as a terminal generation. On reopening, the host drained the response check, but native generation was already terminal and could no longer retry publication of its retained output. The same shared stream adapter handles other planned slice yields.

## Correction and regression

For `pi_slice_complete`, the adapter now ends the stream only after Pi signals that its native task has stopped. Native harness closure retains the request checkpoint instead of recording a model failure. The next worker reopens the existing checkpoint, settles the host operation and reuses the original retained response through normal admission and completion checks. Other execution errors keep their existing path. No generation loop, retry policy, budget, agent instruction, fallback reply or domain-specific continuation was added.

The regression exercises the real Pi runtime, Convex state owners, framing operation, stream adapter, worker reopen and public conversation history. Only provider HTTP and the acknowledgement timing of the storage RPC are controlled. A streaming response waits for its preview to be stored; delaying that RPC acknowledgement reproduces the shutdown ordering. Native timers run normally during this interval. The original implementation failed with no published assistant reply; the correction publishes exactly the retained draft with an unavailable-control reserve, preserves the saved framing and completes the mission after two simulated provider requests, with no third generation. A second case cancels the turn before reopening and verifies no reply is published and the mission remains cancelled.

## Verification and limits

- Eight affected Vitest suites passed: 168 tests across native response continuation, response control, native transport, recovery, deferred wakes, publication, Workbench native interaction and registered-operation conformance. The two focused continuation cases were rerun after tightening the preview-ordering fixture.
- Application and backend TypeScript checks, focused Biome and execution-ownership checks passed. Documentation links and consistency were checked separately.
- The existing loopback instance at `http://127.0.0.1:3210` accepted an explicit local synchronization with schema validation and generated bindings. No second backend was started.
- The production change is confined to the shared native stream adapter. Existing model, budget, generation, cancellation and authority owners remain in use. The test adds no production API or copied domain logic.

The regression proves the recorded continuation mechanism with controlled provider responses and real native execution. It does not establish model judgment, browser behavior, remote deployment or a successful 24-case comparison. The closed historical campaign and its terminal native record were not revived or rewritten. A replacement paid comparison remains a separate authorization; its already recorded USD 0.00237242 must remain visible in cumulative accounting.

The [verified local archive](../../scripts/evaluations/archives/20261119T233302550Z-native-response-continuation/record.json) preserves the adapter and regression source, original native failure extract, RED and GREEN results, broader validation, publication log and this report before addition of this archive link. Its twelve files total 90,811 bytes before compression. Byte preservation does not extend the behavioral claims above.
