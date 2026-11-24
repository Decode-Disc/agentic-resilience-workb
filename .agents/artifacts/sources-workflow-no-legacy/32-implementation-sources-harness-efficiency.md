---
type: implementation-result
flow: tdd
status: completed
---

# Sources harness efficiency implementation

All five phases of `31-structure-outline-sources-harness-efficiency.md` (implementing `29-tdd-sources-harness-efficiency.md` and closing all three Oracle watches from `30-review-sources-harness-efficiency.md`) are implemented on branch `sources-workflow-no-legacy` from base commit `6043a64af02577cb3aaf13eb2a3ce1e8804f7060`. No commit, push, dependency change, SDK patch, local backend publication, or paid live qualification was performed.

## Summary of changes by phase

### Phase 1 — Current Sources progress projection, `consult_run_state` v3, `action_not_applicable`, and profile carry-forward
- Added `sourcesPreparationProgressValidator` (`version: 1`, `handoff`, capture availability counts, recorded qualifications with all four `effectiveUses` categories, and reading-reference window completeness) and `projectSourcesPreparationProgress` in `convex/domain/sourcesContracts.ts` and `convex/domain/sources.ts`, exposed as optional `ResearchState.sources.progress` through `convex/domain/researchState.ts` and `convex/domain/researchStateContracts.ts`.
- Shared one transaction-local `SourceReviewReads` cache across `sourcesContext` (`convex/domain/sourcesAgent.ts`), `workbenchContext` (`convex/domain/workbenchContext.ts`), `documentaryInventory` (`convex/domain/savedMaterial.ts`), `suspendInterruptedResearch` (`convex/execution/researchControl.ts`), and `transitionResearchRun` (`convex/researchRuns.ts`, called from `convex/sourcesMission.ts`) so committed `sourceCaptures` are not re-read within a transaction (eliminating the 16 MiB Convex read-limit breach under the 48-large-capture stress test in `sources-instruction-capacity.test.ts`).
- Advanced `consult_run_state` to version 3 in `convex/execution/commonOperations.ts`, preserving byte-identical completed v2 receipt replay, `operation_version_conflict` refusal for pending v2 requests, and revoked-authority enforcement.
- Added `action_not_applicable` distinct from `human_prerequisite_required` in `convex/execution/researchControl.ts`, `convex/execution/approvalCatalog.ts`, `src/lib/presentation/approvals.ts`, and `src/components/workspace/approvals/connected-approval-card.tsx`.
- Added `mergeRetainedPiInputProfiles` in `convex/integrations/modelRouting.ts` and preserved the pre-edit baseline `validation/sources-harness-efficiency-impl/piInputProfiles.baseline.json` (SHA256 `26fe6a240513da070b6f3980dd659f8682e627c0055eeb502cca19f72215df75`).

### Phase 2 — 64 KiB history page capacity, 65,563-byte Pi tool output allowance, and resolved continuation pins
- Removed `MAX_HISTORY_RESULT_BYTES` and added `MAX_CONVERSATION_SCAN_BYTES = 512 * 1024` in `convex/resourcePolicy.ts`.
- Derived `MAX_MODEL_OPERATION_OUTPUT_BYTES = MAX_OPERATION_RESULT_BYTES + 27` (`65,563` bytes, exact `{"kind":"success","value":...}` wrapper overhead) in `convex/execution/agentDefinition.ts` and wired `outputLimits: { maxBytes: MAX_MODEL_OPERATION_OUTPUT_BYTES }` into `piToolMetadata` in `convex/integrations/modelInput.ts`.
- Updated `convex/execution/history.ts` and `convex/execution/journal.ts` to fill pages up to `MAX_OPERATION_RESULT_BYTES` (64 KiB) with Unicode-safe `fitHistoryContent` (verified via RED/GREEN and a falsification check), store resolved `frontier` and optional `targetReference` on continuation pins, and validate legacy predecessor ancestry chains without losing cross-mission targeted event identity.

### Phase 3 — Native `submit_completion` tool completion and structured terminal settlement recovery
- Added `SUBMIT_COMPLETION_TOOL = "submit_completion"`, `CompletionTransport = "native_tool"`, `SUBMIT_COMPLETION_DESCRIPTION`, `renderCompletionToolOutcome`, and `completion_must_be_sole_call` diagnostics in `convex/execution/agentDefinition.ts`, projecting `submit_completion` directly from `definition.completionValidator` without duplicating schemas.
- Extended `convex/execution/agentCatalog.ts` to reject reserved `submit_completion` operation-name collisions (`operation_definition_conflict`) and `native_tool` + `textCompletion` or non-object validator contradictions (`definition_contract_invalid`).
- Extended `convex/execution/executionProtocol.ts`, `convex/execution/invokeAgentModel.ts` (scoped to `pi-durable` so retained Workflow/`ai-sdk`/`convex-agent` backends keep JSON text decoding), and `convex/execution/invocationLifecycle.ts` for `completion_submission` (sole `submit_completion` adoption, text-only `call: null` completion correction, and mixed/duplicate `submit_completion` retained invalid-request refusal while executing authorized sibling operations once).
- Updated `convex/execution/context.ts`, `convex/integrations/modelInput.ts`, `convex/integrations/piModelProfiles.ts`, and `convex/execution/fixtures.ts` for `constraints.completion = { format: "tool", tool: "submit_completion" }` and `PI_NATIVE_COMPLETION_MISSION_INPUT`.
- Extended `convex/execution/piStore.ts`, `convex/execution/piControl.ts`, and `convex/integrations/piMission.ts` to register `submit_completion`, stop rebuilding inputs/tools after persisted `terminalCompletionAccepted`, renew/reopen terminal settlement leases on `native_tool` structured missions with bounded retry and `native_settlement_blocked` permanent failure, while preserving the cancelled non-conversation `piStore.writer` fence and conversation-only queue pause/pump behavior.
- Added `sourcesV8Definition` (v8, on `research-methods-v2`), `documentaryInspectionV4Definition` (v4), `conversationValidationV3Definition` (v3), and `executionValidationV3Definition` (v3), and included v8/v4 in `savedMaterialBinding` (`convex/domain/savedMaterialOperations.ts`).

### Phase 4 — Versioned default activation, deterministic offline profile regeneration, and DB profile refresh
- Activated Sources v8, saved-material inspection v4, conversation validation v3, and execution validation v3 as defaults in `convex/execution/agentCatalog.ts`, `convex/domain/sourcesAgent.ts`, `convex/domain/conversationValidation.ts`, and `convex/domain/executionValidationAgent.ts`, while retaining Sources v4/v5/v6/v7, inspection v2/v3, validation v2, and Workbench v12 unchanged.
- Regenerated `convex/integrations/piInputProfiles.json` deterministically via `UPDATE_PI_INPUT_PROFILES=1`: `1,362` baseline keys retained verbatim (`0` changed or missing), `2,680` newly measured keys added, `4,042` total keys, preserving the additive `profileCatalog` revision (`f08b8d0668cb288c42870e07491ebff37395cfd50a909cdb500a84228eec0b2a`).

### Phase 5 — Combined end-to-end verification and documentation alignment
- Added and passed the combined real-owner scenario in `src/__tests__/convex/sources/sources-completion.test.ts` exercising Sources v8 preparation of restricted material, pre-handoff Workbench progress observation, single-page targeted >45 KiB history retrieval, mixed premature completion refusal with single execution of authorized work, sole `submit_completion` acceptance, and crash-recovered native settlement.
- Updated `context/TECH.md`, `docs/ROADMAP.md`, and added a dated supersession note to `docs/brainstorming/question-led-workbench/2026-11-06-schema-enforced-model-output.md`.

## Offline measurements and Oracle watch closures

### 1. Projection read-cost watch — CLOSED
Preserved before/after measurements in `validation/sources-harness-efficiency-impl/projection-before.json` and `projection-after.json` (logical rows and serialized Convex bytes read across all `db.get`/`db.query` calls, with zero passage hydration):

| Consumer | Before (rows / bytes) | After (rows / bytes) |
| --- | --- | --- |
| `sourcesContext` | 57 rows / 31,582 B | 58 rows / 32,453 B |
| `workbenchContext` | 57 rows / 33,670 B | 57 rows / 34,617 B |
| `standaloneConsultation` (`consult_run_state`) | 4 rows / 3,249 B | 24 rows / 16,729 B |

In addition, sharing `SourceReviewReads` into `documentaryInventory` and `transitionResearchRun` verified that the 48-large-capture stress test (`sources-instruction-capacity.test.ts`) stays within Convex's 16 MiB per-transaction read ceiling across `processInstructions`, `invocations.begin`, and both `sourcesMission.finish` transitions.

### 2. History pagination measurements — VERIFIED
- Synthetic 44,418-character mission event (`history-read-cost.test.ts`): **12 → 1 consultation**, **13 → 3 documents read**, **572,299 → 88,046 payload bytes**, single page **45,682 result bytes** (`<= 65,536`).
- Real Traversal 0 (`validation/sources-harness-efficiency-impl/history-real-before.json` vs `history-real-after.json`, 27 real complete events from `sources-attribution-independence#traversal-0`): **5 → 2 consultations** (bounded by `HISTORY_PAGE_SIZE = 20`), **61,631 → 59,272 total response bytes**, `restoredHashesVerified: true`.

### 3. Structured terminal settlement watch — CLOSED
Verified in `src/__tests__/convex/execution/pi-recovery.test.ts`, `pi-native-transport.test.ts`, `sources-completion.test.ts`, `sources-completion-correction.test.ts`, and `sources-completion-freshness.test.ts` across all four crash boundaries (`generation_return`, `completion_tool_execution`, `tool_acknowledgement`, `worker_close`), stale writer rejection, revoked dossier authority, cancelled non-conversation `piStore.writer` fence, bounded retry exhaustion into permanent failure (`native_settlement_blocked`), and zero duplicate result/provider accounting.

### 4. Profile preservation and DB refresh watch — CLOSED
Verified in `src/__tests__/convex/execution/pi-input-capacity.test.ts` (`1,362` baseline keys identical, `2,680` new keys measured, `4,042` total; deterministic regeneration without `UPDATE_PI_INPUT_PROFILES`; explicit SDK mismatch and unmeasured-schema refusal) and `src/__tests__/convex/admin/model-configuration.test.ts` (both `unchanged_additive_catalog` and `changed_catalog_revision` modes fail explicitly with `model_input_profile_unavailable` before refresh and succeed after offline `api.modelConfigurationActions.refreshProfiles` without network I/O or altering selected model, reasoning preference/effort, or admitted mission pins).

## Executed verification evidence

- Focused Biome formatting and diagnostics on all explicit changed files: **0 errors, 0 warnings**.
- `pnpm agent-skills:check`: **passed**.
- `pnpm docs:check`: **passed** (74 Markdown files, 446 local links, 0 errors; `context/TECH.md` advisory word-count warning only).
- `pnpm design:check`: **passed**.
- `pnpm typecheck` (`tsc --noEmit && tsc --noEmit -p convex/tsconfig.json`): **passed** (0 errors).
- `pnpm lint` (`biome lint .`, `scripts/check-imports.ts`, `scripts/check-execution-boundaries.ts`, `pnpm resource-policy:check`): **passed**.
- `pnpm test` (`pnpm test:protocol` + full Vitest suite): **passed** (**362/362 test files**, **3,517/3,517 tests**).
- `pnpm build`: **passed** (`✓ built in 2.32s`).
- Note on `pnpm check` / `pnpm format:check`: `pnpm check` passed `agent-skills:check`, `docs:check`, `design:check`, `typecheck`, and `lint`, then stopped in `format:check` solely on one untouched pre-existing file from HEAD `6043a64a` (`src/__tests__/setup/fixtures/nvidia-citation-review.json`). That unrelated file was left untouched, and all remaining CI steps (`pnpm test` and `pnpm build`) were executed and passed.

## Documentation review

Reviewed `context/TECH.md`, `docs/ROADMAP.md`, and `docs/brainstorming/question-led-workbench/2026-11-06-schema-enforced-model-output.md` for necessity, single ownership, zero duplication, zero stale contradictions, single-line prose paragraphs, and zero links to ignored directories (`.agents/artifacts/**` or `.implementation-plans/**`). Historical verification reports (`docs/verification/**`) and frozen ADRs (`docs/decisions/**`) were preserved untouched.

## Remaining limits

- **Local backend publication / runtime verification**: Backend code was not pushed to the running local Convex deployment; a watcher/manual push (`pnpm convex:sync --url ...`) and an authorized zero-provider local fixture run remain outstanding and are not equated with `tsc` or `convex-test`.
- **Live semantic usefulness**: Deterministic integration, crash-recovery boundaries, and offline read-cost/history-pagination improvements do not establish live model semantic usefulness; any live qualification requires a separately authorized bounded mandate.

## Outcome notification

Confirmed receipt: `/home/abdwhb/.local/state/agent-stack/notify/220ceaf001fb9e1af5552883bc20a6dff4ae53e125d0aebdc1d4cba4c0e0739d.json`; project `agentic-resilience-workbench`, sender `Antigravity`, event `implementation-verified`, key `sources-harness-efficiency-v8-6043a64a`, base revision `6043a64af02577cb3aaf13eb2a3ce1e8804f7060`, message ID `1010`. Delivery configuration was not exposed.
