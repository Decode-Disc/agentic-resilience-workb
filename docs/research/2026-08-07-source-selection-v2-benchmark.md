# Source Selection v2 Benchmark

> **Historical record.** Preserve the observations and limitations below. Its status, requirements and permissions describe that checkpoint, not current authority. Use the [current document owners](../../AGENTS.md#document-authority-and-required-reading) and [delivery roadmap](../ROADMAP.md); no historical budget or execution permission is renewed.

## Status

Historical metadata-policy v2 benchmark. At this checkpoint, the offline fixture was complete and live acquisition awaited explicit provider opt-in and manual scoring. The thresholds and source-role labels below belong to that policy and corpus; they are not current acceptance criteria for content-based preparation. [ADR-024](../decisions/024-qualify-source-content-before-corpus-approval.md), [ADR-025](../decisions/025-use-versioned-scoped-evidence-retrieval.md) and the [recorded evaluation state](../../scripts/evaluations/source-selection/README.md#recorded-evaluation-state-2026-10-22) describe later work and its limits. Preserve the original benchmark without treating its command as authorization for a new live run.

## Objective

Measure whether the metadata-only v2 policy avoids recommending prohibited or redundant candidates while retaining the document roles an analyst would expect in a credible corpus.

## Frozen Corpus

`src/__tests__/benchmarks/source-selection-v2-existing-corpus.ts` contains a normalized snapshot of all 110 candidates present in the local prototype on 2026-08-07: 24 CCC balanced candidates and three ServiceNow pools containing 27 balanced, 28 balanced and 31 first-party-depth candidates. Convex IDs and timestamps that do not affect policy behavior are replaced by stable fixture keys. Must-include expectations use explicit typed role-event identities; prose justifications are display-only and never define the metric. Alternate URLs for the same event share one obligation, while distinct events with the same prose remain separate. Three Community rows previously labelled must-include were corrected to explicit exclusions because ADR-018 requires Community content to remain an inspectable Alternative. Existing v1 proposal dispositions are not used as ground truth.

The offline evaluator enforces zero prohibited recommendations, zero duplicate recommendations, a coverage contribution for every recommendation, no more than one `needs_attention` item per pool, at least 95% recommendation precision and at least 90% typed must-include role-event recall. The corrected frozen corpus contains 37 unique role-event obligations and the policy satisfies all 37. As a stricter diagnostic, it recommends 37 of the 39 candidate rows attached to those obligations (94.9%); the two omitted rows are alternate URLs for already-satisfied Q2 results events. The policy recommends 44 candidates overall with 100% measured precision on this fixture.

## Live Harness

The opt-in harness covers ServiceNow, CCC, Microsoft, Cloudflare and Shopify using SEC CIK as the stable identity key. It performs metadata-only acquisition, writes no Convex data, allows one SEC submissions request per company and caps total Exa physical requests at 30. Raw responses, normalized batches, request counts and an empty manual scorecard are written only under `/tmp/agentic-resilience-source-selection-v2-benchmark/<timestamp>/`.

Run it only with both opt-ins: `RUN_LIVE_PROVIDER_TESTS=1 RUN_SOURCE_SELECTION_BENCHMARK=1 pnpm exec vitest run src/__tests__/live/source-selection-v2-benchmark.contract.test.ts`.

The live harness is observational until a reviewer completes the emitted scorecard. Precision and recall must not be claimed from unlabeled fresh results.
