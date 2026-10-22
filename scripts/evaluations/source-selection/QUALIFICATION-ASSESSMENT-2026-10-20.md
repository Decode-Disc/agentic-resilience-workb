# Historical protocol-2 qualification assessment

This document preserves the protocol-2 assessment. The current result is [the protocol-3 assessment](QUALIFICATION-V3-ASSESSMENT-2026-10-20.md).

**At the protocol-2 checkpoint, activation was blocked by a semantic failure. That comparison was complete.** Both selected routes now have nineteen structurally valid exact-input responses. MiMo still permits a forecast to qualify as support for an achieved result through the current evidence-use policy. No routing change or workflow activation follows from structural validity.

## Current comparison

The user authorized eleven additional requests, bringing the cumulative ceiling to 145 with USD 1 unchanged. Run `qualification-current-matrix-20261020` reused twenty-seven valid exact-input responses and issued exactly eleven requests: seven DeepSeek and four MiMo. All eleven returned HTTP 200 with retained distinct generation identifiers and bounded diagnostics. Their total provider-reported cost was USD 0.01611839836. Combined conservative accounting is **145 attempts and USD 0.49142902524**, including the unchanged USD 0.32 reservation for eight historical unknown-charge attempts. The ceiling is exhausted. No additional inference is authorized.

| Measure | DeepSeek V4 Flash through Reka | MiMo V2.6 Flash through DeepInfra FP8 |
| --- | ---: | ---: |
| Current structurally valid responses | 19 / 19 | 19 / 19 |
| Company relationship matches | 19 / 19 | 19 / 19 |
| Exact document-purpose matches | 17 / 19 | 18 / 19 |
| Required role groups missed | 0 | 0 |
| Explicitly forbidden roles returned | 0 | 0 |
| Reporting-period mismatches | 0 | 1 conservative null |
| New requests | 7 | 4 |
| Median latency of new requests | 4.585 seconds | 3.1615 seconds |
| Reported cost of new requests | USD 0.004379031 | USD 0.01173936736 |

The new-request samples differ, so their latency and cost columns do not establish a controlled ranking. Both routes call the HR API reference product documentation rather than the expected narrower integration-documentation kind. The actual policy still makes its integration material available. DeepSeek additionally calls the quarterly investor presentation an earnings release, losing presentation eligibility and misassigning the document's purpose. MiMo leaves the quarterly period endpoint null. No reference label was changed to improve these scores.

The exact official model and selected-provider snapshot was refreshed through the connected OpenRouter MCP immediately before dispatch and retained in `fixtures/catalog-current-matrix-2026-10-20.json`. Reka advertised USD 0.021/M input and USD 0.528/M output. DeepInfra FP8 advertised USD 0.133/M input and USD 0.266/M output. Both selected endpoints advertised operational status and structured outputs. These observations are dated metadata, not an ongoing availability guarantee. [DeepSeek endpoint metadata](https://openrouter.ai/api/v1/models/deepseek/deepseek-v4-flash-0731/endpoints), [MiMo endpoint metadata](https://openrouter.ai/api/v1/models/xiaomi/mimo-v2.6-flash/endpoints).

## Blocking passage and policy result

The quarterly presentation contains actual Q1 results at `p47`, Q2 guidance at `p56` and full-year guidance at `p57`. Both routes put these passages in one investor-presentation contribution. DeepSeek labels that mixed contribution `reported_outcome/current`. MiMo labels it `asserted_fact` and leaves its period unspecified.

The response contract assigns one kind and period to a role contribution containing several passages. This cannot distinguish different kinds within that contribution. The current use guard trusts those annotations. It checks qualification membership, provenance, role usage and restrictions, but does not establish that a passage reports an achieved outcome. For MiMo, the actual policy permits the two frozen probes that falsely describe Q2 and full-year guidance as achieved revenues. This is an executable unsafe eligibility result. No such analytical claim has been persisted, approved or published.

DeepSeek rejects those particular probes because it wrongly classifies the presentation as an earnings release and the presentation role is then unsuitable. That accidental rejection does not establish robust forecast detection. Both routes reject the expected margin-headwind probe and unestablished current contractual terms. Both permit the bounded claim about the actual HR API documentation. The earlier API navigation defect is resolved for these exact inputs: actual capability/access paragraphs `p540`–`p542` are selected, rather than menu labels.

The new `audit-qualified-selection.ts` script imports the real selection and evidence-use modules. It makes zero provider requests, prohibits fetch, disables environment-file loading and refuses output overwrite. `fixtures/qualification-usage-probes.json` records the investigator's expected judgments and rationales. These are post-comparison regression probes, not independent holdout evidence. The nineteen-document subset uses category `other` and URL-derived origin, so its recommendation dispositions do not reconstruct the original full dossier. Its measured passage-usage behavior does expose the failing guard.

Resolve the mixed-contribution and factual-use contract, then validate these frozen regressions before proposing any new paid check. Do not soften the plan's forecast stop condition or substitute a model-order change for this correction. The current configured order remains DeepSeek primary and MiMo technical fallback. Neither a new primary nor an alternative provider is selected here.

## Other recorded limitations

External business arguments remain attributed hypotheses and cannot strengthen factual support. This protects against simply promoting article figures to verified facts, but it does not verify a premise or establish that an argument is independent of a known error. DeepSeek's Capital Blueprint selection includes the paragraph with the previously documented wrong cRPO amount. Targeted verification remains necessary before factual use. MiMo's StockSentinel contradiction warnings are also unverified concerns: differing dates, metrics or rounded values do not prove a contradiction.

The historical agreement is genuine, but neither route establishes current applicability. Policy keeps its terms limited and factual use blocked. Product data-sheet security fragments remain limited contributions. Store labels such as Paid do not establish tariff amounts or a complete pricing document. Generic boilerplate and package names are weaker contributions than operative mechanisms. None of these outputs certifies editorial independence, factual truth or measured customer outcomes.

`runs/qualification-current-matrix-20261020/investigator-assessment.json` records a documentary judgment for each of the nineteen cases, automated metrics, inspected high-risk findings, provenance hashes and the activation verdict. The investigator is the judge, not independently adjudicated human ground truth. This purposive single-company sample is not an exhaustive factual audit or a statistical model ranking.

## DeepSeek failure diagnosis

The seven original transport failures remain unchanged in historical artifacts. Three unchanged-input failure cases in the new batch succeeded, alongside the earlier successful unchanged RFQ diagnostic. Other inputs were corrected, so those later requests are not exact reproductions. The missing historical HTTP responses prevent identification of the original cause. Successful later requests do not prove an outage, throttling or any other cause. The reconstructed historical requests contain text only, so unsupported image input does not explain them. Full evidence and its limits remain in [the diagnosis record](DEEPSEEK-DIAGNOSIS-2026-10-20.md).

## Historical reproduction without provider calls

```sh
# Historical protocol-2 command. Restore its recorded source snapshots in an isolated checkout.
# Current protocol-3 inputs intentionally do not reuse these response keys.
node --experimental-strip-types scripts/evaluations/source-selection/qualify.ts --reuse-run qualification-current-matrix-20261020,qualification-deepseek-http-diagnostic-20261020,qualification-choices-v2-complete-20261020,qualification-choices-v2-20261020 --replay-only --run my-final-revalidation --max-attempts 145

# Recompute actual policy effects and the investigator's explicit misuse probes.
node --experimental-strip-types scripts/evaluations/source-selection/audit-qualified-selection.ts qualification-current-matrix-20261020 /tmp/my-qualification-policy-audit.json
```

The saved current policy verdict is `runs/qualification-current-matrix-20261020/selection-policy-regression-verdict.json`. The audit exits 1 because its two unsafe-use probes fail. Its exact audit-only source snapshots and probe bytes are preserved under `audit-sources/` with `audit-source-manifest.json`, alongside the original qualification snapshots. Reproduction rejects a changed original policy module rather than silently calling it the old result. Earlier policy-only reports, failures, source snapshots, references and charges remain preserved. The earlier 133-attempt assessment is retained in `runs/qualification-choices-v2-complete-20261020/investigator-assessment.json`; its MiMo-first suggestion was withdrawn and never authorized. Default and CI tests invoke no paid provider. Runtime preparation remains disabled while this gate is open.


## Protocol 3 correction status

The production representation and use policy have since been revised to separate homogeneous contributions within one role and preserve individual forecast, mixed-content, historical and dependency restrictions. Ambiguous attributed hypotheses require a precise finding selection. The selected-source reader returns the same adjudicated restrictions to the existing disclosure. Immutable approved protocol-2 qualifications remain readable. These changes address the demonstrated granularity defect and do not retroactively change any recorded model judgment or make a model's classifications semantically correct. The original version-2 misuse probes and source snapshots above remain failing historical evidence.

Local tests establish the new schema and restriction behavior for controlled qualifications. They do not establish that DeepSeek or MiMo emits correct new-format annotations. A dry run finds zero reusable old input keys and thirty-eight new responses needed for the nineteen-document comparison. No inference above 145 or runtime activation is authorized. The detailed correction evidence and remaining browser/live limits are recorded in the feature verification report.
