# Source-quality evaluation tools

This README documents the evaluation runners and their files. Product outcomes belong in [PRODUCT.md](../../../PRODUCT.md#evaluation-and-demonstration); the project skill [$workbench-evaluation](../../../.agents/skills/workbench-evaluation/SKILL.md) guides protocol design, interpretation and evidence preservation. Results and historical settings belong in the reports linked below. These tools do not select an application model or approve sources.

Run commands from the repository root using its installed Node, pnpm and dependencies. Examples use placeholder paths that must be replaced with existing study inputs.

## Inputs and model selection

A study identifies captured documents, tasks and references. Its catalog owns candidate identifiers, provider routes, tariff snapshots and supported reasoning/output settings. Select candidates through `--models ID_A,ID_B` or `--models all`; do not edit TypeScript for each subset. Unknown, empty and duplicate identifiers are rejected. Historical protocol files and runs remain unchanged when a catalog is revised.

```sh
quality_runner=scripts/evaluations/source-selection/compare.ts
quality_study=path/to/study.json
quality_catalog=path/to/catalog.json
quality_cases=path/to/cases.json

# List catalog candidates without loading a study or calling a provider.
node --experimental-strip-types "$quality_runner" --catalog "$quality_catalog" --list-models

# Freeze a common-case comparison without sending inference.
node --experimental-strip-types "$quality_runner" --study "$quality_study" --catalog "$quality_catalog" --cases "$quality_cases" --models all --prepare --run common-example
```

Common comparisons require explicit `--cases`. Each selected subset produces an exact manifest, request hashes, attempt ceiling and cost envelope. The configured output cap applies to both the request and its reservation, including reasoning tokens. Model identifiers and tariff snapshots are experiment inputs, not application routing defaults or current market quotations.

## Grouped production tasks

`qualify.ts` and `check-source-comparison.ts` exercise the real qualification/comparison preparation and adapters. Select `--tasks qualification`, `--tasks comparison` or `--tasks qualification,comparison` with `--models`. Do not combine grouped selection with `--cases` or historical `--replacements`; native decision models are unsupported for grouped extraction.

```sh
quality_generative_models=ID_A,ID_B
node --experimental-strip-types scripts/evaluations/source-selection/qualify.ts --study "$quality_study" --catalog "$quality_catalog" --models "$quality_generative_models" --tasks qualification,comparison --prepare --run grouped-example
```

For grouped tasks, select only supported generative candidates from the catalog. Each selected entry needs a prepared `descriptor` in the [canonical model shape](../../../convex/modelConfigurationSchema.ts), with `descriptor.contextWindow` matching its quoted `contextLength`; missing capabilities block preparation instead of inventing an output ceiling. `maximumOutputTokens` remains an explicit experimental reduction, not a model-capability default. Both entrypoints prepare the same manifest for the same selection through the real SDK serializer and offline transport; each live invocation dispatches only its own task and phase. Prepared request hashes bind the captured SDK body and configured transport/output settings. Changed code or inputs cannot silently resume a historical run.

## Execution and saved results

Live dispatch requires the prepared manifest, `--live --authorization PATH`, a fresh `--preflight-catalog PATH`, and an explicit `--phase development`, `holdout` or `regression`. The runner verifies the exact manifest grant, selected attempts and budget before dispatch. Complete development across all selected entrypoints before holdout. Credentials use existing secure configuration channels, never command arguments or reports. Unknown external outcomes block blind repetition; a historical authorization cannot be reused for changed code, inputs or routes.

Use `--summarize --report NEW_NAME.json` with the same study/catalog/selection arguments to score saved responses without provider calls. Reports are append-only. A run's `manifest.json` binds inputs and requests; `calls.jsonl` records actual starts and terminal responses/errors, latency and available cost; reports retain unavailable and invalid observations. Existing legacy default commands and their historical limits are preserved in [the original experiment report](REPORT.md#historical-runner-usage-preserved-on-2026-10-22) and [grouped qualification record](QUALIFICATION-EVALUATION.md).

The catalog collection utility makes public metadata GETs only: `node --experimental-strip-types scripts/evaluations/source-selection/catalog.ts OUTPUT.json`. The model catalog includes a separate native-decisions query; its frozen output is not authorization for inference.

## Fixed pipeline versus agent on frozen Sources dossiers

`sources-approach.ts` is a standalone evaluation bench. It compares a fixed read–qualify–compare–select pipeline with an AI SDK tool-loop agent that makes its own qualification and comparison proposals. Both use the same qualification contract, captured passages, production materializers and deterministic selection policy. Protocol `sources-approach-v3` explicitly selects candidate qualification version 5: explicit assertions, relevance and scope, and comparisons assessed by material premise. It also removes `no_substantive_content` as an experimental redundant negative verdict and requires references for a claimed current or historical period. Running the bench does not change application routing or approve a corpus. The application still defaults to version 4 because the candidate live check retains semantic failures. Historical version-one and version-two runs retain their frozen code and input identities; new resource conditions do not rewrite or renew their authority.

The bench uses the application's structured extraction and full-document-first qualification policy. Comparison candidates come from the complete structured capture, including material omitted from qualification inputs, and the shared comparison preparer performs bounded selection. This reuses the production domain owners; it does not replay Convex native full-text/vector search or establish native retrieval quality. The journal exposes the exact context supplied to each comparison.

The default corpus contains four known ServiceNow documents and five documents each for Adobe and Snowflake (annual, quarterly, commercial terms, analysis and distractor). Investigator labels and historical qualifications are retained separately from provider inputs; source identities sent to models do not reveal expected categories. ServiceNow and Adobe are development cases. Snowflake is previously exposed validation, not an unseen holdout. This measures preparation on frozen captures, excluding live discovery and acquisition.

```sh
sources_runner=scripts/evaluations/source-selection/sources-approach.ts

# Freeze the default corpus and code without network access or inference.
node --experimental-strip-types "$sources_runner" --prepare --out /tmp/sources-approach-offline

# To prepare a separately quoted live lot, supply a current model and provider.
# This queries public official endpoint metadata only; it does not send inference.
node --experimental-strip-types "$sources_runner" --prepare --out /tmp/sources-approach-quoted \
  --model "$MODEL" --provider "$PROVIDER"

# Execute supplied simulated or retained provider responses locally.
node --experimental-strip-types "$sources_runner" --offline --out /tmp/sources-approach-offline \
  --responses /path/to/responses.json

# Summarize retained results without provider calls. Reports are append-only.
node --experimental-strip-types "$sources_runner" --summarize --out /tmp/sources-approach-offline \
  --execution offline --report comparison
```

Preparation accepts `--servicenow-input FILE` for the earlier frozen ServiceNow inputs, or `--scenarios FILE` for an explicitly supplied corpus. The default ServiceNow input is `/tmp/qualification-scope-diagnosis-20261025/frozen-inputs.json`; the Adobe and Snowflake captures come from the retained cross-company fixture. Use `--repetitions 1` for a smaller lot; the default two repetitions produce 24 missions across fixed/agent and reasoning off/medium. The second repetition reverses the condition order. The version-3 experiment retains 16 model calls per mission, 16,384 output tokens per call, ten minutes per mission and 512 KiB per assembled request. Each generation uses the remaining absolute mission time rather than a separate 180-second cutoff. Use `--maximum-attempts N` to lower the aggregate ceiling when earlier attempts have already consumed part of an authorized evaluation; it cannot exceed the planned mission ceiling. There is no automatic retry or provider fallback. Native SDK context handling and the quoted model capacity govern input admission, without a byte-plus-token comparison. Financial reservations cover the quoted context capacity and explicit output ceiling, independently of the request-byte safeguard; these reservations are not measured token use or charges.

Use `--approach fixed|agent` and `--reasoning off|on` during preparation to freeze only the required conditions. Omitting either flag retains both values. For a semantic before/after check of the fixed pipeline, `--approach fixed --reasoning off --repetitions 1` avoids rerunning the architecture comparison. Changing conditions requires a new output directory and a new exact live authorization.

Budget authorization defaults to `whole_lot`: the grant must cover the conservative maximum of the frozen lot. Select `--budget-policy stop_at_budget` during preparation to allow a smaller explicit budget. This policy is frozen in the manifest and cannot be changed at dispatch. Each call reserves its maximum before I/O, known charges replace reservations immediately, and missing charge receipts keep their reservations. Concurrent requests wait for in-flight receipts before declaring exhaustion and retain their planned admission order. If the next request still cannot fit, execution records `budget_exhausted`, retains partial results and leaves subsequent work not run. It does not cancel paid requests already in flight or replay an incomplete mission. Continuation retains cumulative consumption and existing unknown-outcome restrictions; a larger budget requires a new explicit authorization. A conservative reservation may prevent even the first call from fitting a very small budget.

The fixed-request study runner (`compare.ts`, `qualify.ts`, `check-source-comparison.ts`) also accepts `--budget-policy` and an optional `--cost-reference PATH_TO_CALLS_JSONL`. A cost reference supplies native token usage for exactly matching request hashes and models; the indicative estimate uses the current quoted input/output rates without cache discounts and averages repeated observations of the same request. The reference bytes and digest are retained with the prepared lot. Missing or incompatible usage leaves the estimate unavailable. Native preparation and Sources missions whose downstream requests depend on model responses do not invent a token forecast. Reports distinguish the indicative estimate, conservative lot maximum, authorized cumulative ceilings, reported charges and unknown-charge reservations; authorized ceilings across continuations are not additive. Partial lots do not establish comparable quality or timing gains. Historical manifests without a budget policy retain whole-lot authorization.

The agent begins with `mission_control`, then uses `read_source`, `submit_qualification`, `prepare_comparison`, `submit_comparison`, `preview_selection` and `complete`. Tools perform no nested inference. Accepted qualifications retain passage provenance and revision numbers; invalid replacements preserve the earlier accepted material. Any changed qualification invalidates comparison contexts. Once a reading has produced an accepted qualification, subsequent model context keeps that qualification instead of repeatedly sending the full reading; `read_source` can inspect it again. The journal retains complete readings and exact requests. Completion is computed from actual prepared state, so an agent's early stop cannot claim completed preparation.

An offline response file maps each exact mission ID, such as `servicenow.agent.off.1`, to an ordered array of `{ "response": <OpenRouter chat completion envelope>, "requestHash": <optional SHA-256> }` entries. Responses must include the provider usage fields expected by the installed adapter. A supplied hash must match the assembled request; missing or exhausted entries fail explicitly. Offline transport cannot use the network. Its outputs are labelled simulated, and its reported costs and timings do not establish live model cost, latency or quality. The focused CLI test provides a complete synthetic example through the real runner and domain modules.

Live execution requires a separately authorized exact `manifest.json` hash, attempt ceiling and budget, based on `authorization-template.json`. Its null approval timestamp is not an authorization. Run `--live --out DIR --authorization APPROVED.json --phase development`, then explicitly run the frozen validation phase with `--phase validation`. The development lot must have retained results first; code and corpus hashes must still match. The runner refreshes official route capabilities and prices before loading the existing `OPENROUTER_API_KEY` configuration. Approval, preflight metadata, requests, final responses, operation results, usage, actual charges and unresolved reservations are retained. Raw reasoning fields and credential headers are excluded. Started phases cannot be replayed. After inspecting a known failure, `--continue` runs only missions without retained results, carrying all previous attempts and charges or reservations within the same ceiling. It preserves failed missions and refuses continuation when a provider outcome or a started mission's result is unresolved; each continuation retains its own preflight, authorization and start marker.

The Markdown and JSON reports preserve separate repetitions and distinguish unread, invalid, incomplete and not-run work, source inclusion, eligible coverage and comparison outcomes. The review template asks about useful content retained or lost, genuine restrictions, temporal support, comparison quality, selection and equivalent evidence; removed contributions after corrections require inspection rather than automatic rejection. JSON validity and workflow completion do not establish analytical correctness. Offline and live reports are generated separately. Archive the whole prepared directory and retained replay inputs with the existing `pnpm evaluation:archive` command before using results in a conclusion; raw reasoning remains outside this evidence boundary.

The [2026-10-25 live evaluation](SOURCES-APPROACH-EVALUATION-20261025.md) records all 24 trials, documentary findings, transport and context limitations, verified charges and the bounded recommendation.

## Inspection and revision of frozen provisional dossiers

Use the same runner with `--inspection-baseline PREVIOUS_RUN --mandates FILE` to prepare an inspection study. The previous run supplies `manifest.json`, `scenarios.json` and `live-results.jsonl`; select one successful fixed/off result per requested dossier. The mandates file maps scenario IDs to neutral documentary research instructions. Investigator answers, expected errors and reference judgments belong outside that file. Qualification version 5 remains an explicit experimental contract, and application routing is unchanged.

```sh
node scripts/evaluations/source-selection/sources-approach.ts --prepare \
  --inspection-baseline /path/to/retained-assertion-study \
  --mandates /path/to/neutral-mandates.json --out /path/to/new-inspection-study \
  --model "$MODEL" --provider "$PROVIDER"
```

The `sources-inspection-v3` protocol freezes the validated initial proposals, mandates, captures, code and common limits. Initial proposals are a zero-call reference, not another paid condition. The two conditions are a fixed source-first inspection and adaptive agent inspection, both with reasoning disabled. Two repetitions reverse the condition order. Add `--inspection-focus FILE`, a scenario-ID map of source-ID arrays, to inspect specific documents while keeping the complete frozen corpus available for corroboration. Only focused qualifications can be edited. Adobe and Snowflake are development dossiers; CrowdStrike is previously exposed validation, not an unseen holdout. Two dossiers with two repetitions produce eight missions and at most 96 dispatches. The official quote is a conservative ceiling, not an expected charge or authorization. Historical version 1 and 2 results remain separate evidence and cannot be pooled with version 3.

The fixed condition first inventories up to eight material premises without seeing the provisional qualification, proposes at most two searches per focused source, reads the first three results per search, then receives the proposal and inspected evidence for one targeted correction batch. This source-first inventory is an experimental hypothesis, not a proven improvement. The agent chooses its reads, searches and targeted corrections within six inspection steps. Both conditions share 12 model calls per mission, 16 searches, 64 reading operations and the existing request/time ceilings. Focused comparisons are refreshed and other pending comparisons are finalized through structured model output after inspection under deterministic orchestration, including after the agent reaches its inspection-step limit. An unchanged qualification does not suppress its focused documentary recheck. Comparison calls remain within the same mission budget; invalid responses are retained without automatic retry.

Inspection uses structured contribution-level edits, with at most three finding changes and two restriction changes per atomic batch. Each edit binds to a qualification revision. Indices refer to the original batch snapshot; a null index appends, a null replacement removes, and a null document kind preserves it. Unmentioned contributions and restrictions remain intact. The resulting whole qualification still passes the canonical schema, period, role-count and exact-reference validators. No nested JSON string or full qualification rewrite is required.

A targeted reading returns at most 32 KiB and prioritizes requested passages before neighbors. The current source view stays within 128 KiB while the cumulative inspected-evidence catalogue remains separate and retains citable references. Evidence not returned by a reading cannot become newly citable. Older model readings are compacted above 160 KiB; omitted requested keys and omitted context are explicit. Exact readings remain in the journal and can be requested again. Targeted primary readings receive priority in later comparison preparation within its existing limits. Revisions and changed reading context invalidate earlier comparison contexts. These limits do not increase merely because the catalogue grows.

Live inspection reuses the running project's local backend, verifies its instance identity before sending an admin credential, and requires `E2E_FIXTURES_ENABLED=true` plus an admitted `--slot-key`. Internal retrieval fixtures bind ownership to that claimed invitation slot, index only the frozen normalized captures, and use native lexical retrieval with `allowProviderCalls: false`. No public test endpoint, embedding, discovery or acquisition is added. One retrieval fixture/index is shared across a dossier's conditions without sharing model observations or revisions; it is finalized on dossier change, cancellation or failure. Do not use a slot occupied by another running workflow. Remove the fixture flag after the phase and verify its removal; a failed teardown leaves verification incomplete.

After separate approval of the exact lot, use the existing `--live --authorization FILE --phase development` and then `--phase validation`, adding `--slot-key CLAIMED_SLOT`. Missing local configuration or fixture authority fails explicitly and cannot select a remote deployment or simplified retrieval fallback. Preparation and offline modes do not enable fixtures or send inference. Offline replay additionally accepts `--search-responses FILE`: a mission-ID map of ordered `{status: "available", hits: [{sourceId, passageKey, excerpt}], nextOffset}` records. Missing search responses fail explicitly rather than pretending that no evidence was found.

Reports keep before/after proposals and pending semantic judgments, including autonomous detection, material omissions, unsupported favorable conclusions and lost useful contributions. Qualified-source counts include restored work. Review actual passages and equivalent evidence before judging a change; indiscriminately making comparisons inconclusive does not establish improvement. Compare semantic corrections across both repetitions before expanding the agent, and retain the simpler fixed path when its improved tools recover the same material.

## Retained native preparation concurrency study

The preparation study launcher was retired on 2026-11-24 with the former corpus-review workflow. Existing reports, captures, qualification references, and native journals remain available for offline analysis. The [Sources mission contract](../../../context/TECH.md#sources-mission-and-prepared-material) describes the current execution path. The historical procedure is preserved in `git show 0bac6435:scripts/evaluations/source-selection/README.md`.

The study froze captures, qualifications, routes, code, and the provider catalog. Offline replay compared queued controls at two with inline controls at two and four using the same 23 cached whole-document qualifications. The offline runner could not reproduce the retrieved-selection capture's native retrieval-aware request hash. The live lot matched all 24 primary qualification input hashes across cloned dossiers. Offline timing measured coordination and cached reading. Version 3 manifests counted eligible model sources per condition and retained the conservative attempt and cost envelopes for interpreting the results.

## Saved retrieval replay

`check-source-comparison.ts --retrieval-phase replay` reads saved native rankings and captures through the current production preparer. It makes no new ranking, search, embedding or model request and writes a new report. Other retrieval phases may access or mutate the local backend.

```sh
node --experimental-strip-types scripts/evaluations/source-selection/check-source-comparison.ts \
  --study "$quality_study" --retrieval-phase replay \
  --run-dir /path/to/retained-retrieval-inputs \
  --ranked-rows /path/to/ranked-rows.json \
  --reference-review /path/to/reviewed-reference.json \
  --retrieval-mode both --report-file /path/to/new-replay-report.json
```

The retained run directory must contain matching `freeze.json`, `native-state.json` and `native-results.jsonl`; summaries cannot replace them. Options include `--retrieval-mode lexical|hybrid|both`, `--company` matching a study company and `--context-bytes`. Existing output files are refused. A replay records the current preparer's hash and is a new measurement when code changes. The retrieval report (`docs-checkpoint-2026-11-18:docs/verification/2026-10-21-evidence-retrieval.md`) records the original input locations and their limitations.

## Local artifacts and restoration

Git ignores directories named `runs/` and `captures/` anywhere under `scripts/evaluations/`. Keep code, deterministic test fixtures, protocols, catalogs, references and compact reports outside those reserved directories. An explicit output path elsewhere is not covered automatically. Ignored local files remain available to the runners, but a fresh clone needs the retained inputs restored before historical checks.

The [retained snapshot record](fixtures/cross-company-20261020/README.md#retained-artifact-snapshot-2026-10-22) documents the existing manual archive, its checksum inventory and restoration. It does not include every external replay input. Missing evidence must not be silently regenerated with live calls under an old authorization.

## Archive a retained experiment

Use `pnpm evaluation:archive --help` for options, an example, storage paths and checksum/recovery instructions. The command creates a new verified snapshot of explicitly selected files without removing originals. The skill guides which evidence to retain; byte copying, hashing and restoration verification belong to the command.

## Cross-company model selection

The [frozen cross-company fixture](fixtures/cross-company-20261020/README.md) records its corpus, references and catalog provenance. Use the generic selection commands above with those inputs. Recorded provider/model profiles and reasoning differences belong in the screening report (`docs-checkpoint-2026-11-18:docs/verification/2026-10-20-glm53-source-quality-screen.md#catalog-configuration-recorded-on-2026-10-22`).

## Recorded evaluation state, 2026-10-22

These are dated observations, not current execution grants or application activation:

- [Original ServiceNow comparison](REPORT.md) and [grouped qualification](QUALIFICATION-EVALUATION.md).
- Cross-company preparation (`docs-checkpoint-2026-11-18:docs/verification/2026-10-20-cross-company-source-quality-preparation.md`), common-case batch (`docs-checkpoint-2026-11-18:docs/verification/2026-10-21-source-quality-first-batch.md`) and grouped batch (`docs-checkpoint-2026-11-18:docs/verification/2026-10-21-source-quality-second-batch.md`).
- Retrieval interpretation correction (`docs-checkpoint-2026-11-18:docs/verification/2026-10-21-evidence-retrieval-repair.md#interpretation-correction-2026-10-22`) and source utility (`docs-checkpoint-2026-11-18:docs/verification/2026-10-21-source-utility.md`).

The [roadmap](../../../docs/ROADMAP.md) owns delivery state and remaining acceptance work.
