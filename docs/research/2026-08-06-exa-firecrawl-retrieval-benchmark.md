# Exa Contents vs Firecrawl Scrape Retrieval Benchmark

Date: 2026-08-06

Status: **Completed — retain Exa Contents as the approved-web-source retrieval provider; do not introduce Firecrawl as a production fallback.**

## Decision

The benchmark does not meet the adoption threshold recorded before execution. Exa and Firecrawl both produced usable, complete, relocalizable content for all ten sources. Firecrawl was never usable where Exa was partial or unusable, so it recorded zero material fallback wins against the required minimum of two.

Keep the ADR-004 decision unchanged: use Exa Contents for approved general web sources and leave Firecrawl deferred. Firecrawl credits remain useful for future targeted re-evaluation if Phase 5 records repeated failures on real approved sources, but available credits are not evidence that another production provider is needed.

## Scope and safety boundary

This was an out-of-band retrieval benchmark, not a Phase 5 implementation. It made no Convex writes and changed no schema, workflow, discovery adapter, provider routing, analyst-facing behavior, or approval boundary. SEC filings and PDFs were excluded because their selected paths are direct SEC retrieval and page-aware normalization rather than general web scraping.

The reusable harness lives under `src/__tests__/benchmarks/` with one opt-in live contract at `src/__tests__/live/retrieval-benchmark.contract.test.ts`. Default and CI execution make zero provider calls. Live execution requires both `RUN_LIVE_PROVIDER_TESTS=1` and `RUN_RETRIEVAL_BENCHMARK=1`, a non-empty Exa credential, an authenticated Firecrawl CLI, and at least 20 Firecrawl credits before any benchmark retrieval starts.

Raw provider payloads, normalized review copies, hashes, request identifiers, and the blind provider key were written only to `/tmp/agentic-resilience-retrieval-benchmark/2026-08-06T18-48-15-662Z/`. They are intentionally not committed because retrieved third-party content is mutable and may be copyrighted.

## Frozen corpus

The corpus was frozen on 2026-08-06 with six CCC first-party product/technology pages and four public third-party sources. Each source had three short independently selected text anchors.

| Class | Source |
|---|---|
| First party | [CCC Auto Physical Damage](https://www.cccis.com/insurance-carriers/apd) |
| First party | [CCC First Look](https://www.cccis.com/insurance-carriers/claims-solutions/apd/ccc-first-look) |
| First party | [CCC Claims Processing](https://www.cccis.com/insurance-carriers/apd/claims-processing) |
| First party | [CCC Claims Estimating](https://www.cccis.com/insurance-carriers/apd/claims-estimating) |
| First party | [CCC IX Cloud Platform](https://www.cccis.com/our-technology/ix-cloud-platform) |
| First party | [CCC Secure Share](https://www.cccis.com/secure-share) |
| Independent trade press | [Repairer Driven News — CCC Crash Course report](https://www.repairerdrivennews.com/2023/03/14/ccc-2023-crash-course-report-explores-ai-effects-on-collision-claims-processes/) |
| Independent trade press | [Insurance Journal — Why Totaled Auto Losses Are Hard to Pin Down](https://www.insurancejournal.com/magazines/mag-features/2024/03/04/762503.htm) |
| Third-party vendor case study | [NVIDIA — AI-powered auto repair estimates](https://www.nvidia.com/en-eu/case-studies/delivering-millions-of-ai-powered-auto-repair-estimates-for-better-claims-experiences/) |
| Third-party transcript host | [Investing.com — CCC Q1 2026 earnings call transcript](https://www.investing.com/news/transcripts/earnings-call-transcript-ccc-intelligent-solutions-q1-2026-beats-forecasts-93CH-4654050) |

## Method

- Exa used the installed `exa-js` 2.16.0 client with `getContents([url], { text: true, maxAgeHours: 24, filterEmptyResults: false })`.
- Firecrawl used the authenticated CLI 1.19.0 with `scrape`, Markdown-only output, `--only-main-content`, a 24-hour maximum cache age, JSON metadata, and request timing. Search, crawl, JSON extraction, screenshots, browser actions, and summaries were not used.
- Provider order alternated by source to reduce simple order bias.
- Each provider had a 120-second outer timeout and at most one retry for timeout, network, HTTP 408, HTTP 429, or HTTP 5xx failures. The worst-case ceiling was 20 Exa retrieval requests and 20 Firecrawl scrape credits; the observed run needed one attempt per source.
- Both outputs were normalized identically with Unicode NFKC, LF line endings, trailing-whitespace removal, excessive-blank-line reduction, and outer trimming. Native and normalized SHA-256 hashes remained separate.
- Neutral observations captured provider, input/final URL, success/error, attempts, latency, title, word and character counts, anchor coverage, hashes, request identifier, client version, and provider-reported cost when available.
- Manual scoring was performed on A/B files before opening the provider map. The four 0–2 dimensions were completeness, structure, noise absence, and exact-quote relocalizability.
- A retrieval was `usable` only when completeness and relocalizability were both 2 and no score was 0; it was `partial` when relevant content remained but at least one required dimension was 1; errors, empty/blocked content, or a 0 were `unusable`.

## Aggregate results

| Metric | Exa Contents | Firecrawl Scrape |
|---|---:|---:|
| Successful sources | 10 / 10 | 10 / 10 |
| Usable after blind review | 10 / 10 | 10 / 10 |
| Requests / attempts | 10 / 10 | 10 / 10 |
| Mean anchor coverage | 100.0% | 96.7% |
| Mean latency | 2,361 ms | 2,381 ms |
| Median latency | 1,145 ms | 2,391 ms |
| Observed p95 latency (nearest rank, n=10) | 10,385 ms | 2,682 ms |
| Mean words returned | 2,285 | 2,531 |
| Mean completeness score | 2.0 | 2.0 |
| Mean structure score | 1.2 | 1.6 |
| Mean noise-absence score | 1.3 | 1.1 |
| Mean relocalizability score | 2.0 | 2.0 |
| Observed provider usage | USD 0.010 reported total | 10 credits consumed |

Exa had the lower median latency and complete anchor coverage, but its long tail on NVIDIA and especially Investing.com made mean latency almost identical to Firecrawl. Firecrawl was more consistent and produced better heading structure on five CCC pages. That structural advantage did not improve completeness or quote relocalizability, and Firecrawl included substantially more navigation/noise on Repairer Driven News and NVIDIA. Firecrawl missed one of three exact anchors on Repairer Driven News.

## Per-source blind scores

Scores are shown as `completeness / structure / noise absence / relocalizability`.

| Source | Exa | Firecrawl | Exa anchors | Firecrawl anchors | Classification |
|---|---:|---:|---:|---:|---|
| CCC Auto Physical Damage | 2 / 1 / 1 / 2 | 2 / 2 / 1 / 2 | 3 / 3 | 3 / 3 | Both usable |
| CCC First Look | 2 / 1 / 1 / 2 | 2 / 2 / 1 / 2 | 3 / 3 | 3 / 3 | Both usable |
| CCC Claims Processing | 2 / 1 / 1 / 2 | 2 / 2 / 1 / 2 | 3 / 3 | 3 / 3 | Both usable |
| CCC Claims Estimating | 2 / 1 / 1 / 2 | 2 / 2 / 1 / 2 | 3 / 3 | 3 / 3 | Both usable |
| CCC IX Cloud Platform | 2 / 1 / 1 / 2 | 2 / 2 / 1 / 2 | 3 / 3 | 3 / 3 | Both usable |
| CCC Secure Share | 2 / 1 / 2 / 2 | 2 / 1 / 2 / 2 | 3 / 3 | 3 / 3 | Both usable |
| Repairer Driven News | 2 / 1 / 2 / 2 | 2 / 1 / 1 / 2 | 3 / 3 | 2 / 3 | Both usable |
| Insurance Journal | 2 / 1 / 1 / 2 | 2 / 1 / 1 / 2 | 3 / 3 | 3 / 3 | Both usable |
| NVIDIA case study | 2 / 2 / 2 / 2 | 2 / 1 / 1 / 2 | 3 / 3 | 3 / 3 | Both usable |
| Investing.com transcript | 2 / 2 / 1 / 2 | 2 / 2 / 1 / 2 | 3 / 3 | 3 / 3 | Both usable |

## Observed provider differences

- Exa frequently appended CCC JSON-LD to otherwise complete content, which reduced structure/noise scores but also preserved some FAQ answers that were not visible in the main Markdown body.
- Firecrawl produced cleaner heading structure on the five modern CCC product/technology pages, but `onlyMainContent` did not reliably remove site navigation, country selectors, related content, job listings, or financial-site chrome.
- Exa produced the cleanest NVIDIA and Repairer Driven News copies. Firecrawl's NVIDIA output contained a long locale selector, and its Repairer Driven News output contained navigation and sharing controls.
- Firecrawl exposed canonical redirect destinations for CCC First Look and CCC Secure Share, while Exa returned the requested URLs. This is useful metadata, but it is not a reason to delegate provenance or redirect safety to Firecrawl: Phase 5 still needs application-owned canonicalization, redirect validation, and stable locators.
- Firecrawl returned richer page titles for most CCC pages; Exa often returned URL slugs. Title quality is metadata convenience rather than retrieval sufficiency.

## Adoption rule and outcome

The precommitted rule was: recommend Firecrawl only when it is usable on at least two sources where Exa is partial or unusable, without worse anchor coverage or relocalizability.

Observed material wins: **0**.

Outcome: **do not add Firecrawl to the production architecture now.** Exa Contents is sufficient for this representative approved-web-source corpus. Firecrawl's structure and latency-tail advantages are real but non-material under the evidence-workbench requirements because Exa remained complete and precisely relocalizable on every source.

## Limits and next trigger

This is one dated run on ten public pages with 24-hour provider caches and one reviewer. It does not establish universal provider reliability, measure uncached cold retrieval, cover paywalls or authenticated pages, test every JavaScript-heavy site, or evaluate SEC/PDF paths. Provider behavior, page content, pricing, and credit accounting can change.

Re-run the same harness only when Phase 5 telemetry supplies a concrete trigger: repeated Exa timeouts, empty/blocked content, missing essential sections, or failed stable-locator construction on approved general-web sources. A future adoption decision should use the same material-win threshold and should become a separate ADR/Phase 5 adapter change; the benchmark itself does not authorize production integration.
