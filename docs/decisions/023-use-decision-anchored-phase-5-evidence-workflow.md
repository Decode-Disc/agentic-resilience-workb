# ADR-023: Use a Decision-Anchored Phase 5 Evidence Workflow

> **Historical record.** Preserve the observations and limitations below. Its status, requirements and permissions describe that checkpoint, not current authority. Use the [current document owners](../../AGENTS.md#document-authority-and-required-reading) and [delivery roadmap](../ROADMAP.md); no historical budget or execution permission is renewed.

## Status

Amended on 2026-10-20 by [ADR-024](024-qualify-source-content-before-corpus-approval.md). Its explicitly listed preparation, qualification and evidence-use clauses supersede the corresponding historical clauses below; the other recorded decisions were unchanged by that amendment.

Accepted

## Date

2026-08-15

## Context

Phase 4 ends honestly at an approved immutable `CorpusRevision`, `lifecycleState = corpus_approved`, and `executionStatus = idle`. The current production workflow does not retrieve approved documents, create source versions or passages, extract claims, evaluate evidence policy, or render a live Evidence Matrix. The existing `extracting_evidence` lifecycle value and Evidence navigation affordance are scaffolding, not proof that Phase 5 exists.

Phase 5 must turn only analyst-accepted sources into inspectable evidence without collapsing retrieval, provenance, model proposals, policy, or later human decisions into one opaque operation. It must also provide an honest candidature slice before production model providers and page-aware PDF normalization are integrated. A deterministic adapter can demonstrate the full claims pipeline for curated fixtures, but it cannot truthfully generate arbitrary claims from a new live dossier.

The design must therefore prove two distinct capabilities: real post-approval retrieval and provenance for accepted live sources, and a complete claims-first Evidence Matrix for a clearly labelled showcase corpus. It must never present prefabricated claims as live analysis or convert a missing technical capability into an analytical `Unknown`.

The validated Phase 5 design (`docs/brainstorming/2026-08-15-phase-5-evidence-matrix-provenance-design.md`) defines the complete lifecycle, domain model, retrieval contract, claim generation boundary, and demonstration protocol. This ADR makes that design authoritative before any production code changes.

ADR-004 establishes SEC, Exa, and Unstructured as the source-acquisition providers and separates discovery from post-approval retrieval and normalization. ADR-009 establishes typed AI tasks and deterministic policy adjudication. ADR-010 keeps provider routing, retries, and fallback application-controlled. ADR-017 through ADR-022 own source-selection proposal composition, authority classification, company linkage, and the durable corpus-approval checkpoint. This ADR consumes their accepted corpus boundary; it does not rewrite how proposals are composed or how providers are routed.

## Decision

Adopt a separate decision-anchored, provenance-first Phase 5 workflow on the existing Convex Workflow engine, with real retrieval for the exact accepted corpus, immutable source versions and passages, fixture-bound deterministic claim and policy adapters, a read-only claims-first Evidence Matrix, and a strong `evidence_ready + idle` handoff. Reserve successful Phase 5 completion for runs containing at least one structurally valid claim. Preserve arbitrary live retrieval results but pause honestly when claim generation is unavailable, without inventing evidence, `Unknown`, or Phase 6 readiness.

### Separate workflow definition on the existing engine

Phase 5 is a separate decision-anchored Convex Workflow execution rather than an extension of the Phase 4 workflow. The existing `@convex-dev/workflow` component and `WorkflowManager` own the single durable orchestration authority. A separate Phase 5 workflow definition is not a second workflow engine or persistence authority.

### Effective-head freeze

A protected start mutation verifies run ownership, the active approved immutable `CorpusRevision`, `corpus_approved + idle`, the absence of another running workflow, and the visitor execution limit. In the same transaction, it reads the latest effective decision head for every source from the revision's `sourceReviewItems` projection, verifies each `latestDecisionId` against its append-only `SourceDecision`, and freezes only heads whose effective decision is `accepted`. It requires at least one accepted head, persists each source and authoritative accepted-decision ID in the Phase 5 source projection, atomically claims the execution slot, increments the execution generation, and transitions to `extracting_evidence + running`. Historical accepted rows superseded by pending or rejected heads confer no authority.

### Active-only workflowId with compare-and-clear completion

The run stores the active workflow ID only while Phase 5 is running. Phase 4 `onComplete` success calls a compare-and-clear internal mutation that clears the stored workflow ID only when it still matches the completed handle. This prevents a newer execution from being erased by a late completion. The run retains the workflow version and generation used for every artifact; it has no active workflow ID when idle, paused, failed, or cancelled.

### Lifecycle: evidence_ready

Add `evidence_ready` between `extracting_evidence` and `assessing_dimensions`:

```text
corpus_approved + idle
→ extracting_evidence + running
→ evidence_ready + idle
→ assessing_dimensions + running
```

`evidence_ready` is a strong handoff, not a synonym for "the workflow stopped." It requires every frozen source branch to be terminal, at least one structurally valid reproducible passage, a terminal claim pipeline, and at least one structurally valid claim visible in the matrix. Individual sources may have failed, and policy outcomes may remain `needs_review` or `blocked`; those limitations remain visible without preventing the matrix from being ready.

### claim_generation_unavailable pause and retry

When a live arbitrary dossier has valid retrieved passages but the deterministic adapter is not authorized for their hashes, the persisted tuple becomes `lifecycleState = extracting_evidence`, `executionStatus = paused`, `pauseReason = claim_generation_unavailable`, and the claim-generation `WorkflowStep` becomes `needs_review`. This is an inspectable technical stop, not an analyst judgment checkpoint, `Unknown`, evidence insufficiency, or successful Phase 5 completion. The current Phase 5 workflow records its terminal paused outcome and releases its workflow execution and visitor running slot; the run retains the workflow version and generation used for every artifact but has no active workflow ID. It does not unlock Phase 6.

The run owner may request `Retry claim generation`, or a protected administrator may retry on the owner's behalf, but the server first verifies that an authorized claim adapter is now available. If capability remains unavailable, the mutation performs no state change, claims no slot, increments no generation, and issues no external call. A valid retry atomically claims the visitor slot, advances the generation, starts a new current-version Phase 5 workflow from the persisted corpus artifacts, and schedules only the incomplete claim and policy steps. Cancellation from this paused state records `cancelled` and prevents retry until the existing explicit resume contract reclaims the run.

### Immutable versioned ResearchPlanQuestion

`ResearchPlanQuestion` is an immutable, versioned record created with the research plan. It stores a stable question key, bounded semantic question text, the dimension it serves, the plan template version, and creation provenance. Every `Unknown` claim references at least one unresolved `ResearchPlanQuestion` and at least one `context` evidence passage; coverage is derived from claims and passages rather than stored by mutating the question. A protected, paginated, idempotent backfill generates the same versioned questions for existing plans from their persisted confirmed company snapshot, dimension keys, and bounded research angle; it must not alter the original plan or infer from provider output.

### Immutable provenance, claim, and policy records

The following Phase 5 records are immutable once persisted:

- `SourceVersion` — created only after successful bounded retrieval and normalization; stores content hash, media type, byte and page counts, canonical retrieval URL, retrieval and normalizer versions, retrieval metadata, and an `Id<"_storage">` for the normalized artifact. A source fetched again with changed content creates a new immutable version; retries with the same logical operation and hash reuse the existing result.
- `SourcePassage` — belongs to exactly one `SourceVersion`; stores exact quotation, normalized quotation hash, stable order, and typed locator (web or PDF). A passage whose quotation cannot be reproduced against the stored version is structurally invalid and cannot support a claim.
- `Claim` — atomic canonical proposal scoped to the approved corpus revision and extraction/task schema versions; classification is `Fact`, `Inference`, `Hypothesis`, or `Unknown`; contains no analyst decision, final confidence, or workflow authority.
- `ClaimEvidence` — sole owner of the relationship between a claim and a passage; relation is `supporting`, `counter`, or `context`. Discovery category, source family, recommendation contribution, eligible role, and `companyLinkageBasis` never pre-assign this relation.
- `ClaimDimensionLink` — immutable proposal record between one claim revision and one assessment dimension in one corpus/extraction revision; stores `origin = generated | analyst`, the proposing `AITaskResult` when generated, and a bounded rationale; contains no effective decision.
- `AITaskResult` — stores typed task schema versions, normalized inputs, validated outputs, execution mode, and task references. Deterministic fixture execution is explicitly recorded as `showcase` and does not fabricate an external `ProviderCall`.
- `PolicyEvaluation` — stores policy version, normalized observable inputs, executed rules, rule reasons, verifier references, and `pass`, `needs_review`, or `blocked` result.
- `EvidenceSourceStatus` — mutable projection per frozen accepted source and execution generation with `queued`, `running`, `succeeded`, `partial`, or `failed` status plus bounded typed reasons and counts; drives progress and coverage presentation but never replaces immutable records.

### Upload lease and cleanup

Large normalized artifacts live in Convex File Storage. A durable `ArtifactUploadLease` owns one logical operation and records `reserved`, `uploaded`, `committed`, or `orphaned`, plus the storage ID as soon as it is available. File upload and database commit are not atomic: the invariant is one committed referenced artifact per logical source-version operation, not zero transient duplicate uploads. A rejected or failed finalize marks the upload orphaned and deletes it best-effort. A paginated protected cleanup reconciles old upload leases and the `_storage` system table against referenced storage IDs after a safety interval, covering both recorded orphans and a crash between upload and lease attachment.

### Real SEC and Exa approved-source retrieval in Phase 5

Real SEC filing retrieval by confirmed CIK and accession identity and real Exa Contents retrieval for approved general-web URLs enter Phase 5. These are post-approval retrieval operations only; they do not alter the pre-approval discovery boundary or the provider ownership established by ADR-004 and ADR-010.

### Deferred real Unstructured and model-provider generation

Real Unstructured page-aware PDF normalization and real model-provider claim generation, semantic verification, routing, retries, and fallback remain Phase 8 deferrals under ADR-004, ADR-009, and ADR-010. Phase 5 defines and tests the page-aware normalizer contract and the claim-generation task schema; the real Unstructured adapter and real model routing belong to the later provider-integration slice. This ADR does not supersede ADR-004, ADR-009, or ADR-010.

### Hybrid showcase and live boundary

The deterministic claim and policy adapter runs only when the complete normalized input matches a hash-identified fixture manifest. Fixture provenance and the `illustrative` or `showcase` label are part of the persisted result and visible presentation. Only a complete normalized-hash showcase corpus creates deterministic claims. An arbitrary live dossier may demonstrate retrieval, normalized artifacts, passages, and source failures, but it stops at `claim_generation_unavailable`; it never receives prefabricated claims, a fabricated `Unknown`, `evidence_ready`, or Phase 6 access. Cached, seeded, fixture, or precomputed data is always labelled. The distinction is visible in the product and persisted in task provenance.

### Numeric safety limits

The following locked values govern Phase 5 retrieval, normalization, and passage extraction:

| Limit | Value |
| ------- | ------- |
| `MAX_APPROVED_SOURCE_BYTES` | 16 MiB (declared and decompressed) |
| `MAX_NORMALIZED_ARTIFACT_BYTES` | 16 MiB |
| `MAX_PDF_PAGES` | 400 |
| `MAX_PASSAGES_PER_SOURCE` | 512 |
| `MAX_QUOTATION_CHARS` | 4,000 |
| `MAX_REDIRECTS` | 5 |
| Total attempts per source | 2 |
| SEC and direct HTTP timeout | 10 seconds (abortable) |
| Exa Contents outer timeout | 120 seconds (abortable) |
| Accepted-source count | Capped by the existing `SOURCE_CANDIDATE_LIMIT = 48` |

The frozen fan-out count is the actual number of accepted sources, never the source-recommendation ceiling or an assumed target. If the accepted ADR changes any number, revise every later test and table in the implementation plan before production code.

## Alternatives Considered

### Fixture-only Phase 5

- Pros: simplest claim pipeline; no live retrieval risk.
- Cons: cannot prove real post-approval retrieval, provenance, or partial-failure behavior for accepted sources.
- Rejected: the candidature requires both real retrieval and deterministic claims.

### Full model-provider Phase 5

- Pros: end-to-end real claim generation from the start.
- Cons: introduces real model routing, retry, fallback, cost, and availability dependencies before the evidence pipeline is structurally proven; conflicts with the Phase 8 provider-integration sequence.
- Rejected for this slice: real model generation remains Phase 8 under ADR-009 and ADR-010.

### Extend the Phase 4 workflow definition

- Pros: one workflow definition to maintain.
- Cons: collapses the corpus-approval checkpoint boundary and makes Phase 5 start semantics ambiguous.
- Rejected: a separate definition on the same engine preserves the checkpoint while using one orchestration authority.

### Skip evidence_ready and go directly to assessing_dimensions

- Pros: fewer lifecycle states.
- Cons: removes the strong handoff predicate; cannot distinguish "workflow stopped" from "matrix is ready for review."
- Rejected: `evidence_ready` is a strong gate, not a synonym for idle.

## Amendment: automatic approved-corpus continuation (2026-10-19)

Corpus approval authorizes automatic evidence preparation. The final Phase 4 handoff records the approved-corpus transition and starts the separate Phase 5 workflow in one mutation, reusing the protected start implementation. It binds the approved revision and expected execution generation, freezes effective accepted decision heads, and claims the visitor slot without an observable idle gap. A deterministic start key prevents repeated handoff delivery from starting another execution. Late Phase 4 completion remains compare-and-clear and cannot erase the Phase 5 handle. The public owner-authorized start remains available for historical dossiers already at `corpus_approved + idle`.

The Sources collection remains inspectable and read-only during and after extraction. The existing revision control remains subject to its server-side lifecycle eligibility. Evidence and Assessment keep their strong handoff gates. Automatic continuation does not authorize fixture claims for arbitrary live inputs or weaken the claim-generation-unavailable stop.

Exa Contents continues to use the installed SDK's `getContents` validation and payload construction. A dedicated SDK subclass per attempt overrides only the Contents HTTP request to supply an abort signal. It retains application-owned timeout, retry, telemetry, and validation rules without changing global fetch or SDK discovery.

## Consequences

- The lifecycle contract gains `evidence_ready` and `claim_generation_unavailable`; validators, transitions, pause reasons, and workflow ownership rules must be updated before implementation.
- The domain model gains `ResearchPlanQuestion`, `SourceVersion`, `SourcePassage`, `Claim`, `ClaimEvidence`, `ClaimDimensionLink`, `EvidenceSourceStatus`, `ArtifactUploadLease`, `AITaskResult` (extended), and `PolicyEvaluation` as Phase 5 records.
- `workflowId` becomes active-only with compare-and-clear completion; a late Phase 4 completion cannot erase a newer Phase 5 handle.
- Real SEC and Exa approved-source retrieval enters Phase 5; real Unstructured normalization and model-provider generation remain Phase 8.
- The curated showcase dossier can demonstrate the complete Evidence Matrix; arbitrary live dossiers preserve real provenance but pause honestly without fabricated claims or Phase 6 unlock.
- ADR-004, ADR-009, ADR-010, and At that checkpoint, ADR-017 through ADR-022 retained responsibility for their respective decisions. This ADR consumes their accepted corpus boundary without rewriting source selection, provider routing, or policy adjudication.
- The numeric safety limits are locked; changing any value requires revising every later test and table in the implementation plan.

## Supersession

This ADR does not supersede any prior ADR. It establishes the Phase 5 evidence workflow authority that consumes the accepted corpus boundary from ADR-017 through ADR-022 and the provider boundaries from ADR-004, ADR-009, and ADR-010.

## Retrieval amendment (2026-10-21)

[ADR-025](025-use-versioned-scoped-evidence-retrieval.md) adds versioned structured candidates, scoped native retrieval and a bounded optional embedding provider. It distinguishes whole-capture search candidates from the unchanged 512 approved-passage materialization ceiling, and introduces a cumulative conservative input-byte allowance for embeddings rather than a money settlement ledger. Historical preparation identities and human corpus approval remain unchanged. Local activation remains conditional on the recorded evaluation and verification gates.
