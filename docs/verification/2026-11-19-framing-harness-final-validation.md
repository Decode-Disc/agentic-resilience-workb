# Framing harness final validation

November 19 follow-up: the [subsequent six-case qualification](2026-11-19-framing-harness-requalification.md) records live results on the corrected harness, remaining semantic failures and a diagnosed automated-review interruption. The verification below remains the deterministic evidence for the correction paths.

Date: November 19, 2026. Reviewed checkout: `sources-workflow-no-legacy`, with uncommitted corrections over `5d7e35b1`. This report supplements the [failed qualification](2026-11-19-workbench-framing-requalification.md) and [earlier implementation verification](2026-11-19-workbench-framing-contract-corrections.md). Current contracts remain in [TECH](../../context/TECH.md#public-context-during-framing), with acceptance state in [ROADMAP](../ROADMAP.md#phase-6--framing-and-controlled-transition).

## Disposition

The approved deterministic corrections passed focused verification and were published to the existing local backend. No blocking defect was found in the reviewed correction paths. This was a direct review of implementation and tests, not another delegated review or live semantic qualification. No production code was changed during final verification.

Initial v6 open framing refuses an absent activity anchor without saving a generic replacement. The tests cover bare open proposals and proposals with conditional questions, draft preservation after refusal, and a corrected write preserving the proposed scope. Retained v4 and bare v5 fallback behavior remains intentionally unchanged; this report does not accept that behavior against the current product target.

Shared input diagnostics identify malformed nested public reading references, missing candidate search identifiers and missing existing-need identifiers. A native Pi continuation fixture verifies the actual refusal path and a corrected response that saves the scope, common question and public reading association. The provider response is simulated: this proves transport, continuation and persistence, not that a live model will choose the same recovery.

Normalization refusals preserve `documentary_need_not_observed`, `instruction_not_observed` and `qualification_observation_unavailable` through admission, stored request and dispatch to model-facing diagnostics. The retained automated-review failure diagnostics in `5d7e35b1` are included in the passing review suite; no interrupted provider request was replayed.

## Checks executed

The following focused battery passed all 179 tests in nine files, with no failed or skipped tests in this run:

```sh
pnpm exec vitest run \
  src/__tests__/convex/execution/workbench-framing-receipts.test.ts \
  src/__tests__/convex/execution/workbench-native-interface.test.ts \
  src/__tests__/convex/execution/workbench-prepared-material.test.ts \
  src/__tests__/convex/sources/sources-diagnostics.test.ts \
  src/__tests__/convex/execution/workbench-framing-completion.test.ts \
  src/__tests__/convex/execution/operation-result-contracts.test.ts \
  src/__tests__/convex/execution/operation-conformance.test.ts \
  src/__tests__/convex/execution/pi-input-capacity.test.ts \
  src/__tests__/convex/execution/qualification-review.test.ts
```

`pnpm typecheck`, Biome check on the twelve correction TypeScript files, the import checker, execution ownership checker, `pnpm resource-policy:check`, `pnpm docs:check` and `git diff --check` passed. Profile verification ran without regeneration. `pnpm build` passed for client and server; it was included because the corrections touch shared execution contracts and their consumers. The full project test suite, aggregate `pnpm check` and CI were not run.

Historical RED evidence was inspected for the initial open write (unexpected success instead of refusal), nested union feedback (`eventBasis.kind` instead of the malformed reading reference), and Workbench normalization (`invalid_operation_input` instead of `documentary_need_not_observed`). Those failures came from the implementation session; this run independently establishes GREEN without reverting code to repeat RED. The RED commands used the corresponding suites with `-t "initial open framing refuses missing activityExcerpt"`, `-t "discriminated union operation inputs report the failing nested field"`, and `-t "normalization refusals preserve domain refusal codes"`.

## Local publication

The existing watcher and backend belong to this checkout. The local selector, configured identity and port matched `local-aboul_panga-dd_proto` at `http://127.0.0.1:3210`, with no conflicting ambient selector or deployment key. `pnpm convex:sync --url http://127.0.0.1:3210` completed schema validation, binding generation, backend typechecking and function publication without starting another watcher or deleting indexes. Generated bindings and the route tree had no resulting diff.

A subsequent authenticated read-only query of `execution/piControl:publicationStatus` returned `held: false` and `hasActiveWorkers: false`. The watcher was preserved. Publication establishes installation; business behavior was exercised through real Convex operations in deterministic integration tests, not a new live dossier.

Non-blocking notices included TECH's word-count advisory, the build's plugin timing notice, Node's localStorage experimental warning during publication, and Convex's typecheck-duration notice. No dependency or resource-limit change was made to suppress them.

## Design and documentation review

The correction remains at the existing framing writer, shared validation feedback and invocation admission owners. Convex's validator still decides structural validity; the additional schema traversal selects a diagnostic after failure. No second retry loop, semantic controller, execution authority, speculative registry or per-operation copy of the diagnostic algorithm was introduced. Domain correction wording stays in agent definitions. No structural refactor was needed for final verification.

Earlier reports retain their evidence and receive dated follow-up links. This report records verification rather than creating a normative contract. TECH and ROADMAP already distinguish strict v6 anchoring, shared diagnostics, retained compatibility paths and pending semantic qualification.

## Remaining limits

The approved semantic approach consists of clearer v6 instructions and actionable recovery, without an additional semantic gate. Relevance, entailment, source selection and live-model preservation of public associations still require a separately authorized fixed-battery qualification. This verification performed no paid inference or retrieval, browser/E2E scenario, live Sources handoff, cloud deployment, commit or push. Passing fixture-driven recovery does not turn the failed live examples into accepted semantic results.
