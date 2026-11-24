---
type: request
repos:
  - identifier: agentic-resilience-workbench-proto
    sha: "0bac64351157f700ad944b12e0fbf2e0ef24b9ba"
flow: tdd
---

# Original Request: Legacy Retirement and Agent Version Resolution

The user requested a legacy-code audit, an Oracle consultation on concrete next actions, and added: “there should be a helper that set actual version used for maintainability so that there's a single source of Truth and the right version is used everywhere calling it.” On November 24, 2026, the user selected research questions → research → technical design (TDD). This document scopes that work; implementation is a later phase.

## Desired Outcome

Retire obsolete executable paths and centralize effective agent-definition version selection in one authoritative owner used by all relevant callers. Investigate extending the existing agent catalog before adding another module. Current defaults, persisted conversation/mission pins, and authorized qualification versions must have explicit precedence. A caller must not silently substitute the latest definition for an existing pin. Avoid scattered numeric defaults, duplicated version-selection rules, and wrappers that merely forward calls.

Keep version dimensions distinct: agent definition, operation contract, execution protocol, backend/runtime, skill package, and input-profile identity are related but not interchangeable. The technical design must establish which decisions the shared resolver owns and which remain with their existing owners.

## Prior Advice and Decisions Still Open

Oracle recommended removing obsolete research-start entry points and the completed local purpose backfill first; retiring old agent execution and corpus-review orchestration after narrowing the documented compatibility promise; and retaining the two research conversations on Workbench v4 for now. This is advice, not approval to change the compatibility contract, migrate or purge records, or retire qualification comparisons. Current AI SDK documentary checks, shared preparation primitives, and Sources recovery reattachment must be distinguished from obsolete execution.

The November 22 local audit counted 244 dossiers, 76 Pi missions, 43 conversations, 153 preparation records, and 436 invocations. Both research conversations pinned Workbench v4; a research Sources mission pinned v4. All 144 non-mission preparation records belonged to tests/evaluations. These are dated observations, not a current deployment inventory or evidence about production. Pending scheduled calls and Workflow component state were not fully inventoried.

The November 24 code check found that `confirmAndStartReserved` now rejects fresh non-framed creation with `framing_required` after its idempotent replay lookup. The earlier finding that fresh calls start the retired workflow must not be repeated as current fact. Research must refresh the remaining retirement candidates and distinguish obsolete interfaces, permitted historical replay, and active execution.

## Source Pointers

- Repository: `/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto`; branch at intake: `sources-workflow-no-legacy`.
- Contracts: `PRODUCT.md`, `context/TECH.md`, `docs/ROADMAP.md`.
- Version owners/callers: `convex/execution/agentCatalog.ts`, `convex/execution/missions.ts`, `convex/execution/conversations.ts`, `convex/qualificationAgentMethods.ts`, `convex/domain/workbenchAgent.ts`, `convex/domain/sourcesAgent.ts`.
- Retirement candidates: `convex/researchLaunch.ts`, `convex/workflowControls.ts`, `convex/domain/runPurpose.ts`, `convex/adminOperations.ts`, `convex/researchWorkflow.ts`, `convex/sourcePreparationWorkflow.ts`.
- Existing local implementation plan: `.implementation-plans/2026-11-22-sources-harness-review-fixes.md`; its work is separate from this new scope.
- Oracle consultation: [Oracle: concrete legacy retirement sequence](t3-thread://v2/fd444fb6-ad2f-436e-94ed-43654c2044a4/thread:delegated-task:command%3Amcp%3A5d450d96-17cd-4eaf-bad4-30495243a65f%3Adelegate-task%3Afc35aaea-221f-4cc7-9339-74b41e7d589a).

## Scope Boundary

Research and technical design are authorized. Preserve unrelated work and existing records. Production changes, deployment, data migration/deletion, commits, and further delegation are not authorized by selecting this flow. Refresh deployment facts only through available authorized read-only access; report unavailable evidence explicitly.
