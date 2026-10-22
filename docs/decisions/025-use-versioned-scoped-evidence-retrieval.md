# Use versioned, scoped evidence retrieval

> **Historical record.** Preserve the observations and limitations below. Its status, requirements and permissions describe that checkpoint, not current authority. Use the [current document owners](../../AGENTS.md#document-authority-and-required-reading) and [delivery roadmap](../ROADMAP.md); no historical budget or execution permission is renewed.

Date: 2026-10-21

Status: Accepted for implementation; activation depends on validation. The 2026-10-22 interpretation amendment below limits what the historical exact-reference experiment can establish. It does not select a new winner, revise raw scores or authorize activation.

## Context

Pre-approval qualification and targeted comparison discard detailed passages after the first 512 and comparison selects eight captures before ranking their content. These bounds restrict recall independently of model quality. Captures remain immutable preparation artifacts under ADR-024. Retrieval must preserve exact quotations, human corpus approval, and Convex ownership.

## Decision

Separate size-bounded searchable candidates from selected/model and approved/materialized passages. A new preparation version reads the entire bounded capture, groups coherent paragraphs and table context, and stores derived passages with exact offsets, hashes, headings and a separate search field. The historical extractor and existing completed preparations retain their identities. To bound expansion from pathological captures, preparation rejects more than 100,000 parsed blocks or 20,000 searchable units explicitly before index writes. It never silently labels a truncated prefix as a complete candidate set. The 512-passage limit applies to materialization, with all pinned qualification references and their context prioritized. An excessive mandatory set fails explicitly.

Use native Convex full-text search (BM25) as the lexical candidate. Compare it with equal-weight reciprocal rank fusion (constant 60) of lexical and Cloudflare BGE-M3 embeddings. Queries are short, contribution- or role-specific, with at most 16 terms. Comparison ranks all eligible indexed captures before the final eight-capture selection. Authority remains an independent eligibility rule, never a similarity score.

Derived search rows are scoped to the authorized run, corpus revision, capture hash and preparation policy. Embeddings are scoped to a versioned profile. Neither rows nor embeddings are approved SourceVersions or analytical SourcePassages. New preparations are indexed lazily. Do not backfill historical runs or introduce another persistence owner.

Call Workers AI directly from a Convex action, without a Worker, Vectorize, reranker, local model or new subscription. The initial profile uses 1024 dimensions, at most 32 bounded texts per call, two concurrent calls, a 30-second timeout, a 1 MiB response bound and truncate_inputs=false. Validate vector count, dimensions, finite values and nonzero vectors. Cache by exact text and profile. Use existing provider-call telemetry and generation fences before I/O and persistence. A submitted request with an unknown billing outcome is not automatically retried.

Reserve a conservative submitted UTF-8 byte allowance before any embedding request, using one input token per byte and a rounded tariff ceiling of USD 0.012 per million input tokens. Embedding allowance is cumulative per dossier across retries and revisions, limited to USD 0.01. The frozen 32-document evaluation is separately capped at USD 0.10. Reservations are retained after ambiguous outcomes. This scoped allowance amends ADR-006 without creating a transaction-grade money ledger or claiming actual billed cost. Free allowance is preferred but cannot be assumed available from account-wide quota. Missing configuration, unavailable service, exhausted allowance and partial embeddings produce explicit lexical degradation, including requested/effective modes and reason.

## Historical evaluation criterion and activation boundary

Freeze complete-evidence references for the 32 existing captured documents and 16 controls before ranking. Tune on Adobe only. Nvidia, Snowflake and CrowdStrike are reserved comparison companies, historically observed rather than an independent blinded test. Include late and reordered evidence, distractors, and separated table headings. Do not collect new sources or invoke generative qualification/comparison for this experiment.

The original experiment specified that hybrid would win only if complete-evidence recall was at least lexical by company and control type, improved at least one reserved case, preserved all provenance and stayed within allowance. Ties, partial hybrid execution or absent improvement selected lexical under that criterion. Both alternatives were required to preserve useful legacy-accessible evidence and retrieve the Adobe table with context. Native-backend ranking and a real bounded Cloudflare smoke were required evidence, not convex-test ranking simulation. Preserve this historical criterion alongside its results; the interpretation amendment below explains why the implemented exact-reference score cannot establish that useful-evidence criterion by itself.

Activate locally only after focused tests, whole-project checks, and the protected approval/materialization desktop/mobile path. No remote deployment is authorized. If provider configuration or runtime gates remain blocked, retain the historical production default and report incomplete activation.

## Interpretation amendment, 2026-10-22

The [documented Snowflake correction](../verification/2026-10-21-evidence-retrieval-repair.md#interpretation-correction-2026-10-22) establishes that an equivalent revenue table was already in the original hybrid final inputs and is in both modes after repair, while the scorer still reports the chosen reference absent. The 32 conditions derive from sixteen controls tested with focused and distractor scopes. They are neither 32 independent analyst questions nor a completion target for the prototype. Investigator-authored references and previously observed companies do not establish independent generalization.

Keep source retention, exact-reference retention, useful equivalent evidence, displayed qualification and downstream analytical correctness separate. Preserve all original captures, references and scores. This amendment corrects their interpretation without retroactively changing acceptance thresholds or declaring a technology winner. A revised usefulness protocol and any resulting selection or activation decision require explicit acceptance. The current source-retention, provenance, resource and human-approval contracts remain in force. The 600-character response-contract issue remains deferred; no larger explanation limit is approved by this retrieval decision.

## Consequences and alternatives

This extends existing capture preparation, provider telemetry and native Convex indexes. It adds derived storage and preparation work but no provider-specific domain model names or second workflow engine. Native lexical search remains useful without Cloudflare. A RAG component, Vectorize, hosted reranker, multiscale indexes and graph retrieval remain technically possible but add dependencies or cost without evidence of benefit for this prototype. The separate 600-character comparison explanation contract is outside this change.

## Related contracts

This record amends ADR-006 for the bounded embedding allowance, ADR-010 for an optional non-generative retrieval provider, ADR-023 for candidate versus materialization limits, and ADR-024 for derived pre-approval search artifacts. Their other rules were unchanged by that amendment; current contracts now live in the document owners linked above.


## Authorized retention repair

The user authorized the combined selection repair, reference adjudication and protected-flow verification after the stage audit identified evidence loss between retrieval and final preparation. For versioned retrieval inputs, six passages plus structural context remain per-finding priority suggestions. Additional retrieved passages may occupy the shared request up to a 32-KiB serialized expansion budget, within the existing 64-passage and 128-KiB hard limits. Already allocated priority context for multiple findings is preserved even if it exceeds 32 KiB. The byte limit includes the provider response schema, not just quotations. The offline replay may supply a different expansion budget up to the hard limit to measure the recall/volume trade-off. Fill remaining space after all included findings receive their priority context, retain exact quotations, avoid fully contained duplicate spans and record actual omissions. The provider output citation bound remains eight references per finding. Historical unversioned preparation behavior is preserved.

Measure actual serialized bytes together with recall. Reusing existing embeddings adds no inference calls for this repair, but larger later generative inputs can cost more. Preserve the historical scores, report reviewed directly comparable references separately from contextual and unresolved controls, and do not infer model-answer accuracy or a definitive retrieval winner from a retention replay. This repair authorizes no new paid call or remote deployment.
