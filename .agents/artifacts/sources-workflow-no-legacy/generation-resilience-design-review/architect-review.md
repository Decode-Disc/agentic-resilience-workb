**BLOCK for implementation readiness.** The architecture can extend the existing owners, but the accounting cutover and lost-worker receipt closure need explicit transitions before implementation. Three additional WATCH items concern retained bindings, historical assessment representation, and the recovery allowance.

Reviewed the complete [frozen candidate](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/generation-resilience-design-review/tdd-reviewed.md), verified SHA-256 `915d50380628d68af5596e95a46de2fe669c4e6421009fad850dc1f3d7253e51` and HEAD `168981b3c48a7d20062e39e2a2df71689c1036d4`. No files were modified.

1. **High · BLOCK — Changing the classifier requires rebasing persisted accounting projections.**

   [TDD:155](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/generation-resilience-design-review/tdd-reviewed.md:155) changes the shared failure classification, while [TDD:181](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/generation-resilience-design-review/tdd-reviewed.md:181) inventories projections without defining their conversion.

   **Verified:** an EOF-derived `invalid_output` currently counts as an incident through [sourcePreparationAuthority.ts:243](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/domain/sourcePreparationAuthority.ts:243). Under the proposed terminal-evidence rule, that same receipt can become unknown and therefore reserved. However, [readPreparationBudget:124](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/domain/sourcePreparationAuthority.ts:124) immediately returns the stored budget, and [patchQualificationReceipt:215](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/qualificationUsage.ts:215) calculates both sides of its accounting delta using the currently installed classifier. Campaign projections use the same before/after mechanism at [qualificationUsage.ts:104](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/qualificationUsage.ts:104).

   **Failure inferred from those mechanisms:** changing code does not move the previously counted incident into reservation or increment the stored unknown count. A later cancellation confirmation can subtract a reservation or unknown entry that was never added, producing inconsistent or negative counters. Late settlement makes this relevant even for closed work.

   **Smallest correction:** make rebasing `researchRuns.sourcePreparationBudget` and affected `qualificationUsage` rows an explicit, resumable transition step under the admission fence. Establish the baseline under the final classifier before allowing ordinary receipt deltas. Preserve charges, reservations and attempt counts; this needs no additional accounting engine.

   **Verification:** seed an old EOF receipt with its old materialized counters, convert twice, then apply cost-only evidence and matching termination evidence separately. Assert agreement between receipt-derived totals and stored projections, nonnegative counters, unchanged financial reservation until eligible settlement, and unchanged lifetime dispatch counts.

2. **High · BLOCK — Reconciliation needs an explicit lost-worker receipt closure transition.**

   [TDD:159](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/generation-resilience-design-review/tdd-reviewed.md:159) arms reconciliation after generation identity is retained, and [TDD:175](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/generation-resilience-design-review/tdd-reviewed.md:175) orders recovery before replacement inference. Neither identifies the transition that closes the original local attempt when its worker disappears before `finishOneShot`.

   **Verified:** [settleBilling:443](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/providerCalls.ts:443) updates billing/provider observations without closing `providerCalls.status`. Meanwhile, [assertQualificationAllowance:165](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/qualificationUsage.ts:165) rejects any expired `started` receipt independently of the failure classifier. `finishOneShot` also requires a non-started receipt before retaining its returned result at [invocationLifecycle.ts:1337](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/invocationLifecycle.ts:1337).

   **Failure inferred:** a successfully reconciled cancellation can clear remote uncertainty while the original receipt remains expired and `started`; replacement admission still fails. Classifier changes alone cannot close this lifecycle.

   **Smallest correction:** name one existing lifecycle owner for closing a lost structured attempt after its worker ownership has expired and terminal evidence matches. It must first recover any complete retained result, otherwise retain an explicit technical failure, update accounting through the normal receipt transaction, and only then request the operation continuation. Billing must supply evidence without independently declaring domain failure or adoption.

   **Verification:** lose the worker after generation identity persistence but before `finishOneShot`; obtain cancellation confirmation without cost; then exercise real scheduled continuation. Assert one closed original receipt, both financial reservations, one replacement receipt, one qualification and one final operation outcome. Include a late original-worker acknowledgement and a previously retained successful result.

3. **Medium · WATCH — The retained-binding cutover remains conditional rather than concretely mapped.**

   [TDD:181](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/generation-resilience-design-review/tdd-reviewed.md:181) correctly refuses silent version substitution and permits blocking cutover. The missing program detail is the actual conversion of quiescent but resumable owners.

   **Verified:** new defaults do not upgrade existing work. [resolveAgentDefinition:205](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/agentCatalog.ts:205) uses the conversation’s persisted version; [missions.start:92](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/missions.ts:92) reuses the existing objective mission; and [piControl.rebind:1276](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/piControl.ts:1276) changes execution/adoption generation, not definition version. Removing the old catalogue entries therefore leaves an unchanged idle conversation or paused Sources mission unable to resume. A blanket mission-version rewrite is also unsafe because [canAdoptRetainedResponse:50](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/authority.ts:50) requires matching invocation and mission versions.

   **Correction:** specify the one-time transition through `conversations` and `missions`, including admissible statuses, native-session settlement, pending requests, completion ownership, immutable invocation preservation and the new policy snapshot. Distinguish an idle conversation, a paused Sources mission and historical completed work. Keep the fence when those preconditions cannot be established.

   **Verification:** resume a converted idle conversation and a quiescent paused Sources mission after removing old executable definitions. Assert preserved transcript hashes, objective/completion identity, analyst decisions, counters and deadlines; prove an old response cannot acquire new adoption authority. Actual stored cohort counts remain unverified.

4. **Medium · WATCH — Define the persisted “not examined under the current contract” shape separately from the examiner’s strict result.**

   [TDD:127](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/generation-resilience-design-review/tdd-reviewed.md:127) requires complete contribution/need findings. [TDD:183](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/generation-resilience-design-review/tdd-reviewed.md:183) correctly says old global results cannot supply those findings and must expose an unavailable current assessment. The closed persisted representation connecting those requirements is unspecified.

   **Verified:** [documentaryControlOutput:110](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/domain/sourcesContracts.ts:110) embeds the executable control validator directly, and [schema.ts:1215](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/schema.ts:1215) installs it in persisted task outputs. [controlledSourcesContributions:967](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/domain/sources.ts:967) requires that control, while [readPreparedNeed:807](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/domain/sources.ts:807) combines frozen handoff associations with the current projection.

   **Maintenance risk:** without one canonical unavailable-assessment representation, conversion and individual readers must invent their own interpretation of absent per-need findings. Filling those findings fabricates approval; treating the historical object as current preserves implicit compatibility; representing everything as an explicit rejection changes its meaning.

   **Correction:** specify the normalized persisted assessment state and audit reference, while keeping new model results strict. Let the shared Sources projection distinguish historical recorded outcomes from current admissibility. This is data normalization, not a retained v1 executor.

   **Verification:** convert a completed old handoff and an unfinished preparation. Exercise workspace inspection, prepared-need consultation and advisory facts through their real owners. Preserve historical membership and decisions, expose current assessment absence consistently, and make zero model calls.

5. **Medium · WATCH — Clarify whether same-operation recovery includes the third lifetime attempt.**

   [TDD:155](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/generation-resilience-design-review/tdd-reviewed.md:155) invokes the existing bounded recovery allowance, while [TDD:157](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/generation-resilience-design-review/tdd-reviewed.md:157) retains the existing attempt selector.

   **Verified:** [nextPreparationAttempt:291](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/domain/sourcePreparationAuthority.ts:291) permits an absolute third documentary attempt, but [line 308](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/domain/sourcePreparationAuthority.ts:308) refuses it in the same preparation as `explicit_recovery_required`. Its existing explicit-recovery path depends on a linked successor preparation at [line 295](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/domain/sourcePreparationAuthority.ts:295).

   **Interpretation needing clarification:** recovery from attempt one to attempt two fits the current same-preparation allowance. Automatically reaching attempt three does not. If the proposal intends the third attempt, merely preserving the selector cannot deliver it.

   **Correction:** state whether recovery exhausts after two attempts or how current authority explicitly admits the third for the same logical operation. If the latter, extend this selector and its atomic admission consumer; do not create a new preparation or enlarge the lifetime ceiling.

   **Verification:** exercise attempt two, the third-attempt decision and exhaustion. Assert unchanged artifact/preparation identity, cumulative consumption and refusal of a fourth dispatch. This becomes a **decision conflict only if automatic third-attempt admission is intended without the currently required recovery authority**.

The five code-smell questions give the following result:

| Question | Assessment |
| --- | --- |
| Does the design localize knowledge? | **Mostly CLEAR.** `controlledDocumentaryUse` remains the semantic owner; Sources remains the projection/handoff owner. Accounting conversion needs an explicit baseline owner. |
| Does it reduce concepts? | **CLEAR with a check.** Scoped findings and separate termination/cost facts express real distinctions. Scheduling phase must remain scheduler-owned metadata, not another independently managed workflow. |
| Are future changes localized? | **Mostly CLEAR.** The shared selector/profile requirement is appropriate. Binding and historical-assessment conversion must avoid reader-specific exceptions. |
| Is the interface simpler than the implementation? | **CLEAR.** The compact receipt plus existing journal reference hides substantial diagnostic storage and paging. The lexical detector also has a suitably narrow interface. |
| Does it avoid speculative abstractions? | **CLEAR.** A concrete opt-in recovery contract is justified by the exposed scheduled operation. No new retry service, parser, transport, budget engine or generic migration framework is needed. |

The detector stays an observer: quotes/escapes are sufficient for the selected whitespace policy, while native parsing retains validity authority. The installed adapter preserves an explicit finish reason at [provider source:4679](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/node_modules/@openrouter/ai-sdk-provider/dist/index.js:4679), and the SDK exposes `rawFinishReason` at [stream-text-result.ts:241](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/node_modules/ai/src/generate-text/stream-text-result.ts:241). I found no architectural reason to revisit the accepted transport, routing or 4,096-character decision.

Checks were limited to hashing, repository status/diff inspection, the full candidate and supplied context/evidence, required instructions/skills, relevant domain/execution/accounting consumers, installed SDK source and existing test definitions. No tests or probes were executed, and no services, network calls, migrations, notifications or delegation occurred. Consequently, the failure paths above are source-grounded design inferences; actual migration feasibility against retained data and runtime recovery remain unverified. This review provides no implementation or provider-quality acceptance.


