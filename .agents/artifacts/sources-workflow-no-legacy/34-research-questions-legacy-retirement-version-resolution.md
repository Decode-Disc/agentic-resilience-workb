---
type: research-questions
repos:
  - identifier: agentic-resilience-workbench-proto
    sha: "0bac64351157f700ad944b12e0fbf2e0ef24b9ba"
flow: tdd
---

# Research Questions: Legacy Retirement and Agent Version Resolution

## Context

Use [the request](33-request-legacy-retirement-version-resolution.md) for the desired change, dated audit evidence, and unresolved decisions. Research describes the current system; the later technical design decides ownership and retirement. Start from the repository at the recorded revision and identify intervening changes before relying on prior findings.

## Questions

1. **Where is the effective agent definition selected today?** Trace default registration, explicit-version lookup, backend compatibility, conversation creation, turn admission, mission creation, child missions, resume/recovery, and qualification overrides. What precedence does each path use, where is the selected version persisted, and which callers duplicate that rule or supply a literal/default independently? Start with `convex/execution/agentCatalog.ts`, `missions.ts`, `conversations.ts`, `handoffs.ts`, `piControl.ts`, and `convex/qualificationAgentMethods.ts`. Produce a compact caller → selection rule → persisted pin → consumer map.

2. **Which version identities must agree, and which evolve independently?** Follow agent-definition pins into operation schemas and receipts, completion transport, framing acknowledgements, saved-material bindings, skill packages, model preparation, and input-profile generation. How are mismatches, absent pins, unavailable definitions, and unsupported backends handled? Start with `convex/execution/agentDefinition.ts`, `executionProtocol.ts`, `operationContracts.ts`, `convex/framing.ts`, `convex/domain/savedMaterialOperations.ts`, `convex/integrations/modelInput.ts`, `piModelProfiles.ts`, and `src/__tests__/convex/execution/pi-input-capacity.test.ts`.

3. **What remains of the obsolete research-start path at the current revision?** Trace fresh requests and idempotent replay separately through `convex/researchLaunch.ts`, `convex/framing.ts`, and `convex/workflowControls.ts`. Which UI, type-only, test, internal, or scheduled consumers still reference each entry point? What state/quota behavior is enforced now, including `framing_required`, withdrawal, concurrent starts, missing Sources configuration, and manual-reference ownership? Start with `src/lib/presentation/research-copy.ts` and the research-launch, framing, and workspace-separation tests.

4. **Which legacy execution paths remain reachable, and which code is shared with current work?** Trace the old mission driver and backend fallback separately from current AI SDK one-shot documentary checks. Trace corpus-review preparation separately from Sources mission claim, instructions, intake, and recovery reattachment. Start with `convex/execution/missionWorkflow.ts`, `invokeAgentModel.ts`, `convex/integrations/agentBackends.ts`, `modelTransport.ts`, `convex/researchWorkflow.ts`, `sourcePreparation.ts`, `sourcePreparationWorkflow.ts`, `sourceSelectionProposalActions.ts`, `sourcesMission.ts`, `runRecovery.ts`, and `sources/examineContributions.ts`. Record concrete callers rather than classifying code by its name.

5. **What retained state currently depends on each old definition or executable target?** For each accessible deployment, inventory continuing conversations, resumable missions, unfinished operations, scheduled function targets, Workflow state, and qualification comparisons. Distinguish research from technical fixtures, terminal history from executable work, and unstarted framing from legacy execution. Recheck the November 22 counts only where authorized access exists; local absence does not establish production absence. Identify how read-only history and continued execution depend on different code.

6. **What remains of the run-purpose migration and its consumers?** Is `purpose` required in the current schema and populated in accessible records? Which production callers, local-only guards, tests, or operational procedures use `classifyRunPurpose`, `previewRunPurposes`, and `migrateRunPurposes`? Which validator/type and workspace/quota rules remain current? Start with `convex/domain/runPurpose.ts`, `convex/adminOperations.ts`, `convex/schema.ts`, and `src/__tests__/convex/research-runs/run-workspace-separation.test.ts`.

7. **Which existing checks establish version consistency and safe retirement, and where are the gaps?** Locate integration coverage for new/default selection, pinned continuation, authorized comparison versions, child missions, missing/unknown versions, and receipt replay. Which tests obtain their version from the actually admitted mission, and which freeze incidental literals? Also map launch/quota, withdrawal, Pi recovery, one-shot accounting, and Sources reattachment coverage. Separate observed test results from inspected assertions and identify documented compatibility promises that require an explicit decision before removal. Start with `src/__tests__/convex/execution/`, `src/__tests__/convex/research-runs/`, `context/TECH.md`, and `docs/ROADMAP.md`.

## Research Output

Return the version-selection map, an executable/read-only/shared dependency inventory, dated deployment evidence with access limits, and focused test gaps. Keep retirement recommendations from the earlier Oracle consultation identifiable as proposals. Do not implement, migrate records, silently upgrade pins, or settle the open compatibility decisions during research.
