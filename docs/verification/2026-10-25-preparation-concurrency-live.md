# Live preparation concurrency trial — 2026-10-25

## Decision supported by this lot

Four concurrent sources substantially shortened the observed comparison phase, while reading/qualification showed little elapsed-time improvement and retained one fewer successful qualification. Keep the shared deployment default at two pending a decision about this trade-off. Four remains promising for comparison; this single, partially confounded pair does not establish a general throughput or quality winner.

The user explicitly authorized the prepared four-condition lot, the two configured DeepSeek/Relace routes, at most 128 dispatched attempts and a total USD 3.07 ceiling. The exact manifest hash was `cc34d1780d2dc2dee9596a3f41fa2fb17b07d3371e52948e35c65cb5af89869f`. All 111 code files and 24 captures matched the approved manifest before execution. Official availability and prices were refreshed. No code or model routing changed during the experiment.

## Timings, work and cost

| Phase | Concurrency two | Concurrency four | Observed reduction |
| --- | ---: | ---: | ---: |
| Reading/qualification | 80.844 s | 78.703 s | 2.141 s / 2.6% |
| Comparison | 147.591 s | 87.701 s | 59.890 s / 40.6% |

Each interval runs from the native workflow start request to persisted preparation completion, including its proposal finalization. The four executions ran in order: reading at two, reading at four, comparison at four, comparison at two. They used the same 24 retained captures from the earlier ServiceNow dossier (CIK 1373715). No fresh company discovery, Exa retrieval or SEC acquisition was measured. Each phase had its own dossier; summing the rows is not an end-to-end fresh-preparation measurement.

| Observation | Reading two | Reading four | Comparison four | Comparison two |
| --- | ---: | ---: | ---: | ---: |
| Candidate sources | 24 | 24 | 24 | 24 |
| Successful qualification outcomes | 24 | 23 | 24 frozen | 24 frozen |
| Paid model attempts | 24 | 26 | 8 | 8 |
| Received invalid model outputs | 0 | 3 | 0 | 0 |
| Maximum attempts per paid source | 1 | 2 | 1 | 1 |
| Provider-reported cost, USD | 0.013672388 | 0.010040674 | 0.013861724 | 0.013963634 |

The lot dispatched 66 attempts: 63 succeeded and three received HTTP 200 responses that failed output validation. Every attempt has a terminal receipt, an explicit response-received outcome and a reported charge. Total reported cost is USD 0.05153842, below the USD 3.07 authorization. No unknown outcome or model reservation remains.

Reading at four used two bounded technical fallbacks. One recovered; the other also failed validation, leaving the full-year 2024 earnings release unqualified. That source received a valid qualification at two. These observations do not prove that concurrency caused the invalid outputs. Input-cache usage also differed materially: 128,256 of 226,318 input tokens were cached at two, versus 217,088 of 249,059 at four. The lower reading cost at four is not an isolated concurrency saving.

Both comparison conditions dispatched exactly eight calls for eight distinct targets, all on the first attempt. The experiment therefore paid for 16 comparison calls across two deliberately separate conditions; no target was compared repeatedly within a condition. This does not reproduce the earlier 29-call repeated-comparison pattern.

## Input and evidence checks

All 24 primary qualification input hashes matched between two and four. The 23 sources qualified in both conditions also retained the same selected passage spans. Seven of those sources changed a document/company classification or a finding-role count, so analytical equivalence cannot be assumed from successful structure validation.

Comparison used the original frozen qualifications in both conditions, independently of either new reading result. However, the selected retrieval passage sets were not identical for any of the eight model-compared targets: their Jaccard overlap ranged from 91.0% to 98.5%. Aggregate comparison inputs were 148,362 tokens at four and 149,975 at two. Five of the eight targets retained the same finding dispositions; three differed. Exact captures and qualifications were frozen, but the protocol did not fully freeze comparison passage selection. The observed 40.6% reduction is therefore not a clean causal estimate of concurrency alone.

The current retrieval implementation fuses rankings keyed by `sourceSearchPassages` document IDs and resolves equal RRF scores using those IDs. Cloned dossiers receive different IDs, providing a verified mechanism by which otherwise equal evidence can be ordered or selected differently. Native lexical ranking may also contribute; the full ranked input of every search was not retained, so the earliest divergence is not localized for every target. A future clean comparison should freeze the selected passages or establish a stable logical tie-break before another paid lot. This task did not change that policy or start another lot.

All 512 recorded quotation checks passed exact-text and available UTF-16 span validation against the frozen captures. This establishes quotation integrity for retained outputs, not entailment, useful classification or downstream analytical correctness. Invalid raw provider response bodies were not retained; their receipts establish validation failure and cost, but do not recover the precise malformed or unsupported content.

The live results also correct the earlier offline diagnosis: the retrieved-selection qualification input did not inherently change when cloned. The offline runner substituted a hash prepared without the native retrieval-aware input. Its cache miss was correctly blocked at zero allowance, and the 23-source cached timing table remains a valid common-workload observation. Historical diagnostics and the original interpretation remain in the prior archive; the report and runner README have been corrected explicitly.

## What limited reading concurrency

| Native root-action occupancy during reading | Concurrency two | Concurrency four |
| --- | ---: | ---: |
| No inspection/qualification action active | 30.629 s | 23.111 s |
| One action active | 13.656 s | 31.215 s |
| Two actions active | 36.559 s | 5.483 s |
| Three actions active | 0 s | 17.846 s |
| Four actions active | 0 s | 1.048 s |

The setting allowed four, but actual four-action overlap occupied only about one second. Journal time between an inspection's recorded completion and its qualification's enqueue totalled 7.649 source-seconds at two and 45.097 source-seconds at four; maxima were 0.501 and 10.594 seconds. These are aggregate per-source intervals, not additive wall-clock savings.

For example, all four inspections in the first four-source batch completed by 1.756 seconds after start. Three qualification steps were enqueued at 1.959 seconds; the fourth was not enqueued until 6.573 seconds, after the first three had completed. Similar delayed groups occur later. The existing inspect-then-qualify durable branching does not continuously keep four qualifications active. The installed Workflow executor batches newly available steps and can short-circuit replay while journal entries remain in progress. The traces establish delayed dispatch; they do not prove the exact upstream event ordering behind every delayed group or establish an untested replacement design.

Median provider-attempt latency was similar (2.114 seconds at two, 2.072 at four), while aggregate provider latency rose from 51.993 to 60.550 seconds with the extra attempts. Transaction-conflict retry records were 68 versus 67 during reading and 35 versus 27 during comparison at four/two respectively. They include component bookkeeping retries and must not be counted as additional paid attempts.

The global Workflow queue was unchanged. The installed Workflow 0.4.4 default and the retained Workpool globals both show capacity 25; the standalone Workpool default is a different value and should not be substituted for the effective Workflow capacity. No global capacity increase is required merely to permit these four-source batches.

## Completion and retained evidence

All four evaluation dossiers returned to paused, unapproved draft corpus checkpoints. Every model reservation is released. Both previous real dossiers are unchanged across run documents, sources, captures, tasks, calls and events. The admitted visitor still has three production analyses reserved. `E2E_FIXTURES_ENABLED` was removed and its absence checked; `SOURCE_PREPARATION_MAX_CONCURRENCY` remains unset, retaining the approved default of two. No further attempt, recovery, publication or cloud deployment was started.

The native collector preserved 4,526 events without a log-read failure, covering the execution windows. The [machine-readable analysis](artifacts/2026-10-25-preparation-concurrency-live.json) contains condition IDs, receipts, timing/occupancy counts, input comparisons and the quotation checks. The [verified local archive record](../../scripts/evaluations/archives/20261025T094214915Z-preparation-concurrency-live/record.json) preserves 174 files (18,193,258 bytes): the exact manifest and explicit grant, code snapshots, captures, original qualifications, final native journals and normalized results, all attempt receipts/charges, selected retrieval rows, official route metadata, installed Workflow excerpts, analysis program, original-dossier preservation checks and fixture teardown. Raw invalid provider bodies and every search ranking are missing, as noted above. Archive verification proves byte preservation within this scope; storage remains local.

No production code changed for this live execution. Documentation validation is the applicable repository check; the existing 128-test implementation verification is recorded in the earlier report and was not replayed to simulate live acceptance. The next useful investigation is deterministic: preserve comparison passage selection and characterize the delayed inspect-to-qualify dispatch before paying for another concurrency pair.
