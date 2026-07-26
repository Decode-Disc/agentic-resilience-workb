# ADR-010: Keep Provider Routing, Retries, and Fallback Application-Controlled

## Status

Accepted

## Date

2026-07-27

## Context

The MVP requires OpenRouter, experimental Codex subscription transport, SEC
EDGAR, Exa, and Unstructured. Provider libraries offer useful transport and
typing, but provider-owned retries or routing must not silently change the model
task, duplicate an external side effect, or advance a cancelled workflow.

The application also needs one auditable fallback policy across providers.
Routing all services through CLIProxyAPI would create a shared failure point and
overlap its routing behavior with the application-owned `ModelRouter`.

Current primary documentation establishes these practical boundaries:

- [`@openrouter/ai-sdk-provider`](https://github.com/OpenRouterTeam/ai-sdk-provider)
  integrates OpenRouter with the Vercel AI SDK and exposes provider routing and
  usage metadata;
- [`@ai-sdk/openai-compatible`](https://github.com/vercel/ai/tree/main/packages/openai-compatible)
  supports a custom OpenAI-compatible base URL for CLIProxyAPI;
- [`exa-js`](https://github.com/exa-labs/exa-js) separates search from
  `getContents`;
- [SEC developer resources](https://www.sec.gov/about/developer-resources)
  require declared automation identity and bounded request rates;
- the [Unstructured JavaScript/TypeScript client](https://docs.unstructured.io/api-reference/legacy-api/partition/sdk-jsts)
  documents the legacy Partition endpoint, while the current
  [Pipeline Jobs API](https://docs.unstructured.io/api-reference/workflow/overview)
  documents direct HTTP and the Python SDK.

## Decision

Use a small application-owned adapter for every external provider.

### Model providers

- Use `ai` with `@openrouter/ai-sdk-provider` for OpenRouter.
- Use `ai` with `@ai-sdk/openai-compatible` for the private CLIProxyAPI
  inference surface.
- Keep provider and model identifiers in configuration.
- Allow OpenRouter infrastructure routing only for the same configured model
  and explicit parameter/privacy requirements. Disable or constrain
  provider-internal fallbacks when they would obscure the selected execution.

### Source providers

- Query SEC EDGAR directly over HTTP for identity, filings, filing metadata,
  and filing content.
- Use `exa-js` for metadata-only discovery. Do not request page contents during
  the pre-approval search stage.
- Call `getContents` only for URLs in an approved corpus revision.
- Use direct HTTP for the current Unstructured Pipeline Jobs API. Do not install
  the JavaScript client merely to call its legacy one-file Partition endpoint.

### Application policy

For each task, the application configuration declares the primary provider,
bounded retry policy, optional fallback provider/model, and hard resource
limits. The application:

1. persists the intended logical operation and idempotency key;
2. performs bounded retry on retryable transport failures;
3. invokes the explicitly configured fallback only after primary exhaustion;
4. records every attempt and the fallback reason in `ProviderCall`;
5. validates the typed result before it becomes usable;
6. rejects late results whose execution generation no longer matches the active
   run.

Fallback never silently changes task semantics, evidence policy, or workflow
authority.

## Alternatives Considered

### Send OpenRouter and Codex traffic through CLIProxyAPI

- Pros: one apparent inference endpoint.
- Cons: shared failure domain, overlapping routing and fallback, harder
  diagnostics, and possible loss of OpenRouter metadata and options.
- Rejected.

### Let every provider apply its default retry and fallback behavior

- Pros: less adapter code.
- Cons: retry counts, model changes, side effects, and costs become difficult to
  correlate with workflow idempotency.
- Rejected.

### Use the Unstructured JavaScript client for normalization

- Pros: generated TypeScript client for the legacy Partition endpoint.
- Cons: the documented client targets the legacy API, while the selected
  production-level flow is the current Pipeline Jobs API.
- Rejected for the current API. Reconsider if Unstructured publishes a current
  TypeScript Jobs client with a material advantage over bounded HTTP.

## Consequences

- Adapters map provider types into application-owned task and acquisition types.
- Default and CI tests use deterministic fake adapters; live contract tests are
  explicit, opt-in, and budget-limited.
- Provider configuration must make fallback targets and OpenRouter routing
  constraints inspectable.
- Cancellation and workflow retries remain application concerns even when an
  SDK performs transport.
- Provider package versions are pinned when installed and verified against
  current primary documentation during each implementation slice.
