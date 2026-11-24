---
type: design-review
repos:
  - identifier: agentic-resilience-workbench-proto
    sha: "0bac64351157f700ad944b12e0fbf2e0ef24b9ba"
flow: tdd
status: block
---

# Oracle Review: Legacy Retirement System Design

Review of artifact 36 before Program Design. Reviewer: Codex gpt-6-astra, xhigh reasoning. The report below is preserved as received; artifact line numbers refer to the reviewed revision, before subsequent corrections. No implementation or independent recheck is implied.

**BLOCK — one replay-policy ambiguity must be resolved before System Design approval.** The catalog ownership and approved retirement scope are sound. The remaining findings are bounded Program Design or activation requirements; they do not justify a new framework or reopening the approved scope.

Reviewed baseline: `0bac64351157f700ad944b12e0fbf2e0ef24b9ba`, branch `sources-workflow-no-legacy`.

1. **High — approval blocker: replay’s governing contract is not fully specified.**

   The design promises retained mission identity for replay, exact persisted-pin precedence, and defaults affecting only future work. It also requires preserving existing replay refusal behavior while deferring replay order to Program Design. Those statements leave an observable choice unresolved. See [selection and replay contract, lines 49–71](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/36-tdd-legacy-retirement-version-resolution.md:49) and [deferral at line 120](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/36-tdd-legacy-retirement-version-resolution.md:120).

   Today, [missions.start](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/missions.ts:61) selects a candidate and validates its backend compatibility and scope **before** looking up the retained request at line 123. It can therefore reject a replay because of today’s candidate, even when the retained mission has a different, supported pin. The separate objective-reuse path at lines 144–159 also derives the lookup key from the candidate before returning a retained mission.

   Simply moving replay earlier is not sufficient: dossier/run authority, active-turn validation, request identity and generation checks currently precede its return. Definition-specific authority runs later through [requireMissionAccess](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/authority.ts:137). A refactor must distinguish returning an existing identity from authorizing its execution.

   **Correction required in System Design:** state the observable replay rules for both request-key replay and objective reuse:
   - Which retained identity governs validation when it exists?
   - Does a changed current default ever invalidate a supported retained request?
   - Does a retired-backend replay return an identity without execution, or refuse?
   - Which authority checks remain mandatory for replay, and which are required before continuation?

   My recommendation follows the approved precedence: use the retained pin for an identified mission, preserve authority and identity guards, and explicitly distinguish replay from resume. Treat any resulting change to candidate-dependent refusal as intentional and test it. Exact query placement and function signatures can then remain in Program Design.

   An alternative reading is that line 71 already mandates preserving the candidate gate. If that is intended, describe it explicitly as an additional replay eligibility rule and reconcile it with “defaults affect future work”; “do not accidentally change behavior” is insufficiently precise.

2. **Medium — WATCH: close every producer of retired execution, including the preparation-study launcher.**

   The [retirement table](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/36-tdd-legacy-retirement-version-resolution.md:77) identifies the principal owners correctly, but removing `sourcePreparationWorkflow` has another concrete consuming boundary: [sourcePreparationEvaluation.start](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/sourcePreparationEvaluation.ts:415) launches it and registers its completion callback at lines 516–523. This is executable technical tooling, distinct from the retained Workbench/Sources method comparisons.

   Also, [researchWorkflow.run](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/researchWorkflow.ts:80) handles reattachment first, but otherwise calls `companyResolution.revalidateRun` at line 96 before checking `sourcesEnvelope` at line 111. Rejecting a retired no-envelope invocation only where its old loop used to begin would permit external work first.

   **Recommended correction:** in Program Design, explicitly account for the preparation-study start boundary, legacy instruction delivery and manual-candidate review branches. Remove or explicitly refuse their obsolete execution behavior while preserving required inspection. Place rejection of unsupported research-workflow entry shapes before external work; retain the separate authorized reattachment branch. These are consequences of the approved retirement, not grounds for replacing the old executor with an adapter.

3. **Medium — WATCH: make the activation gate a concrete dependency condition, not just an inventory activity.**

   The [activation paragraph](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/36-tdd-legacy-retirement-version-resolution.md:88) correctly blocks only the affected batch and grants no cancellation or migration authority. It should additionally specify that the inventory remains valid through activation.

   Old targets have completion callbacks, not just queued starts: [missions.resume](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/missions.ts:417) registers `missionWorkflow.onComplete`; the preparation-study launcher does the same for its workflow. Cancellation can also reach Workflow state: [cancelMission](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/cancellation.ts:203) finishes child notifications and cancels the retained workflow, while [run cancellation](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/domain/runCancellation.ts:31) explicitly anticipates callbacks during cancellation.

   **Recommended correction:** require no remaining execution, retry, completion or cancellation dependency on each deleted target, and prevent old producers from adding such dependencies between the check and deployment. Inspect suspended workflows and outstanding callbacks, not merely running missions. If that condition cannot be established, defer the batch as already proposed. A short deployment procedure using existing controls is enough; a migration framework is unnecessary.

4. **Medium — WATCH: strengthen the verification matrix with cases that distinguish the proposed policy.**

   The [verification section](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/36-tdd-legacy-retirement-version-resolution.md:106) selects appropriate real consuming boundaries. Its broad statements still need discriminating cases in Program Design.

   In particular, ordinary current-default assertions alone cannot detect continued use of `Math.max`: the present [maximum-version helper](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/agentCatalog.ts:182) and named defaults currently agree for Pi. Likewise, existing [comparison-authority coverage](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/src/__tests__/convex/execution/qualification-method-comparison.test.ts:119) exercises operation admission after a mission exists; it does not establish the proposed replay policy.

   **Recommended correction:** include consuming-boundary evidence for named-current versus higher retained registration, pin precedence over comparison selection, child-agent identity, and the replay outcomes settled above. For refusals, assert the relevant failure effects: no new mission/turn ownership, scheduled dispatch, reservation or provider receipt; retained state remains unchanged. Preserve cancellation’s real outcomes—fencing late work, settling outstanding requests and releasing active ownership—not merely a successful return.

The proposed selector can be a substantive abstraction. It removes duplicated choice rules from conversation creation, turn admission and mission creation, while [agentCatalog](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/agentCatalog.ts:231) already owns exact definitions and named defaults. Keep precedence and required-pin handling inside that owner; callers should supply authoritative facts rather than precompute a version. [Qualification authorization](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/qualificationAgentMethods.ts:19) should remain with its existing owner. A saved comparison pin identifies the contract; it does not permanently confer campaign authority.

I found no inherent contradiction between retaining Workbench 4/Sources 4 definitions and deleting non-Pi executors. Agent version and execution backend are separate identities. The design also correctly preserves current one-shot calls, conversation storage and envelope-less reattachment. The latter is concretely used by [runRecovery](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/runRecovery.ts:119). Cancellation already has a path independent of executable definition admission. None of these observations certifies the two historical conversations or blocked Sources mission as currently recoverable.

Program Design should retain responsibility for signatures, argument shapes, call-site changes, precise transaction placement after replay semantics are fixed, deletion closure, test organization and generated-profile verification. Deployment inventory and the blocked Sources 4 mission’s actual recoverability remain deployment-only unknowns; neither prevents preparing a candidate implementation.

Checks performed: read artifacts 33, 35 and 36, repository instructions, `PRODUCT.md`, relevant technical-contract and roadmap sections; inspected selection, authority, handoff, retirement, recovery, cancellation and representative test owners; verified HEAD and clean tracked working state. No files were changed, tests run, services started, deployments accessed or provider calls made. The research’s 171 passing tests remain dated evidence, not validation of this proposal. Memory was used only to locate prior audit concerns; code claims above were checked against this baseline.
