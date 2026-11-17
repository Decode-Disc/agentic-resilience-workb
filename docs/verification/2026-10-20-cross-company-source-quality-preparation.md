# Cross-company source-quality comparison: offline preparation

> **Dated evidence.** Preserve the observations and limitations below. Its status, requirements and permissions describe that checkpoint, not current authority. Use the [current document owners](../../AGENTS.md#document-authority-and-required-reading) and [delivery roadmap](../ROADMAP.md); no historical budget or execution permission is renewed.

Date: 2026-10-20. Status: prepared, no inference performed, no semantic acceptance.

## Authorized result

The comparison extends the evaluation surface beyond the repeatedly inspected ServiceNow examples. It prepares a fixed 32-document public corpus, 16 targeted controls, a pre-inference investigator reference, five-model common decision tasks, and separate tests through the existing grouped qualification and comparison adapters. It does not establish generalization merely by adding companies. The study can support a narrower transfer finding or remain inconclusive.

The [study README](../../scripts/evaluations/source-selection/fixtures/cross-company-20261020/README.md) owns the exact manifest identifier, reservations, corpus provenance, conditions, commands, review procedure, and paid-dispatch gate. The ready manifest (`scripts/evaluations/source-selection/fixtures/cross-company-20261020/runs/ready/manifest.json`, local reference as of 2026-10-22; not included in checkpoint `c4f0d24`) binds the corpus, reference, code, official tariff snapshot, and all 416 serialized provider requests. There is no authorization file and no inference journal. Actual inference attempts, charged inference cost, and application writes are all zero.

The original implementation goal remains paused. This evaluation does not activate a model, modify provider routing, deploy, commit, publish, or modify production/configuration/application data. GPT-6 Luna Decisions is excluded from prototype integration. The withdrawn four-call proposal and historical spending allowances remain separate.

## Changed boundaries

- The three existing evaluation entrypoints accept a study mode and retain their previous modes. Default behavior stays offline. The historical comparison's default dry-run output is byte-identical to its captured baseline.
- `source-quality-study.ts` owns corpus/reference validation, production input preparation, fixed-choice tasks, cohort assignment, request limits, and offline scoring. `decision-protocol.ts` centralizes the existing strict answer parser and correctly routes all three decision models to native endpoints.
- `study-cli.ts` captures real SDK request bodies through an injected offline transport. Paid dispatch requires an exact-manifest approval, a sufficiently fresh official catalog, a whole-lot budget, a shared exclusive execution lock, and a durable attempt ledger. No automatic retry or fallback is enabled. A worker failure cancels further work and waits for all in-flight workers before execution ownership can be released.
- `evaluation-records.ts` rejects orphan or duplicate result records, preserving conservative treatment of unresolved external outcomes. The reference separates common tasks supplied with investigator-selected primary passages from grouped tasks using production retrieval alone.
- The new fixture contains normalized captures, raw responses, collection failures, immutable input hashes, exact reference quotations, and an empty-result preparation report. Earlier zero-inference preparation versions remain archived with hashes. Existing historical evaluation records and unrelated working-tree changes were preserved.

No production implementation, database, deployment configuration, credentials, dependency manifest, or lockfile was edited by this work. No agent was spawned. No existing local service was restarted or stopped.

## Verification performed

All commands ran from the repository. The installed global pnpm launcher stalled while resolving its executable. Checks used the already cached exact project pnpm 10.20.0 through a task-local PATH shim. No dependency installation or package-manager upgrade occurred.

| Check | Result |
| --- | --- |
| `pnpm test src/__tests__/benchmarks/source-quality-study.test.ts` | 18 tests passed, including the final worker-settlement correction |
| `pnpm test src/__tests__/convex/integrations/source-qualification-transport.test.ts src/__tests__/convex/integrations/source-comparison-transport.test.ts` | 14 existing transport tests passed |
| `pnpm typecheck` | Client/scripts and Convex checks passed |
| `pnpm exec tsc --noEmit` after the final executor edit | Passed, rechecks the changed script boundary |
| Scoped `pnpm exec biome check` | Nine task files passed, then the two subsequently changed files passed again |
| `node --experimental-strip-types scripts/check-imports.ts` | Passed |
| Three entrypoints against the frozen ready study | Offline manifests agree, 416 planned attempts, no blockers, zero provider requests |
| Offline summary | 416 not-run observations, zero semantic errors attributed to missing responses, `semanticAcceptance: not_evaluated` |
| Historical default dry-run comparison | `cmp` against pre-change capture passed |
| `pnpm check` | Design synchronization and both typechecks passed, then lint failed outside this change |

The repository-wide lint failure is `lint/suspicious/noArrayIndexKey` in `src/components/workbench-shell/analyzed-company-list.tsx:114`. That component was not edited. The chained repository-wide format check, full test suite, and build were not reached. They are not reported as passing. No browser check was performed because this work changes evaluation tooling and artifacts rather than user-facing surfaces.

Meaningful RED/GREEN evidence includes native Luna routing, orphaned ledger results, missing-reference accounting, unsupported CLI options, fresh equal-or-lower quote reuse, duplicate logical controls, cohort-label leakage, not-run/unusable/wrong-answer separation, and the in-flight-worker completion boundary. The worker regression failed because the old `Promise.all` boundary finished while another worker was still running. The corrected boundary cancels further dispatch, awaits all settlements, then propagates the failure.

Logs are in the fixture's `evidence/verification/` directory. Collection failures and superseded preparation artifacts are retained as evidence rather than counted as successful evaluation.

## Remaining uncertainty and next decision

There are no model-quality results yet. Request acceptance, route availability, measured latency, actual inference cost, native probability behavior, and semantic adequacy require the separately authorized lot. Offline capture and tests do not prove provider acceptance. The archived tariff snapshot is a quote basis, not a claim of current pricing. Refresh official model/route metadata before dispatch and stop for a changed provider or a higher quote.

The assistant-authored reference is inspectable but not independent human ground truth. Its input-contract revision was completed before inference. The revision removes benchmark cohort metadata from model context and corrects a grouped Snowflake capability expectation against an already supplied annual-report passage. Common semantic instructions and source-selection decisions were not tuned using model responses. Exact citation localization does not measure semantic retrieval recall. Constructed comparison contributions do not demonstrate an autonomous extraction-to-comparison chain.

After an authorized run, review semantic outputs and disagreements separately from availability/schema failures, inspect company-level and task-level differences, and keep ServiceNow regression and sensitivity results separate from held-out results. Report uncertainty rather than selecting a model automatically. A single captured multi-company corpus does not prove robustness to future source changes. Any integration choice remains a subsequent user decision.

The next approval concerns only the new exact-manifest lot of at most 416 attempts and at most USD 3.00, with the original implementation goal still paused. This document proposes that approval boundary and does not grant it.
