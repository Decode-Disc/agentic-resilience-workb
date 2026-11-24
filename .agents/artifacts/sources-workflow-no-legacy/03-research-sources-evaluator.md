---
date: "2026-11-19T09:42:24+01:00"
repos:
  - identifier: "abdwhb-png/decoding-discontinuity-proto"
    sha: "cf757669701104f835a29fb1f0941d1c78ce3304"
topic: "Sources execution, missing completion content, and evaluation integrity"
type: research
tags: [research, sources, durable-execution, model-transport, evaluation]
status: complete
flow: tdd
---

> November 19 implementation update: this report preserves the research/design state at its original checkpoint. The implemented mechanisms, measurements and verification limits are recorded in [09-implementation-complete.md](09-implementation-complete.md); current technical obligations remain in the repository technical contract.

# Research: Sources execution and evaluation integrity

## Research scope and method

This answers the six [research questions](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/02-research-questions-sources-evaluator.md): Sources execution and fencing; response retention; the excessive generation and external recovery; cost-policy propagation; scenario milestones and continuation; existing test coverage. Current source, installed SDK source, preserved campaign requests, receipts and timeline, official documentation, focused tests and one local transport probe supply the evidence. The commit identifies production source; the checkout also contains uncommitted historical reports and archives. No production code, backend state, provider settings or dependencies changed. No model inference or browser ran.

## Summary

The evidence establishes three separate application/evaluator failures. Sources holds a parent dispatcher open while a child control runs; the parent connection expires before the child settles, leaving no owner to record the operation result. The response transport and one-shot adapter expose completed bodies and completed model responses, but do not preserve interrupted assistant content. The evaluator interprets an omitted accounting policy differently in Convex and its relay, causing a budget refusal despite known small charges. These are shared paths, not behavior selected by one test case.

The reason for the provider's 45,867 completion tokens remains unknown. The request, schema, route and usage metadata exist, but the generated text does not exist in the application's retained reply. The configured OpenRouter content API returns 404 for both the failed generation and its adjacent successful control. A zero-byte retained reply does not establish that zero bytes reached the process. The local probe demonstrates loss after nonzero received content, but cannot reconstruct the historical network body or prove why that model generation continued.

## Sources awaits its child synchronously and records results only after it returns

The actual call chain is:

```text
Pi tool execution
  piMission.dispatchRetainedOperation
    operations.dispatch                     [parent action]
      sourcesAgent operation.execute
        ctx.runAction(sourcesMissionActions.execute) [child Node action]
          sourcesMission.reserve
          examineContributions
            executePreparationModel
              beginOneShot / retainRequest / authorizeDispatch
              examineDocumentaryContributions -> invokeOneShot -> generateText
              finishOneShot                  [receipt and reply journal]
            retainControl                    [only for an admissible current result]
      operations.recordResult                [requires the parent still to exist]
```

[Pi dispatch](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/integrations/piMission.ts:253) awaits the shared dispatcher. [The dispatcher](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/operations.ts:1143) claims the operation, awaits its registered callback and only then records the result. [Sources' callback](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/domain/sourcesAgent.ts:124) awaits the separate Node action. [That action](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/sourcesMissionActions.ts:32) fixes its own generation deadline at entry and routes documentary submissions/checks to the examination. Neither path returns a waiting outcome for this control.

### The retained timeline explains the missing operation result

| UTC on November 18 | Retained observation |
| --- | --- |
| 17:44:45.689 | Pi worker starts. |
| 17:46:34.908 | Second documentary operation dispatches and remains running. |
| 17:51:35.571 | Mission blocks with `execution_interrupted`; the dossier pauses and generation advances. The writer lease had not expired. |
| 17:56:26.623 | Child control records `request_timeout`, its receipt and an incomplete reply. |
| 17:57:41.699 | Operation expires with no result and becomes `operation_outcome_unknown`. |

The [original timeline and actual-runtime probe](/home/abdwhb/.cache/workbench-evaluations/directed-framing-workbench-only-20261118/sources-timeout-diagnosis/historical-timeline.json) are preserved in the [supplemental archive record](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/scripts/evaluations/archives/20261118T183803479Z-workbench-six-and-sources-diagnosis/record.json). This research checked all five Sources-probe files against their recorded SHA-256 hashes. It read, but did not rerun, the five-minute loopback probe: the real Convex callback accepted the request, then failed with `UND_ERR_HEADERS_TIMEOUT` after 300,942 ms while the action signal remained active.

The pinned backend's [callback endpoint](https://github.com/convex/convex-backend/blob/80befbc1152f13077236bfc09284d887c478dfa5/crates/local_backend/src/node_action_callbacks.rs#L314-L343) waits for the action before sending the response. Its [caller classification](https://github.com/convex/convex-backend/blob/80befbc1152f13077236bfc09284d887c478dfa5/crates/common/src/types/functions.rs#L290-L302) and [execution cancellation path](https://github.com/convex/convex-backend/blob/80befbc1152f13077236bfc09284d887c478dfa5/crates/isolate/src/environment/action/mod.rs#L1182-L1190) support the earlier diagnosis: the parent V8 dispatcher disappears when its caller disconnects, bypassing JavaScript catch and settlement. The child Node action continues and settles its own receipt. The original socket subcode is not retained in the historical mission event; timing, backend source and the preserved runtime reproduction establish the mechanism rather than a directly preserved historical socket exception.

The child deadline is the minimum of admitted authority and its action-entry deadline. [The platform-derived policy](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/resourcePolicy.ts:45) leaves ten seconds from the 600-second Node action ceiling for settlement. Because the parent worker started earlier, it would itself reach that physical ceiling before the child completed even without the five-minute callback failure. This explains why callback duration and child generation duration are different quantities.

### Existing waiting and fencing mechanisms are present but not used by this Sources callback

[Operations](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/operations.ts:706) recognize `waiting` and return its retained reference without rerunning the effect. [Result recording](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/operations.ts:923) persists that state. [Pi's operation-result task](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/integrations/piMission.ts:263) checkpoints the wait, releases the worker and resumes consultation later. A [deferred fixture](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/domain/conversationValidationOperations.ts:98) and [child mission completion](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/handoffs.ts:184) exercise different existing result-delivery patterns. These demonstrate available mechanisms, not an already implemented durable documentary-control path.

[Sources reservation](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/sourcesMission.ts:143) checks the running request, execution generation, preparation and needs revision. [Model execution](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/sources/preparationModel.ts:73) derives the attempt from the pinned input, claims its provider receipt and prevents an already claimed attempt from dispatching again. Request retention and dispatch authorization occur before I/O. The SDK has [zero automatic retries](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/integrations/modelRouting.ts:146); the preparation owner permits a second technical attempt only for eligible retryable, non-reserved first failures. The historical timeout was non-retryable. [Operation recording](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/operations.ts:940) retains observations before checking current adoption authority, then refuses late adoption; [documentary adoption](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/sources/examineContributions.ts:190) re-enters the controlled mutation. Billing settlement and permission to advance the dossier remain separate.

## Interrupted response content has no path into the one-shot journal

There are two distinct capture boundaries:

| Boundary | Current behavior | Interruption consequence |
| --- | --- | --- |
| HTTP wrapper | Counts and buffers received chunks locally; optional `onResponse` fires at EOF. | Read errors and cancellation bypass the observer. The local byte count is not persisted. |
| SDK wrapper | `wrapGenerate` extracts visible text/tool calls only after `doGenerate()` resolves. | A failed generation never assigns `observableReplyJson`. |
| One-shot persistence | Stores the returned observable JSON, or an explicit unavailable reply. | Missing JSON becomes `state: incomplete`, `sizeBytes: 0`; this measures retained payload, not network traffic. |

The [HTTP implementation](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/integrations/modelTransport.ts:245) invokes the observer after successful completion for both JSON and SSE. Its JSON read has a release-lock `finally` but no partial observation on failure. SSE error/cancel paths likewise omit partial observation. More importantly, [production preparation execution](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/sources/preparationModel.ts:168) supplies dispatch and provider-identity hooks, not this optional body observer. Merely invoking that observer on failure would therefore not by itself connect interrupted content to durable persistence.

[The SDK adapter](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/integrations/modelTransport.ts:423) sets `observableReplyJson` after successful `doGenerate()`, excluding hidden reasoning. [Error settlement](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/integrations/modelTransport.ts:667) can retain the identity, HTTP status and protected transport diagnostic, but has no partial assistant-text value on a transport timeout. [One-shot completion](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/invocationLifecycle.ts:115) writes an unavailable reply through the [journal owner](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/journal.ts:480). The historical failed reply has exactly that shape.

The [retained-text store](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/retainedText.ts:65) stages fragments against a known final manifest, hashes, size and character counts. Its `receivedBytes` tracks staged fragments. It is not instrumentation of provider socket reads and does not establish that historical network content was empty.

### A real-module probe reproduces content loss without a provider

The [probe](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/response-retention-probe.mjs) imports the real transport and documentary consumer through installed Vite, substituting only the external fetch response. It emits content, then either closes normally or raises a `TimeoutError`; no fake clock or model provider is involved. [Recorded results](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/response-retention-probe.json) show normal JSON/SSE bodies reaching the observer and interrupted JSON/SSE bodies not reaching it. Through the complete documentary consumer, the successful response retains visible output and the interrupted response retains generation identity but no observable reply despite 208 emitted bytes.

This proves a reproducible loss mechanism. It does not prove those 208 bytes resemble the historical response, that OpenRouter transmitted historical assistant content incrementally, or that an in-memory prefix would explain all 45,867 tokens.

## The request was non-streamed; the usage record cannot reconstruct its output

Both historical documentary requests omit `stream`, use `generateText` with `Output.object`, and request a strict keyed findings schema. Installed `@openrouter/ai-sdk-provider` 3.1.0 [uses JSON response handling for `doGenerate`](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/node_modules/@openrouter/ai-sdk-provider/dist/index.js:4353); its separate streaming method supplies `stream: true`. OpenRouter's metadata nevertheless reports `streamed: true` for the failed generation. The records do not establish why this flag differs from the retained client request. It is not evidence that the application received SSE deltas or 45,867 tokens of text.

[The preserved request comparison](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/retained-control-comparison.json) confirms identical system instructions, selected model, high reasoning, temperature zero, provider price constraints and a 131,072-token output allowance. The earlier successful request has five contributions; the failed request has three. Both used Wafer. The earlier control completed with a retained reply; the later control was cancelled at its generation deadline. Input size or number of findings alone does not explain the later behavior. The earlier investigation reports both schemas accepted by installed AJV and valid witnesses; this research did not repeat that schema probe.

The [documentary schema](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/integrations/documentaryControl.ts:15) limits diagnostics and limitations as data, while [transport capacity](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/integrations/modelTransport.ts:779) derives generation capacity from the admitted model. `strict: true` proves what the client requested, not that the provider obeyed every keyword or that an interrupted output was valid. String length limits are not equivalent to a completion-token bound; they also do not bound JSON whitespace. The evidence does not identify repetition, excessive diagnostics, schema enforcement behavior or another provider/model interaction as the cause. Hidden reasoning accounts for 2,243 reported tokens, not the whole completion count.

### Existing OpenRouter access retrieves metadata but not either control's content

On November 19, this research rechecked Executor's OpenRouter tools: generation metadata is exposed, generation-content retrieval is not. Direct read-only calls using the configured project access returned HTTP 200 for both generation metadata records and HTTP 404, `Content not available for this generation`, for both content records. The [saved observations](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/openrouter-generation-observations.json) contain the responses without credentials. The failed generation still reports cancellation, upstream status 499, 45,867 completion tokens and 589,336 ms generation time.

The [official content endpoint](https://openrouter.ai/docs/api/api-reference/generations/get-stored-prompt-completion-and-error-content-for-a-generation) is distinct from metadata. [Private input/output logging](https://openrouter.ai/docs/guides/features/input-output-logging) applies to generations made after enablement, with key filters, organization access rules and regional exclusions. A content 404 does not expose the historical setting or prove the exact reason for missing content. No setting was changed, no alternate account was selected and no provider support message was sent. No connected provider-side log access was established. The text is unavailable through the existing verified paths; this is narrower than claiming it no longer exists anywhere.

## One omitted accounting field produces different enforcement in Convex and the relay

The retained mandate input, prepared campaign manifest and lot protocol all omit `costAccountingPolicy`. [Manifest validation](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/qualificationCampaignPolicy.ts:293) makes that field optional. [Campaign preparation](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/scripts/evaluations/workbench-browser/campaign.ts:1420) preserves the manifest and [protocol serialization](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/scripts/evaluations/workbench-browser/campaign.ts:2211) embeds it unchanged. The omission was not caused by stripping an explicit policy. Model configuration supplies no accounting default.

```text
Authored manifest: policy absent
  Convex grant creation -> known_final_v1
    confirmed final cost replaces reservation
  Relay initialization -> exact policy match is false
    each full reservation remains budgeted
```

[Convex fixture admission](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/fixtures.ts:847) rejects an explicit conservative configurable grant, then [stamps known-final policy](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/fixtures.ts:1150). [The relay](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/scripts/evaluations/workbench-browser/relay.mjs:98) enables final-cost replacement only for the exact nested string. Its older standalone producer can also supply a protocol without a campaign manifest, so this behavior is not isolated to the CCC scenario.

The [retained CCC ledger](/home/abdwhb/.cache/workbench-evaluations/directed-framing-workbench-five-20261118/lots/lot-1/ledger.jsonl) has twelve dispatches with complete responses and reported charges. Their maximum reservations remain budgeted. A further reservation exceeds the remaining allowance and produces `refused_before_dispatch`, before a thirteenth upstream dispatch. The application already created its attempt receipt before calling the relay and therefore retains an uncharged reservation for that refused attempt. Application attempts, actual upstream dispatches, relay model-only cost and application totals including retrieval are different measurements. The [original report](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/docs/verification/2026-11-18-workbench-framing-live-and-sources-timeout.md:40) reconciles their difference rather than treating the reservation as an invoice.

### Both layers retain uncertain reservations, but they have different settlement evidence

In known-final mode the relay replaces a reservation only after a valid successful terminal SSE response, `[DONE]` and a finite nonnegative reported charge. Missing cost, incomplete streams, unresolved dispatch and HTTP refusal retain the reservation. An over-reservation charge halts dispatch. Client disconnect aborts upstream I/O; a close after already retained terminal output can still settle. Restart reconstructs this state from the ledger; unresolved dispatch without a response/uncertainty record makes the lot fatal. The relay accepts the last observed finite usage cost and does not implement Convex's conflicting-billing reconciliation. [Relay accounting and response handling](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/scripts/evaluations/workbench-browser/relay.mjs:113), [Convex usage projection](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/qualificationUsage.ts:37), [provider billing](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/providerCalls.ts:1624).

These differences belong to the shared protocol/admission/accounting path. The Independent scrutiny scenario does not choose an accounting policy.

## The evaluator delays handoff evidence and treats backend failures differently from browser failures

[Fresh Workbench initialization](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/scripts/evaluations/workbench-browser/scenarios.ts:392) waits for native settlement before writing its framing artifact. Independent scrutiny had already saved a program, but the blocked final turn prevented reaching that artifact write. Its retained state proves the saved framing independently; a missing runner artifact is not proof of missing domain state.

[Public Start](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/scripts/evaluations/workbench-browser/scenarios.ts:727) fixes the current program. The first actual serialized Sources request provides direct evidence of what Sources received. However, [the runner's handoff artifact](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/scripts/evaluations/workbench-browser/scenarios.ts:853) checks persisted framing, preset and documentary needs only after `sources_prepared` resolves. That wait includes settled conversation, idle execution, the handoff lifecycle and a terminal Sources mission; an honest partial handoff can qualify, while an expired blocked mission before handoff fails. The frozen NVIDIA run reached actual Sources input but failed the later wait, so the runner never wrote the handoff artifact.

[The shared scenario loop](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/scripts/evaluations/workbench-browser/scenarios.ts:963) records failures and releases held controls. Backend mode then throws before later scenarios. Browser mode already has conditional continuation after failure, checking native settlement, idle state, absent active workers/holds and settled accounting with no pending, unknown or overrun usage. This is a verified implementation difference, not a general inability to continue after failure. Cases have distinct dossiers but share visitor authority, configuration and a relay ledger; independence cannot be inferred from different dossier IDs alone.

[Campaign cleanup](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/scripts/evaluations/workbench-browser/campaign.ts:2323) revokes dispatch, retains observations, closes the context, restores revision-bound configuration, closes the relay/session and restores temporary flags. Interrupted-lot recovery performs cleanup, not replay of unfinished scenarios. [Review](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/scripts/evaluations/workbench-browser/campaign-review.ts:812) separates material case checks from the aggregate mechanical verdict. Positive upstream observations and a failed lot can already coexist. The defect is that observation timing and backend stop-first behavior reduce available independent results, not that the review model lacks every distinction.

## Focused checks pass while the demonstrated failure boundaries remain uncovered

| Check actually run in this research | Result | Evidence boundary |
| --- | --- | --- |
| `pnpm exec vitest run src/__tests__/convex/integrations/documentary-control-transport.test.ts src/__tests__/convex/integrations/source-qualification-transport.test.ts src/__tests__/convex/sources/documentary-control-integration.test.ts` | 41 passed | Real documentary transport and Convex integration; injected external responses. |
| `node --experimental-strip-types --test src/__tests__/config/{workbench-relay.test.mjs,workbench-protocol.test.mjs,qualification-campaign.test.mjs}` | 159 passed, delegated lane | Real local relay with deterministic upstreams; protocol/review/configuration coverage. |
| `node .agents/artifacts/sources-workflow-no-legacy/response-retention-probe.mjs` | Six observations/assertions passed | Real HTTP wrapper and documentary consumer with normal/interrupted response bodies; zero provider requests. |
| Archived Sources-probe hash verification | Five files matched | Verifies the prior runtime probe's preserved bytes; does not rerun it. |
| OpenRouter generation/content reads | Metadata 200, content 404 for both controls | Current API retrieval evidence; no generation or logging-setting change. |

[Documentary integration tests](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/src/__tests__/convex/sources/documentary-control-integration.test.ts:70) cover late billing without adoption, preparation authority, pinned identities and actionable unfinished controls. Their [interruption cases](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/src/__tests__/convex/sources/documentary-control-integration.test.ts:737) inject an immediate body error, then verify identities, billing and absence of replay/adoption. They do not emit partial assistant content or terminate a real V8 parent outside JavaScript. The transport suite tests completed malformed replies and bounded diagnostic observers, not interrupted partial retention.

[Relay tests](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/src/__tests__/config/workbench-relay.test.mjs:372) cover known-cost replacement and restart, but insert the nested policy manually. Tests rejecting an unsupported retained policy concern the separate top-level resource policy. They do not prove mandate-to-backend-to-relay accounting agreement or contradictory SSE charge handling. [Scenario tests](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/src/__tests__/config/qualification-v2.test.mjs:283), read but not run in this research, cover backend stop-first and browser continuation fences with controlled snapshots. They do not demonstrate durable documentary delivery across a real callback interruption.

The repository documentation check passed with zero errors; the artifact documents' local links were also checked separately because repository discovery excludes `.agents/artifacts`. Biome likewise excludes this directory; formatting the probe through its stdin interface succeeded. No full-project typecheck, build, local E2E, provider replay or replacement qualification ran. The outstanding mechanisms can be investigated with deterministic transport/Convex/relay boundaries; actual provider output, provider-specific schema enforcement and the missing Independent scrutiny final reply are not established by these passing tests.

## Architecture owners and remaining uncertainty

[The technical contract](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/context/TECH.md:162) assigns durable history and recovery to Pi plus Convex state, and requires billing observations to remain separate from adoption. Current owners relevant to subsequent technical design are `execution/operations` and `piMission` for operation waiting/delivery; `sources/preparationModel`, `modelTransport`, `invocationLifecycle` and the journal for provider admission and visible response retention; campaign policy/protocol, fixture admission and relay accounting for evaluation authority; and the shared scenario runner/review for observation boundaries. These are key paths, not a complete inventory of every caller. This research approves no change to those owners.

Three questions remain unresolved by available evidence:

1. **What did the failed generation contain, and why did it continue?** No captured completion text or accessible provider content answers this. A repeat would be a new observation, not recovery of this one.
2. **What reached the application before cancellation?** No retained body prefix, network-byte measure or historical content-type record distinguishes no assistant bytes from bytes lost in capture. The current probe proves the latter is possible.
3. **Why does OpenRouter lack accessible content for these generations, and why is `streamed` true?** Existing metadata/content calls do not reveal historical logging filters, settings or internal routing behavior. No provider-side log access was verified. These uncertainties must remain explicit rather than being assigned to the model, schema or transport without further evidence.

The next selected workflow phase is technical design (`flow: tdd`). It can use the demonstrated shared execution, capture and accounting mechanisms while retaining the provider-generation anomaly as unresolved. A working design for those mechanisms would not itself establish that excessive generation has been corrected.

## Additional current-source findings from performance review — 2026-11-19

An independent performance-reviewer inspected the proposed technical design and installed SDK without running tests or benchmarks. AI SDK 7.0.138 enriches `Output.object` deltas by reparsing accumulated text and may withhold unchanged partial values; public `fullStream` tees that enriched stream and retains another branch. Native routed-model streaming middleware precedes this enrichment, and the SDK's transform extension precedes its output transform. Thus the capture location and partial-object event frequency affect both evidence retention and resource amplification. Source inspection establishes these mechanisms, not their measured memory cost in this prototype.

The existing Pi wait task's fallback wakes open and replay the retained log before consulting the pending request. The qualification snapshot deliberately avoids transcript scans; repeatedly embedding a newly added first-input body would change that property. See the [complete performance review and dispositions](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/05-performance-review.md) for source pointers, illustrative cost estimates and required implementation measurements. These findings do not change the unresolved historical provider-generation cause.
