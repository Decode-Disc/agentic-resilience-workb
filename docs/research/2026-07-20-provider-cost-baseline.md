# Provider Cost Baseline

## Status

Optional historical research snapshot. It is not an implementation prerequisite, an architectural decision, or a promise of actual dossier cost. ADR-006 supersedes the transaction-grade budgeting approach that motivated this analysis.

## Snapshot Date

2026-07-20

## Current Use

Use this snapshot only to understand relative provider cost drivers. The candidature prototype relies on visitor limits, bounded retries and research breadth, provider-side controls when available, and best-effort usage telemetry. It does not require exact per-run cost reservation, settlement, or average-cost calibration.

## Verified Public Pricing

| Service | Public unit | Snapshot price | Operational treatment |
| --- | --- | ---: | --- |
| SEC EDGAR | Requests | No usage fee; fair-access limits apply | Direct first-party regulatory source |
| Exa Search | Request with up to ten results | USD 0.007 | Discovery with contents disabled |
| Exa Search additional results | Result beyond the first ten | USD 0.001 | Bound discovery breadth |
| Exa Contents | Page per requested content type | USD 0.001 | Request text only for approved web sources |
| Unstructured | Document page after free allowance | USD 0.03 | Bound approved PDF pages |
| OpenRouter | Model-specific input, output, cache, image, tool, or request units | Dynamic | Use account-side spending controls when available |
| CLIProxyAPI | Software license | USD 0 | Hosting and operations remain separate fixed costs |
| Codex subscription | Subscription capacity | No reliable per-call dollar conversion | Record observable usage only |

Official references:

- [SEC EDGAR access and fair-use guidance](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data)
- [Exa pricing](https://exa.ai/pricing?tab=api)
- [Unstructured pricing](https://www.unstructured.io/pricing)
- [OpenRouter pricing](https://openrouter.ai/pricing)
- [Codex pricing and subscription limits](https://developers.openai.com/codex/pricing)
- [Upstream CLIProxyAPI repository](https://github.com/router-for-me/CLIProxyAPI)

Provider prices and free allowances may change. Do not copy this table into domain logic.

## Prototype Usage Notes

- Bound source discovery, approved PDF pages, provider calls, and retries through configuration.
- Use provider-reported usage and cost fields for diagnostics when available.
- Prefer provider-side credit or spending controls over application-level accounting.
- A single measured showcase run is sufficient to reveal obvious usage problems before the candidature demo.
- Exact average dossier cost is not required because the project is not being validated as a SaaS business.
