# DeepSeek qualification failure diagnosis

**Root cause: not established. The authorized single repeat succeeded, so the failure did not reproduce. Routing remains unchanged.** The historical comparison used 133 attempts. One subsequently authorized diagnostic request brought accounting to 134 attempts. The later authorized eleven-call continuation is complete at 145 attempts and USD 0.49142902524 conservatively reserved or reported.

## Observed failure and lost information

Seven of the nineteen DeepSeek observations in the completed grouped comparison have the application label `transport_unavailable`. The seven newly failed attempts completed in 2.512–3.138 seconds. The remaining twelve observations have structurally valid responses, including two reused responses. This does not establish semantic acceptance or a model-quality ranking.

| Document case | Latency in milliseconds | Saved detail |
| --- | ---: | --- |
| `doc_store_rfq` | 2694 | `transport_unavailable` |
| `doc_store_contracts` | 2635 | `transport_unavailable` |
| `doc_hated` | 2887 | `transport_unavailable` |
| `doc_capital` | 3138 | `transport_unavailable` |
| `doc_intellectia` | 2512 | `transport_unavailable` |
| `doc_historical_contract` | 2609 | `transport_unavailable` |
| `doc_q1_presentation` | 2914 | `transport_unavailable` |

The adapter maps HTTP 404, 408, 429, server errors and retryable errors without a status to this same label. The SDK retains HTTP error details internally, but the application result discarded them. The evaluator's earlier diagnostic wrapper inspected successful responses only. Neither the HTTP status, provider message, response identifiers nor generation identifier was saved for these seven failures. Local journal and terminal evidence cannot reconstruct the missing response.

## Images hypothesis

The offline audit imports the retained production source snapshots and uses the actual installed SDK with an injected fetch. It reconstructs all 38 saved input/route requests. The injected fetch returns a synthetic error and any other fetch throws. It does not load credentials or contact a provider.

All 38 requests contain text message parts only. None contains an image, file or other non-text part, and none contains an image data URI. Some text still contains Markdown image references. These remain characters inside a text message, not a visual input. Unsupported image input therefore does not explain these requests. DeepSeek's retained catalog entry also advertises text-only input, so the comparison did not depend on image capability.

The audit retains original input hashes, manifest and journal hashes, exact reconstructed wire hashes, request sizes and message-part types in `runs/qualification-deepseek-diagnosis-20261020/snapshot-request-audit.json`. The earlier audit without snapshot loading remains historical in `request-audit.json`. Neither substitutes for a captured historical HTTP response.

```sh
node --experimental-strip-types scripts/evaluations/source-selection/audit-qualification-requests.ts qualification-choices-v2-complete-20261020 /tmp/qualification-request-audit.json
```

The output file must not already exist. The script verifies snapshot hashes and dependency-lock identity before reconstruction.

## OpenRouter metadata and MCP

The direct Analytics metadata request returned HTTP 403, `Only management keys can access analytics`. Existing inference credentials cannot query those analytics. No credentials were printed or changed.

After Executor reconnection, the OpenRouter MCP documentation lookup and endpoint uptime tool both succeeded. Its hourly history reports Reka at 100% for the 08:00 and 09:00 UTC buckets on October 20. These aggregates do not identify an individual request error or prove a provider outage. The connected MCP exposes generation lookup by identifier, but no request-log listing or Analytics query tool. The required identifiers are missing from the old journal. Tool results are retained in `runs/qualification-deepseek-diagnosis-20261020/mcp-evidence.json`.

OpenRouter documents [generation metadata lookup](https://openrouter.ai/docs/api/api-reference/generations/get-generation) and [stored generation error content](https://openrouter.ai/docs/api/api-reference/generations/get-stored-prompt-completion-and-error-content-for-a-generation). Both require a generation identifier. [Analytics metadata](https://openrouter.ai/docs/api/api-reference/analytics/get-available-analytics-metrics-and-dimensions) requires a management key. No missing identifier or credential is inferred.

## Diagnostic correction and next probe

The production adapter now permits an explicitly supplied observer to receive the bounded response body, HTTP status and the two response identifiers. It runs after the existing 1 MiB decompressed-body limit. It receives no request headers, API key, cookies or arbitrary response headers. Normal production callers do not enable the observer. This changes observability, not routing, retry or qualification policy.

The evaluation `--diagnostics` option uses that observer for successful and failed responses. It records selected error fields, a bounded provider error string and available identifiers. Complete bounded error objects are retained in separate `http/` artifacts. It redacts the configured key and bearer-token forms before parsing. An HTTP failure with a non-JSON body retains redacted content and its original hash. A non-JSON successful response records only its hash. Success diagnostics retain the existing structured candidate and validation. This cannot recover old errors.

The focused observer test failed because no response was delivered, then passed with the real adapter and a synthetic HTTP 502 response. The synthetic schema error is test data, not evidence about the seven historical failures. The transport file passed 12 tests. No paid or nondeterministic provider was invoked by these tests.

The user explicitly authorized one repeat of `doc_store_rfq` with the same DeepSeek/Reka route and unchanged input, raising the cumulative ceiling from 133 to 134 with USD 1 unchanged. Exact request and input-hash identity were checked before dispatch. The repeat completed in 4036 milliseconds with HTTP 200, a structurally valid qualification and a provider-reported cost of USD 0.000394689. The generation identifier and 2524-byte response receipt are now retained. The MCP lookup independently reports one Reka upstream attempt with HTTP 200, `finish_reason: stop` and zero reasoning tokens. Evidence is in `runs/qualification-deepseek-http-diagnostic-20261020/`, including `generation-metadata.json`.

This successful repeat establishes only that the symptom did not reproduce. It does not prove the cause was an outage, throttling, a request defect or the model. It also does not certify every semantic contribution in the new qualification. The application classified product capabilities and package dependencies, while an overbroad `no_substantive_content` warning still requires cautious interpretation. The historical seven failed observations remain unchanged. Recovering their exact cause still requires their original generation identifiers or historical account logs. At that checkpoint no further inference was authorized. The later authorized continuation completed the missing eleven exact-input responses, as recorded below.

The following command was executed once. It includes all six paid histories, disables SDK retries and retains the existing two-worker runner with a one-item queue. Repeating the same run does not reissue its completed attempt:

```sh
node --experimental-strip-types scripts/evaluations/source-selection/qualify.ts --live --run qualification-deepseek-http-diagnostic-20261020 --models deepseek/deepseek-v4-flash-0731 --cases doc_store_rfq --prior-run mimo-choices-20261020,grouped-qualification-20261020,qualification-diagnostics-20261020,qualification-clarified-20261020,qualification-choices-v2-20261020,qualification-choices-v2-complete-20261020 --max-attempts 134 --limit 1 --diagnostics
```


## Authorized comparison continuation

The user subsequently authorized eleven additional requests, cumulative ceiling 145 and USD 1 unchanged. `qualification-current-matrix-20261020` completed all eleven with HTTP 200, including seven DeepSeek and four MiMo requests. The three unchanged-input historical DeepSeek failures in that batch (`doc_store_contracts`, `doc_intellectia`, `doc_q1_presentation`) succeeded. Together with the earlier RFQ diagnostic, four original failure inputs have successful exact-input repeats. Corrected inputs are not exact reproductions of their older failures. The original failure cause remains unknown because its HTTP evidence is unavailable. All old outcomes remain preserved. Both current model matrices are complete, but [semantic acceptance is blocked](QUALIFICATION-ASSESSMENT-2026-10-20.md). There is no authorization above 145, no routing-order change and no runtime activation.
