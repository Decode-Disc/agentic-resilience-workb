# Independent Review of the Generation Resilience Design

## Verdict: BLOCK implementation readiness

Both requested reviewers completed independent reviews of the same [frozen candidate](tdd-reviewed.md), SHA-256 `915d50380628d68af5596e95a46de2fe669c4e6421009fad850dc1f3d7253e51`, against repository HEAD `168981b3c48a7d20062e39e2a2df71689c1036d4`. The user's design approval remains recorded; these reviews identify missing contracts before implementation. The reviewed TDD and production code were not changed during review.

Oracle used the fixed native Codex / GPT-6 Astra / xhigh profile for causal correctness. Architect used Codex / GPT-6.1 Sol / max for ownership, complexity and transition feasibility; the delegated run confirms the requested model. Complete findings and verification boundaries are retained in the [Oracle report](oracle-review.md) and [Architect report](architect-review.md). [Context and reviewer identities](context.json) preserve the exact candidate and execution scope.

Neither reviewer recommends reopening the accepted separate examination, 4,096-character outside-string counter, Pi/AI SDK split, OpenRouter routing, reservation policy or removal of replaced code. The defects concern making those choices work through the actual existing lifecycle and persisted state.

## Blocking findings

### High: persisted accounting needs an explicit rebase

Reported by Architect; accepted after parent source inspection. The changed EOF classification can move a receipt from incident to reserved/unknown, but existing stored projections are returned as-is. Later receipt updates calculate both delta operands through the new classifier. Consequently, an old baseline can disagree with the new receipt meaning and subsequent settlement can subtract a reservation/unknown count never added. Relevant owners are `readPreparationBudget` and `patchQualificationReceipt` in [preparation authority](../../../../convex/domain/sourcePreparationAuthority.ts) and [qualification accounting](../../../../convex/qualificationUsage.ts); candidate lines 155 and 181.

Correction: define an idempotent rebase of run preparation budgets and affected campaign/run qualification projections under the admission fence, before ordinary settlement deltas resume. Preserve lifetime dispatches and financial reservations. Verify old EOF data, repeated conversion, cost-only evidence and then termination evidence against receipt-derived totals, including late updates for closed work. No second accounting engine is needed.

### High: worker recovery must trigger before inference authority expires

Reported by Oracle; accepted after parent source inspection. The receipt lease is the minimum logical authority deadline plus settlement grace, rather than the earlier action lifetime. Arming the proposed recovery trigger only against that lease can discover worker loss after replacement dispatch is no longer authorized. See [provider receipt admission](../../../../convex/providerCalls.ts), lines 471, 1431 and 1692; candidate lines 159–161.

Correction: use the existing owned action/job termination or action recovery boundary to trigger reconciliation while original authorization remains available. Keep logical deadline, worker execution lifetime and financial reservation lifetime distinct. Verify actual scheduled recovery after early worker loss without manually invoking the recovery mutation or extending authority.

### High: a reconciled lost worker still needs its local receipt closed

Reported by Architect and also identified within Oracle's first finding; accepted after parent source inspection. Provider reconciliation can confirm cancellation while leaving the receipt `started`. An expired started receipt independently blocks qualification admission; finalization also requires the receipt to have left started state. Terminal evidence alone does not perform that transition. See [provider settlement](../../../../convex/providerCalls.ts), [qualification admission](../../../../convex/qualificationUsage.ts) and [one-shot finalization](../../../../convex/execution/invocationLifecycle.ts); candidate lines 159 and 175.

Correction: name the existing invocation/receipt lifecycle transition that, after matching terminal evidence and loss of worker ownership, first recovers a retained complete result or closes the abandoned attempt as an explicit technical failure. Update accounting through its normal transaction, retain unknown cost and only then request continuation. Verify cancellation without cost, late original-worker acknowledgement and a previously retained success, with one replacement and one adoption.

### High: acknowledgement loss can block the mission before recovery runs

Reported by Oracle; accepted after parent source inspection. The scheduled wrapper converts an exception after entering the effect callback into uncertain effect. Its settlement only checks operation/effect outcomes, so a committed one-shot result or control with a lost acknowledgement can still lead to mission blocking before the proposed retained-fact recovery executes. See [scheduled execution and failure settlement](../../../../convex/execution/operations.ts), lines 111, 1350 and 1395, and [failure classification](../../../../convex/execution/errors.ts), line 102; candidate lines 169 and 175.

Correction: make the opt-in recovery contract reach these exception handlers. Inspect retained operation/control/invocation facts or establish an owned eligible wait before unresolved terminal closure; never infer permission to repeat an uncertain external action. Verify acknowledgement loss after one-shot, control/qualification and final operation commits through their actual exception paths, without manually unblocking the mission.

## Additional contracts to clarify

| Finding and reviewer | Evidence and consequence | Smallest correction and verification |
| --- | --- | --- |
| High / WATCH: fence every epoch boundary; Oracle | Candidate 165–173. Operation result/failure settlement currently checks generation, not epoch. Engaged pause/resume changes adoption generation while dispatch still checks the original expected generation. | Specify operation/epoch/dispatch-generation/call identity at admission, adoption and both settlement paths. Test delayed obsolete worker success/failure and a positive pause/reconcile/resume through real slot admission. Preserve the distinction between late factual receipts and dispatch authority. |
| Medium / WATCH: recover an abandoned reconciliation claim; Oracle | Candidate 153 and 161. `claimBilling` persists checking; ordinary claim accepts pending only. Worker loss after claim has no unavailable-response callback to schedule recovery. | Reclaim through existing retryAt, attempt fence and scheduler ownership. Interrupt after claim and settlement commits; verify no concurrent claim, duplicate continuation or inference after expiry. |
| Medium / WATCH: map retained bindings concretely; Architect | Candidate 181. Existing conversations resolve their stored version; mission start reuses its objective mission; rebind changes generation rather than definition. Removing old code does not upgrade those owners. | Define admissible idle-conversation and quiescent-paused-mission conversion, native session/request/completion handling and policy snapshot. Preserve immutable invocation hashes, decisions, deadlines and counters; test useful resume after old definitions are removed and refusal of stale response adoption. Stored cohort counts were not inspected. |
| Medium / WATCH: give absent current examination one persisted shape; Architect | Candidate 127 and 183. Existing stored task output embeds the model control validator, while new strict findings cannot honestly be manufactured from a global old verdict. | Separate strict new model output from normalized persisted examination availability plus original audit reference. Test completed and unfinished historical material across workspace, need consultation and advisory projection, with preserved membership and zero model calls. This does not retain an old executor. |
| Medium / WATCH: state the same-preparation retry allowance; Architect | Candidate 155–157. The current selector permits two initial attempts in one preparation; the third lifetime documentary attempt requires explicit recovery through a linked successor. | State the two-attempt automatic boundary unless separately authorized recovery is deliberately redesigned. Test the second attempt, refusal or explicit admission of the third and absolute exhaustion. The parent recommends no automatic authority expansion; the review found an ambiguity, not an approved third-attempt change. |
| Medium / WATCH: distinguish contextual usefulness from closing a need; Oracle | Candidate 33 and 131–133. Current handoff accepts nonblocked material as covered and renders associated needs prepared. Per-need use filtering alone does not specify when contextual material satisfies a need seeking observed outcomes. | Define expected retained association and unfinished/coverage behavior for that case, and a positive case where the need itself is contextual. Parent retains this as a coverage-contract ambiguity: complete preparation does not itself mean the economic question is answered. Do not add economic-answer adjudication or fabricate a gap. |

All additional findings remain open. No reviewer disagreement about the architectural direction was reported. The parent qualifies the final two interpretations as stated above rather than silently expanding retry authority or redefining preparation completion.

One additional coverage boundary from Oracle remains explicit: qualification and comparison callers in [sourcePreparationActions](../../../../convex/sourcePreparationActions.ts), lines 449 and 1020, lack an operation request ID. They must consume the shared helper's pending-result variant deliberately without acquiring an undeclared scheduled-recovery lifecycle. Their counter/classifier coverage remains appropriate; their new integration behavior is unverified.

## Verification and limits

Architect ran source/dependency/contract/test-definition inspection and repository/hash checks only. Oracle additionally ran a two-case offline native SDK probe: identical valid JSON returned stop/raw-stop with explicit finish and other/raw-null on EOF; both serialized strict json_schema requests. Neither ran repository tests, a local backend, a migration, browser work or a live provider qualification.

The parent read both complete reports, checked the cited budget/classifier/delta logic, receipt deadlines and states, scheduled exception handling, result/rebind generation guards, pinned definition/mission reuse, historical control consumers, handoff completion and shared qualification/comparison call sites. These checks support the design findings by execution order and persisted state; they do not reproduce the proposed future recovery or establish migration feasibility on actual retained cohorts. Candidate identity and its JSON example/local original link targets were checked. The parent did not change production code or the approved design, or perform paid inference.

## Recommended next action

Revise the TDD at these existing owners and add discriminating regression sequences before preparing its implementation outline. Preserve the accepted architecture and no-legacy requirement. New migration execution, production changes and paid qualification remain separately unauthorized. This review closes only the requested review task; implementation readiness remains blocked by the four concrete lifecycle/accounting gaps above and the unresolved detailed contracts.
