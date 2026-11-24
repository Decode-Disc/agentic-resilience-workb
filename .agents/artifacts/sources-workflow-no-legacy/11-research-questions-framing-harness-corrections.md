---
type: research-questions
repos:
  - identifier: "abdwhb-png/decoding-discontinuity-proto"
    sha: "a18e82a71de38db7fe34cba75e51447129e19464"
flow: tdd
---

# Research Questions: Framing harness contracts

## Existing evidence

Start with the [activity excerpt diagnosis](../../../docs/verification/2026-11-20-activity-excerpt-diagnosis.md) and [live comparison](../../../docs/verification/2026-11-20-task-method-live-comparison.md). Reuse their captured arguments, refusal delivery and replay results; check current owner changes before applying historical conclusions. The [request](10-request-framing-harness-corrections.md) separately records the desired changes and decision status.

| Established observation | Remaining evidence gap |
| --- | --- |
| Two captured initial open writes omit `activityExcerpt`; the model-facing schema accepts them and business validation refuses them. Adding the anchor succeeds in the retained integration probe. | Complete state-dependent contract, native preparation constraints and affected versions. |
| The shared counter stops at three non-progress invocations, with context/recovery exemptions. In the failed case, history consultation resets the counter before the final read, search and state consultation reach three. | All stop consumers and independent controls; no proof that an extra live turn would have repaired this case. |
| A candidate search is adopted at framing revision 1; an unread candidate is refused after revision 2 is saved. Source inspection identifies the revision equality check. | Executable reproduction and complete authority rules for candidates, read continuations and later citations. |

## Questions

1. **Where does the conditional activity-anchor rule live, and how is it represented at every boundary today?** Trace `provisionalOpenEvent` in `convex/domain/framingContracts.ts`, `prepareProvisionalFraming` in `convex/domain/framingProvenance.ts`, and `nativeWorkbenchOperation`, `nativeToolSets`, `modelOperation` and refusal diagnostics in `convex/domain/workbenchAgent.ts`. Describe initial, unchanged-scope and changed-scope writes, including authority inheritance. How do offered schemas, prepared profiles, serialized native tools and retained agent versions relate? Identify shared knowledge and existing projection mechanisms without selecting a replacement.

2. **What precisely increments, exempts, resets and consumes non-progress state?** Trace `MAX_NO_PROGRESS_TURNS` in `convex/resourcePolicy.ts`, `invocationProgressSettlement` in `convex/execution/invocationLifecycle.ts`, `consult_run_state` in `convex/execution/commonOperations.ts`, and all readers of `repetition_stop`, `noProgressTurns` and `recoveryRead`. Which registered definitions, completion paths, recovery/publication decisions and tests depend on the threshold? Distinguish this stop from preparation mismatch detection, stalled I/O and resource exhaustion.

3. **Which existing controls bound execution and prevent repeated effects independently of that counter?** Follow actual admission, provider accounting, operation identity, retained-result reuse, cancellation, stale generation and deadline paths for Workbench and Sources. Identify each limit's purpose, scope, unit, authority and exhaustion outcome. Which protections are demonstrated by current tests, and which paths rely on the non-progress stop alone? Include retained versions and unknown provider/effect outcomes; do not infer coverage from configuration declarations.

4. **What is the current lifetime of a documentary reference across framing changes?** Trace `requirePublicContextRequest` and read continuations in `convex/workbenchPublicContext.ts`, operation adoption and `convex/domain/framingProvenance.ts` through search → save → unread candidate read → continuation → citation in a later write. Which checks enforce observation membership, message/instruction authority, current execution and write freshness? Contrast an agent's own provisional save with analyst edits, steering, a new turn, cancellation and foreign references. Where do distinct failures currently collapse into `source_reference_not_observed`?

5. **Which real integration boundaries already cover these sequences, and what remains unproved?** Inspect `src/__tests__/convex/execution/workbench-framing-receipts.test.ts`, `workbench-native-interface.test.ts`, `operation-conformance.test.ts` and the retained diagnostic replay. Map existing tests to full persisted effects, feedback delivery, successful continuation and negative authority cases. Identify the smallest missing reproductions and all current reference statements that depend on the existing behavior, especially tool inputs, native skills and loop prevention in `context/TECH.md`. Separate deterministic guarantees from live model judgment that these tests cannot establish.

The research output should answer these questions with current file references, reused evidence and explicit unknowns. The next phase settles design choices; this phase does not prescribe a new abstraction or authorize another live campaign.
