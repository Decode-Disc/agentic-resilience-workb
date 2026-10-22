# GLM 5.3 Flash screen and reusable model selection

> **Dated evidence.** Preserve the observations and limitations below. Its status, requirements and permissions describe that checkpoint, not current authority. Use the [current document owners](../../AGENTS.md#document-authority-and-required-reading) and [delivery roadmap](../ROADMAP.md); no historical budget or execution permission is renewed.

Date: 2026-10-20. Four user-authorized GLM calls completed successfully, with schema-valid outputs. No other model was rerun. Recorded provider cost: **USD 0.001102867344**. The original implementation goal remains paused and no application routing change has been made.

## Result

GLM 5.3 Flash does not resolve the observed source-decision weaknesses. It misses the directly supplied Adobe numerical discrepancy by selecting no conflict observed, then selects a possible conflict on CrowdStrike without directly contradictory evidence. Its NVIDIA and Snowflake answers are consistent with the supplied passages. All four citation choices are valid and relevant, but a relevant citation does not make the associated disposition evidentially justified.

| Case | GLM response | Investigator assessment |
| --- | --- | --- |
| Adobe realized FY2025 revenue | No conflict observed, period aligned, e0 | Incorrect agreement. The external range is approximately USD 22.5–23 billion, while e0 gives USD 23.769 billion for the same year. A possible conflict should be flagged. |
| NVIDIA prospective causal mechanism | Inconclusive, forecast, no directly comparable citation | Appropriate uncertainty. The source's prospective mechanism is not established by supplied primary evidence. |
| Snowflake public-cloud compute/storage | No conflict observed, applicability unknown, e0 | Scoped agreement is supported by the matching architecture passage. Temporal uncertainty is reasonable for the undated product excerpt. |
| CrowdStrike ARR and four-quarter acceleration | Possible conflict, period aligned, e0 | Unsupported conflict. ARR matches, while four-quarter acceleration remains unestablished. Missing corroboration is not contradictory evidence. |

The CrowdStrike error differs from the earlier MiMo and new DeepSeek agreements: GLM signals a conflict too readily, while those conditions agreed too readily. Neither disposition preserves the unresolved material premise. The underlying reasoning cannot be inferred from a fixed-choice response.

No overall accuracy ranking is claimed. The reference's Snowflake applicability expectation is already documented as too strong, and terse documentary-nature categories have overlap. Raw scores and the frozen reference are preserved rather than edited after seeing outputs. Investigator annotations record both known reference limitations and substantive errors. This is assistant investigation, not independently adjudicated human ground truth.

## Model, route, and experimental conditions

The user requested replacing MiMo with `z-ai/glm-5.3-flash` in the comparison candidate list and running only GLM. The fresh data catalog now contains DeepSeek V4.1 Flash, GLM 5.3 Flash, Jev 1.14, Microsoft Decision 1, and DeepSeek V4.1 Flash 1017. Historical source protocols, references, model runs, and their journals remain unchanged. No application provider, production configuration, database, schema, or analyst workflow was changed. No agent was spawned, no service was stopped or restarted, and no commit, deployment, or publication occurred.

The official model catalog resolves GLM to canonical snapshot `z-ai/glm-5.3-flash-20260826` and marks reasoning mandatory. The selected operational route is `open-inference/fp4`, which advertised structured JSON output, reasoning control, USD 0.047076/M prompt tokens, and USD 0.12/M completion tokens. The returned provider was OpenInference and the returned model ID was the requested GLM ID. Official snapshots are preserved in the fixture's `evidence/glm53-preflight-20261020/` directory.

GLM was configured with low reasoning effort, reasoning content excluded from responses, temperature zero, and an 8,192-token total completion cap. It reported 4731 reasoning tokens across the four calls. This differs from the earlier generative runs requesting reasoning disabled and a 1,024-token output cap. Source snapshots, common messages, questions, and answer schema remain unchanged, as verified by `input-equivalence.json`. The comparison therefore does not isolate model identity from reasoning policy, endpoint, or quantization. No hidden reasoning trace is exposed or used as evidence.

All four cases were the same fixed common controls: Adobe numeric, NVIDIA forecast, Snowflake capability, and CrowdStrike numeric. The Adobe development call completed before the three held-out calls. There were no retries or provider fallbacks. Four samples do not establish dynamic-source robustness, live discovery performance, retrieval recall, document qualification, open-ended extraction, or end-to-end production behavior.

## Authorization, cost, and execution evidence

The exact four-call manifest identifier is `26567d2de7875df77391edd89989f534d8eab70a6fb81a0c3d11ec1b8ea40291`. Its independent authorization caps execution at four attempts and USD 0.01. The conservative whole-lot reservation was USD 0.006949354992. All four terminal results use provider-reported cost, totaling USD 0.001102867344. This is API usage accounting, not independently reconciled invoicing. Median request time was 9.4245 seconds from only four samples. The reasoning setting and serving route differ from earlier runs, so this is not a stable latency comparison.

There are four unique started records and four successful terminal results, with no unresolved outcome. The authorization is exhausted. Original and later historical journals remain unchanged. Final counts come from the durable journal and completed offline report, rather than the dispatch console's previously documented pre-dispatch counter snapshot.

Artifacts are under `scripts/evaluations/source-selection/fixtures/cross-company-20261020/runs/glm53-screen-20261020/`: exact manifest, authorization, journal, final raw scoring and review export, input-equivalence record, investigator annotations, reviewed summary, and verification logs.

## CLI repair

The previous CLI had file-based replacements, but lacked direct selection of the current candidate list. The common-case study CLI now supports:

- `--list-models` with `--catalog`: prints the local candidate list and its configured routes/settings without loading the study or making provider calls.
- `--models MODEL_ID`: prepares or dispatches only that selected model.
- `--models MODEL_ID,OTHER_MODEL_ID`: selects a mixed generative/native subset.
- `--models all`: selects the catalog's current candidates, not the historical protocol's original model list.

The catalog owns IDs, routes, rates, context bounds, and optional reasoning/output settings. Existing real common-task templates are reused for both generative and native calls. There is one request-building path shared by direct selection and historical replacement mappings. No model name was added to CLI control flow for GLM. New generative candidates and per-model settings can be supplied as catalog data without editing TypeScript. Historical `--replacements` remains supported, but cannot be combined with `--models`.

Unknown, empty, or duplicate selected IDs are rejected. Common selection requires explicit cases. Selected generative routes must match their catalog quote. Request provider price ceilings are derived from that quote. Output caps are validated and included in both requests and reservations, so GLM reasoning cannot be billed against a misleading 1,024-token reservation. A changed selection creates a distinct manifest, attempt count, hash, budget quote, and approval boundary. An authorization for one subset cannot expand to another.

The complete runnable examples are in `scripts/evaluations/source-selection/README.md`, under Cross-company model selection. The list is in `fixtures/cross-company-20261020/candidate-catalog-20261020.json`. The five-model candidate list is evaluation data, not activated production routing.

## Verification

The new selection tests first failed on unsupported `--models`, then passed after implementation. Twenty-four focused study tests pass, including one model, several models, all catalog models, mixed native/generative templates, mandatory reasoning settings and output-cap reservation, unknown IDs, and duplicate IDs. The client/scripts TypeScript check passes. Biome passes on the five changed TypeScript files, and the import-boundary check passes. The actual `--list-models` entrypoint prints the expected five candidates without `--study`. The default historical comparison dry-run is byte-identical to its captured pre-change baseline.

No project-wide check was repeated because the previous unrelated lint failure remains outside this tooling change. No browser validation or production-pipeline activation was performed. No reference labels, source excerpts, or common questions were tuned after results.

The result does not justify preferring GLM as an evidence authority. Its candidate substitution is recorded as requested, while production model choice and the paused original goal remain separate.
