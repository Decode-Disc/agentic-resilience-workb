# Evidence Retrieval: Working Decisions and Research

## Subsequent implementation authority

The user subsequently approved implementation of the retrieval comparison. [ADR-025](../decisions/025-use-versioned-scoped-evidence-retrieval.md) and the [implementation plan](../superpowers/plans/2026-10-21-evidence-retrieval.md) own that later decision and its validation gates. The discussion below records the earlier state of knowledge. It is retained as research history and does not imply that an unverified integration is deployed. The broader goal remains paused.

## Status and Authority

Recorded on 2026-10-21 before implementation. The user accepted comparing a structured lexical baseline with a lexical-and-embedding hybrid. The user excluded embedding models running on their own machine and prioritized free services, allowing consideration of a verified free tier or very marginal additional cost. These are accepted comparison constraints, not acceptance of a deployed architecture or a particular embedding model.

Cloudflare Workers AI is the recommended hosted embedding candidate. Direct invocation from Convex is a recommendation, not an approved provider integration. Account access, available quota, runtime behavior, retrieval quality and actual workload costs remain unverified.

This record documents the discussion and its evidence. It is neither an implementation plan nor an acceptance report, and it supersedes no accepted ADR. The broader implementation goal remains paused. Documentation does not authorize inference, installation, provider configuration, application or data changes, deployment, or resumption of that goal.

Before implementation, reconcile the selected design with [ADR-023](../decisions/023-use-decision-anchored-phase-5-evidence-workflow.md), [ADR-024](../decisions/024-qualify-source-content-before-corpus-approval.md), [ADR-010](../decisions/010-keep-provider-routing-retries-and-fallback-application-controlled.md) and [technical context](../../context/TECH.md). In particular, do not silently raise the locked passage limits or add a provider under a contract that currently specifies no additional retrieval-model request.

## Destination and Prototype Priorities

Choose a small, inspectable retrieval foundation that preserves enough useful evidence to prepare a credible dossier at low cost across changing sources and companies.

The user prefers retaining useful sources with a few additional questionable candidates over losing useful material through excessive filtering. This does not grant questionable sources factual authority. Multiple sources, later processing and analyst review are reasons to avoid requiring perfect model performance, not reasons to accept systematic evidence loss or unsupported conclusions.

Keep the candidature demonstration, precise citations and analyst control central. Avoid building a general search platform, replacing the existing workflow engine or introducing infrastructure merely because a tutorial uses it. Improvements must be justified by the preparation and evidence paths exposed by this prototype.

## Verified Local Findings

### Different stages answer different questions

Source discovery, proposal composition, content qualification, passage retrieval and semantic comparison are separate stages. Discovery already has document-aware rules, including annual, interim and material SEC filings in [sourceDiscoveryActions.ts](../../convex/sourceDiscoveryActions.ts). The [source selection policy](../../convex/domain/sourceSelectionPolicy.ts) combines authority, provider position, recency, coverage and content contributions. A passage-retrieval failure does not establish that all discovery and proposal behavior is defective.

The observed failures establish a concrete need to revisit document preparation and retrieval. They do not establish that Convex, immutable captures or the existing workflow architecture must be replaced.

### Evidence can disappear before relevance ranking

[sourcePassages.ts](../../convex/domain/sourcePassages.ts), through `extractPassagesFromNormalizedText`, traverses normalized text but retains bounded detailed and brief passage buckets. Detailed passages take priority in the returned set. The default is 512 retained passages, with a maximum quotation size of 4,000 characters, as specified in [resourceLimits.ts](../../convex/resourceLimits.ts) and ADR-023. Traversing the document does not mean that retained passages cover the whole document.

The 512 limit is a passage count, not the 512-token chunk size discussed in the multi-scale retrieval video. Changing a chunk size and changing a retained-passage ceiling address different mechanisms.

The same extraction owner is used by qualification in [sourceQualification.ts](../../convex/domain/sourceQualification.ts), comparison preparation in [sourcePreparationActions.ts](../../convex/sourcePreparationActions.ts) and approved-source materialization in [evidenceActions.ts](../../convex/evidenceActions.ts). Qualification then applies its own selection by detailed-content priority and matches against research-angle and generic documentary terms, within a 128-KiB serialized input envelope. Fixing only comparison ranking would leave other selections unchanged.

### The comparison ranker is a simple lexical heuristic

[sourceComparison.ts](../../convex/domain/sourceComparison.ts) selects at most eight supporting captures using document purpose, matching reporting-period end, authority and recency. This selection precedes reading supporting document contents and is shared across the contributions in the comparison. Its preference for financial reports may be unsuitable for some capability or commercial-terms questions, but the frequency and impact of that failure remain unmeasured.

For passage ranking, the query text combines a contribution summary and its quotations. The code lowercases text, extracts alphanumeric terms of at least three characters, removes a small stopword list and counts distinct shared terms against each passage and heading. Every shared term has equal weight. There is no term-rarity weighting, passage-length normalization or semantic embedding in this path. Document purpose, period and authority break lexical-score ties rather than correcting a high but irrelevant lexical score.

The selection keeps six passages per contribution, with at most two preceding context passages added when a selected passage already looks structured, and a global limit of 64 primary passages. A table omitted by the initial ranking cannot obtain its missing context through this expansion.

### Table structure and context need explicit treatment

The SEC HTML normalizer in [evidenceNormalization.ts](../../convex/integrations/evidenceNormalization.ts) converts table-cell endings into separators and row endings into blank lines. Passage extraction subsequently splits on blank lines. A row, date header, unit caption and explanatory note can therefore become separate passages. Finding a relevant row does not establish that its columns and units remain interpretable.

### The evaluation and application did not use identical extraction limits

The [second-batch report](../verification/2026-10-21-source-quality-second-batch.md) records that the Adobe annual revenue table containing USD 23,769 million was absent from the grouped comparison context. A subsequent read-only probe against the immutable capture and the real extractor showed two distinct losses: the default 512-passage extraction did not retain that table row, while extraction with a 10,000-passage allowance retained it but the comparison ranker did not select it.

The grouped evaluation explicitly sets `maxPassages: 10000` in [source-quality-study.ts](../../scripts/evaluations/source-selection/source-quality-study.ts). The application comparison action uses the default allowance. The batch reused real domain preparers and validators, but it was not an identical action-level extraction path or an end-to-end workflow run. This qualification supplements the historical report without rewriting its requests, results or references. The probe was a diagnostic observation, not a new saved acceptance run.

The grouped reference expected 14 inconclusive outcomes out of 16, two scoped no-conflict outcomes and no conflict outcome. High agreement with that reference cannot establish good retrieval: an always-inconclusive result would match 14 cases. Measure retrieval against evidence in the complete available capture separately from the verdict justified by the supplied context.

## Accepted Direction and Remaining Choices

| Topic | Status | Meaning |
| --- | --- | --- |
| Structured lexical retrieval | Accepted for comparison | Replace the rudimentary overlap baseline with a substantive lexical baseline, considering BM25 and coherent section/table context. |
| Lexical and semantic hybrid | Accepted for comparison | Compare lexical retrieval plus embeddings and deterministic rank fusion against the lexical baseline under comparable context limits. |
| Embedding execution location | Accepted constraint | No embedding model on the user's machine. A hosted service must perform embedding inference. |
| Cost | Accepted constraint | Prioritize no additional financial cost. Consider a verified free tier or a very marginal cost with explicit evidence before a spending decision. No monetary threshold has been chosen. |
| Cloudflare Workers AI | Recommended candidate | Evaluate hosted embeddings without assuming a particular model, account quota, deployment or integration has been accepted. |
| Direct Convex-to-Workers-AI calls | Recommended integration shape | Avoid an intermediary Worker when it would only forward requests. A Worker remains technically possible if a concrete responsibility justifies it. |
| Final retrieval technology | Not selected | No embedding model, dependency, index schema, ranking weights or production activation has been approved. |

## Approaches Considered

| Approach | Fit and benefits | Failure conditions and disposition |
| --- | --- | --- |
| Conventional baseline: structured lexical retrieval | Reuse the current domain and preparation owners, search the available document content, weight discriminating terms and preserve coherent evidence context. No additional inference call is needed for ranking. | Exact-term search may miss paraphrases. Retained for comparison, not declared sufficient before measurement. |
| Conventional ecosystem approach: lexical and embedding hybrid | Combine exact-term candidates with semantic candidates and merge their rankings using reciprocal rank fusion. Hosted embeddings meet the execution-location constraint. | Cannot recover content excluded before indexing, and similarity does not establish comparable periods or units. Cost, provider handling and quality need verification. Retained for comparison. |
| Structural alternative: bounded whole-section context | Select a few plausible sections and preserve their content order rather than aggressively ranking isolated fragments. This tests whether fine-grained retrieval adds value. | Large sections consume more downstream input; section selection may still miss evidence. Not selected as a separate implementation, but useful as a simple evaluation control if practical. |
| Relational alternative: graph-assisted retrieval | Explicit relationships may help questions requiring paths across products, companies or dependencies. | Adds extraction, entity resolution, provenance and maintenance work. A graph does not restore omitted source text or certify extracted relationships. Deferred by recommendation, not permanently ruled out by the user. |

No evidence currently establishes that a reranker is necessary. Reranking can reorder an existing candidate set but cannot recover evidence absent from that set. Likewise, changing the decision model alone cannot correct missing input evidence.

## Recommended Foundation, Pending Design

Retain Convex, immutable captures, exact source locators and the existing durable workflow. Extend the existing normalization, passage, qualification and comparison owners before adding a new retrieval component or framework. Convex provides [full-text search](https://docs.convex.dev/search/text-search), and the [RAG component source inspected during research](https://github.com/get-convex/rag/blob/8647bdefba28057c2393cc27fc40ad5a1ff820b3/src/component/search.ts) includes hybrid fusion. These are reuse candidates, not approved dependencies or proof of suitability for the project's citation contract.

Separate candidate traversal and searchable representations from the smaller set sent for a particular task. Candidate discovery should consider the whole authorized, size-bounded capture without requiring every candidate to become a persisted analytical passage or model input. Precise limits, representation ownership and any ADR amendment remain open design work.

Represent evidence at useful structural levels, such as passages, tables and sections, while retaining a single authoritative source capture. Search representations may include heading, period or unit context, but must remain distinguishable from exact quotations. They must resolve back to the original capture hash and spans rather than silently editing cited source text.

For comparisons, retrieve by the concept or metric, entity, period and applicable basis. Do not favor the amount claimed by an article when seeking counter-evidence: a contradiction can contain a different amount. Unknown period or unit information must remain visible rather than being inferred from semantic similarity. Designing compact retrieval queries is still necessary; the current long summary-plus-quotation query is not automatically suitable for another search engine.

Construct a bounded evidence package after retrieval. Include the table headers, dates, units and notes needed to interpret a row, or a coherent section where context is distributed. Search granularity need not equal the context supplied to the comparator. How this fits the existing passage and serialized-input limits must be decided explicitly.

## Cloudflare Workers AI Feasibility and Cost Snapshot

The official documentation checked on 2026-10-21 supports hosted embeddings through [Workers AI's REST API](https://developers.cloudflare.com/workers-ai/get-started/rest-api/). A separate Worker is not required to invoke that API from an existing backend. Workers AI inference and a Worker application's ordinary CPU execution are different facilities. This proposal uses hosted model inference, not a model downloaded to the user's machine.

The proposed ownership is: Convex authorizes and coordinates work, Workers AI computes embeddings, and Convex retains captures, derived vectors, task results and analyst decisions. Cloudflare Vectorize is technically available but is not required by this proposal; no second persistence authority or workflow engine is selected.

The [Workers AI pricing page](https://developers.cloudflare.com/workers-ai/platform/pricing/) states a free allocation of 10,000 neurons per day, resetting at 00:00 UTC. Under Workers Free, exceeding the allocation blocks further calls unless the account is upgraded. Workers Paid can charge for usage above the allocation. The account's actual plan and remaining allocation were not inspected.

As an illustration, the published BGE-M3 rate is 1,075 neurons per million input tokens, approximately USD 0.012 per million input tokens at the published paid rate. Dividing the free allocation by that rate gives about 9.3 million input tokens per day if the entire allocation is dedicated to this model. This arithmetic is not a measured dossier capacity, a reserved allowance or selection of BGE-M3. Document and query embeddings, overlap, multiple representations, retries and other account usage consume the allowance. Paid usage also depends on the account plan; the token rate is not the complete price of upgrading an account.

Reuse embeddings only when their source and embedding configuration match. Record resource usage and stop explicitly when authorized limits or provider availability prevent more work. Do not introduce a paid fallback or silently present lexical-only results as a completed hybrid comparison. Prototype controls should remain proportional to [ADR-006](../decisions/006-use-lightweight-prototype-usage-guards.md), without adding a transaction-grade billing ledger.

## Video Research and Source Coverage

All three videos' metadata and complete English transcripts were retrieved. Analysis used transcripts and the external sources below, not frame-by-frame visual review. A vendor demonstration is evidence of the described approach, not independent validation of its reported performance.

| Video | Sources actually read | Relevant finding and limits |
| --- | --- | --- |
| [Stop Chunking Like It's 2022, Yuval Belfer](https://www.youtube.com/watch?v=r9OwPx_HoV0), particularly 8:12-15:24 | [Official talk page linked in the description](https://ai.engineer/talks/r9OwPx_HoV0-youtube-53783b315e0664562cfb), [AI21 study](https://www.ai21.com/blog/query-dependent-chunking/), [example repository](https://github.com/AI21Labs/multi-window-chunk-size) | Several chunk sizes produce rankings that vote for parent documents through rank fusion. Oracle headroom is not an achievable gain guarantee. The study measures document-level retrieval and reports additional indexing/storage work; it does not establish precise financial-table recovery in this application. |
| [How Bridgewater Built an AI Analyst That Does Hours of Expert Research in Minutes](https://www.youtube.com/watch?v=lXZb21CfeIY), particularly 10:24-11:14 and 21:13-25:29 | [LangGraph page linked in the description](https://www.langchain.com/langgraph) | The speakers describe inspecting frequency, currency and values after search, plus structured plans, enforced validation and caching. Their accuracy and latency figures concern an internal system and were not independently reproduced. The framework page does not verify those results. |
| [RAG Needs a Map, Nyah Macklin](https://www.youtube.com/watch?v=LJ2a9nX3vlo), particularly 11:38-20:18 and 42:22-51:07 | [Official talk page linked in the description](https://ai.engineer/talks/LJ2a9nX3vlo-youtube-cf62a92c82ed1de99233), [GraphAcademy workshop](https://graphacademy.neo4j.com/courses/workshop-genai), [linked GraphRAG repository](https://github.com/neo4j/neo4j-graphrag-python) | Vector lookup can be extended with connected graph context and schema-guided relationship extraction. The demonstration's 30-versus-15 lesson count illustrates why a working pipeline still needs data checks. No local need for graph traversal has yet been measured. |

The source-to-project mapping below records adaptations rather than claiming faithful reproduction of any complete tutorial architecture.

| Source component | Mechanism and intended result | Project treatment | Status |
| --- | --- | --- | --- |
| AI21 multi-scale indexing and rank fusion | Search several representations so a fixed granularity does not determine all retrieval behavior. | Consider passage, table and section context, and compare fusion where appropriate. Do not assume six indices or reported gains transfer. | Adapted; exact representation design remains open. |
| AI21 parent-document retrieval | Make candidates comparable across chunk sizes and supply broader context. | Preserve capture identity but bound the evidence package; sending complete annual reports is not selected. | Intentional divergence for prototype input and cost constraints. |
| Bridgewater inspection of retrieved data | Check semantic appropriateness beyond a search score. | Preserve entity, measure, period, unit and scope checks; expected values must not suppress genuine counter-evidence. | Adapted; local performance unverified. |
| Bridgewater plans, enforced checks and reuse | Make validation and reproducibility part of execution. | Extend existing typed tasks, deterministic validators, workflow fences and exact-input reuse. No coding-agent product or autonomous self-modification is selected. | Adapted; additional agent architecture intentionally omitted for scope. |
| Neo4j relationship extraction and traversal | Retrieve facts through explicit connected entities. | Defer until repeated, specific relationship queries justify it. The analytical map remains derived from validated claims. | Intentional divergence for scope and evidence authority. |
| Neo4j inspectable sources and direct checks | Make incorrect or incomplete results detectable. | Preserve exact citations, source inspection and explicit uncertainty regardless of retrieval method. | Adapted to existing product invariants. |

Additional primary research consulted included [BEIR](https://arxiv.org/html/2104.08663v4), [FinQA](https://aclanthology.org/2021.emnlp-main.300.pdf) and the [financial retrieval evidence-unit fairness preprint](https://arxiv.org/html/2608.00183v1). They motivate heterogeneous evaluation, coherent table context and equal access to evidence when comparing retrievers. They do not establish a winning configuration for this prototype. The preprint's results remain reported research rather than reproduced project measurements.

An independent read-only Oracle consultation challenged the global-architecture premise and compared deterministic, section-based, hybrid and graph paths. Its recommendation informed this record; the cited code and primary sources remain the factual basis. No new retrieval experiment was run by Oracle or the documenting agent.

## Comparison Method Recommended Before Selection

Use the existing captured multi-company documents before acquiring more data. Start with the 32 documents and 16 comparison controls from the second batch, retaining immutable historical inputs and outputs. Add focused controls only where they expose an unrepresented failure, rather than expanding into an open-ended benchmark project.

Separate the following measurements: whether useful source material was captured, whether the required evidence survives preparation, whether retrieval includes it, whether the final context retains necessary dates and units, and whether the comparator reaches a defensible conclusion given that context. Measure evidence-set recall and completeness, not only whether one keyword or the correct parent document appears.

Compare the lexical and hybrid paths on the same authorized captures, questions and downstream context envelope. Record index and embedding work, input tokens, retained context size, latency, reuse and any provider quota failure. Shared preparation and context-packaging changes must not be mistaken for an embedding gain. If hosted embedding calls are required, obtain a separately bounded execution scope after checking the account and quoting the workload.

Keep an entire company or a set of untouched cases outside tuning. Include numerical contradictions, comparable non-conflicts, genuinely insufficient evidence, product capabilities, commercial terms, different reporting periods and paraphrases. Do not optimize only for Adobe or ServiceNow. For unanswered cases, distinguish absent evidence from failed retrieval or deliberately uninspected content. No 100-percent performance threshold has been accepted.

Offline replay of saved responses can test a proposed validator contract, but cannot prove that a model will produce the same response to changed input. Do not relabel historical failures as successful calls or change references to hide retrieval defects.

## Separate Comparison Output-Contract Issue

The second batch also records 23 of 32 comparison explanations above the current 600-character limit and one empty explanation. This is distinct from retrieval quality. A response can be rejected structurally even when its raw verdict appears appropriate, while schema-valid output can still reason incorrectly.

Explicit concise-answer instructions and a bounded tolerance such as 2,000 characters were proposed, retaining empty-output rejection, exact-reference validation and resource ceilings. This proposal was not accepted or implemented. Do not truncate explanations blindly or add repair-model calls merely to fit the old bound. The shared constraint and any protocol change require their own focused validation.

## Open Decisions and Implementation Boundary

The design maturity gate has not passed. The comparison paths and user constraints are accepted; retrieval gains, hosting behavior and the final provider/index contract remain unresolved.

Before implementation, settle the embedding model and task-specific input limits, Cloudflare account plan and available quota, permitted workload and cost, the existing Convex primitive or component to reuse, exact source-reference and embedding-reuse identities, and bounded behavior on missing configuration, partial failure or cancellation. Any external call boundary must specify authorization before I/O, validation, resource bounds, timeout, bounded retry, idempotency, telemetry and active-generation checks before the call and persistence. These must extend existing owners rather than create a second execution authority.

Future graph retrieval requires a concrete relationship-question failure that the simpler paths do not resolve. A dedicated reranker requires evidence that relevant candidates are already retrieved but are ordered poorly. A separate Worker requires an identifiable responsibility beyond forwarding. These are future contingencies, not unfinished prerequisites for a minimal prototype.

Preserve source-review UI, corpus approval, append-only analyst decisions, source-use restrictions, rejected-source exclusion, captures and historical evaluation evidence. Neither several sources nor a better search score establishes factual authority. No new analytical claims or graph relations may bypass the approved-corpus and validated-claim boundaries.

The next authorized work in this request is documentation only. A subsequent implementation decision must identify its precise scope and update affected contracts before production changes. This record authorizes no new call, deployment or broader goal resumption.
