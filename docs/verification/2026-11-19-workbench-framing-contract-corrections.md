# Workbench Framing Contract Correction Verification

November 19 follow-up: subsequent qualification exposed deterministic gaps beyond this original test coverage. The [final correction validation](2026-11-19-framing-harness-final-validation.md) records the additional shared fixes, passing checks and local publication. The original evidence below is preserved and does not establish live semantic acceptance.

Date: November 19, 2026. Scope: local implementation on `sources-workflow-no-legacy`, from baseline `64e8c2287fc090091a524dd8c9272ffe87314806`. The task diff remains uncommitted. The [technical contract](../../context/TECH.md#public-context-during-framing) owns behavior; this report records evidence and limits.

## Corrected behavior

Provenance failures identify the faulty field without accepting fabricated excerpts or weakening reading, revision or analyst-edit authority. Workbench v6 requires a saved scope and questions for the initial framing delivery when edits remain authorized; missing programs use the existing native completion correction. Analyst drafts, explicit preservation, later discussion and retained v4/v5 contracts are preserved. Completion neither starts research nor consumes an analysis.

V6 search applies the existing Sources coverage orientation before provider admission, with a specific-purpose focus override and the existing 512-character query boundary. The retained provider query matches the outgoing query. Old search schemas and reading paths retain their semantics. Conditional inquiry instructions distinguish a possible event from the economic consequence to investigate, preserve message dates and prohibit substituting the latest announcement for unresolved intent. No deterministic check of semantic relevance was added.

## Regression evidence

The initial RED tests reproduced absent field feedback, publication of prose with empty saved framing, and unoriented provider queries for all three presets. Field diagnostics then passed through the real operation boundary and scripted native correction. The initial completion regression failed with `completed` instead of `completion_correction_required`; the corrected path retains the rejected draft, saves a provisional program and publishes one final response, including when retrieval is unavailable.

Integration checks cover analyst edits, preservation steering, later discussion, cancellation and Start during correction, shared non-progress containment, all three presets, an official-source override, the oriented query boundary, invalid and forged legacy focus, separate adopted readings and retained versions. The pre-existing Sources admission tests cover default, overridden and absent preset policies. Tests import real Convex modules and native SDK code; only external transport and test time are controlled.

The final 14-suite candidate battery passed 236 tests. After review identified a missing evidence case, one additional native regression exhausted the already-pinned cumulative work allowance during initial correction: it retained the correction and draft, stopped with `work_budget_exhausted`, made no second provider call and published no answer. This added no limit or production change. The final native-suite rerun passed all 53 tests, bringing the covered set to 237 distinct passing tests. Tests deselected by focused `-t` commands are not disabled tests.

The candidate battery used:

```sh
pnpm exec vitest run \
  src/__tests__/convex/execution/workbench-framing-completion.test.ts \
  src/__tests__/convex/execution/workbench-framing-receipts.test.ts \
  src/__tests__/convex/execution/workbench-native-interface.test.ts \
  src/__tests__/convex/integrations/workbench-public-context.test.ts \
  src/__tests__/convex/sources/sources-discovery.test.ts \
  src/__tests__/convex/sources/sources-mission.test.ts \
  src/__tests__/convex/execution/workbench-authority.test.ts \
  src/__tests__/convex/execution/response-control-eligibility.test.ts \
  src/__tests__/convex/research-runs/framing.test.ts \
  src/__tests__/convex/execution/operation-conformance.test.ts \
  src/__tests__/convex/execution/shared-recovery.test.ts \
  src/__tests__/convex/execution/pi-input-capacity.test.ts \
  src/__tests__/lib/presentation/workbench.test.ts \
  src/__tests__/lib/presentation/research-copy.test.ts
```

`pnpm typecheck` passed both frontend and backend checks; subsequent test-only changes passed `pnpm exec tsc --noEmit`. Changed-file Biome formatting, lint and import organization passed on 19 TypeScript files. `scripts/check-imports.ts`, `scripts/check-execution-boundaries.ts` and `git diff --check` passed. Fixture input profiles were regenerated through their owning test and the final battery verified them without UPDATE. `pnpm docs:check` passed; TECH's word-count warning remains advisory. No dependency or resource-policy change was made.

The primary checkout initially had no managed backend. Its single `pnpm convex:dev` watcher published successfully on port 3210 at 13:36:33 local time and again at 13:40:16 after import organization. The running service identity matches this checkout and remains available. Node's experimental localStorage warning, Convex update/AI-file notices and the typecheck-duration notice did not prevent publication; no suggested upgrades were applied. The publication check changed no provider or evaluation flags.

One fresh, read-only correctness reviewer returned **APPROVE**, with no supported findings. The reviewer independently ran 60 completion/public-context tests, five selected native correction/provenance tests and the task whitespace check, and inspected the supplemental exhaustion test and passing result. Broader validation was inspected from retained evidence rather than independently repeated. The review excludes live semantic quality, browser behavior and CI.

Documentation review kept technical obligations in TECH and delivery state in ROADMAP. The earlier qualification report received only a dated follow-up; its pre-existing content and unrelated configuration edits were hash-verified as preserved. Frozen decisions, raw evidence and product requirements were not rewritten.

## Qualification boundary

These checks establish execution contracts, not live-model semantic quality. No paid model/retrieval run, browser inspection, browser E2E or CI run was performed for this lot. Fixture input profiles are generated offline; deployment model profiles still require the existing offline preparation owner before a later authorized qualification. Local publication, when verified, proves installation rather than a real-provider response.

Keep the six original Workbench-only cases: supplied H20 filing, CCC Balanced, CCC First-party depth, CCC Independent scrutiny, unavailable retrieval and undated support. Preserve their original messages/dates, four live-retrieval cases and two adverse conditions, stopping before Start. The earlier ambiguous NVIDIA crisis example is separate and must not replace a case. A future paid mandate must pin the reviewed candidate, supported model/effort, retrieval boundaries and cumulative envelope.

For each case, inspect the original request, actual serialized input, searches/readings, refusals/corrections, saved program and published answer. Acceptance requires a usable saved program or genuine technical inability, dated-request relevance, no unsupported event substitution, questions that do not assume their answer, preset-guided choices or an explained specific-purpose exception, and no automatic Start. Unavailable retrieval still permits a provisional program when authority and capacity permit. Technical containment is a partial outcome, not task success; query wording and publisher hostname do not prove independent material. Keep contradictory results, uncertain costs and unrun cases explicit.

## Qualification preflight follow-up

The first authorized qualification attempt on November 19 stopped before lot admission. Its broader preflight found one obsolete default-version assertion and two continuity tests whose fixture explicitly repinned new conversations to v5 while the assertions expected the current definition. The assertion now expects v6; the two continuity tests use the fixture's existing no-repin option so they exercise the production-created version. No production behavior changed.

A subsequent preflight exposed an independent scheduling race in the Sources simulation test: it manually dispatched operations while real timers could also wake the native mission, which had no configured model route. Letting the scheduler run for 100 ms between discovery and acquisition reproduced `missing_authorized_route`. The temporary delay was removed; the test now controls timers before fixture creation and continues to execute the real operations explicitly. Its full discovery, acquisition, reading, control and zero-paid-receipt assertions remain intact.

The three affected suites passed all 20 tests. The existing qualification validator then passed all six gates on candidate `5f266eadf4579f1d28b74c2dfb51570ba624b7c1e9cf06820b30b2b55efa83f3`: types, 224 protocol tests, 209 domain tests, scoped lint, imports and execution ownership. These checks supplement rather than replace the implementation evidence above. The failed preflights and timing probe remain in the local evaluation directory `~/.cache/workbench-evaluations/framing-contract-corrections-20261119/`; the original campaign was closed with zero lots, calls, searches, acquisitions and allocated dollars. This follow-up does not establish live semantic quality.
