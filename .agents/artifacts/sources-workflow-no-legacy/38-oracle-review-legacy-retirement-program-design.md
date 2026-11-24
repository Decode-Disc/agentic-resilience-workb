---
type: design-review
repos:
  - identifier: agentic-resilience-workbench-proto
    sha: "0bac64351157f700ad944b12e0fbf2e0ef24b9ba"
flow: tdd
status: watch
---

# Oracle Review: Legacy Retirement Program Design

Reviewer: Codex gpt-6-astra, xhigh reasoning. This report is preserved as received. Artifact line references identify the reviewed revision before subsequent amendments. Review conclusions are based on source inspection, not implementation or runtime validation.

**WATCH — the previous replay-policy BLOCK is resolved. The architecture is suitable for approval, with two bounded Program Design amendments needed before implementation.** Neither requires changing the approved selector shape or introducing another abstraction.

Reviewed branch `sources-workflow-no-legacy`, HEAD `0bac64351157f700ad944b12e0fbf2e0ef24b9ba`. No implementation exists yet.

The previous findings have these dispositions:

| Previous finding | Disposition |
| --- | --- |
| Replay’s governing contract — BLOCK | **Resolved.** [Design lines 73–77](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/36-tdd-legacy-retirement-version-resolution.md:73) explicitly select the retained mission, preserve authority checks, refuse retired-backend replay, and separate ID return from continuation. |
| Retired-execution producer closure — WATCH | **Addressed in design.** The preparation-study endpoint/CLI, old instruction/manual-intake branches, and pre-I/O rejection of unsupported research workflow entries are included at [lines 262–271](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/36-tdd-legacy-retirement-version-resolution.md:262). Implementation closure remains to be demonstrated. |
| Activation dependency condition — WATCH | **Addressed in design; deployment evidence pending.** [Lines 94–96](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/36-tdd-legacy-retirement-version-resolution.md:94) cover execution, retries, completion, cancellation, suspended workflows and producer races. [Line 291](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/36-tdd-legacy-retirement-version-resolution.md:291) also addresses automatic watcher publication. |
| Discriminating verification — WATCH | **Mostly addressed.** Named-current selection, pin precedence, child identity, refusal effects and cancellation outcomes are concrete. The retained-replay regression still needs the amendment below. |

1. **Medium — the Sources start replay shortcut bypasses the proposed central checks.**

   The Program Design explicitly updates the Sources key caller at [line 216](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/36-tdd-legacy-retirement-version-resolution.md:216), while placing retained-backend and replay validation in `missions.start`. However, [sourcesMission.ts:1015–1025](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/sourcesMission.ts:1015) returns an existing mission and completion event **before calling either `missions.start` or `missions.resume`**.

   Its preparation fence validates preparation/run state, but does not validate the retained mission’s backend, definition or mission generation; see [sourcePreparationAuthority.ts:334](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/domain/sourcePreparationAuthority.ts:334). Consequently, implementing the listed central changes alone leaves this start boundary able to return a retired mission as a successful replay, contrary to the approved policy. It can also bypass the newly required retained-mission identity checks. This is a source-proven branch, not a claim that such a record currently exists in the stopped deployment.

   **Correction:** explicitly include `sourcesMission.start`’s existing-event branch in the admission changes. Validate replay through `missions.start`, supplying the retained completion event and requested scope/generation, before returning it. Preserve the no-new-event/no-resume behavior of successful replay. Test a supported replay, retired-backend refusal and stale retained generation at this caller, asserting unchanged mission/event ownership and no scheduling or reservations. Keep `reattach` as the separate explicit completion-rebinding boundary.

2. **Medium — a different retained version alone does not falsify candidate-first replay.**

   [Design line 281](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/36-tdd-legacy-retirement-version-resolution.md:281) proposes seeding a supported retained mission different from the current default, then asserting unchanged ID, pin and effects. That is useful preservation coverage, but the existing code already returns the retained mission after validating a compatible current candidate: [missions.ts:61–159](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/missions.ts:61). Its request check does not compare definition versions, and the existing objective formats remain identical across retained/current definitions.

   Therefore those assertions alone can pass with the ordering defect intact.

   **Correction:** specify a case where current-candidate validation fails while the retained contract remains valid, for both request replay and objective reuse. A temporary source rehearsal can narrow only the current definition’s scope validator while preserving the retained validator. Demonstrate that retained-first replay succeeds and temporarily restoring candidate-first validation fails the same tests. Restore all source changes afterward. This complements the already specified named-current-versus-maximum rehearsal without adding a production override or internal mock.

Other reviewed aspects have no identified architectural blocker:

- **Selector and authority:** the discriminated `new`/`conversation`/`mission` input prevents callers from erasing the distinction between absent work and a missing pin. Qualification permission remains outside the pure selector and is checked even when a pin wins. Preserving storage-only validation conversations while refusing unpinned executable Workbench conversations matches the existing distinction.
- **Objective ownership:** all five documented key formats match the current implementations, including ordered `JSON.stringify(values)` and turn suffixes. Moving construction into `missionData` is coherent. Updating `readSourcesMission`, qualification fixtures and Sources request/event names together avoids duplicate constructors. Type-only domain inputs avoid introducing a runtime dependency from `missionData` back into `domain/sources`.
- **Reuse and completion:** request replay retains stricter request/completion identity; objective reuse permits another request key without transferring unfinished ownership. Avoiding full `requireMissionAuthority` on ID-only reuse is necessary because [authority.ts:199–202](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/authority.ts:199) rejects completed missions and expired progression deadlines. The existing [child handoff](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/handoffs.ts:98) distinguishes completed-result reuse from unfinished work owned by another request.
- **Rollback and cancellation:** the proposed single-mutation admission and early resume refusal preserve transactional rollback. Cancellation must remain independent of supported-backend admission: it settles outstanding requests and reaches completion notifications and Workflow cancellation at [cancellation.ts:180](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/cancellation.ts:180).
- **Removal boundaries:** preserving controlled Pi generation, auxiliary work, current AI SDK one-shot accounting and Convex Agent message storage is supported by their actual callers. Retained framing acknowledgements remain operation-version-specific. Removing executor implementations does not justify deleting retained definitions, profiles or journal representations.
- **Verification and activation:** the named-current rehearsal is discriminating provided the higher registration remains present. Run temporary mutations in a checkout that cannot publish them, and verify restoration before final checks. The activation gate correctly includes suspended workflows and callbacks, not merely running missions; satisfying it remains deployment-specific work.

Deployment inventory, outstanding callbacks and the blocked Sources 4 mission’s recoverability remain **unverified activation conditions**, not reasons to redesign the approved catalog or key ownership.

Checks performed: read artifacts 33, 35, 36 and 37; repository instructions, product contract and relevant technical/roadmap sections; traced selection, objective construction, Sources startup/reattachment, comparison authority, generation/storage, retirement producers, history and cancellation; inspected representative tests; verified HEAD and clean working state.

No tests, runtime validation, profile generation, service operations, deployment access, provider calls, notifications or file writes occurred. The research’s 171 passing tests remain prior evidence, not validation of this design. Memory supplied historical compatibility context only; material source claims were checked locally.
