---
type: outline-review
repos:
  - identifier: agentic-resilience-workbench-proto
    sha: "0bac64351157f700ad944b12e0fbf2e0ef24b9ba"
flow: tdd
status: approve
---

# Independent Code Review: Legacy Retirement Outline

Reviewer: native Codex `code-reviewer`, GPT-6.1-sol, xhigh reasoning, fresh context. Scope: artifact 39 against the approved design and actual source/test consumers, applying the requested TDD and code-smell guardrails. The complete final report follows. This verdict concerns the proposed outline; it is not user authorization to implement or activate it.

## Code Review Summary

**Recommendation: APPROVE — pre-implementation outline only.** No actionable outline defects found. Severity totals: CRITICAL 0, HIGH 0, MEDIUM 0, LOW 0.

Reviewed [artifact 39](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/39-structure-outline-legacy-retirement-version-resolution.md:10) against artifacts 33, 35, 36, 37 and 38, repository contracts, the requested TDD references, code-smell guardrails, and relevant production/test consumers.

### Results

- **Spec compliance and phase order pass.** Launch/backfill cleanup precedes shared admission changes; admission/refusal coverage precedes executor deletion; obsolete corpus-review producers close in a cohesive batch. Generated references and test relocation are required before phase completion. Candidate correctness remains separate from deployment activation. See [phase sequence and preconditions](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/39-structure-outline-legacy-retirement-version-resolution.md:20).

- **Both Oracle amendments are concretely incorporated.** The Sources existing-event branch must pass the retained completion event and requested scope/generation through `missions.start`, returning without creating an event or resuming execution. This addresses the actual early return at [sourcesMission.ts:1021](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/sourcesMission.ts:1021). The planned supported/refused replay assertions include retained identity and absence of scheduling, reservations and ownership changes.

- **The replay verification can distinguish the intended correction.** [Phase 2’s rehearsals](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/39-structure-outline-legacy-retirement-version-resolution.md:139) separate named-current selection from maximum-version selection, and current-invalid/retained-valid replay from the baseline’s candidate-first validation. Independent definition objects, higher registrations, both request/objective paths, expected failures and restoration evidence are explicitly required. Merely assigning different version numbers is correctly rejected as insufficient evidence.

- **Replay and progression authority are separated correctly.** Retained lookup preserves identity, generation, owner, scope, comparison and completion checks; objective reuse preserves blocked/unfinished ownership restrictions. Avoiding full progression authority for ID-only completed-result reuse is justified by the terminal/deadline refusals in [authority.ts:199](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/authority.ts:199). Resume retains its separate progression requirements.

- **The TDD plan uses appropriate boundaries.** Characterization precedes preserved-behavior extraction; intentional replay/refusal changes require RED/GREEN. Tests must use real Convex collaborators and inspect returned identities, persisted effects and relevant external-boundary observations. The outline does not invite internal selection mocks, helper-only tests, shallow success assertions or manufactured tests for this prose review. Existing owning suites and the cross-entry matrix have distinct responsibilities.

- **Deletion and shared-dependency boundaries are sound.** The outline explicitly includes the preparation-study launcher/CLI, legacy instruction/manual-review producers and pre-I/O rejection of unsupported research workflow entries. It preserves envelope-less authorized reattachment, Sources primitives, Pi controlled generation, one-shot streaming/accounting, conversation storage, historical representations, definitions/profiles and cancellation. These distinctions match the inspected callers.

- **No masking workaround or unjustified abstraction is proposed.** Selection stays in the existing catalog, objective identity moves to `missionData`, and backend support stays with its existing owner. These changes localize existing rules without adding another registry, service, persistence owner or forwarding layer. No disagreement with the approved design was identified.

- **Generator and activation constraints are accurate.** Installed Convex CLI source confirms that normal codegen resolves deployment credentials and enters `withRunningBackend`. The outline therefore correctly treats generation as conditional and lifecycle-sensitive. Activation requires zero execution, retry, completion or cancellation dependency, explicitly including suspended workflows, callbacks and producer races—not merely all-Pi mission counts.

### Inspection and evidence limits

Executed `pwd`, `git rev-parse HEAD`, `git status --short --branch`, `git diff --stat`, `git diff` and `git diff --cached`, plus targeted `rg` searches and file reads.

Confirmed branch `sources-workflow-no-legacy`, HEAD `0bac64351157f700ad944b12e0fbf2e0ef24b9ba`, and empty tracked/staged diffs. Inspected selection/admission, conversation, handoff, Sources start/recovery, generation/storage, cancellation/history, obsolete producer and representative test owners; checked package scripts and installed codegen source.

**No tests, diagnostics, generators, source rehearsals, service operations, deployment/provider access, notifications or file writes ran.** Runtime behavior was not reproduced. The baseline defects identified above are intentional implementation targets, not new findings against this outline.

Deployment dependencies, blocked Sources 4 recoverability, generator access and future RED/GREEN/restoration results remain unverified prerequisites already represented in the outline. They do not prevent accepting this implementation sequence and do not confer implementation or activation authority.
