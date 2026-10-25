# Live source preparation timing

Date: 2026-10-24. The analyst explicitly authorized one paid real preparation to measure latency and inform a later concurrency decision. A fresh ServiceNow dossier used CIK 1373715, Balanced coverage, no supplied URLs or research angle, and the existing local backend `local-aboul_panga-dd_proto`. Real analyst admission and the public launch flow were used. Source concurrency remained two; provider routes, limits and code were frozen before launch. No further preparation, recovery or concurrency-four experiment was executed.

## Observed result

The [real dossier](http://127.0.0.1:3000/workspace/k97ffcjgz317wxexjm7a891ged8gxp0g?section=sources) reached source review in 555.953 seconds, about nine minutes and sixteen seconds. Preparation itself finished in 554.246 seconds after the launch click; the following workflow transition took 1.707 seconds. The protected review rendered successfully, with 16 included sources, 25 assessed sources and five unavailable sources. The corpus remains unapproved.

| Interval | Seconds |
| --- | ---: |
| Launch to first reading progress | 30.399 |
| Reading and qualification, across four passes | 183.682 |
| Comparisons, across four passes | 321.574 |
| Supplement checks and searches | 17.897 |
| Proposal finalization | 0.694 |
| Final transition to source review | 1.707 |

These intervals use persisted progress events and include orchestration until the following phase. They are not pure provider durations. There were 30 candidate sources and 25 committed captures: 17 complete and eight partial. Qualification classified 16 readings as complete and nine as partial. Five SEC document requests failed with `TypeError`, unknown dispatch outcome and no recorded HTTP status; the underlying transport cause remains unverified. One malformed qualification response was retained as a failed attempt, followed by a successful bounded fallback. No paid call remains started, and no model reservation remains unresolved.

Provider receipts report $0.07103895 for 55 model attempts and $0.074 for 32 Exa operations, totaling $0.14503895. All paid operations have a reported charge; these are provider-reported figures, not an independently reconciled invoice. Routes were DeepSeek Flash through Relace, as captured in the archived protocol and official endpoint preflight. The existing analyst's earlier dossier, its 223 provider calls, preparation and event sequence 201 remain unchanged.

## What dominates and what four could change

Comparisons account for 58% of elapsed time. Four passes created 46 comparison records: 17 local not-run results and 29 paid comparisons covering eight distinct target sources. Targets were compared three or four times as supplemental sources changed the available evidence context. Parent execution identifiers attribute 1,084 native search-batch queries, totaling 124.421 aggregate execution seconds, to those comparison actions. Aggregate query and action durations overlap; they must not be added to wall time.

The model-call peak was two. The final non-cached review query took 0.760 seconds, and finalization took 0.694 seconds, so neither was a major delay in this run. Increasing concurrency does not remove repeated comparisons or search work.

An offline scheduling calculation groups the same observed comparison-action durations in lots of four instead of two, retaining action order and observed orchestration overhead. It estimates 110 seconds saved, yielding approximately seven minutes and twenty-six seconds for the whole run if only comparison concurrency changed. This assumes unchanged action duration, no extra database contention and no provider throttling. It excludes possible reading gains and is not a measured four-way result or an expected service guarantee.

A bounded four-way comparison is worth evaluating on equivalent retained inputs, with source quality, dispatch count, failures and native query load kept visible. Reducing repeated retrieval and comparison work deserves investigation alongside that experiment. Neither recommendation authorizes another paid execution or a concurrency change.

## Evidence and limits

The [measurement summary](artifacts/2026-10-24-source-preparation-live.json) contains phase intervals, provider counts, reported charges, failure outcomes, scheduling assumptions and preservation checks. All 25 normalized capture files were exported from local storage and matched their stored SHA-256 hashes. The frozen snapshot contains 100 authored Convex and package files; all still matched at completion. Events, model task outputs, provider receipts, protocol, official price preflight, protected-screen captures and diagnostic scripts are retained with the experiment.

Native logs start 83.934 seconds after launch; all 46 comparison actions are present, but initial reading-action timings are incomplete. Production did not retain raw provider requests, raw responses or the malformed model output, so the experiment is not a complete provider replay. The corpus has not received analytical approval or a semantic quality evaluation.

The earlier dossier recovery took 522.913 seconds for a different workload with retained work and 48 comparison targets. Its original incomplete preparation took 908.076 seconds and processed more sources. Neither is an equivalent control: this live run establishes current latency, but does not establish a causal before/after speedup from the refactor. A single company and run also cannot establish general robustness or concurrent visitor performance.

No application code, dependency, schema or configuration was changed during this measurement. Verification consists of the real protected journey, persisted state and receipt assertions, frozen-code checks and capture hashes; no application test suite or build was rerun for this evidence-only addition. Documentation changes are confined to this dated evidence and its summary; current product and architecture contracts require no change.

The [verified archive record](../../scripts/evaluations/archives/20261024T221116539Z-source-preparation-live/record.json) identifies the local snapshot, source mappings and checksums. The archive preserved 160 files totaling 13,291,963 uncompressed bytes and verified them after restoration. It includes the measured report, normalized captures, frozen code, protocol, events, task outputs, receipts, screenshots and available native timings. Storage is local-only; this byte verification does not supply missing raw provider payloads or establish analytical correctness.
