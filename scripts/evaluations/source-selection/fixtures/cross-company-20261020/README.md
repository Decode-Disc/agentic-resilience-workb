# Cross-company source-selection comparison

> **Dated evidence.** Preserve the observations and limitations below. Its status, requirements and permissions describe that checkpoint, not current authority. Use the [current document owners](../../../../../AGENTS.md#document-authority-and-required-reading) and [delivery roadmap](../../../../../docs/ROADMAP.md); no historical budget or execution permission is renewed.

## State and authority

The original full 416-request manifest remains unexecuted and unapproved. Subsequent screens and two progressive batches used their own authorized manifests and recorded results. The later batches also total 416 calls, but use different cases and model conditions; that matching count does not mean the original manifest ran. The original implementation goal remains paused. Dataset preparation and historical reports do not authorize new paid dispatch, routing changes, integration, production acceptance, deployment, commit or publication. GPT-6 Luna Decisions was an original comparison witness and was later replaced in the evaluation candidate catalog; it was never accepted for prototype integration.

The ready run is `runs/ready/manifest.json`. Its approval identifier is the SHA-256 of `JSON.stringify(JSON.parse(manifestBytes))`, not the SHA-256 of the indented file:

`8ce2324406b1a651d54ff29a594a53b21adff252edc5a86e143cb4f5f1d306be`

The conservative reservation is **USD 2.905615338** for **416 attempts**. A **USD 3.00** lot ceiling was previously proposed but was not approved. A separate 20-request authorization with a USD 0.10 ceiling was subsequently granted and exhausted. No authorization exists for the full 416-request lot. The previous four-call proposal remains withdrawn. This study has its own journal and does not consume or reuse historical allowances.

### Later recorded results

| Experiment | Recorded inference cost, USD | Evidence and scope |
| --- | ---: | --- |
| Initial 20-call screen | 0.0046848582 | [Initial screen](../../../../../docs/verification/2026-10-20-cross-company-source-quality-screen.md); four common cases. |
| Eight-call DeepSeek replacement screen | 0.00165696 | [Replacement screen](../../../../../docs/verification/2026-10-20-deepseek-v41-source-quality-screen.md); evaluation-only substitutions. |
| Four-call GLM screen | 0.001102867344 | [GLM screen](../../../../../docs/verification/2026-10-20-glm53-source-quality-screen.md); different reasoning condition. |
| First progressive batch | 0.101061466052 | [Common-case comparison](../../../../../docs/verification/2026-10-21-source-quality-first-batch.md); 320 calls across five candidates. |
| Second progressive batch | 0.08439218 | [Grouped qualification and comparison](../../../../../docs/verification/2026-10-21-source-quality-second-batch.md); 96 calls across the two DeepSeek finalists. |

The two progressive batches total **USD 0.185453646052**, excluding the earlier screens. The first batch includes usage-priced Jev charges; the other reported components are provider-reported as detailed in the reports. These are recorded experiment costs, not reconciled invoices or a future dossier quote. The original USD 2.905615338 figure is a conservative reservation for the unapproved manifest, not an amount spent.

Retrieval and illustrative source-review work are separate from these model batches. Read the [retrieval correction](../../../../../docs/verification/2026-10-21-evidence-retrieval-repair.md#interpretation-correction-2026-10-22) before interpreting reference retention: equivalent Snowflake revenue evidence is present despite an exact-reference miss. The [utility replay](../../../../../docs/verification/2026-10-21-source-utility.md) uses historical outputs and observed source pools, not fresh discovery or independent validation. The 600-character explanation limit remains a deferred output-contract issue. None of these records selects a definitive retrieval winner or authorizes general activation.

## Corpus and reference

`study.json` selects 32 captured documents: eight each for Adobe, NVIDIA, Snowflake, and CrowdStrike. Each company has annual, quarterly, product, integration, terms, external analysis, news, and distractor/index slots. Adobe is development. The other three companies form the held-out model-output cohort. SEC CIKs are the stable company identities. Names, tickers, and URLs are observed metadata.

`captures/` preserves raw responses, normalized text, SEC identity metadata, and official model-catalog snapshots. `collection.json` records attempted URLs and failures, including empty responses, authentication walls, HTTP denials, and the unavailable PDF parser. `selected-source-records.json` identifies the 32 selected captures and their provenance. These public GETs were corpus collection, not model inference. The collection script uses validated public addresses pinned through an HTTP dispatcher, validates redirects, and limits response bytes and time. Its archived source is `evidence/collection-script.mjs.txt`. Failed attempts are retained rather than relabelled as selected evidence.

`reference.json` contains 52 common reference groups and 48 grouped-task reference groups with exact normalized-text offsets and quotations. The investigating assistant authored it before inference. It is **not independently adjudicated human ground truth**. Multiple acceptable labels and limited usefulness are explicit where warranted. A citation-localization item supplies an exact excerpt. It measures selection of a supplied passage identifier, not semantic retrieval recall.

`protocol-freeze.json` preserves the early instruction freeze. `input-contract-freeze.json` binds all 416 actual provider request hashes. `evidence/context-minimization/` preserves the earlier freeze and the pre-inference revision: remove cohort metadata from production adapter inputs and correct the grouped Snowflake capability reference against an already supplied primary passage. No evaluated-model output informed either revision. Twelve zero-inference preparation drafts were moved to task scratch space to avoid keeping repeated 43 MB payloads. Their hashes and archive locations are in `evidence/draft-archive.json`.

## Conditions and counts

| Condition | Cases | Models | Attempts |
| --- | ---: | ---: | ---: |
| Common document decisions | 32 | 5 | 160 |
| Common targeted controls | 16 | 5 | 80 |
| Historical ServiceNow regressions | 4 | 5 | 20 |
| Repeat/reverse-choice sensitivity | 8 | 5 | 40 |
| Longer supplied-context cases | 4 | 5 | 20 |
| Existing grouped qualification adapter | 32 | 2 | 64 |
| Existing grouped comparison adapter | 16 | 2 | 32 |
| Total | | | 416 |

Common tasks send the same captured state and criteria through native decision APIs or a constrained generative answer schema. Request serialization differs by API. Ordinary wire inputs are capped at 24 KiB. Four long cases use up to 128 KiB, subject to model context bounds. Unsupported or rejected requests remain visible as unavailable outcomes. Common controls combine production-ranked passages with investigator-selected primary spans to isolate reasoning from retrieval. The supplementary evidence is the same for all five models.

The grouped conditions call the existing production qualification and comparison modules, with external calls intercepted during preparation. They retain production retrieval only and have separate references. Their fixed comparison contributions are investigator-constructed inputs, not outputs from qualification in this study. These are controlled adapter tests, not an end-to-end autonomous discovery workflow. The five-model and grouped conditions must not be pooled into one accuracy ranking.

| Model and fixed route | Attempts | Conservative reservation USD |
| --- | ---: | ---: |
| DeepSeek V4 Flash 0731 / Reka | 112 | 0.302809 |
| MiMo V2.6 Flash / DeepInfra FP8 | 112 | 0.808329 |
| Jev 1.14.0 / TypeSafe direct | 64 | 0.408990 |
| Microsoft Decision 1 / Azure | 64 | 0.409823 |
| GPT-6 Luna Decisions / OpenAI (comparison only) | 64 | 0.975665 |

These original reservations use the frozen official catalog, an upper estimate from serialized request bytes, decision-question multiplicity, and output caps. They are not measured charges. Later costs and quality observations apply only to the separately recorded conditions above. Before any newly authorized paid dispatch, refresh official pricing and availability. An exact-manifest grant is limited to its recorded routes, conditions and remaining allowance; a changed route, higher quote or exhausted grant cannot reuse it.

## Offline commands

Run from the repository with its established pnpm 10.20.0 and Node version. The original ready manifest is a historical preparation snapshot. The later tested subset option changes the CLI code fingerprint, so these original ready commands now correctly reject code drift. Preserve that snapshot and prepare a new exact manifest for any separately authorized future lot. The original preparation commands are retained below for reproducibility. They do not read provider credentials or send inference requests.

```sh
node --experimental-strip-types scripts/evaluations/source-selection/compare.ts --study scripts/evaluations/source-selection/fixtures/cross-company-20261020/study.json --catalog scripts/evaluations/source-selection/fixtures/cross-company-20261020/catalog.json --prepare --run ready
node --experimental-strip-types scripts/evaluations/source-selection/qualify.ts --study scripts/evaluations/source-selection/fixtures/cross-company-20261020/study.json --catalog scripts/evaluations/source-selection/fixtures/cross-company-20261020/catalog.json --run ready
node --experimental-strip-types scripts/evaluations/source-selection/check-source-comparison.ts --study scripts/evaluations/source-selection/fixtures/cross-company-20261020/study.json --catalog scripts/evaluations/source-selection/fixtures/cross-company-20261020/catalog.json --run ready
```

Offline scoring is also available. Output filenames are append-only. `preparation.json` is already present and contains 416 `not_run` observations, no wrong-answer count, and `semanticAcceptance: not_evaluated`. Use a new report filename after any later authorized inference:

```sh
node --experimental-strip-types scripts/evaluations/source-selection/compare.ts --study scripts/evaluations/source-selection/fixtures/cross-company-20261020/study.json --catalog scripts/evaluations/source-selection/fixtures/cross-company-20261020/catalog.json --run ready --summarize --report later-results.json
```

## Paid-dispatch gate

Paid dispatch is blocked by default. Only after explicit approval of this exact lot may an operator create a separate authorization JSON containing `manifestSha256` equal to the identifier above, `maximumAttempts: 416`, `budgetUsd: 3`, and the actual `approvedAt` timestamp. This paragraph is a proposed grant format, not an authorization. Credentials stay in existing secure environment channels and are not included in artifacts.

The three entrypoints share one `calls.jsonl`, one exclusive execution lock, one 416-attempt ceiling, and one budget. Each request is recorded before I/O. Unknown external outcomes block automatic repetition. There are no retries or provider fallbacks. Concurrency is two, timeout is 60 seconds, and response size is bounded. Authentication, payment, quota, or access failures stop further dispatch. Cancellation prevents new dispatch and keeps unresolved reservations visible.

A later authorized command adds `--live --authorization PATH --preflight-catalog FRESH_CATALOG --phase development` to the appropriate entrypoint, using the same study, catalog, and run. The fresh catalog must be less than one hour old. Complete development across all three entrypoints before `--phase holdout`. Regression is separate via `--phase regression`. Phase totals are 99 development, 297 holdout, and 20 regression attempts. No command in this preparation ran with `--live`.

## Reading eventual results

Inspect availability, schema/citation validity, unsafe conclusions, appropriate and avoidable abstention, semantic errors, sensitivity, latency, and cost separately by task, company, model, and cohort. Planned, not-run, unusable, and wrong-answer counts are distinct. Native answer probabilities do not become evidence confidence. There is no aggregate resilience score or automatic model winner.

After inference, `*-blind-review.json` strips model/provider identifiers and `*-review-key.json` stores their mapping separately. This reduces label exposure but is not independent or fully blinded human validation. Inspect every material contribution, comparative dimension, passage citation, and unsupported inference, particularly outputs that pass JSON validation. Correct document labels do not certify extracted contributions. Preserve disagreements with the reference rather than silently revising it after seeing results.

A native model can justify further integration investigation only if the common held-out comparison supports its decisions, uncertainty handling, and citation discipline. The grouped generative condition separately assesses whether the current preparation/extraction pipeline supplies usable evidence. Native decision APIs do not, by themselves, replace open-ended extraction. A tie, insufficient sample, unavailable route, or inconclusive result is an acceptable conclusion. Any integration design requires a later explicit decision.

This single stratified public snapshot is a transfer check beyond ServiceNow. It does not establish dynamic-source robustness across future changes, unseen issuers, changing URLs, retrieval drift, or operational prevalence. ServiceNow regressions and repeated/order variants are reported separately and cannot inflate held-out generalization evidence.

## Verification

See `evidence/verification/` and `docs/verification/2026-10-20-cross-company-source-quality-preparation.md`. Eighteen study tests and fourteen existing adapter/transport tests pass. Client and Convex typechecks pass. Nine scoped files pass Biome. The import-boundary check passes. Legacy default dry-run output is byte-identical to the captured baseline. The repository-wide `pnpm check` passes design and types, then stops on an unrelated `noArrayIndexKey` error in `src/components/workbench-shell/analyzed-company-list.tsx:114`. Repository-wide formatting, tests, and build were therefore not reached. No browser check was required for this evaluation-only change.

## Completed initial screen

A separate 20-request screen was subsequently authorized and completed under a USD 0.10 ceiling. Recorded total: USD 0.0046848582. All 20 requests returned schema-valid answers, with semantic weaknesses recorded individually. The full 416-call lot remains unapproved. See `docs/verification/2026-10-20-cross-company-source-quality-screen.md` and `runs/screen-20261020/reviewed-summary.json`. This later subset uses a new exact manifest. The original ready manifest remains historical and retains its original code fingerprints.

## Completed DeepSeek V4.1 replacement screen

The user subsequently requested replacing the old DeepSeek and Luna comparison candidates with DeepSeek V4.1 Flash and DeepSeek V4.1 Flash 1017, rerunning only those two models. Eight calls completed on the same four cases through Relace, costing USD 0.00165696 in provider-reported charges. Both detect the Adobe conflict but give unjustified agreement on the CrowdStrike compound claim. The 1017 snapshot selects a more direct Snowflake citation. See `docs/verification/2026-10-20-deepseek-v41-source-quality-screen.md` and `runs/deepseek-v41-screen-20261020/reviewed-summary.json`. These remain evaluation-only substitutions.

## Current catalog and GLM screen

The current candidate catalog is `candidate-catalog-20261020.json`, with GLM 5.3 Flash replacing MiMo. The CLI selects one, several, or all candidates through `--models`; `--list-models` displays the list. Models, routes, and optional reasoning/output settings are data rather than per-run source edits. See the root evaluation README for commands. Four GLM calls completed with schema-valid outputs and provider-reported cost USD 0.001102867344. GLM missed the Adobe discrepancy and flagged an unsupported CrowdStrike conflict. NVIDIA and Snowflake results were consistent with the supplied excerpts. Its mandatory low reasoning condition differs from previous reasoning-disabled runs. See `docs/verification/2026-10-20-glm53-source-quality-screen.md`.

## Retained artifact snapshot, 2026-10-22

This is the provenance and recovery record for the manual snapshot, including sibling historical experiments. Its archive layout uses repository-relative paths directly, unlike the newer archive command's `repository/` and `external/` layout.

The snapshot `source-selection-20261022T120958Z.tar.gz` preserves all 395 files in `scripts/evaluations/source-selection/runs/`, this fixture's `runs/` and its `captures/`, totaling 176,602,178 uncompressed bytes. Its compressed size is 25,446,495 bytes. The [archive checksum](../../archives/20261022T120958Z/archive.sha256) verifies the bundle; the [file inventory and checksums](../../archives/20261022T120958Z/files.sha256) identify every repository-relative payload. Archive extraction and all file hashes were verified against the unchanged originals before adding the ignore rules. Failed attempts, raw responses, cost journals and historical code snapshots are preserved without reinterpretation.

The archive is stored locally under `~/.local/share/agentic-resilience-workbench/evaluation-archives/`, outside this checkout and temporary directories. It has not been uploaded or backed up off this machine. A fresh clone needs this exact archive for checks consuming these captured inputs, including recorded-source browser scenarios. The separate inputs described in [saved retrieval replay](../../README.md#saved-retrieval-replay), including its temporary run directory, are not included in this snapshot. The default source-quality unit tests create temporary synthetic captures and do not require these archived directories. Restoring an archive does not authorize inference, live evaluation or replaying historical authorization files.

From a fresh clone's repository root, obtain the archive from that local store and run the following. Set `archive_dir` to its actual location if the bundle has been transferred. Extraction refuses to overwrite existing files; use a separate checkout if historical artifact directories already exist.

```sh
repository="$(pwd)"
checksums="$repository/scripts/evaluations/source-selection/archives/20261022T120958Z"
archive_dir="$HOME/.local/share/agentic-resilience-workbench/evaluation-archives"
(
    set -eu
    cd "$archive_dir"
    sha256sum --check "$checksums/archive.sha256"
    tar --extract --gzip --file source-selection-20261022T120958Z.tar.gz --directory "$repository" --keep-old-files --no-same-owner
    cd "$repository"
    sha256sum --check "$checksums/files.sha256"
)
```
