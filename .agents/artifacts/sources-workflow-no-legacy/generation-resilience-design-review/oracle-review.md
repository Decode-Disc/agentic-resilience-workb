# Oracle Review: Generation Resilience Design

This record preserves the complete substantive findings, recommendations and verification boundaries from the requested native Oracle review. The parent formatted the returned report as this artifact. Reviewer profile: Codex, GPT-6 Astra, xhigh. Candidate SHA-256: `915d50380628d68af5596e95a46de2fe669c4e6421009fad850dc1f3d7253e51`; repository HEAD: `168981b3c48a7d20062e39e2a2df71689c1036d4`. Locations below refer to the immutable [reviewed candidate](tdd-reviewed.md).

## Verdict

**BLOCK.** The selected architecture remains appropriate, but two concrete lifecycle gaps prevent the proposed recovery sequence from working as specified. Three additional contracts need explicit regression cases; none requires changing the accepted SDK, threshold, accounting policy, or no-legacy direction.

## Findings

### High / BLOCK: the worker-loss timer can fire only after retry authority expires

Candidate lines 159–161. Verified source: `convex/providerCalls.ts:471`, 1431–1437 and 1692–1698. Model receipts currently receive a lease ending at the minimum preparation/mission/request/qualification deadline plus settlement grace; the action's earlier platform deadline is not included. Expired started receipts independently block qualification admission in `convex/qualificationUsage.ts:165`.

Failing sequence inferred from these owners: the worker retains a generation ID, then disappears before `finishOneShot`; scheduling reconciliation against the recorded call lease waits until the logical operation can no longer dispatch. Even confirmed cancellation then cannot produce the promised useful continuation. Merely changing the failure classifier also leaves the expired-started admission guard unresolved.

Smallest correction: distinguish the action's existing execution boundary from logical authorization and financial reservation lifetime. Specify a pre-expiry recovery trigger using the owned scheduled job's terminal state or the existing action deadline/recovery wake, and specify how confirmed termination settles an abandoned started receipt without releasing unknown cost.

Discriminating verification: lose the generation worker early with a retained ID and time remaining, drive actual scheduled recovery, return matching cancellation without cost, and obtain exactly one replacement attempt before the unchanged logical deadline. Do not invoke reconciliation manually to make the test pass.

### High / BLOCK: acknowledgement loss reaches mission blocking before retained-result recovery

Candidate lines 169 and 175. Verified source: `convex/execution/operations.ts:111`, `convex/execution/errors.ts:102`, and operations lines 1395–1437. An exception after the effect callback begins becomes `uncertain_effect`; settlement looks only for `request.outcome` or `request.effect.outcome`. If neither exists, `markOperationUnknown` blocks the Sources mission (operations lines 1350–1378).

Failing sequence inferred: `finishOneShot` or `retainControl` commits, its acknowledgement is lost, and the scheduled action throws. The valid response or qualification exists, but the operation has no final receipt yet; the generic exception handler blocks its mission. The TDD's later continuation requires current authority, so its procedure to recover retained work first is never reached automatically.

Smallest correction: include `executeScheduledOperation`/`settleDispatchFailure` in the opt-in recovery contract. Before assigning an unrecoverable unknown outcome, resolve the retained operation/control/invocation facts or retain an eligible wait with an owned recovery wake; genuine unresolved external work still cannot redispatch.

Discriminating verification: lose acknowledgement after each real transaction commits—one-shot result, qualification/control, and operation result—then drive the normal exception and scheduling paths. Assert one model result, one qualification, one context reference and one final adoption, without manually unblocking the mission.

### High / WATCH: epoch fencing and pause/resume dispatch authority need end-to-end specification

Candidate lines 165–173, especially the claim-only epoch description at 167 and adoption rebinding at 173. Verified source: `recordResult` and `settleDispatchFailure` currently fence by execution/adoption generation, not worker epoch (operations lines 934–970 and 1395–1409). `convex/execution/piControl.ts:1250` updates only `adoptionGeneration` for engaged requests; `convex/sourcesMission.ts:174` and providerCalls lines 1409–1418 still require the request's original `expectedGeneration`.

Risk/incompleteness: an old worker's delayed failure/result can affect a newer epoch in the same generation unless finalization and domain-effect boundaries also validate the epoch. Conversely, after an authorized pause/resume, the existing adoption rebind alone cannot dispatch the replacement in the new generation.

Smallest correction: specify the authoritative `(operation, epoch, dispatch generation, provider call)` relationship and its checks at attempt admission, domain adoption, result settlement and failure settlement. Define the controlled new-epoch dispatch rebind separately from factual late receipt retention.

Discriminating verification: delay an old epoch's result/failure until its successor starts; it must not terminate or alter the successor. Separately, reconcile while paused, resume through the real slot-claim path, and complete the same operation/input under a new receipt and current generation without resetting consumption.

### Medium / WATCH: reconciliation-worker loss differs from an unavailable lookup response

Candidate lines 153 and 161. Verified source: `convex/integrations/openRouterGeneration.ts:17` claims first and settles later; providerCalls lines 407–415 persist `checking` with `retryAt`, while `claimBilling` accepts only `pending` (384–395).

Failing sequence inferred: the lookup action disappears after claiming, or its settlement acknowledgement is lost. No unavailable-response handler runs to schedule the next lookup; the persisted checking state cannot be reclaimed by another ordinary claim.

Smallest correction: define recovery of an abandoned lookup claim using its existing `retryAt`, attempt fence and scheduler ownership, including duplicate acknowledgements. Preserve the logical deadline and the separation between late accounting and inference authority.

Discriminating verification: interrupt after `claimBilling` commits and after `settleBilling` commits; drive scheduled recovery and verify one effective continuation, no overlapping lookup ownership, and no generation after expiry.

### Medium / WATCH: admissible context must not silently close an unmet documentary need

Candidate line 33 forbids contextual relevance from establishing completed documentary coverage, while lines 131–133 specify admissible per-need associations. Verified source: `convex/domain/sources.ts:1491` currently treats every nonblocked use as available need material; this satisfies the unresolved-need guard at 1679–1687. With no unfinished entries, the handoff becomes complete at 1727–1731; `convex/sourcesWorkspace.ts:438` renders a need with contributions as prepared.

Inference requiring clarification: applying only the proposed per-need permission filter would preserve that shortcut for `context_only`. The design does not define which existing completion check enforces its stronger distinction.

Smallest correction: explicitly separate a retained contextual association from the evidence sufficient to close that particular documentary need. Define the expected handoff/projection behavior without adding an economic-answer judgment or fabricating a gap.

Discriminating verification: supply only context-level support for a need seeking observed outcomes; preserve the material while preventing a falsely completed need. Also cover a need whose actual purpose is contextual, so the correction does not prohibit legitimate completion.

## Confirmed strengths and limits

- CLEAR: separating termination from cost, preserving both reservations, rejecting EOF as terminal proof, retaining original structured input, and recovering domain effects before regeneration are sound directions. The proposal explicitly addresses the existing EOF and cancellation-classification defects; those are not additional findings here.
- CLEAR: the installed native API supports the proposed finish distinction. An offline probe made one injected HTTP call per case: identical valid JSON produced `finish=stop, raw=stop` with explicit finish and `finish=other, raw=null` on EOF; both serialized requests used strict `json_schema`. This verifies SDK mechanics, not provider reliability.
- Unverified: qualification/comparison callers at `convex/sourcePreparationActions.ts:449` and 1020 lack an operation request ID. Their counter/classifier coverage is appropriate, but implementation must explicitly handle the shared helper's new pending-result variant without granting these callers an undeclared recovery lifecycle.

The TDD's verification matrix is broad, but duplicate wake, worker loss and pause/cancel alone do not discriminate the failure sequences above. Tests must exercise the actual exception handlers, scheduling triggers, resumed generation and delayed obsolete worker—not merely call the recovery mutation directly.

## Recommended action sequence

1. Correct the worker-loss trigger and abandoned-receipt settlement contract, preserving the original authorization deadline and reservations.
2. Route acknowledgement loss and abandoned reconciliation claims through the retained-fact recovery path before terminal closure.
3. Specify epoch/generation fencing and add the positive resume, obsolete-worker and context-only handoff cases to the verification matrix.

The reviewer estimated 1–4 hours for design clarification and the test matrix only; implementation effort was not estimated. This is an estimate, not an execution commitment.

## Verification boundary

Read context.json, the full frozen TDD, request 24, research 26, the Pi/AI SDK investigation, project instructions/product/relevant technical contracts, both required skills, and the cited runtime/dependency/test owners. Ran repository identity/status/hash checks and the two-case offline SDK probe only. No repository tests, backend publication, live provider calls, migration, browser checks, edits, notifications or nested delegation were performed; initial dirty work remained untouched. Historical memory was used for navigation only, with decisive claims checked against current source.
