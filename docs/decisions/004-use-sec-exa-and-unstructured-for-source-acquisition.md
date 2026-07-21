# ADR-004: Use SEC, Exa, and Unstructured for Source Acquisition

## Status

Accepted

## Date

2026-07-20

## Context

The evidence workbench needs to discover authoritative sources, preserve a human-approved corpus, retrieve approved documents, and normalize them into reproducibly locatable passages. These are distinct responsibilities:

1. source discovery proposes candidates;
2. an analyst accepts or rejects the proposed corpus;
3. retrieval and normalization operate only on approved sources;
4. model-based claim extraction operates only on normalized passages from that corpus.

An all-in-one search or extraction call that retrieves and analyzes source contents before approval would obscure this boundary and risk allowing rejected material into downstream artifacts.

The prototype scope is US-listed technology companies, which provides a standardized first-party regulatory source base through SEC EDGAR.

## Decision

Use the following provider boundaries for the prototype:

### Discovery before approval

- Query SEC EDGAR directly for company identity, filings, and filing metadata.
- Use Exa Search for general web discovery, with contents disabled during the discovery stage.
- Accept analyst-supplied URLs and PDF uploads as proposed sources.
- Persist candidate metadata and the reason for selection without treating search snippets or provider summaries as evidence.

### Retrieval and normalization after approval

- Retrieve SEC filing content directly from the SEC where available.
- Use Exa Contents in text-only mode for approved general web sources.
- Use Unstructured SaaS to normalize approved public PDFs when page-aware parsing is required.
- Persist the retrieved artifact or normalized representation as an immutable `SourceVersion` with a content hash and retrieval metadata.
- Create web passage locators from the canonical URL, heading path, exact quotation, surrounding text, and source-version hash.
- Create PDF passage locators from the source-version hash, page number, bounding box when available, and exact quotation.

Unstructured SaaS may receive only documents that are both analyst-approved and classified as public. The prototype must not silently send a private or sensitive upload to a hosted parser. If a document cannot be classified as public, normalization must remain unavailable or require a separately approved local-processing design.

The initial counter-evidence pass searches within the approved corpus. Any newly discovered external source is only a lead: it requires a new corpus revision and another explicit approval checkpoint before retrieval, normalization, or claim extraction.

## Alternatives Considered

### Firecrawl as the primary search and retrieval provider

- Pros: combines search, JavaScript rendering, scraping, raw HTML, Markdown, and PDF support.
- Cons: adds an additional provider without directly solving stable page and bounding-box provenance for PDFs.
- Deferred: add as a retrieval fallback only if measured failures show that Exa Contents and direct retrieval are inadequate.

### Tavily for search and extraction

- Pros: simple search and extraction APIs with transparent credit pricing.
- Cons: no demonstrated advantage over Exa for the initial financial-report and company-document corpus.
- Deferred: retain behind the discovery-provider contract for a future benchmark.

### Docling as a self-hosted document normalizer

- Pros: rich page, bounding-box, heading, OCR, and source provenance with local processing.
- Cons: introduces a Python service and model/runtime operational weight before the prototype demonstrates a need for it.
- Deferred: preferred fallback if privacy, SaaS limits, or measured locator quality make hosted normalization unacceptable.

### One provider call for discovery, retrieval, and structured claims

- Pros: fewer integration steps and potentially lower latency.
- Cons: collapses the mandatory corpus checkpoint and makes rejected-source exclusion difficult to prove.
- Rejected: incompatible with the evidence-first workflow.

## Consequences

- Discovery-provider relevance remains an estimate and never becomes evidence automatically.
- The same vendor may serve discovery and later retrieval, but only through separate persisted workflow stages.
- Source and normalization failures remain visible per source and do not stop unrelated work.
- Provider-specific responses must be validated and mapped into application-owned types.
- Exa, SEC, and Unstructured usage must be recorded as external provider calls for latency, retry, audit, and available usage or reported-cost telemetry.
- Live-provider contract tests must be explicit, opt-in, and budget-limited.
- Provider quality remains unproven until evaluated on the curated corpus; adapters must remain replaceable.
