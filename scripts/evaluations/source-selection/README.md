# Source selection model comparison

For the current cross-company benchmark, use the data-driven [model selection commands](#cross-company-model-selection). The ServiceNow instructions below describe the preserved historical experiment.

## Recorded evaluation state, 2026-10-22

The [first progressive batch](../../../docs/verification/2026-10-21-source-quality-first-batch.md) compares common decisions across five candidates. The [second batch](../../../docs/verification/2026-10-21-source-quality-second-batch.md) evaluates actual grouped qualification and comparison for the two DeepSeek finalists. Their combined recorded inference cost is USD 0.185453646052, excluding earlier small screens. It is distinct from the unexecuted original full-lot reservation of USD 2.905615338 described in the [cross-company fixture README](fixtures/cross-company-20261020/README.md). Recorded cost combines provider-reported charges and usage-priced native calls where specified; it is not an independently reconciled invoice or a quote for a future dossier.

The [retrieval retention report and interpretation correction](../../../docs/verification/2026-10-21-evidence-retrieval-repair.md#interpretation-correction-2026-10-22) and [source utility report](../../../docs/verification/2026-10-21-source-utility.md) assess different boundaries. Exact frozen-span retention is not exhaustive useful-evidence recall. Equivalent Snowflake revenue evidence is present despite an exact-reference miss. Neither the 32 conditions nor the model-reference match counts are product completion targets. The references are investigator-authored and the four-company corpus has been observed in prior work. Illustrative replay does not establish fresh discovery, new-angle model quality or unfamiliar-source robustness.

Keep raw captures, references, provider journals and historical scores immutable. A revised usefulness protocol or a definitive model/retrieval choice requires an explicit decision. The [roadmap](../../../docs/ROADMAP.md#recorded-delivery-state-2026-10-22) owns remaining acceptance work. The 600-character comparison explanation limit is unchanged and its repair remains deferred behind evidence preservation. Evaluation candidates do not replace application routing automatically, and none of the completed manifests grants new paid dispatch.

## Historical ServiceNow experiment

This standalone, opt-in evaluation compares fixed-choice judgments on captured public ServiceNow documents. It does not read or modify Convex, change source approval, or integrate a provider into the application. It uses the project's Node runtime and standard library, with no added dependency.

The later grouped qualification runner imports the real production modules and uses the installed AI SDK. Its reproducible commands, frozen judgments, historical failures, cost accounting and pending activation gate are recorded in [QUALIFICATION-EVALUATION.md](QUALIFICATION-EVALUATION.md).

## Reference and inputs

`fixtures/dataset.json` contains the frozen source captures, provenance hashes, question definitions and protocol. `fixtures/reference.json` contains the investigating assistant's expected answers, individual document analyses, exact evidence anchors and claim judgments. `REFERENCE.md` renders that reference for inspection. Labels were recorded before inference. They are investigator judgments, not independently adjudicated human ground truth. `SOURCE-AUDIT.md` preserves the earlier complete alternative-source audit, including its historical temporary-file references. `REPORT.md` interprets the measured comparison.

The 19 documents were selected from a prior 48-candidate dossier audit to expose known selection problems. The 35 base requests contain 99 decisions across document classification, passage entailment and passage localization. Four cases are repeated and rerun with reversed option order. The five configured models therefore require 215 requests at most. There is one company, no random sample, no independent holdout and no approved confidence threshold. Localization uses constructed passage pools and does not measure full-document retrieval recall.

The full captured text is supplied for document classification. Reference answers, investigator rationales and evidence annotations are never sent to providers. Questions distinguish a contract-management product from an actual agreement, relevant adverse mechanisms from overall sentiment, and an author's assertion from verified truth.

## Offline commands

Run from the repository root with Node 24:

```sh
node --experimental-strip-types scripts/evaluations/source-selection/compare.ts
node --experimental-strip-types scripts/evaluations/source-selection/compare.ts --reference
```

The first command checks the frozen choices and displays the planned calls and conservative reservation. Neither command loads credentials or calls a provider. The sum of pessimistic reservations can exceed the total budget; each live request separately reserves its bound against actual spending, and dispatch stops when the next reservation cannot fit.

## Catalog verification

```sh
node --experimental-strip-types scripts/evaluations/source-selection/catalog.ts /tmp/openrouter-catalog.json
```

This makes public catalog GETs only. The OpenRouter models skill was used for the initial comparison and provider inspection. Its default `/models` request omits decision models, so the catalog script also requests `output_modalities=decisions`, as documented in the [official model catalog guide](https://openrouter.ai/docs/guides/overview/models). Prices are per token in the raw API. Do not interpret the skill's rounded `$0.04` display as an exact `$0.040` tariff.

## Paid execution

Configure `TYPESAFE_API_KEY` and `OPENROUTER_API_KEY` in `.env.local` or the process environment. Never put keys in arguments, fixtures or reports. Verify current tariffs before a new live run. The initial tariff snapshot is `fixtures/catalog-2026-10-20.json`. Its rates and identifiers are historical evaluation configuration, not permanent product defaults.

```sh
# Five initial calls, one per model.
node --experimental-strip-types scripts/evaluations/source-selection/compare.ts --live --run my-comparison --limit 5

# Resume the same run; completed calls, including failures, are not repeated.
node --experimental-strip-types scripts/evaluations/source-selection/compare.ts --live --run my-comparison

# Recompute scores from saved responses, without network access.
node --experimental-strip-types scripts/evaluations/source-selection/compare.ts --summarize --run 2026-10-20-supported-config
```

Use a new run name for an intentional later comparison. A run binds the dataset, reference, runner and tariff snapshot by SHA-256. Changed inputs cannot silently resume an existing run, and offline scoring rejects a changed dataset or reference. An incomplete journal entry represents a call of unknown outcome and blocks automatic repetition. There are no automatic retries or model fallbacks. Authentication, funding, rate-limit and initial smoke failures halt the affected model, including on resume. SIGINT/SIGTERM abort active requests and prevent further dispatch; an already-sent call may still have incurred a charge.

The local budget is $1 of estimated or provider-reported inference charges, with two concurrent requests and a 45-second request timeout. Each dispatch reserves a pessimistic byte-based token bound, including repeated state for native multi-question requests. Unknown charges retain that reservation. OpenRouter reports cost when available; TypeSafe cost is calculated from returned usage and the frozen tariff. This is application-side accounting, not an account-level provider spending limit. Four additional source extractions consumed 47 Firecrawl credits, separately from inference. Earlier audit retrievals are excluded from that count.

`runs/<name>/manifest.json` records inputs and request hashes. `calls.jsonl` records each started request and its terminal response, error, latency and cost basis. `summary.json` is regenerated from the reference and journal. Missing or invalid responses remain visible in the total denominator. Provider confidence is not analytical confidence.

The two recorded historical runs are complete artifacts. Their original runner bytes are archived alongside their manifests. Subsequent improvements to the offline integrity check do not authorize resuming those runs under changed runner bytes. See `CONFIGURATION-NOTES.md` for the GLM configuration correction and the transfer of the initial probe's cost into the main run.

## Boundaries

Results test the tasks and captures supplied here. They do not establish general source reliability, editorial independence, factual truth, production robustness, analyst time savings, extraction fidelity or cross-company recall. The existing metadata selector receives different inputs and enforces authority constraints, so its outputs are not a directly comparable model-accuracy baseline.

The original experiment did not change the approval contract. [ADR-024](../../../docs/decisions/024-qualify-source-content-before-corpus-approval.md) subsequently authorized bounded preparation before corpus approval. Implementation and activation still require their separate verification gates.

## Cross-company model selection

The current candidate list is data in `fixtures/cross-company-20261020/candidate-catalog-20261020.json`. It contains DeepSeek V4.1 Flash, GLM 5.3 Flash, Jev 1.14, Microsoft Decision 1, and DeepSeek V4.1 Flash 1017. GLM replaces MiMo in this current comparison list. Selecting one or several candidates does not require editing TypeScript or creating a replacement mapping.

The catalog owns model IDs, explicit provider routes, verified per-token tariffs, context limits, and optional generative `reasoning` and `maximumOutputTokens` settings. Add or update a generative candidate there after checking official metadata. Keep the frozen historical protocol and runs unchanged. Native decision candidates already in the study retain their real native API templates. Common model selection requires explicit cases. Grouped qualification/comparison selection uses explicit `--tasks` and supports generative candidates through the existing production adapters.

From the repository root:

```sh
source_quality_fixture=scripts/evaluations/source-selection/fixtures/cross-company-20261020
source_quality_runner=scripts/evaluations/source-selection/compare.ts

# List candidates and their configured routes/settings. No study load or provider call.
node --experimental-strip-types "$source_quality_runner" --catalog "$source_quality_fixture/candidate-catalog-20261020.json" --list-models

# Prepare only GLM on the four fixed cases. This does not send inference.
node --experimental-strip-types "$source_quality_runner" --study "$source_quality_fixture/study.json" --cases "$source_quality_fixture/screen-cases-20261020.json" --catalog "$source_quality_fixture/candidate-catalog-20261020.json" --models z-ai/glm-5.3-flash --prepare --run example-glm

# Prepare a mixed generative/native subset, using the same other arguments.
node --experimental-strip-types "$source_quality_runner" --study "$source_quality_fixture/study.json" --cases "$source_quality_fixture/screen-cases-20261020.json" --catalog "$source_quality_fixture/candidate-catalog-20261020.json" --models deepseek/deepseek-v4.1-flash,jev-1.14.0 --prepare --run example-two-models

# Prepare every candidate in the catalog, not the historical protocol's model list.
node --experimental-strip-types "$source_quality_runner" --study "$source_quality_fixture/study.json" --cases "$source_quality_fixture/screen-cases-20261020.json" --catalog "$source_quality_fixture/candidate-catalog-20261020.json" --models all --prepare --run example-all-models
```

Unknown, empty, or duplicate IDs are rejected. `--models` and historical `--replacements` are mutually exclusive. Model selection applies to the explicit common cases. Each changed subset produces its own exact manifest, request hashes, total attempt ceiling, and cost quote. The configured output cap is used in both the request and its reservation, including reasoning tokens. Generative output caps are bounded at 8,192 tokens. Provider price limits are derived from the selected catalog quote rather than a model-name-specific constant.

For grouped tasks, select `--tasks qualification`, `--tasks comparison`, or `--tasks qualification,comparison`, together with `--models`. Do not combine grouped tasks with `--cases` or legacy replacements. Native decision models are rejected for grouped extraction. Both grouped entrypoints prepare the same manifest when the same tasks/models are selected; each live invocation dispatches only its own task and phase. Complete development across both selected tasks before dispatching either held-out task.

```sh
# Prepare 64 qualifications and 32 comparisons for the two DeepSeek finalists.
node --experimental-strip-types scripts/evaluations/source-selection/qualify.ts --study "$source_quality_fixture/study.json" --catalog "$source_quality_fixture/candidate-catalog-20261020.json" --models deepseek/deepseek-v4.1-flash,deepseek/deepseek-v4.1-flash-1017 --tasks qualification,comparison --prepare --run example-grouped
```

Grouped selection preserves prepared source inputs, prompts and output schemas. The evaluation applies catalog transport settings to the captured SDK request and to the live request, then checks its exact approved hash before external I/O. Grouped output caps retain the production default unless the catalog explicitly overrides it, and the reservation always uses the actual request cap. Application provider configuration is unchanged. Historical runs cannot resume under changed runner fingerprints.

Paid dispatch additionally requires a separately authorized manifest, a budget covering the entire selected subset, current official route/tariff verification, and `--live --authorization PATH --phase development` followed by the held-out phase after development completes. Do not reuse an authorization for another subset, run name, catalog, or code fingerprint. The completed four-call GLM run's authorization is exhausted. `--summarize --report NEW_NAME.json` scores saved results offline using the same selection arguments. Reports are append-only.

GLM 5.3 Flash's official metadata marks reasoning mandatory. Its current profile requests low effort, excludes reasoning content from responses, and caps total completion at 8,192 tokens. That condition differs from the previous generative profiles requesting reasoning disabled with a 1,024-token cap. The source snapshots, common questions, output schema, and temperature remain unchanged. Do not treat this as a comparison under identical reasoning settings.

## Saved retrieval replay

The existing `--retrieval-phase replay` path reads saved rankings and captures through the current production preparer. It makes no new ranking, embedding, search or generative-provider request and writes a new report. It is separate from native backend evaluation and embedding export/import. Select `--retrieval-mode lexical`, `hybrid` or `both`, optional `--company adobe|nvidia|snowflake|crowdstrike`, and optional `--context-bytes` without editing the script.

Replay requires the matching retained run directory containing `freeze.json`, `native-state.json` and `native-results.jsonl`, plus the native row projection and reviewed reference. All three inputs were present in `/tmp/evidence-retrieval-implementation-20261021/evaluation-v2` during the 2026-10-22 documentation check. That temporary directory is not a durable repository dependency. On another checkout, restore the exact retained inputs before running the example; the saved result summaries do not replace them. Do not regenerate missing inputs with live calls under an old authorization.

```sh
# Use the retained local directory, or the exact restored archive on another checkout.
source_quality_replay_dir=/tmp/evidence-retrieval-implementation-20261021/evaluation-v2
source_quality_report_dir=$(mktemp -d /tmp/source-quality-replay.XXXXXX)
node --experimental-strip-types scripts/evaluations/source-selection/check-source-comparison.ts \
  --study scripts/evaluations/source-selection/fixtures/cross-company-20261020/study.json \
  --retrieval-phase replay \
  --run-dir "$source_quality_replay_dir" \
  --ranked-rows docs/verification/evidence-retrieval-repair-20261021/ranked-rows.json \
  --reference-review scripts/evaluations/source-selection/fixtures/cross-company-20261020/retrieval-reference-review.json \
  --retrieval-mode both \
  --report-file "$source_quality_report_dir/replay.json"
```

The runner refuses to overwrite an existing report and records the preparer's hash. A replay with changed production code is a new measurement, not an exact reproduction of the old implementation. Keep original and replayed results separate. Other `--retrieval-phase` operations can access or mutate the local backend; the absence of generative calls does not make them read-only. Do not invoke them as documentation checks.
