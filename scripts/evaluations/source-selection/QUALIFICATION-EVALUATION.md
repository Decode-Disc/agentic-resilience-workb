# Grouped source qualification evaluation

> **Dated evidence.** Preserve the observations and limitations below. Its status, requirements and permissions describe that checkpoint, not current authority. Use the [current document owners](../../../AGENTS.md#document-authority-and-required-reading) and [delivery roadmap](../../../docs/ROADMAP.md); no historical budget or execution permission is renewed.

## Scope and acceptance state

This is the historical nineteen-document ServiceNow grouped-evaluation guide. Its protocol checkpoints and allowances belong to those dated runs. Later common-case (`docs-checkpoint-2026-11-18:docs/verification/2026-10-21-source-quality-first-batch.md`) and grouped cross-company (`docs-checkpoint-2026-11-18:docs/verification/2026-10-21-source-quality-second-batch.md`) evaluations are indexed in the [main evaluation README](README.md#recorded-evaluation-state-2026-10-22). The retrieval interpretation correction (`docs-checkpoint-2026-11-18:docs/verification/2026-10-21-evidence-retrieval-repair.md#interpretation-correction-2026-10-22`) distinguishes exact-span scores from useful equivalent evidence. Preserve the results below without treating them as current generalization evidence, an application model change or a renewed provider grant.

`qualify.ts` evaluates the actual production input preparation, provider adapter, response schema and quotation materialization against nineteen frozen ServiceNow documents. It imports those modules through an isolated Vite module loader with HTTP and WebSocket listeners disabled. It never reads or changes Convex data. The earlier fixed-choice experiment remains documented in `README.md` and `REPORT.md`.

The authorized protocol-2 comparison is complete: nineteen structurally valid exact-input responses for each model, after eleven new requests and twenty-seven replays. Its recorded policy audit exposed two unsafe MiMo guidance-use permissions. Protocol 3 has now been evaluated with thirty-eight new calls: DeepSeek has eighteen valid outputs and MiMo nineteen. All frozen forecast/current-terms negative probes are blocked. The application-owned issue restriction has since been implemented and verified deterministically. Production activation remains **blocked** pending evaluation of the actual new comparison inputs and the remaining protected preparation gates. See [the protocol-3 assessment](QUALIFICATION-V3-ASSESSMENT-2026-10-20.md). The corrected HR API inputs now select substantive capability/access paragraphs. See [the investigator assessment](QUALIFICATION-ASSESSMENT-2026-10-20.md) and the executable offline policy probes. No preparation workflow has been activated.

The investigating assistant recorded `fixtures/qualification-reference.json` before qualification inference. It specifies company relationship, document purpose, required or forbidden contributions, reporting period where applicable, rationale and a usage guard for every document. This is the comparison reference, not independently adjudicated human ground truth. The original `fixtures/reference.json`, `REFERENCE.md` and captured dataset remain unchanged.

## Reproduce without provider calls

Run from the repository root using the installed Node 24 and project dependencies:

```sh
# Validate inputs and display the full 38-observation comparison envelope.
node --experimental-strip-types scripts/evaluations/source-selection/qualify.ts

# Confirm that changed protocol-3 input keys cannot reuse protocol-2 responses.
node --experimental-strip-types scripts/evaluations/source-selection/qualify.ts --models xiaomi/mimo-v2.6-flash --reuse-run qualification-choices-v2-complete-20261020,qualification-choices-v2-20261020

# Save the protocol-3 input audit. No older response is expected to match. Use a fresh name.
node --experimental-strip-types scripts/evaluations/source-selection/qualify.ts --models xiaomi/mimo-v2.6-flash --reuse-run qualification-choices-v2-complete-20261020,qualification-choices-v2-20261020 --replay-only --run my-offline-revalidation
```

These commands do not load credentials or dispatch provider requests. The isolated Vite loader disables environment-file loading as well as HTTP/WebSocket listeners. An unknown case or model is an error. Live execution and offline replay are mutually exclusive. `--reuse-run` accepts a comma-separated list of retained runs, in preferred evidence order. Each logical response is reused once. Existing responses are reused only when their exact prepared input key and configured provider route match and their saved JSON still validates. An unknown or unusable saved response is not silently replaced with a paid call. The separate [DeepSeek diagnosis](DEEPSEEK-DIAGNOSIS-2026-10-20.md) documents zero-I/O reconstruction of historical wire requests and the limits of the retained error evidence.

## Protocol and independent judgments

The 128 KiB input bound includes instructions, serialized document/context and the JSON response schema. The installed SDK uses draft-7 input schemas with inline definitions; preparation accounts for that schema before selecting passages. The full normalized capture stays unchanged when fewer passages fit, and omitted content is explicitly marked partial reading.

Each model receives one grouped document request. It chooses the company relationship, document purpose, reporting period and either null or one to two homogeneous contributions for each documentary role, within fifteen contributions overall. Positive choices reference supplied passage identifiers. The application resolves them to complete quotations within the hashed input and derives labelled presentation excerpts. Providers do not receive expected answers, reference rationales or source-audit judgments.

The canonical result still distinguishes asserted facts, attributed arguments, forecasts, reported outcomes, mixed or uncertain content, period applicability, limitations and dependence on flagged assertions. Selecting a passage does not verify its truth. Deterministic validation checks schema, input membership, references and period constraints. It cannot establish semantic relevance, factual accuracy or logical independence. Automated report fields compare company, purpose, required and forbidden roles, and the explicit reporting period. The investigating assistant must also inspect findings, their passages and the recorded usage guard before accepting a route.

The comparison uses `deepseek/deepseek-v4-flash-0731` through `reka` and `xiaomi/mimo-v2.6-flash` through `deepinfra/fp8`. Both receive the same prepared documents. Evaluation calls each selected model directly to compare it, rather than treating a semantic disagreement as a fallback trigger. Production fallback remains limited to technical transport or invalid-output failure.

## Recorded evidence

| Run | Actual requests | What the retained evidence establishes |
| --- | ---: | --- |
| `mimo-choices-20261020` | 43 | Earlier choice task: 98 of 99 decisions match the reference. One unsupported contradiction remains. |
| `grouped-qualification-20261020` | 38 | Initial grouped format failed: DeepSeek had 7 of 19 structurally valid responses and MiMo 6 of 19, with additional semantic errors. |
| `qualification-diagnostics-20261020` | 2 | Form 3 probes confirmed both quotation-copying and semantic problems. |
| `qualification-clarified-20261020` | 8 | Stronger instructions alone yielded 2 of 8 valid responses. One timeout retains its full cost reservation. |
| `qualification-choices-v2-20261020` | 8 | Four documents across both routes. The original journal retains four failures caused by the former document-kind guard. |
| `qualification-v2-offline-revalidation-20261020` | 0 | Historical materializer replay: all eight responses passed against their earlier inputs. Original outcomes remain linked. |
| `qualification-choices-v2-complete-20261020` | 34 | Full pre-correction comparison: DeepSeek 12/19 structurally valid including saved responses, MiMo 19/19. Seven DeepSeek transport failures retained. Manual passage assessment is separate. |
| `qualification-navigation-input-audit-final-20261020` | 0 | Current extraction/input correction: fifteen MiMo responses revalidate; four document inputs changed. Captures and original references are unchanged. |
| `qualification-input-budget-revalidation-20261020` | 0 | Current input-budget replay: four exact-input responses remain reusable. `input-changes.json` records the two changed document inputs, unchanged capture hashes and remaining evaluation envelope. |

The earlier corrected guard retains narrow cross-purpose contributions as limited instead of rejecting an entire document. It does not make a product data sheet sufficient security documentation or a contract-management product an operative agreement. Historical journals, source snapshots and prior scores are preserved. Offline revalidation is a separate artifact, not a rewrite of previous results.

The six paid runs total **133 actual requests**, with **$0.47491593788** in conservative combined accounting. That includes $0.32 reserved for eight unknown-charge attempts. The earlier five-run checkpoint was 99 requests and $0.15751489188. Earlier reports with slightly different totals remain historical. Combined accounting now namespaces each journal entry by run so identical logical keys in separate intentional experiments cannot hide charges.

## Authorized live execution

Credentials belong in `.env.local` or the environment. Never put values in commands, reports or fixtures. Refresh the official model/provider catalog before activation. Current configuration caps input prices at $0.15 per million tokens and output at $0.60 per million, requests strict structured output, disables hidden provider fallback and SDK retries, and limits output to 6,144 tokens. Each attempt has a 60-second timeout. Input preparation includes instructions, context and the JSON response schema within 128 KiB. Evaluation runs at most two calls concurrently, reserves $0.04 per dispatched request and enforces a combined $1 budget.

A live invocation requires `--live`, a fresh `--run` name and `--prior-run` listing every charged evaluation run included in the current authorization, separated by commas. `--limit` bounds the number of new calls. `--max-attempts` defaults to the authorized combined ceiling of 100. Increasing it requires explicit user authorization. Before loading credentials or creating a live run, the runner checks that the selected new calls fit the authorized total-attempt limit. `--limit` may deliberately select a smaller diagnostic batch. Completed attempts, including failures, do not repeat on resume. An incomplete journal entry blocks repetition because its external outcome is unknown.

The earlier pending request for thirty calls and a ceiling of 129 was superseded by the input-budget correction. The revised continuation reused four exact-input responses and added thirty-four calls for seventeen documents, including re-evaluation of two changed inputs. It raised the combined ceiling from 100 to 133 while retaining $1. **The user explicitly authorized this revised increase.** The continuation is recorded as `qualification-choices-v2-complete-20261020`. The earlier two thirty-call answers refer to superseded presentations of the same request and are not additive. That continuation is complete and the ceiling of 133 has been reached. The user requested diagnosis of DeepSeek failures before deciding on the proposed MiMo-first order and four additional checks. That proposal is deferred, not approved. The [diagnosis record](DEEPSEEK-DIAGNOSIS-2026-10-20.md) describes a single possible DeepSeek probe, which also requires fresh authorization. The user then authorized exactly one DeepSeek/Reka diagnostic repeat, raising the cumulative ceiling to 134 with USD 1 unchanged. That repeat succeeded, so the old failure did not reproduce. Accounting at that diagnostic checkpoint was 134 attempts and USD 0.47531062688 conservatively reserved or reported. At that checkpoint, no further inference was authorized. The user subsequently authorized eleven further attempts, raising the cumulative ceiling to 145 with USD 1 unchanged. No application key configuration, workflow activation, corpus approval, deployment or publication is implied by evaluation authorization.

## Files to inspect

Every paid run preserves prepared inputs, source/module snapshots and hashes in `manifest.json` and `sources/`, dispatch/terminal events in `calls.jsonl`, and reference comparisons in `summary.json`. Source snapshots end in `.txt` so historical code is not compiled as current application source. Optional diagnostics preserve structured candidates, validation, bounded HTTP failure detail and response identifiers, never hidden reasoning or credentials. Historical diagnostics that omitted HTTP failures remain unchanged. Offline reports retain the source run, journal hash and original status/error alongside the new validation result.

These experiments cover one deliberately selected company dataset. They do not measure full-document acquisition recall, cross-company performance, editorial independence, exhaustive fact checking, analyst time saved or protected browser workflow correctness.

## Inventory before the authorized eleven-call continuation

The offline run `qualification-current-two-route-offline-20261020` revalidates 27 responses without a provider request: twelve DeepSeek and fifteen MiMo. Seven DeepSeek responses and four MiMo responses are missing for the current inputs. Three historical exact-input DeepSeek failures are listed as unusable, preserving their original artifacts and outcome. The four corrected documents are `doc_hated`, `doc_capital`, `doc_historical_contract` and `doc_hr_api`; DeepSeek additionally lacks `doc_store_contracts`, `doc_intellectia` and `doc_q1_presentation`.

`--replay-only` reports unusable historical responses without treating them as successful replays. Live execution retains its refusal to repeat a failed historical input silently. `--repeat-failed-history` permits a deliberately authorized new experiment for completed failed entries from a different run and records that choice in the manifest. It never retries an unresolved entry in the current journal. Using this option does not grant authorization or raise the call or dollar limit.

The user explicitly authorized the following eleven-attempt continuation, raising the cumulative ceiling from 134 to 145 with the USD 1 limit unchanged. Execution and results are recorded separately below. Twenty-seven exact-input responses are reused. The additional conservative reservation is USD 0.44, for a cumulative USD 0.91531062688 maximum if every new attempt has an unknown charge. Refresh both official routes immediately before any authorized execution. No routing-order decision follows automatically from the command.

```sh
node --experimental-strip-types scripts/evaluations/source-selection/qualify.ts --live --run qualification-current-matrix-20261020 --reuse-run qualification-deepseek-http-diagnostic-20261020,qualification-choices-v2-complete-20261020,qualification-choices-v2-20261020 --repeat-failed-history --prior-run mimo-choices-20261020,grouped-qualification-20261020,qualification-diagnostics-20261020,qualification-clarified-20261020,qualification-choices-v2-20261020,qualification-choices-v2-complete-20261020,qualification-deepseek-http-diagnostic-20261020 --max-attempts 145 --limit 11 --diagnostics
```


## Completed eleven-call continuation

Run `qualification-current-matrix-20261020` completed all eleven authorized requests with HTTP 200 and distinct retained generation identifiers. Both models now have nineteen exact-input structurally valid responses. Combined accounting is 145 attempts and USD 0.49142902524 conservatively reported or reserved. The additional eleven requests cost USD 0.01611839836 as reported by the provider. The call ceiling is exhausted. The unchanged USD 0.32 reservation for historical unknown charges remains included. No additional inference or runtime activation is authorized.

The pre-dispatch official MCP snapshot is `fixtures/catalog-current-matrix-2026-10-20.json`. Current source snapshots, exact input keys, original reused outcomes, HTTP diagnostics and judgments are in the current run. A scan of its fourteen then-existing files found no configured credential value. That scan is a scoped check, not a general security certification.

Offline `audit-qualified-selection.ts` executes the real source-selection and evidence-use owners against the nineteen-document subset and explicit investigator misuse probes. `fixtures/qualification-usage-probes.json` preserves expected results independently of the policy implementation. Its current verdict, `selection-policy-regression-verdict.json`, records two unsafe MiMo factual-use permissions and exits 1. Earlier policy reports remain unchanged. Exact audit-only source/probe snapshots are in `audit-sources/` with `audit-source-manifest.json`. These probes were authored after the comparison and are regression evidence, not independent evaluation data. The reference and all historical failures remain unchanged. The detailed assessment records why structural accuracy does not pass the semantic activation gate.

```sh
# Historical command: requires the retained protocol-2 policy snapshots.
# Current modules deliberately fail the saved source-hash check.
node --experimental-strip-types scripts/evaluations/source-selection/audit-qualified-selection.ts qualification-current-matrix-20261020 /tmp/my-qualification-policy-audit.json
```

The audit makes zero provider requests, prohibits fetch, never loads credentials, checks original module hashes where the evaluation manifest owns them, records current audit-module and probe hashes, and refuses to overwrite an existing report. The output path is optional and defaults to a new `selection-policy-audit.json` within the saved run. Use a fresh output path for later reproduction. Recommendation dispositions use minimal frozen metadata and are not a reconstruction of the full user's dossier. Policy eligibility is not a persisted or approved claim.


## Protocol 3 correction and completed paid evaluation

The response schema now permits at most two homogeneous contributions per role, with fifteen findings overall and three passage references per finding. Reusing a passage within two contributions for the same role is invalid. An inseparable or uncertain passage uses `mixed_or_uncertain`. The source-selection owner computes each finding's use independently of its role summary. Actual results may remain documentary while forecasts are limited to constructed attributed hypotheses and mixed content requires verification. Approved protocol-2 pins remain readable without being relabelled. The use policy checks annotations and citation provenance, not arbitrary statement entailment or source truth. A model can still mislabel a standalone forecast.

The zero-I/O protocol-3 dry run reports nineteen documents, thirty-eight missing responses and zero reusable protocol-2 responses. The retained comparison, original judgments and failing historical probes remain unchanged. The current authorization remains exhausted at 145 attempts and USD 0.49142902524 conservatively reported or reserved. That was the pre-comparison checkpoint. The user then authorized up to forty new calls, cumulative ceiling 185 with USD 1 unchanged. The thirty-eight-call comparison is complete at 183 cumulative calls and USD 0.53658964396 conservatively reported or reserved. Two conditional runtime attempts remain unused. Runtime activation is still blocked by the recorded known-issue enforcement gap.
## Targeted comparison continuation

`check-source-comparison.ts` evaluates the actual comparison adapter on the two frozen critical inputs in `runs/qualification-v3-matrix-20261020/source-comparison-input-final.json`. Both routes receive the same preserved MiMo qualification, so this isolates the new comparison rather than rerunning qualification. DeepSeek's original unavailable or unselected qualification outcomes remain historical facts. The payloads contain the entire bounded contribution groups, including independent material. Investigator judgments and the exact request bytes are recorded before inference and are never supplied as expected answers to the models.

Prepare without credentials, network access or application writes:

```sh
node --experimental-strip-types scripts/evaluations/source-selection/check-source-comparison.ts --run targeted-comparison-20261020 --prepare --max-attempts 189
```

The user explicitly authorized these four additional comparisons after reviewing the prepared request. The cumulative ceiling is now 189, 183 consumed before this dispatch, and the original two conditional local-runtime attempts remain reserved. The unchanged total budget is USD 1. The authorized command is:

```sh
node --experimental-strip-types scripts/evaluations/source-selection/check-source-comparison.ts --run targeted-comparison-20261020 --live --max-attempts 189
```

The four requests compare Capital Blueprint and EarningsMoat through each configured route. The additional conservative reservation is at most USD 0.16 within the unchanged USD 1 total. Each attempt uses the real application adapter, one request, bounded response and timeout, and no automatic retry or fallback. A common format, account-access or request error stops dispatch. Completed results are reused when the same run is resumed; an unfinished start prevents repetition. Source, input, reference, route and catalog hashes prevent silently resuming changed work. The official selected-endpoint snapshot must be less than one hour old before dispatch.

`evaluation-records.ts` owns the historical attempt/cost calculation and credential redaction shared with `qualify.ts`. Unknown charges retain their reservation. The original qualification dry-run output was unchanged by this extraction. Frozen historical scripts and journals are preserved. The new HTTP diagnostics retain status, request/generation identifiers, response hashes and redacted response content while omitting reasoning fields. Machine disposition/reference checks remain distinct from investigator semantic review. This runner neither changes Convex nor activates preparation.


### Compact-input continuation and recorded outcomes

The original first-case requests both reached 6,144 output tokens with incomplete JSON. The corrected input uses deterministic compact primary aliases with exact provenance materialization and clarifies the existing comparison instructions. The changed-input Capital requests both complete, but investigator review records three semantic mismatches across sixteen contributions. They remain rejected for activation. The failed and corrected run directories each retain HTTP diagnostics, journals, source snapshots and a separate investigator assessment. The original runner snapshots own historical reproduction. Running a changed current script against an old manifest intentionally fails its source-hash check.

The actual corrected two-call command was:

```sh
node --experimental-strip-types scripts/evaluations/source-selection/check-source-comparison.ts --run targeted-comparison-compact-20261020 --audit source-comparison-input-compact.json --live --max-attempts 189 --limit 2
```

Cumulative accounting is 187 attempts and USD 0.54878789396 conservatively reported or reserved. Paid comparison journals are automatically included in later comparison history, alongside the original qualification lineage, so a new run cannot reset that accounting. All four extra comparison attempts are consumed, and the two original runtime attempts stay reserved.

A second-article continuation is prepared with the same exact compact input, both routes and a proposed ceiling of 191. Preparation is offline and does not authorize inference:

```sh
node --experimental-strip-types scripts/evaluations/source-selection/check-source-comparison.ts --run targeted-comparison-debt-20261020 --audit source-comparison-input-compact.json --case doc_earningsmoat --prepare --max-attempts 191
```

The corresponding live command requires the explicit pending authorization before use. It must not be run simply because the prepared manifest exists. Its maximum new reservation is USD 0.08, with USD 1 total unchanged and two runtime attempts still reserved. Fresh comparison source changes require a new manifest and preserved history. The current investigator review is documented in the live verification report (`docs-checkpoint-2026-11-18:docs/verification/2026-10-20-source-comparison-live-evaluation.md`).

For a later continuation, preserve the original endpoint snapshot and supply a newly recorded official snapshot filename through `--catalog <filename.json>` under the existing fixtures directory. Prepare a new run after this tooling revision. The manifest binds the selected filename and its hash, while live dispatch still requires a snapshot less than one hour old. An explicitly missing snapshot now fails before credential loading or provider I/O. The original prepared debt run and its runner snapshot remain historical zero-call preparation. A newly prepared continuation must retain all paid comparison journals in its accounting. This does not authorize the pending calls or refresh provider routes.


### Completed second article and corrected shared citation context

The user explicitly authorized the two-call debt continuation, overall ceiling 191 and USD 1 unchanged. The actual command used the newly recorded official endpoint snapshot while preserving the expired snapshot and the earlier zero-call manifest:

```sh
node --experimental-strip-types scripts/evaluations/source-selection/check-source-comparison.ts --run targeted-comparison-debt-current-20261020 --audit source-comparison-input-compact.json --case doc_earningsmoat --catalog endpoints-targeted-comparison-debt-2026-10-20.json --live --max-attempts 191
```

Both requests complete and materialize exact references. Their twelve individual investigator judgments are saved separately. Combined with the sixteen Capital judgments, all twenty-eight contributions from the four complete outputs are reviewed. The original two truncated responses remain rejected. Cumulative accounting is 189 attempts and USD 0.55230824396 conservatively reported or reserved. Two original conditional runtime attempts remain unused. The comparison is not semantically accepted: numerical periods, an irrelevant citation, a missed supplied historical debt column and unsupported explanations remain documented. No routing or activation change is authorized.

A verified interface restriction prevented a finding from citing primary passages already provided elsewhere in the same grouped input. The domain schema and materializer now share the whole actually supplied primary set while retaining eight references per output finding and exact target/capture provenance. Ranked per-finding keys are suggestions. Foreign and omitted references stay invalid. A zero-network prefix-search probe preserves exact input bytes/hash/omissions while reducing CPU use, without claiming a wall-time improvement. Historical provider results are not reclassified under the changed input.

The new comparison input is prepared without credentials, inference or app writes:

```sh
node --experimental-strip-types scripts/evaluations/source-selection/check-source-comparison.ts --run targeted-comparison-shared-context-20261020 --audit source-comparison-input-shared-context-final.json --catalog endpoints-targeted-comparison-debt-2026-10-20.json --prepare --max-attempts 195
```

Ceiling 195 is a proposal for four changed-input comparisons, not an authorization. It preserves the two original runtime attempts and USD 1 total, with at most USD 0.16 additional reservation. No request from this run may be sent without a new explicit answer. All paid comparison journals remain in its prior history. Read the current verification report (`docs-checkpoint-2026-11-18:docs/verification/2026-10-20-source-comparison-live-evaluation.md`) and saved investigator judgments before deciding whether to dispatch it.

### Reading call counts

The cumulative attempt ceiling counts all retained paid experiment history, not the number of requests scheduled by a script. Default tests/CI and comparison runs without `--live` make no paid model request. The prepared changed-input comparison contains four requests: two articles through two routes. An unchanged same-run resume uses completed journal entries and dispatches only pending keys. Creating a different run can repeat that run's batch; prior history is included for accounting, not automatic cross-run response reuse. Changed inputs or source hashes must never silently reuse old model responses. Read `preparedCalls`, `pendingCalls` and the dry-run output before any explicitly authorized `--live` invocation. A stale or changed historical manifest may be rejected without making a provider call.
