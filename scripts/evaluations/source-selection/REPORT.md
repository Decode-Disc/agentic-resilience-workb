# Source qualification comparison, 20 October 2026

> **Dated evidence.** Preserve the observations and limitations below. Its status, requirements and permissions describe that checkpoint, not current authority. Use the [current document owners](../../../AGENTS.md#document-authority-and-required-reading) and [delivery roadmap](../../../docs/ROADMAP.md); no historical budget or execution permission is renewed.

## Decision supported by this experiment

DeepSeek V4 Flash 0731 is the strongest starting candidate in this small comparison for grouped semantic source qualification and passage verification. It matched all 99 reference decisions and had the lowest observed inference cost on the base workload. Jev and Microsoft Decision 1 were faster and classified every document they could process correctly, but made errors on the distinction between an assertion, a forecast and an established fact. GLM matched all reference decisions, with more latency and reasoning-token consumption.

This supports further design around inspected source content and bounded semantic judgments. It does not establish general model superiority or production acceptance. The reference is the investigating assistant's recorded analysis, not independent human ground truth.

## Reference, scope and execution

The reference was authored at `2026-10-20T02:57:44.211838Z`, before the first provider call at `2026-10-20T03:03:52.375Z`. The run manifest binds its exact bytes. [REFERENCE.md](REFERENCE.md) contains the individual analyses and expected decisions. [SOURCE-AUDIT.md](SOURCE-AUDIT.md) preserves the preceding full alternative-source audit. The machine-readable reference (`scripts/evaluations/source-selection/fixtures/reference.json`, local reference as of 2026-10-22; not included in checkpoint `c4f0d24`) and dataset (`scripts/evaluations/source-selection/fixtures/dataset.json`, local reference as of 2026-10-22; not included in checkpoint `c4f0d24`) are sufficient to reproduce scoring and send the same questions again.

The base set has 19 captured ServiceNow documents, 35 requests per model and 99 decisions: 67 document judgments, 24 passage-entailment judgments and eight passage-localization judgments. Ten documents also test whether the content contains an adverse business mechanism. A broadly favourable article may contain relevant counter-analysis. A contract-management application is not a subscription agreement.

This was a purposive sample of known difficult or useful audit cases. There is no second-company holdout, random sample, independent annotator or calibrated operating threshold. Passage localization uses small constructed pools with deterministically rotated positions. Its perfect results do not establish full-document retrieval recall.

Five smoke calls preceded the main run. GLM initially rejected reasoning disabled. The main run used low reasoning for GLM and reasoning disabled for DeepSeek, with a 1,024-token output cap. The same state, question definitions and allowed choices were used across models. Native decision APIs and generative JSON-schema APIs necessarily have different transport instructions. No reference answer or investigator rationale was sent to a provider.

The main run completed 213 of 215 scheduled calls. All 175 base calls were attempted. A DeepSeek HTTP 429 during the reversed-choice sensitivity check halted its remaining two calls. There were no automatic retries or model fallbacks. Including the initial probe, 218 calls were attempted, within the 220-attempt ceiling. GPT-6 Luna Decisions was not used.

## Base results

Counts below refer only to the 99 base decisions. Unavailable decisions remain visible and are not silently excluded from the denominator.

| Model | Matches reference | Different answer | No usable answer | Median successful request | Known or estimated base cost |
| --- | ---: | ---: | ---: | ---: | ---: |
| Jev 1.13 | 93 | 2 | 4 | 242 ms | $0.00808 |
| Jev 1.14 | 93 | 2 | 4 | 264 ms | $0.00808 |
| Microsoft Decision 1 | 94 | 1 | 4 | 499 ms | $0.00748 |
| DeepSeek V4 Flash 0731 | 99 | 0 | 0 | 1,035 ms | $0.00472 |
| GLM 5.3 Flash, low reasoning | 99 | 0 | 0 | 3,679 ms | $0.01459 |

Jev and Microsoft each answered 63 of 67 document questions correctly, with four unanswered questions belonging to the same oversized document. Both Jev versions matched 22 of 24 entailment labels; Microsoft matched 23. All five models matched the eight localization labels. DeepSeek and GLM matched all 67 document labels and all 24 entailment labels.

These latency samples measure client round trips, with concurrency two and shared provider routing. They compare direct TypeSafe access to OpenRouter-mediated access, not isolated model compute. P95 successful base latency was 449 ms for Jev 1.13, 443 ms for Jev 1.14, 1,059 ms for Microsoft, 2,373 ms for DeepSeek and 14,948 ms for GLM.

## What actually failed

### Oversized extracted content

The full FSM capture contains 67,195 characters, including 27,547 characters of encoded image data across 16 embedded images. Jev returned HTTP 400 with `max_tokens_exceeded`. Microsoft returned HTTP 422 identifying its 32,768-token context limit. The four questions on that document therefore have no model answer for those three candidates.

These failures establish that this captured input exceeded the providers' limits. The image-data measurement makes deterministic cleanup an actionable next probe, but no cleaned-input rerun was performed and its success is not established. The application's `normalizeExaText` currently standardizes control characters and whitespace; the SEC HTML normalizer separately strips SVG elements. This experiment used Firecrawl captures, not the application's full live retrieval pipeline, so it does not prove that the same payload would reach production models.

### Forecast confused with contradiction

The supplied FSM passage identifies a possible margin-pressure mechanism and says management expects subscription gross margins above 80%. The tested claim says inference costs have already reduced margin below 80%. The reference labels that outcome `not_established`: a management expectation neither establishes nor explicitly disproves a realised historical outcome.

Both Jev versions and Microsoft selected `contradicts`. DeepSeek and GLM selected `not_established`. Confidence on the incorrect choice was 0.77 for Jev 1.13, 0.69 for Jev 1.14 and approximately 0.596 for Microsoft. This is a concrete case where preserving uncertainty matters more than merely returning valid JSON.

### Author attribution missed on a short excerpt

The EarningsMoat excerpt explicitly contains a zero-long-term-debt assertion, although the captured paragraph is truncated after the following word fragment. The tested claim is only that the author makes that assertion. The reference therefore labels it `supports`, without endorsing the assertion's truth. Both Jev versions selected `not_established`, with confidence 0.25. Microsoft, DeepSeek and GLM matched the reference.

This probes attribution on a short imperfect excerpt. It does not demonstrate that Jev would miss the same assertion in a fuller paragraph. The preceding source audit's contradiction against the annual report is outside the content supplied in this entailment case.

### Operational refusals

The initial GLM HTTP 400 rejected the requested inference mode. It was preserved separately from the main run rather than scored as a classification error. The main GLM configuration succeeded on all 43 requests. Its recorded usage included 17,861 reasoning tokens out of 18,865 output tokens, so the reasoning requirement materially affected the work done.

DeepSeek returned HTTP 429 on the reversed-option historical-contract request. Its two remaining sensitivity calls were not dispatched. Base accuracy was unaffected, but sensitivity coverage is incomplete.

## Stability and confidence

All five models retained the same answers across the 11 repeated sensitivity decisions. Jev, Microsoft and GLM also retained their answers across all 11 reversed-option decisions. DeepSeek had four valid reversed-option decisions with no changes, then the rate-limit failure. These are small selected probes, not evidence of complete determinism. Repeating an incorrect answer is stability, not correctness.

On the base set, confidence below 0.8 flagged seven valid Jev 1.13 answers, eight Jev 1.14 answers and four Microsoft answers. Those sets included all their observed semantic mistakes, plus correct answers. This is a retrospective observation on this dataset, not a calibrated threshold or an approved escalation rule. Provider confidence must not become analytical confidence in the assessed company.

## Cost and provider evidence

Known provider-reported or tariff-derived inference cost was $0.053807 including the initial probe and sensitivity checks. Five unsuccessful calls lack reported usage or cost. Retaining their pessimistic reservations gives total accounted exposure of $0.138647, below the $1 local budget. This reservation is not a provider invoice.

TypeSafe costs are calculated from returned token usage at the documented $0.042 per million input tokens. Microsoft, DeepSeek and GLM costs use OpenRouter's returned `usage.cost`. Four additional Firecrawl extractions consumed 47 credits separately. Prior-audit retrieval costs are not included in that figure.

OpenRouter routed all observed DeepSeek calls to Reka, Microsoft to Azure and GLM to OpenInference. The provider snapshot (`scripts/evaluations/source-selection/fixtures/provider-prices-2026-10-20.json`, local reference as of 2026-10-22; not included in checkpoint `c4f0d24`) confirms Reka's DeepSeek input tariff of $0.021 per million and output tariff of $0.528 per million. That differs from the general model-catalog tariff of $0.44/$1.32. DeepSeek's observed cost also benefited from 24,576 cached input tokens across the main run. These provider and cache conditions must be retained when interpreting its cost advantage.

The live catalogue also contains other inexpensive decision models. They were not benchmarked here. This comparison is not an exhaustive search for the cheapest available model.

## Consequences for the source-selection design

Keep acquisition, provenance, content qualification and analytical judgment distinct. Retrieve once under an approved acquisition policy, retain the captured artifact, normalize it deterministically and supply bounded content to a grouped semantic qualification request. A useful result should identify document purpose, relevant mechanisms and supporting passage identifiers. It should not declare that a publisher is trustworthy or that a claim is true merely because the text contains it.

The existing metadata selector still needs its demonstrated deterministic defects addressed: document identity versus filing accession, period and recency ordering, family-limit explanations, and recognized document types. A model call does not replace those rules. The semantic layer should inform the existing proposal mechanism rather than introduce a second selection or persistence authority.

For the next design discussion, use DeepSeek Flash as the initial candidate for grouped qualification and entailment, while keeping Jev and Microsoft as viable lower-latency candidates for constrained classification or localization. The current measurements do not justify automatically placing Jev in front of every DeepSeek call: that would add work and cost, and on this route DeepSeek was already cheaper. GLM provided no accuracy gain on this sample and required more time and reasoning tokens.

Before choosing production routing, expand the frozen reference to another company and harder negative, partial and conflicting-source cases, and probe deterministic cleanup on the oversized input. No further paid calls were made for those proposed follow-ups.

Pre-approval document inspection would change the current product contract. This experiment does not approve that change or alter the mandatory corpus checkpoint. Analyst review should remain focused on corpus approval, substantive judgments and unresolved exceptions, not per-question coordination.

## Verification and remaining limits

The CLI dry run checked the 215-call plan and all expected-choice memberships without network access. Six offline assertions imported the real runner and verified valid native/generated responses plus rejection of missing keys, invented choices, invalid probability sums and truncated generation.

Focused TypeScript strict checking and Biome checking passed for the two scripts. A public-CLI mismatch probe demonstrated that offline scoring initially accepted a manifest with a different reference hash; after correction it failed with an explicit reference-mismatch error. The real reference remained unchanged. The final offline recalculation succeeded against the actual manifest, and input hashes and archived runner hashes matched.

Executed verification commands:

```sh
node --experimental-strip-types scripts/evaluations/source-selection/compare.ts
node --experimental-strip-types scripts/evaluations/source-selection/compare.ts --summarize --run 2026-10-20-supported-config
node_modules/.bin/tsc --ignoreConfig --noEmit --strict --target es2023 --module nodenext --moduleResolution nodenext --types node --allowImportingTsExtensions scripts/evaluations/source-selection/compare.ts scripts/evaluations/source-selection/catalog.ts
node_modules/.bin/biome check scripts/evaluations/source-selection
git diff --check
```

The final Biome check covered 12 supported files without changes. A credential-presence scan covered all 21 evaluation files and found neither configured provider key. Both runs' dataset, reference and archived-runner fingerprints matched their manifests. Medians were cross-checked against Python's `statistics.median` and use the mean of the two middle observations for even sample sizes.

The `pnpm exec` Biome invocation stalled and was interrupted. The same locally installed Biome and TypeScript binaries were then invoked directly. No dependency was installed or changed. No application-wide test suite, build, browser journey or Convex deployment ran because application behaviour was not modified.

The recorded main-run summary (`scripts/evaluations/source-selection/runs/2026-10-20-supported-config/summary.json`, local reference as of 2026-10-22; not included in checkpoint `c4f0d24`), journal (`scripts/evaluations/source-selection/runs/2026-10-20-supported-config/calls.jsonl`, local reference as of 2026-10-22; not included in checkpoint `c4f0d24`), manifest (`scripts/evaluations/source-selection/runs/2026-10-20-supported-config/manifest.json`, local reference as of 2026-10-22; not included in checkpoint `c4f0d24`), usage (`scripts/evaluations/source-selection/runs/2026-10-20-supported-config/usage-details.json`, local reference as of 2026-10-22; not included in checkpoint `c4f0d24`) and integrity record (`scripts/evaluations/source-selection/runs/2026-10-20-supported-config/integrity.json`, local reference as of 2026-10-22; not included in checkpoint `c4f0d24`) preserve the raw evidence and limits.

Official references used for interface and catalogue verification: [TypeSafe models](https://docs.typesafe.ai/models), [TypeSafe System One](https://docs.typesafe.ai/api/system-one), [OpenRouter model catalogue](https://openrouter.ai/docs/guides/overview/models), [OpenRouter OpenAPI](https://openrouter.ai/openapi.json), [Microsoft Decision 1 announcement](https://commandline.microsoft.com/microsoft-decision-1-model-foundry/) and [OpenRouter reasoning parameters](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens). Vendor benchmark claims were not used as the scoring reference.
