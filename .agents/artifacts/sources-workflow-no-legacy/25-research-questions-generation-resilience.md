---
type: research-questions
repos:
  - identifier: agentic-resilience-workbench-proto
    sha: "6043a64af02577cb3aaf13eb2a3ce1e8804f7060"
flow: tdd
---

# Research Questions: Recovery from Nonproductive Generation

## Context

The [request](24-request-generation-resilience.md) owns the intended outcome, constraints and exact evidence locations. Reuse the completed Oracle inspection and retained traces, checking current code and unresolved facts rather than repeating the paid qualification. Preserve the distinction between an unusable response, confirmed external termination and settled cost.

```text
Provider stream → SDK projection → retained output → validated control
       │                              │                    │
       └─ interruption → receipt → reconciliation          └─ adoption
                                      │
                               attempt admission
                                      │
                               scheduled operation
```

## Questions

1. **What happens for each observed termination class today?** Trace empty completed output, incomplete `length` output, continuing whitespace, EOF without terminal proof and cancellation through `invokeOneShot`, `failedAttemptFromError`, the operation receipt and documentary adoption. Which facts prove remote termination, and where can an SDK-normalized `finish` conceal a missing provider finish reason? Start with `convex/integrations/{modelTransport,documentaryControl}.ts`, `convex/sources/examineContributions.ts`, the installed OpenRouter adapter and the retained three invocations. Separate reproduced evidence from static concerns such as `NoOutputGeneratedError` handling.

2. **Which progression observations and timing evidence are actually available?** How do the installed AI SDK's `partialOutputStream`, raw text/reasoning events and chunk timeout behave with whitespace, long strings, incomplete keys, escaped strings and initial reasoning? How does current stream packing, capture backpressure or partial-output batching affect observation latency? Inspect the installed packages, `modelTransport.ts` and `convex/resourcePolicy.ts`. Which retained timestamps support real temporal measurements, and which traces preserve only final text and overall duration? Identify what a local replay can prove and what it cannot establish about a safe production inactivity duration; do not choose a threshold during research.

3. **How are termination, failure classification and financial reservation coupled?** Follow `preparationFailureClass`, `nextPreparationAttempt`, `nextPreparationAttemptForInput`, `requestBilling` and `settleBilling` through `convex/domain/sourcePreparationAuthority.ts`, `convex/providerCalls.ts`, `convex/qualificationUsage.ts` and `convex/integrations/openRouterGeneration.ts`. What changes when cancellation is confirmed, when only cost is known, when cost conflicts or stays unknown, and when the active accounting policy requires final settlement? Which existing attempt allowances and historical bindings constrain recovery, and which callers share each rule?

4. **What recovery is possible inside and after the current action?** Trace `executePreparationModel`, `sourcesMissionActions.execute`, `beginScheduledExecution`, result recording and mission recovery. What durable identities, scheduled markers and outcomes survive action expiry, process loss, duplicate delivery or lost acknowledgement? How does reconciliation reach the waiting work today? Locate existing owners in `convex/sources/preparationModel.ts`, `convex/sourcesMissionActions.ts`, `convex/execution/{operations,invocationLifecycle}.ts` and mission/recovery modules. Describe existing capabilities and missing transitions without assuming that clearing a marker or changing a retry flag safely enables another execution.

5. **Which authority and effect guarantees apply to every potential continuation?** Where are mission, generation, instructions, retained input identity, corpus revision, deadline, visitor slot and cumulative allowances checked before dispatch and adoption? What happens when these change while remote termination is being reconciled? Compare structured one-shot consumers and native Pi generation paths, including `convex/execution/invokeAgentModel.ts` and `convex/integrations/piMission.ts`; identify shared protections and genuine differences rather than assuming one retry policy applies to every effect. Which current technical statements would need an explicit design decision before changing terminality or scheduled-start semantics?

6. **What existing tests can prove recovery through the real consuming boundary?** Inspect `src/__tests__/convex/integrations/{documentary-control-transport,provider-billing}.test.ts`, `src/__tests__/convex/sources/{documentary-control-integration,source-qualification-action}.test.ts` and `src/__tests__/convex/execution/{one-shot,journal,sources-qualification,operation-conformance}.test.ts`. Which cover retained prefixes, no partial adoption, unknown termination, cancellation, budget exhaustion and duplicate effects? Identify the smallest missing regression proving a valid control is eventually adopted once after a recoverable failure. Specify local real-stream measurements and independently derived timing/money boundary cases, while keeping internal collaborators real and external HTTP replaceable.

## Research Deliverable

For each question, report current behavior, owner and consumers, decisive code/evidence, existing executable coverage and remaining uncertainty. Preserve the Oracle findings that survive verification and record disagreements explicitly. Identify policy decisions and tests needed by the technical design; do not present an unmeasured threshold, an untested recovery mechanism or a successful diagnostic call as an implemented repair. The research should bound one coherent correction spanning detection, termination evidence and useful recovery.
