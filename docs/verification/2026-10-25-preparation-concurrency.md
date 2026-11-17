# Preparation concurrency and inline-control verification — 2026-10-25

This report records the pre-live implementation and cached trials. The subsequent authorized lot and its comparability limits are recorded in the [live concurrency trial](2026-10-25-preparation-concurrency-live.md).

## Observed result

The local backend `local-aboul_panga-dd_proto` ran the production source-preparation Workflow with the same 23 cached whole-document qualifications under three settings. All 23 sources retained qualified outcomes in every condition; no provider attempt was reserved or dispatched. Durations run from the start request to persisted preparation completion and include final proposal construction, rather than only action execution.

| Condition | Elapsed | Journal steps | Scheduled steps |
| --- | ---: | ---: | ---: |
| Queued controls, concurrency two | 50.918 s | 97 | 97 |
| Inline controls, concurrency two | 39.854 s | 97 | 49 |
| Inline controls, concurrency four | 33.897 s | 85 | 54 |

Inline controls saved 11.064 seconds (21.7%) at two. Four saved a further 5.957 seconds (14.9%), for a combined observed reduction of 33.4%. The scheduled fourth result save explains why four retains more scheduled steps than inline two. These are single observations in fixed order on one previously investigated company's cached material. They measure coordination and cache reuse, without live model latency, fresh discovery, acquisition or analytical-quality acceptance. They do not establish an optimal concurrency or justify automatic promotion to four.

The initial 24-source replay stopped on a retrieved-selection cache miss: the offline runner prepared its imported hash without the native retrieval-aware input. The subsequent live lot matched all 24 primary qualification input hashes across cloned dossiers, correcting the earlier assumption that cloning itself changed the qualification hash. Zero model allowance correctly prevented inference. Its six/eight-source timings are retained as diagnostics and excluded from the table. The common offline corpus therefore contains the 23 full-document qualifications; the paid corpus retains all 24 sources.

## Implementation and resource evidence

`SOURCE_PREPARATION_MAX_CONCURRENCY` is declared in the typed Convex environment and validated through the existing resource-limit owner. New preparations and explicit recoveries snapshot a positive safe integer; missing configuration defaults to two. Historical snapshots retain two, and running preparations ignore later environment changes. Reading and comparison consume the same snapshot. Invalid settings are rejected before launch reserves analysis quota or schedules provider work. The global Workflow queue remains independently configurable and was not changed by this task. Its actual capacity was not frozen with these timing conditions.

New `inline_controls_v2` executions retain the scheduled bootstrap and use native journaled inline control mutations. Source-result saves yield through a scheduled fourth save after at most three inline saves; comparison-target reads, final proposals and external actions remain scheduled. Existing journals preserve their sequencing. The implementation extends existing Workflow, preparation authority and configuration modules, without adding another scheduler or a new public endpoint.

A native stress case cloned the largest retained full-document qualification 60 times with distinct prepared input identities, configured source concurrency to 60, and completed all 60 outcomes in 58.434 seconds without provider calls or transaction-limit failures. This is a bounded correctness/resource check, not a performance recommendation. The retained final 1,000 native events contain 647 mutation completions, with maxima of 3,536,135 bytes read and 310,439 bytes written among that sample, including component wrappers. They are not maxima for the complete experiment.

Standalone log collectors aborted during idle intervals, leaving incomplete coverage; a full comparison of transaction conflicts at two versus four is unavailable. The final runner now continuously drains native logs with bounded reads, explicit read-failure records and cancellable shutdown. Its read-only native probe captured a completion and verified shutdown without retaining log lines or credentials. That collector was added after the measured runs; no claim of complete historical log coverage is made.

## Verification and preservation

The following checks ran: `pnpm typecheck`, a successful `pnpm convex:sync --url http://127.0.0.1:3210`, focused Biome checks on the 16 task files, `node --experimental-strip-types scripts/check-imports.ts`, `pnpm docs:check` and `git diff --check`. Documentation has zero link/location errors; the existing technical-reference word-count warning remains advisory. No frontend build or whole-project suite was run for this backend/tooling change.

Six focused suites passed 64 tests with `pnpm test` selecting concurrency, study guards, preparation start, preparation Workflow, final comparison pass and research launch, using `--maxWorkers 1 --testTimeout 20000`. Three adjacent suites covering preparation review, qualification and comparison passed 61 tests. The journal-replay test subsequently passed for the new version, the previous version and an absent version, adding two distinct cases: The eight-target comparison test also passed at both two and four, with exactly eight simulated provider calls and no duplicate after replay: 128 distinct tests were exercised across nine suites. The initial parallel verification hit the host's five-second test timeout and cascading jsdom teardown errors; its failed output remains preserved. The serialized run passed without weakening assertions or adding retry behavior.

Tests cover invalid/default/larger settings, historical values, explicit recovery, shared reading/comparison fan-out at two/four/eight, bounded scheduled saves, journal replay without duplicate provider work, cancellation, quota preservation, local fixture guards, immutable imports, cache-miss blocking and rejection of insufficient paid authorization. Author self-review checked the task delta against the saved dirty-worktree baseline; no independent implementation review was requested or performed.

Both previous real dossiers were compared against their retained snapshots: run documents, sources, captures, task results, provider calls and events are unchanged. The admitted evaluation visitor retains three reserved production analyses. Evaluation dossiers are separately identified through local fixture reservations and imported results retain precomputed execution provenance. All evaluation runs returned to a paused review checkpoint; no corpus approval occurred. `E2E_FIXTURES_ENABLED` was removed and its absence verified after both native batches.

## Prepared paid lot

The [prepared manifest](artifacts/2026-10-25-preparation-concurrency-paid-manifest.json) freezes the 24 captures, original qualifications, current application code and refreshed official route metadata. Its SHA-256 is `cc34d1780d2dc2dee9596a3f41fa2fb17b07d3371e52948e35c65cb5af89869f`. The [grant template](artifacts/2026-10-25-preparation-concurrency-grant-template.json) is intentionally not an authorization.

The lot comprises reading/qualification of 24 sources at two and four, followed by comparison of the same frozen qualifications at four and two. Eight targets are expected to require model comparison. The ceiling is 128 dispatched attempts across 64 logical model tasks, using the configured primary `deepseek/deepseek-v4.1-flash` and technical fallback `deepseek/deepseek-v4.1-flash-1017`, both through Relace. The conservative reservation is USD 3.0670848, rounded to an approval ceiling of USD 3.07, using existing application price/input/output bounds plus SDK-envelope headroom. This is a reservation bound, not a prediction of actual charges. No Exa acquisition is part of this frozen-capture lot.

The runner reuses the existing exact-manifest approval validator, refreshes official prices before paid work, refuses automatic rerun of a started paid lot, and retains production allowance, generation, cancellation and unknown-outcome rules. No paid lot was started. Its speed, quality, actual cost, provider failures and complete transaction-conflict comparison remain unmeasured. The deployment default remains two pending the user's decision after real measurements.

## Retained evidence

The [verified local archive record](../../scripts/evaluations/archives/20261025T091831889Z-preparation-concurrency/record.json) preserves 671 files (35,497,160 bytes): captures, source snapshots, both complete native journals and earlier diagnostic runs, current and measured code snapshots, provider catalogs, protocols/grant templates, partial native logs, transaction samples, failed/passing validation logs, original-dossier comparisons and fixture teardown evidence. The [machine-readable observations](artifacts/2026-10-25-preparation-concurrency.json) identify each evaluation dossier and the timing boundary. Report interpretation was written from those archived inputs; archive verification establishes byte preservation, not semantic correctness. Storage is local and originals were retained.
