# Live source preparation comparison

Date: 2026-10-25. One fresh paid ServiceNow preparation was explicitly authorized to measure elapsed-time savings after the preparation changes. It used real analyst admission and the public launch flow on the existing local backend `local-aboul_panga-dd_proto`. Company CIK 1373715, Balanced coverage, no research angle or supplied URLs, lexical retrieval, provider routes, resource limits and source concurrency two match the earlier reference. No application code or provider configuration changed during the experiment.

## Observed time

The [new real dossier](http://127.0.0.1:3000/workspace/k97cyen3fpnjk2yfcpbh0yh0718gyzfv?section=sources) reached the source-review checkpoint in **324.114 seconds**, against **555.953 seconds** for the [earlier dossier](http://127.0.0.1:3000/workspace/k97ffcjgz317wxexjm7a891ged8gxp0g?section=sources): **231.839 seconds saved, or 41.7% less elapsed time**. Timing starts at the browser's launch click and ends at the persisted transition to paused source review, excluding the observer's polling delay. The protected review rendered 16 included sources and explicit reading limitations in both runs.

| Interval | Before, seconds | After, seconds | Change |
| --- | ---: | ---: | ---: |
| Discovery before preparation | 15.423 | 20.634 | +5.211 |
| Reading and qualification | 198.658 | 163.626 | −35.032, or −17.6% |
| Supplemental checks and searches | 17.897 | 19.480 | +1.583 |
| Comparisons | 321.574 | 117.775 | −203.799, or −63.4% |
| Proposal finalization | 0.694 | 0.764 | +0.070 |
| Transition to source review | 1.707 | 1.835 | +0.128 |
| Total | 555.953 | 324.114 | −231.839, or −41.7% |

The initial reading interval starts at persisted preparation creation; subsequent boundaries use persisted phase events. This counts the first reading batch, which the earlier report's first-progress boundary allocated to startup instead: its 183.682-second reading figure becomes 198.658 seconds here, and its startup allocation decreases by 14.976 seconds. The original record and total elapsed time remain unchanged. Phase intervals include orchestration, rather than only provider execution.

## Work and limitations

| Observation | Before | After |
| --- | ---: | ---: |
| Candidate sources | 30 | 29 |
| Qualified sources | 25 | 24 |
| Complete qualifications | 16 | 16 |
| Partial qualifications | 9 | 8 |
| Unavailable SEC documents | 5 | 5 |
| Qualification model attempts | 26 | 26 |
| Invalid qualification responses | 1 | 2 |
| Paid comparison calls | 29 | 8 |
| Distinct compared targets | 8 | 8 |
| All model attempts | 55 | 34 |
| Provider-reported model cost | $0.07103895 | $0.036126166 |
| Provider-reported Exa cost | $0.074 | $0.073 |
| Provider-reported total cost | $0.14503895 | $0.109126166 |

All eight new comparisons succeeded on their first attempt, with a maximum of one call per target. Seven compared target URLs are shared between runs; the eighth differs. The former repeated-pass mechanism is absent in this execution. Twenty-three new qualifications used all available document passages without native search, and one required retrieved selection. The new run issued 15 qualification search queries. Comparison search queries fell from 1,084 to 320, a 70.5% reduction; both traces cover their full comparison phases. The earlier trace does not cover all initial qualification work, so its qualification-query count is not an equivalent full-run control.

Both invalid new qualification responses received successful bounded fallbacks. The same five SEC URLs failed before a recorded HTTP status with `TypeError` and unknown transport outcome. Their underlying transport cause remains unverified. Failures remain visible, no source was approved, and no recovery was started. Both executions produced partial proposals, so faster completion does not establish analytical usefulness or a complete regulatory evidence base.

Fresh discovery returned different collections: 21 canonical URLs are shared, including 16 captured sources whose retained content hashes match exactly. The later run has 24 captures totaling 750,694 bytes, compared with 25 totaling 849,168 bytes. Qualification outcomes and provider latency are also uncontrolled. Consequently, 41.7% is the observed saving for these two real preparations, not a guaranteed or isolated causal speedup for arbitrary dossiers. Reduced repeated comparison work is directly evidenced; the smaller reading gain is less isolated from collection and provider variation.

## Evidence and operating boundary

The [structured comparison](artifacts/2026-10-25-source-preparation-live-comparison.json) retains both phase reconstructions, resource use, source overlap, capture hashes, failures and reported charges. Public OpenRouter model and Relace endpoint preflight confirmed the same routes and availability before launch; the runtime price ceilings and finite attempt limits remained unchanged. Reported charges are receipts, not an independently reconciled invoice.

Native timings were collected before launch through completion. All 24 committed capture files were exported and matched their stored SHA-256 hashes. All 101 frozen backend/package files still matched at completion. The two older real dossiers retained exactly the same run, preparation, revision, provider calls and latest events. The new run ended paused with no started provider calls or outstanding model reservations; the observed model-call peak was two. The browser was closed after inspecting the source-review checkpoint.

No fixture flag, environment variable, dependency, deployment or execution policy was changed for this measurement. Production does not retain raw model HTTP requests/responses or malformed response text; persisted outputs, selected references, receipts and error metadata cannot substitute for those missing payloads. This remains a single-company live observation, not general semantic acceptance or a concurrency-four experiment.

The roadmap is updated only to replace the now-inaccurate statement that revised live latency is unmeasured; broader performance and analytical acceptance remain open. `pnpm docs:check` and `git diff --check` validate this evidence-only addition. Application tests and builds were not rerun because no application code changed during the experiment.

The [verified archive record](../../scripts/evaluations/archives/20261025T065800705Z-source-preparation-live-after/record.json) preserves both experiment directories, their captured content, frozen code snapshots, protocol and route preflight, persisted results, receipts, native timings, observations and the measured report. Its 317 files total 22,555,710 uncompressed bytes and were restored and hash-verified. Storage is local-only; unavailable raw provider payloads remain a reproducibility limitation.
