---
date: "2026-11-21T20:35:49+01:00"
repos:
  - identifier: "agentic-resilience-workbench-proto"
    sha: "6043a64af02577cb3aaf13eb2a3ce1e8804f7060"
topic: "Recovery from nonproductive generation"
type: research
flow: tdd
tags: [research, generation, termination, recovery, accounting]
status: complete
---

# Research: Recovery from Nonproductive Generation

## Research Scope and Method

This report answers the six [research questions](25-research-questions-generation-resilience.md): termination handling; native progress and timing; accounting and retry admission; durable recovery; authority and effect adoption; and executable coverage. It describes the current system, not an approved correction. The [request](24-request-generation-resilience.md) preserves the intended outcome and evidence locations.

The investigation combined source inspection, installed dependency inspection, retained invocation and Arize exports, ten temporary transport/SDK probes, one follow-up Sources integration probe, and three existing test suites. One read-only research agent traced admission, accounting, scheduled execution and authority; its complete report was checked against the parent investigation. Only external HTTP/DNS boundaries were replaced in executable checks. No production code, services, deployments, dependencies or paid provider calls changed. Temporary test edits were removed; tracked checkout contents remained unchanged.

Installed versions inspected: AI SDK `7.0.138`, OpenRouter AI SDK provider `3.1.0`, Pi AI and Pi Durable `1.4.0`, Convex `1.47.0`. Public documentation supplies API context; installed source and executed probes establish this checkout's behavior.

## Summary

The original whitespace degeneration is retained accurately and rejected without documentary adoption. A deadline interrupts it, but no structured-progress policy ends it earlier. After confirmed cancellation and billing, the same documentary input is classified as terminal. Billing settlement updates accounting without waking or reopening its operation. Both scheduled-start and Sources work-reservation guards prevent simply running the same request again.

A further issue is now reproduced: normal EOF without a provider finish reason becomes SDK finish `other`, then `invalid_output` with `retryable: true`. A real Sources operation subsequently admits a second generation while the first bill is pending. This does not prove the remote provider continued working; it proves retry admission does not require evidence of its termination in this path.

Native partial-object observations exist, but current application packing delays them until 61,440 text characters or another flush event. They are not an immediately available producer-progress clock. The inspected retained records have whole-invocation/span timing, not an inter-chunk timing series; they cannot establish a defensible production inactivity duration.

## 1. Completed Invalid Output and Unproven EOF Share Retry Classification

`examineDocumentaryContributions` calls the shared `invokeOneShot`, which uses `streamText` and `Output.object`. It captures visible text, consumes the stream, obtains its normalized finish reason and usage, seals capture, and then accepts only schema-valid output with finish `stop`. `NoObjectGeneratedError` becomes `invalid_output`, retaining the rejected text and finish diagnostic. Documentary identity and permitted-use checks run after successful transport/schema validation. Sources adopts only a successful matching control. See [modelTransport.ts](../../../convex/integrations/modelTransport.ts), lines 775–852 and 870–1129; [documentaryControl.ts](../../../convex/integrations/documentaryControl.ts), lines 78–156; [examineContributions.ts](../../../convex/sources/examineContributions.ts), line 171.

| HTTP fixture through the real documentary boundary | Observed outcome | Capture |
| --- | --- | --- |
| Empty response with explicit `stop` | `invalid_output`, `json_invalid`, retryable | Complete, `stop` |
| Whitespace response with explicit `stop` | Same classification, exact whitespace preserved | Complete, `stop` |
| Incomplete JSON with explicit `length` | `invalid_output`, `finish_reason_invalid`, retryable | Complete, `length` |
| Partial JSON then EOF, no terminal reason | `invalid_output`, `finish_reason_invalid`, retryable | Complete, `other` |
| Valid JSON then EOF, no terminal reason | Same classification; no successful control | Complete, `other` |
| Empty EOF or `[DONE]` without terminal reason | Same classification | Complete, `other` |
| Retained nonterminating whitespace followed by local deadline | `request_timeout`, not immediately retryable | Incomplete, `TimeoutError` |

Here “complete” is the capture flag, not a statement that the JSON or remote outcome is valid. The OpenRouter adapter starts with finish reason `other` and always emits a normalized finish at normal stream flush, even without `choice.finish_reason`. AI SDK consequently sees a terminal SDK event. This path does not raise `NoOutputGeneratedError`; that Oracle concern remains a static possibility on other paths, not a demonstrated cause of the tested empty responses. Installed references: [adapter](../../../node_modules/@openrouter/ai-sdk-provider/dist/index.js), lines 4583, 4679 and 4947–5046; [SDK](../../../node_modules/ai/src/generate-text/stream-text.ts), lines 1677–1697 and 2980–2998.

The follow-up probe used the actual Sources dispatch, examiner, provider receipt, invocation finalization and operation outcome. The first HTTP stream ended after a JSON prefix with no terminal reason or cost, retaining a generation ID. Its receipt became failed/`invalid_output` with diagnostic `other` and pending billing. A second generation succeeded and the operation persisted a successful outcome. This was observed locally, not merely inferred from a retry flag. See [probe source](generation-resilience-research/eof-integration-probe.test.ts.txt) and [passing run](generation-resilience-research/eof-integration-tests.log).

## 2. Native Progress Exists but Application Packing Delays Its Delivery

The native object parser exposes repaired partial JSON without final schema validation. The SDK emits a partial value only when its serialized projection changes. A local stream confirmed that spaces inside a string and an escaped newline change that value, while whitespace after a key does not. Partial values are observations, not admissible documentary results. [Native parser](../../../node_modules/ai/src/generate-text/output.ts), lines 163–182; [native projection](../../../node_modules/ai/src/generate-text/stream-text.ts), lines 1039–1055.

The application's transform accumulates contiguous text deltas until `TEXT_FRAGMENT_CHARACTERS` (60 × 1024 UTF-16 code units), a different text ID, a non-text event or stream flush. This precedes partial parsing. Thus a progressing text sequence below that capacity may emit no partial object yet. The raw visible-text middleware observes earlier provider deltas but awaits capture writes, whose backpressure also affects delivery. See [modelTransport.ts](../../../convex/integrations/modelTransport.ts), lines 214–267, 490–509 and 949–986; [resourcePolicy.ts](../../../convex/resourcePolicy.ts), line 314. Watching only downstream partial-object silence would therefore conflate packing with producer inactivity.

AI SDK `timeout.chunkMs` recognizes any nonempty text/reasoning delta as activity, including spaces. An executed native SDK probe streamed 40 whitespace chunks over approximately 435 ms with `chunkMs: 100`; it reached explicit `length` rather than timing out. These are fixture timings, not proposed production settings. Current application generation settings use the admitted total deadline and `maxRetries: 0`, not `chunkMs`. Pi Durable's automatic retry is also explicitly disabled. [Chunk classification](../../../node_modules/ai/src/generate-text/is-output-chunk.ts), line 43; [modelRouting.ts](../../../convex/integrations/modelRouting.ts), lines 146–165; [piMission.ts](../../../convex/integrations/piMission.ts), lines 1384–1393.

Retained measurements were recalculated from original bytes and checked against stored SHA-256 hashes:

| Invocation export | Visible characters | Trailing whitespace | Invocation duration | End |
| --- | ---: | ---: | ---: | --- |
| `invocations-10.json` | 13,603 | 1,833 | 44,479 ms | `length` |
| `invocations-11.json` | 11,220 | 0 | 43,778 ms | `stop` |
| `invocations-9.json` | 1,141,943 | 1,131,782 | 590,641 ms | `TimeoutError` |

The first two wire inputs are identical. Invocation durations include local orchestration and differ from provider latency. The inspected eight Arize spans contain start/end times and no chunk events; invocation exports retain concatenated text and terminal metadata. No onset or interval distribution for the whitespace plateau can be recovered from these records. Database fragment creation is also not a native provider-chunk clock.

A local replay preserved all 1,141,943 characters and the original hash, then interrupted at approximately 1,240 ms under a deliberately short fixture deadline of 1,200 ms. It proves current capture/timeout mechanics with real streams and a real clock. It does not reproduce historical token timing or select an inactivity threshold. See [measurements](generation-resilience-research/retained-measurements.json) and [probe observations](generation-resilience-research/observations.json).

## 3. One Classification Drives Retry Admission and Incident Accounting

`preparationFailureClass` distinguishes non-dispatch, success, unknown outcome, transient failure, invalid output and terminal failure. The same classification feeds attempt admission, Sources reservation/incident accounting and campaign unknown-outcome counts. Its documentary exception requires a failed model call, operation `source_documentary_control`, generation ID, explicit cancelled observation and confirmed billing. That combination becomes terminal even though the original timeout error remains. [sourcePreparationAuthority.ts](../../../convex/domain/sourcePreparationAuthority.ts), lines 107–310.

| Facts after settlement | Same-input retry | Accounting consequence |
| --- | --- | --- |
| Proven non-dispatch | Subject to existing admission; ordinal may be reused | Sources reservation released; campaign attempt remains counted |
| Known invalid output/transient failure | Subject to ordinal, deadline, cooldown and budget | Incident; unknown cost keeps monetary reservation |
| Timeout/disconnect without confirmed terminal classification | Blocked as unknown | Sources reservation retained; known cost alone does not clear uncertainty |
| Documentary cancellation plus matching confirmed bill | Blocked as terminal | Sources reservation becomes incident; campaign unknown count clears |
| Missing or conflicting bill after timeout | Remains or becomes unknown | Conservative reservation retained; conflict blocks campaign dispatch |

Documentary control has two initial lifetime attempts and one explicit recovery allowance. Qualification and comparison have a distinct exemption from that absolute ordinal cap; later attempts still require explicit linked recovery and cumulative authority. This distinction is in the existing selector, not a general permission to retry every model operation. `recordAttempt` repeats admission atomically. A new preparation ID is part of documentary input identity, so creating a fresh preparation is not the same retry under the old hash. [providerCalls.ts](../../../convex/providerCalls.ts), lines 564–638 and 1333–1462; [sourcesMission.ts](../../../convex/sourcesMission.ts), lines 544–563.

Under `known_final_v1`, confirmed final cost can replace the financial reservation. A known failure with cost still pending can be admitted again if the old reservation plus the new reservation fits. Unknown outcome, conflict, overrun and expired started calls have separate blockers. The EOF integration probe used the normal Sources fixture, not a complete campaign grant; its campaign consequence is established by source inspection. [qualificationUsage.ts](../../../convex/qualificationUsage.ts), lines 38–65 and 130–205; [providerCalls.ts](../../../convex/providerCalls.ts), lines 1575–1661.

## 4. Billing Settlement Does Not Reopen a Scheduled Operation

```text
claim operation → persist waiting job
  beginScheduledExecution → scheduledStartedAt
    Sources reserve → work entry + control consumption
      attempt admission → one-shot → receipt/result + billing request
        success → retain documentary control
        failure → explicit unavailable outcome
      recordResult → retained operation outcome → workflow/Pi wake

later billing reconciliation → receipt + budget/campaign projections
                             (no operation reopen or result wake)
```

The immediate second attempt runs inside `executePreparationModel`, only when the first lifetime ordinal is 1, the result is retryable and its budget outcome is no longer reserved. After action exit, `beginScheduledExecution` refuses a request with `scheduledStartedAt`; Sources reservation independently refuses its existing work row. Removing only the scheduled marker would not enable safe continuation. [preparationModel.ts](../../../convex/sources/preparationModel.ts), lines 307–320; [operations.ts](../../../convex/execution/operations.ts), lines 901–925; [sourcesMission.ts](../../../convex/sourcesMission.ts), lines 255–295 and 522–566.

`finishOneShot` atomically stores the attempt result, receipt and billing request. Documentary adoption and the operation result are later commits. Lost acknowledgement after `recordResult` can recover the retained operation outcome/effect. A loss earlier in this sequence does not cause that recovery path to read a one-shot result or Sources task result. Expiry without an operation outcome becomes unknown. Billing settlement only updates receipt/accounting projections; the normal operation wake is owned by `recordResult`. [invocationLifecycle.ts](../../../convex/execution/invocationLifecycle.ts), lines 968–1015; [operations.ts](../../../convex/execution/operations.ts), lines 1248–1255, 1390–1432 and 1468–1503; [providerCalls.ts](../../../convex/providerCalls.ts), lines 419–468.

A hard worker loss after identity observation but before finalization can leave a started receipt without an initial billing request. Observing identity alone does not enqueue reconciliation; administrative billing retry requires an existing eligible billing state. This is a static lifecycle finding, not a fault injected in this research. Existing historical recovery reattaches the completion event and pauses at a time-limit decision; it does not directly dispatch a replacement control. [providerCalls.ts](../../../convex/providerCalls.ts), lines 183–235 and 317–379; [runRecovery.ts](../../../convex/runRecovery.ts), lines 113–152.

## 5. Current Authority and Adoption Checks Remain Independent of Cost Settlement

The kernel enforces visitor/dossier ownership, invitation, active slot, mission scope, generation and deadlines. Operations verify their version, admitted event, current pin and conversational instructions where applicable. Preparation additionally checks corpus revision, workflow version, source eligibility and its lease. Before I/O, the invocation retains the logical input hash and exact serialized request and revalidates dispatch. [authority.ts](../../../convex/execution/authority.ts), line 59; [operations.ts](../../../convex/execution/operations.ts), line 274; [sourcePreparationAuthority.ts](../../../convex/domain/sourcePreparationAuthority.ts), line 334; [invocationLifecycle.ts](../../../convex/execution/invocationLifecycle.ts), lines 233 and 894.

`retainControl` requires successful matching receipts, current contribution identities/versions, permitted uses and live observation/adoption authority, including campaign deadlines. Late billing can remain factual while adoption is forbidden. Resume reclaims the visitor slot transactionally and preserves consumed budgets. Pi rebind changes pending work's execution generation, but engaged work receives adoption authority without restarting an old scheduled execution. [sourcesMission.ts](../../../convex/sourcesMission.ts), lines 603–674 and 810–879; [researchControl.ts](../../../convex/execution/researchControl.ts), lines 691–777; [piControl.ts](../../../convex/execution/piControl.ts), lines 759–805.

Shared one-shot callers are documentary examination, source qualification and source comparison. Native Pi generation has a separate retained-task lifecycle: an engaged receipt without output fences reopening; abort/error without raw terminal evidence stays uncertain. Its compaction and completion correction must not inherit documentary cancellation semantics automatically. [sourceQualification.ts](../../../convex/integrations/sourceQualification.ts), lines 36 and 114; [invokeAgentModel.ts](../../../convex/execution/invokeAgentModel.ts), line 431; [invocationLifecycle.ts](../../../convex/execution/invocationLifecycle.ts), lines 296 and 1229.

Current [TECH.md](../../../context/TECH.md) explicitly owns one scheduled start in the original generation, atomic one-shot settlement, no blind retry of unknown outcomes, and known-terminal treatment of confirmed cancelled documentary examinations (sections Shared Execution Structure, Semantic Controls, Context/Recovery and Provider Boundaries). Changing those contracts needs the subsequent design decision. The observed EOF path is a separate mismatch between available terminal evidence and current retry classification.

## 6. Existing Tests Prove Containment but Not Recovery Across Action Lifetimes

| Boundary | Existing executable coverage | Remaining recovery proof |
| --- | --- | --- |
| Documentary transport | Missing/expired authority, invalid identities, exact raw output, stalled capture append/seal, expiry, SSE above 1 MiB | Early stagnation interruption with valid slow/string/initial-reasoning counterexamples |
| Provider reconciliation | Matching identity, lookup failure/retry, conflicting cost, cancellation and late billing | A confirmed terminal event driving useful operation recovery |
| Sources operation integration | Durable waits, duplicate delivery, stale generation, rollback, lost worker, late control, native unfinished feedback, cost-only versus confirmed cancellation | Valid control adopted once after interruption and reconciliation across action lifetimes |
| One-shot and journal suites (read only in this phase) | Existing attempt identity, late results, atomic finalization and billing acknowledgement loss | Reuse distinctions between retained generation, adopted documentary control and recorded operation outcome |

The first three suites use real internal modules and Convex persistence where relevant, replacing external I/O. The new probes characterize current behavior; they are not permanent acceptance tests for allowing EOF retries. A future test-first correction must assert the intended opposite behavior for unproven termination and protect legitimate recovery, authority exhaustion and independent money/time boundaries.

Executed checks:

- `pnpm exec vitest run src/__tests__/convex/integrations/generation-resilience-research.test.ts src/__tests__/convex/integrations/documentary-control-transport.test.ts src/__tests__/convex/integrations/provider-billing.test.ts src/__tests__/convex/sources/documentary-control-integration.test.ts`: 65 passed, comprising 10 temporary probes and 55 existing tests, 27.54 seconds.
- Targeted follow-up `pnpm exec vitest run src/__tests__/convex/sources/documentary-control-integration.test.ts -t 'research: EOF'`: 1 passed, 13.50 seconds; the other 32 cases were excluded by the name filter and had passed in the previous run. An initial probe assertion used `outputDiagnostic` instead of the receipt's `diagnostic` field; that setup error and corrected run are both retained. It is not a product RED result.
- Exact retained output hashes and input equality recalculated; real-stream local timeout and native partial-output/chunk-timeout observations saved. These timings are single-run mechanical observations, not provider latency benchmarks.

Sources and reproduction instructions are retained in [the research evidence directory](generation-resilience-research/README.md). No production behavior was changed. No application-wide typecheck, build, browser test, backend publication or live-provider qualification was needed or performed for this research.

## Architecture and Open Questions for the TDD

The existing owners are transport/SDK for bytes and parsing, provider receipts for external observations, preparation authority for attempt eligibility, operations for durable execution/wakeups, and Sources for documentary adoption. One shared failure classifier currently feeds several consequences; an operation-specific cancellation predicate affects both accounting and retry. The native partial-output interface also sits behind application buffering. These concrete couplings matter to the requested change; they do not justify additional managers, registries, parsers or agent-specific retry loops.

The Oracle findings survive with two refinements: native partial-output monitoring is not directly usable as a progress clock under current packing, and unproven EOF is now reproduced as retryable through the consuming Sources boundary. Empty responses in the tested OpenRouter path do not reproduce the suspected unhandled `NoOutputGeneratedError`.

The design still needs to settle what evidence permits retry, how an admitted operation can continue after reconciliation without resetting work or budgets, which existing bindings adopt changed behavior, and what measured inactivity duration and false-stop risk are acceptable. Research does not select these policies. The exact upstream cause of whitespace generation remains unknown; so does a justified production inactivity threshold. The inspected historical records do not supply chunk timing, and local replay cannot replace that evidence. Recovery after real process death and success with a live provider remain unverified.

## External References

- [AI SDK v7 streamText reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text): timeout and streaming output interfaces; behavior checked against installed `7.0.138` source and local probes.
- [AI SDK structured-data documentation](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data): partial objects are not validated as final schema-conforming output.
- [OpenRouter structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs): supported-model schema contract; this does not establish a particular endpoint's decoder behavior or explain the retained incident.

Context7 was used to locate official SDK documentation. Its version index was not used as release or compatibility evidence. No dependency recommendation or change is made.
