# Isolated Workflow upgrade measurement

The Workflow/Workpool dependency bundle reduced median warm native preparation replay time from 47.368 s to 42.224 s: 5.144 s saved, or 10.9%, at unchanged source concurrency 2. This is a modest coordination improvement, not evidence of faster fresh model qualification or comparison. The initial post-upgrade warmup was substantially slower and is retained separately below.

## Applied change

Starting from application commit `89b84fd`, upgrade Workflow 0.4.4 → 0.4.10, Workpool 0.4.8 → 0.4.14 and convex-test 0.0.54 → 0.0.62. Workpool adds nested Batch Worker 0.2.2; Convex remains 1.47.0. Live official npm metadata, integrity, peers and the seven-day release age were checked immediately before the targeted Socket Firewall installation. Existing dependency safety controls remain in place. Only the package manifest and lockfile changed in the frozen application code; preparation logic and concurrency configuration did not change.

`pnpm convex:sync --url http://127.0.0.1:3210` successfully published the components to the existing `local-aboul_panga-dd_proto` backend without deleting indexes or restarting its process. No cloud deployment occurred. `.env.local`, `.env.example` and the unrelated user-authored conception changes retained their hashes; the upgrade needs no new environment setting. Current product/technical references did not require revision because their contracts remain unchanged.

## Common workload

Use the existing guarded `sourcePreparationEvaluation` APIs and actual production durable workflow, with the admitted local visitor, `inline_controls_v2`, concurrency 2 and zero work/incident model allowances. Each stack runs one warmup and three measured preparations. Both use exactly the same 23 frozen full-document captures, recorded qualification responses and input hashes. The retained dossier's twenty-fourth, retrieved-selection document is excluded using the existing replay subset.

These are explicitly precomputed protocol-3 qualifications imported through the existing replay API with current input hashes. They do not establish fresh protocol-4 quality. Comparison is disabled in this fixture. Fixture import and client polling are excluded from elapsed time, which ends at persisted preparation completion. No heavy validation was deliberately run during the timed blocks. The host is shared and its unrelated load was not controlled; three sequential repetitions do not establish statistical confidence or cloud performance.

## Observations

| Metric | Before | After | Difference |
| --- | ---: | ---: | ---: |
| Warm total median | 47.368 s | 42.224 s | 10.9% faster |
| Reading and cached qualification median | 46.210 s | 41.273 s | 10.7% faster |
| Final proposal/control tail median | 0.837 s | 0.808 s | 29 ms; no meaningful gain established |
| Native scheduled invocations, median | 472 | 380 | 19.5% fewer |
| Internal successful-handler callbacks per run | 49 | 0 | Removed |
| Conflict/retry log entries, median | 63 | 23 | Fewer observed conflicts |
| Journal steps / scheduled journal steps | 97 / 49 | 97 / 49 | Unchanged |

Measured totals before: 51.895, 47.368, 46.462 s. After: 42.230, 42.224, 31.654 s. Warmups: 57.388 s before and 121.857 s after. The latter is a real adverse observation, excluded under the predeclared warmup protocol. Repeated deployment/first-run trials would be needed to attribute or generalize it.

All eight runs retain 23/23 qualified outcomes and identical normalized proposal business fields, including original source identities, ranks, dispositions, coverage and reasons. All finish paused with draft corpora and cleared workflow handles. No provider call was reserved or dispatched. Both original dossiers, their audited records and the visitor quota remain identical across the entire upgrade. All fixture flags were removed. Native log collection has no read failures or function errors within the measured windows. Invocation counts include polling/retries and a fixed two-second completion tail; they are not billing estimates.

## Validation and limits

`pnpm check` passed: documentation/design checks, application/backend typechecks, lint, formatting, 165 test files / 1,473 tests and client/server build. The test stage took 247.43 s with the repository's default workers and timeout. No compatibility patch, retry or relaxed configuration was needed. The existing technical-document word warning, existing Lucia deprecation and one pre-timing fixture-import duration warning are retained and explained in the archive.

All four pre-upgrade 97-step journals remain readable through the upgraded component. The initial diagnostic incorrectly expected an asynchronously completed workflow handle to remain in an old snapshot; the corrected check requires handle clearance and exact preservation of the remaining preparation, run and journal data. Both attempts are retained. This proves persisted journal readability and terminal cleanup, not every possible in-flight upgrade, cancellation or recovery case. No browser journey, fresh provider preparation or live comparison was executed.

The update provides a measured warm coordination benefit. It does not change the application's step graph or establish a fresh end-to-end speedup. Treat first-run latency and fresh model/comparison performance as separate uncertainties before promising a broader percentage.

## Retained evidence

The [verified archive record](../../scripts/evaluations/archives/20261025T143258672Z-workflow-upgrade-isolated/record.json) identifies 326 files / 31,091,291 bytes, the external archive and checksums. It preserves the frozen captures, both code manifests, exact protocol, source mappings, results/proposals, native logs, zero-call evidence, cleanup receipts, registry/install/push logs, compatibility probes, full check log and bounded experiment drivers. Its `README.md` documents commands, normalization, absolute-path restoration and the required existing local records. Backend credentials and environment contents are excluded; an archive grants no provider or deployment authority.
