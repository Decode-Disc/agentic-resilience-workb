---
type: research-questions
repos:
  - identifier: "abdwhb-png/decoding-discontinuity-proto"
    sha: "cf757669701104f835a29fb1f0941d1c78ce3304"
flow: tdd
---

# Research Questions: Sources execution and evaluation integrity

## Key context pointers

The source task and its desired result are recorded in [the request](01-request-sources-evaluator.md). The starting checkout has unrelated existing changes; the commit pin does not identify all dirty evidence files. The [main investigation report](../../../docs/verification/2026-11-18-workbench-framing-live-and-sources-timeout.md) and [supplemental archive](../../../scripts/evaluations/archives/20261118T183803479Z-workbench-six-and-sources-diagnosis/record.json) preserve the prior investigation. Read their exact evidence before repeating probes.

```text
Sources operation -> dispatcher -> documentary control -> model transport -> OpenRouter
                         |                  |                    |
                   operation result    provider receipt     response content

Campaign protocol -> relay ledger -> allowance check -> provider dispatch or refusal
```

## Questions

1. **How does a documentary control progress from submission to a retained operation result today?** Trace [examineContributions.ts](../../../convex/sources/examineContributions.ts), [documentaryControl.ts](../../../convex/integrations/documentaryControl.ts), [operations.ts](../../../convex/execution/operations.ts) and [piMission.ts](../../../convex/integrations/piMission.ts). Identify each action, callback, lease, deadline, cancellation boundary and generation check. Compare the recorded five-minute parent interruption with the reproduced Convex callback timeout and the later child receipt. Which existing operations release a worker while awaiting a durable result, and what actually fences late results, duplicate dispatch and paid retries?

2. **Where can response content disappear between the provider and the invocation journal?** Trace [modelTransport.ts](../../../convex/integrations/modelTransport.ts), including `createBoundedModelFetch`, `invokeOneShot`, `onHeaders`, `onResponse`, EOF, reader errors, cancellation and timeout settlement, through their real persistence callers and [retainedText.ts](../../../convex/execution/retainedText.ts). Does the journal distinguish zero network bytes from zero persisted bytes? What happens to already received chunks on each failure path? Reconcile the SDK's non-streamed structured invocation with OpenRouter metadata reporting `streamed: true`; identify what that flag proves and whether intermediate completion text could have reached this client. Determine which conclusions follow from code and which require an executable probe.

3. **What can the failed generation's request, adjacent successful control and external records establish about its 45,867 tokens?** Compare the actual serialized prompts, schemas, input material, output capacity, reasoning and provider routing, using preserved requests rather than reconstructed examples. Inspect generation `gen-1795023997-J0fvISV95BakDdWI2icV` and upstream ID `chatcmpl-c1cc03b8-3ea0-4769-984a-17440cf82552`. What constraints were enforced by the provider versus local post-generation validation? Does existing authorized OpenRouter access expose any content beyond the observed `/generation/content` 404? Verify official logging and retention conditions without enabling settings or submitting support messages. Separate evidence of excessive generation from unproven explanations such as repetition, large JSON diagnostics or provider schema behavior; identify what remains unknowable without the text.

4. **How does the evaluation protocol select and propagate its cost accounting policy?** Trace protocol construction in [campaign.ts](../../../scripts/evaluations/workbench-browser/campaign.ts), [protocol.ts](../../../scripts/evaluations/workbench-browser/protocol.ts) and [campaign-configuration.ts](../../../scripts/evaluations/workbench-browser/campaign-configuration.ts), then ledger reconstruction, reservation and settlement in [relay.mjs](../../../scripts/evaluations/workbench-browser/relay.mjs). Explain why the retained protocol lacked `manifest.costAccountingPolicy`, which producers and consumers share that contract, and how it relates to application accounting. What happens for confirmed charges, missing or conflicting charges, in-flight calls, cancellation, restart, and a refusal before upstream dispatch? Use the Independent scrutiny ledger to distinguish reported charges, reservations and actual attempts.

5. **How does the evaluator determine scenario completion, attribute failures and continue independent cases?** Trace [scenarios.ts](../../../scripts/evaluations/workbench-browser/scenarios.ts), the campaign runner and [review code](../../../scripts/evaluations/workbench-browser/campaign-review.ts). Which conditions distinguish saved framing, the first actual Sources input and completed documentary preparation? Where does one failed scenario prevent later cases, and what shared state, configuration restoration, accounting or unknown outcomes constrain continuation? Identify existing mechanisms for keeping a failed downstream capability visible without treating it as failure of an already observed upstream handoff or silently passing an incomplete workflow.

6. **Which existing tests and probes exercise these boundaries, and which observable failures remain uncovered?** Inspect [documentary-control transport tests](../../../src/__tests__/convex/integrations/documentary-control-transport.test.ts), [documentary-control integration tests](../../../src/__tests__/convex/sources/documentary-control-integration.test.ts), [relay tests](../../../src/__tests__/config/workbench-relay.test.mjs), [protocol tests](../../../src/__tests__/config/workbench-protocol.test.mjs) and the existing execution tests. Identify tests using real internal collaborators and distinguish their evidence from the archived actual-runtime callback probe. Locate deterministic coverage for interrupted response retention, durable result delivery, accounting settlement/restart, pre-dispatch refusal, and scenario boundary isolation. State which missing evidence can be obtained without providers or a running-backend mutation and which would require a separately authorized live observation.

## Research boundaries

This document asks about current behavior; it does not approve a design, new limit, new subsystem, model change or production correction. Reuse the already completed six-case evaluation. Preserve the distinction between dispatcher loss, content capture failure, unexplained provider output and evaluator accounting. Do not infer the contents of 45,867 tokens from their count, infer logging configuration from a 404, or report a missing check as executed.
