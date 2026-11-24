---
type: implementation-review
repos:
  - identifier: agentic-resilience-workbench-proto
    sha: "0bac64351157f700ad944b12e0fbf2e0ef24b9ba"
flow: tdd
status: comment
---

# Independent Review: Legacy Retirement Implementation

Review target: the uncommitted candidate on `sources-workflow-no-legacy` relative to the recorded HEAD, including the new `agent-definition-selection.test.ts` and `research-workflow-admission.test.ts`. The implementation thread was read as evidence, without messaging or modifying it. The single requested code-reviewer lane used fresh context, the native GPT-6.1-sol/xhigh profile, and the TDD and code-smell guardrails. This review did not change implementation files or the approved scope.

## Verdict

**COMMENT: no blocking implementation defect found; one LOW documentation inconsistency remains open.** No critical, high or medium findings. Candidate review does not establish deployment readiness.

## Independent Reviewer Report

The complete final report follows.

**COMMENT — no blocking implementation defect found. One LOW documentation inconsistency remains.**

Reviewed the candidate at HEAD `0bac64351157f700ad944b12e0fbf2e0ef24b9ba` on `sources-workflow-no-legacy`, including both untracked tests. No files were modified.

- **CRITICAL: 0**
- **HIGH: 0**
- **MEDIUM: 0**
- **LOW: 1**

**[LOW] Historical executor compatibility remains ambiguous in the capability summary.** [docs/ROADMAP.md:18](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/docs/ROADMAP.md:18) still promises “Workflow/AI SDK compatibility for historical runs.” The candidate deletes those executors and [context/TECH.md:127](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/context/TECH.md:127) now restricts mission admission/resume to stored Pi identities. This leaves the roadmap’s main delivery summary inconsistent with the approved retirement policy. Replace that phrase with explicit historical inspection/cancellation retention and current one-shot/storage support, and identify retirement activation as pending. **Evidence:** parent-identified, independently confirmed by source/document inspection; documentation issue only.

The traced implementation follows the approved admission policy: retained identity precedes current selection; comparison authorization remains separate; stable objective bytes are preserved; Sources completion-event replay reaches central mission validation; child admission resolves the child’s definition; retired-backend resume refuses before recovery mutations. No newly introduced masking fallback or unauthorized definition pruning was found.

The large capture/qualification/comparison deletions remove cases routed through the retired review-preparation entry. Retained suites still exercise actual capture authorization, late-result fencing, failed-attempt accounting, exact comparison reuse, one-shot acknowledgement loss, historical journals and cancellation cleanup. I found no concrete shared-functionality coverage regression in those removals.

**Executed:** seven existing focused suites passed **91/91 tests** in **19.92 seconds**:

```text
source-captures
source-qualification-action
source-comparison-action
missions
backend-default
cancellation
mission-history
```

`git diff --check` also passed.

**Not independently verified in this lane:** full aggregate/typecheck/build, chronological RED and mutation logs, profile generation, deployed state, live providers or browser behavior. The parent is auditing implementation evidence separately. Deployment inventory and activation remain pending conditions, not new code findings.

## Parent Verification and Synthesis

The finding is accepted as a nonblocking documentation correction and remains open; this was a review request, so no source or normative-document edits were made. No disagreement with the independent verdict remains.

Separately reran the following command on the candidate: **3 files, 10 tests passed in 6.85 seconds**. These tests exercise actual mission admission/replay, missing pins and queued refusal, Pi settlement rollback/replay accounting, and no-envelope workflow refusal before external I/O. The independent lane's seven suites are separate, for a combined **101 tests across 10 files** during this review. Parent `git diff --check` also passed.

```sh
pnpm exec vitest run src/__tests__/convex/execution/agent-definition-selection.test.ts src/__tests__/convex/execution/model-action.test.ts src/__tests__/convex/workflows/research-workflow-admission.test.ts --maxWorkers=2
```

Inspected [the implementation's final aggregate log](legacy-retirement-final-check.log), which records 237 passing protocol tests, 3,396 passing Vitest tests across 345 files, and successful client/server builds. Those are prior implementation results, not a rerun by this review. The log includes existing lint notices and the advisory TECH word warning. Inspected named-current/maximum and retained-scope/candidate-first rehearsal logs: the recorded mutations fail the consuming tests for incorrect version selection and scope validation, respectively. These logs support the claimed falsification outcomes; the review did not independently repeat temporary source mutations or reconstruct every chronological TDD step.

The questioned 64 KiB guard exists in the baseline at both `decodeReceivedReply` and `invocationLifecycle.retainOutput`. It constrains the decoded invocation-response JSON, including tool arguments or working notes, rather than cumulative provider-stream bytes. The candidate preserves that behavior and adds receipt/budget rollback coverage. Its age establishes that it is not introduced by this retirement change; neither that fact nor a passing regression establishes whether the limit is justified by current platform needs. This review did not approve a new limit or perform a separate resource-policy redesign.

Source inspection confirms the offline API script calls the installed declaration generator and the generated diff removes the five deleted module imports/map entries. The parent did not execute that generator or independently reproduce its baseline comparison. No service, deployment, provider or browser operation ran during this review. Pending scheduled work, suspended workflows, completion/cancellation callbacks, producer races and the retained Sources 4 mission's actual recoverability remain deployment-specific unknowns.

## Reviewed Candidate Fingerprint

The tracked binary diff against HEAD had SHA-256 `7947a1f54840c8defeebabc7c1e6778f0a48e760312b30eed4ba8892852e1225`. Untracked test hashes were `51682d468ed8b1410ec1efba739cf6f9a336b9e52ac975721860df7cd3ee1463` for `src/__tests__/convex/execution/agent-definition-selection.test.ts` and `a22213b75045c1e954d549cb359d7c8ae568e47bafdb9aba38dd9e476a2928f6` for `src/__tests__/convex/workflows/research-workflow-admission.test.ts`. This identifies the reviewed working-tree content independently of the unchanged Git HEAD.
