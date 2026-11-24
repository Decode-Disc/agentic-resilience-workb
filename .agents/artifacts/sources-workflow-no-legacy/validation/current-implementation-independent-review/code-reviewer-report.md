# Independent Code Reviewer Report

Profile: native Codex Code Reviewer, GPT-6.1 Sol, xhigh. Required procedures: `tdd` and `code-smell-guardrails`. This record preserves all findings, conclusions and verification limits from the final reviewer message.

## Verdict

REQUEST CHANGES. The initial Sources harness contracts have strong integration coverage, and the generated-response storage extension passes focused regressions. One cleanup defect remains; one original performance-verification obligation is not fully evidenced.

Reviewed content started at `09b1fff5` plus 31 storage-change paths and ended at clean `e8e32ec11983d06a91b582c820e6f097360a35f9`. The parent confirmed all 509 recorded source/test/config fingerprints were unchanged by the concurrent commit. The reviewer made no edits, probes, commits or external calls.

## Medium — Blocking: Purge stops inspecting payloads after the first 100 invocations

`convex/dossierPurge.ts:317` selects the same first `DOSSIER_PURGE_BATCH` parent invocations on every iteration. Once those parents have no payloads, the step returns false; the action advances permanently to later steps at `dossierPurge.ts:615`. Payloads and retained fragments belonging to later invocations remain after their invocation and dossier are deleted. Session cleanup has the same bounded-parent traversal at `dossierPurge.ts:292`.

This traversal defect predates the storage extension but prevents its fragmented-payload cleanup claim from being complete. The new purge test uses one invocation at `src/__tests__/convex/execution/large-response.test.ts:255`. Remedy: traverse all parents with a continuation, or delete each parent only after its owned children and fragments have been removed; test 101 invocations with payloads beyond the first batch and apply the same traversal correction to sessions. Source-confirmed, not reproduced: adding a probe/test was prohibited for this read-only reviewer.

## Medium — Watch: Projection-cost acceptance uses synthetic preparation data

The benchmark at `src/__tests__/convex/execution/research-state.test.ts:1103` seeds five captures. `convex/fixtures/researchState.ts:48` constructs repeated captures and example.com sources. This is useful executable coverage but does not establish the approved before/after measurement on retained preparation data or retained legacy cursor-ancestry cost required by TDD 29:239. Implementation record 32:43 nevertheless closes the projection-cost watch.

Retain the synthetic regression, identify its limits and leave acceptance open until those bounded measurements exist. This is an evidence gap, not a demonstrated projection malfunction.

## Sources and Storage Assessment

The reviewer inspected current progress/effective-use projections, action applicability, completed/pending historical consultation, history ancestry/sizing, native completion schema/raw arguments, sole-call admission, domain freshness/correction, terminal recovery and profile preservation/refresh. Exercised tests assert meaningful persisted outcomes: effective-use categories and restrictions, pending/settled membership, exact history reconstruction, Unicode/escaping and wrapper boundaries, malformed/missing completion arguments, mixed/duplicate rounds, late work, repeated corrections, cancellation, four crash boundaries, settlement exhaustion and no duplicate effects/accounting. Approved legacy retirement supersedes the earlier promise to execute retired backends.

Storage review covered fragmentation and consumers, replay conflicts, publication reconstruction, previews, correction drafts and purge. Regressions execute real Convex functions/schema/component storage for 65,537-byte and 1,100,001-byte replies under transaction limits. The native Workbench case verifies published text and provider accounting.

## Executed Verification

All commands used one worker and simulated external HTTP only:

```sh
pnpm exec vitest run src/__tests__/convex/execution/{large-response,mission-history,history-read-cost}.test.ts src/__tests__/convex/sources/{sources-completion,sources-completion-correction,sources-completion-freshness}.test.ts --maxWorkers=1
# 45 passed, 6 files
pnpm exec vitest run src/__tests__/convex/execution/{pi-recovery,pi-native-transport,research-state}.test.ts src/__tests__/convex/admin/model-configuration.test.ts --maxWorkers=1
# 173 passed, 4 files
pnpm exec vitest run src/__tests__/convex/execution/{pi-input-capacity,model-action,response-control,conversation-history}.test.ts src/__tests__/convex/sources/sources-instruction-capacity.test.ts --maxWorkers=1
# 68 passed, 5 files
HARNESS_REAL_TRAVERSAL_INPUT=.agents/artifacts/sources-workflow-no-legacy/validation/sources-harness-efficiency-impl/real-traversal-payloads.json pnpm exec vitest run src/__tests__/convex/execution/history-read-cost.test.ts -t 'supplied retained traversal' --maxWorkers=1
# Selected real-payload replay passed; three unrelated cases excluded
```

Total: 286 passing tests across 15 suites, plus the selected real-payload replay. Focused Biome lint passed on 19 production/test files and `git diff --check` passed. Independent artifact comparison found all 1,362 baseline profile keys preserved unchanged under the same SDK tuple.

## TDD, Design Quality and Limits

Historical RED and mutation outcomes remain recorded evidence; the reviewer did not rerun them or revert production code. Current passing tests do not prove historical development order. Crash wrappers preserve real internal execution while injecting faults. No copied production implementations or mocked internal business outcomes were found in inspected coverage.

The new helpers encapsulate actual storage, validation and reconstruction. No additional actionable shallow-wrapper, speculative-abstraction or masking-fallback issue was found. Cursor resolution and profile carry-forward preserve explicit failure rather than substituting another path.

No typecheck, full suite, build, backend publication, browser/runtime verification or live model qualification ran in this review. Historical results remain separate evidence. The purge correction and missing performance evidence remain outstanding.
