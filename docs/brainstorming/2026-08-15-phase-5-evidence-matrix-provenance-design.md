# Phase 5 Evidence Matrix and Provenance Design

## Status

Design validated on 2026-08-15 and accepted through [ADR-023](../decisions/023-use-decision-anchored-phase-5-evidence-workflow.md). Its later handoff amendment, [ADR-024](../decisions/024-qualify-source-content-before-corpus-approval.md) and [ADR-025](../decisions/025-use-versioned-scoped-evidence-retrieval.md) replace the idle-only handoff, post-approval-only acquisition and original retrieval assumptions respectively. The problem and code observations below describe the design-time baseline. See the [roadmap](../ROADMAP.md#current-delivery-state) for delivery and remaining activation limits.

## Problem

Phase 4 ends honestly at an approved immutable `CorpusRevision`, `lifecycleState = corpus_approved`, and `executionStatus = idle`. The current production workflow does not retrieve approved documents, create source versions or passages, extract claims, evaluate evidence policy, or render a live Evidence Matrix. The existing `extracting_evidence` lifecycle value and Evidence navigation affordance are scaffolding, not proof that Phase 5 exists.

Phase 5 must turn only analyst-accepted sources into inspectable evidence without collapsing retrieval, provenance, model proposals, policy, or later human decisions into one opaque operation. It must also provide an honest candidature slice before production model providers and page-aware PDF normalization are integrated. A deterministic adapter can demonstrate the full claims pipeline for curated fixtures, but it cannot truthfully generate arbitrary claims from a new live dossier.

The design must therefore prove two distinct capabilities: real post-approval retrieval and provenance for accepted live sources, and a complete claims-first Evidence Matrix for a clearly labelled showcase corpus. It must never present prefabricated claims as live analysis or convert a missing technical capability into an analytical `Unknown`.

## Evidence at Design Time

### Verified

- `convex/researchWorkflow.ts` completes Phase 4 after the corpus-approval event by verifying the approved handoff, transitioning the run to `corpus_approved + idle`, and returning without emitting extraction work.
- `convex/domain/validators.ts` and `convex/domain/transitions.ts` contain `extracting_evidence` but do not contain `evidence_ready`. The current transition is directly from `extracting_evidence` to `assessing_dimensions`.
- The completed domain design names `SourceVersion`, `SourcePassage`, `Claim`, `ClaimEvidence`, `ClaimDecision`, `ClaimDimensionDecision`, `AITaskResult`, and `PolicyEvaluation`, but the production schema does not yet persist the Phase 5 evidence records.
- `SourceDecision` is the append-only authority for corpus inclusion. Grouped approval creates individual accepted decisions for pending recommended sources, preserves explicit decisions, leaves other candidates pending, and approves an immutable corpus revision.
- ADR-017's fixed-target language is now explicitly historical and superseded. ADR-018 owns adaptive contribution-based composition and the recommendation ceiling. ADR-021 and ADR-022 separate publisher provenance, document capability, company linkage, automatic coverage eligibility, recommendation disposition, and analyst decision.
- ADR-019 preview content is ephemeral visual convenience before approval. It is not a source version, passage, or evidence input.
- The 2026-08-06 retrieval benchmark found Exa Contents and Firecrawl usable on all ten benchmark sources and zero material Firecrawl fallback wins. The accepted provider boundary therefore remains SEC direct retrieval plus Exa Contents, with no Firecrawl production fallback.

### Unresolved until implementation

- Locator quality on the final curated CCC corpus has not yet been measured through production Phase 5 adapters.
- The real false-negative and exception rates of claim generation, canonicalization, semantic verification, and policy cannot be measured until the real model-provider slice is integrated.
- A concrete public-PDF normalizer implementation remains deferred. Phase 5 defines and tests the page-aware contract; the real Unstructured adapter belongs to the later provider integration slice.

These unresolved facts limit what the showcase may claim. They do not weaken approved-source authorization, provenance, idempotency, or analyst-control requirements.

## Goals

- Start a new durable Phase 5 execution only from an approved corpus handoff.
- Retrieve and normalize the actual accepted source set with visible per-source partial failures.
- Preserve immutable retrieved artifacts, reproducible passages, typed claim proposals, evidence relations, proposed dimension links, task results, and policy evaluations.
- Render a claims-first, read-only Evidence Matrix that exposes supporting evidence, counter-evidence, context, critical unknowns, policy exceptions, and coverage limitations.
- Demonstrate the complete claim pipeline only for hash-identified deterministic showcase fixtures and label that path honestly.
- End successful Phase 5 work at a new `evidence_ready + idle` handoff for Phase 6.
- Preserve retries, cancellation, generation fencing, provider telemetry, resource ceilings, and rejected-source exclusion.

## Non-Goals

- Claim approval, claim rejection, correction, or dimension-link decisions; these remain Phase 6.
- Dimension assessment, confidence, three-year direction, architecture-map generation, or brief generation.
- Real model-provider claim generation or real Unstructured PDF normalization in this slice.
- A second workflow engine, persistence authority, or post-approval company-linkage checkpoint.
- Firecrawl, general-purpose crawling, local file upload, or retrieval of pending or rejected candidates.
- Treating recommendation disposition, source family, coverage role, company linkage, or discovery metadata as claim truth or counter-evidence.

## Approaches Considered

### Fixture-only Phase 5

This would deliver the complete matrix quickly and deterministically, but it would not prove that accepted live sources can be retrieved, normalized, versioned, and cited after the durable checkpoint. It would weaken the central evidence-integrity demonstration and make the product look precomputed.

### Fully live retrieval and model extraction

This would exercise the final architecture immediately, but it would combine source acquisition, model routing, prompt and schema evaluation, semantic verification, PDF normalization, cost controls, and matrix UX in one high-risk slice. Current provider quality on the approved corpus is not yet measured, so this approach would increase uncertainty before the provenance backbone exists.

### Hybrid vertical slice

Adopt real SEC and Exa retrieval for accepted sources, deterministic normalization where the format contract is supported, a page-aware PDF normalizer interface, and deterministic claim and policy adapters for hash-identified showcase fixtures. This proves live acquisition and durable provenance while keeping fabricated analysis out of arbitrary live dossiers. It is the selected approach because precise post-approval retrieval is necessary to demonstrate the Phase 5 provenance outcome; leaving all retrieval adapters until Phase 8 would make Phase 5 either fixture-only or non-runnable. It deliberately moves the approved-source SEC and Exa retrieval subset forward from the current Roadmap Phase 8 while leaving real model routing, model providers, and Unstructured integration in that later provider slice.

## Architecture

The 2026-10-19 amendment to ADR-023 makes continuation automatic for new corpus approvals. The final Phase 4 handoff records the approved state and invokes the shared Phase 5 start implementation in one mutation. A deterministic revision-bound key, expected generation, and atomic execution-slot claim prevent duplicate starts and idle-gap races. The public start remains available for historical approved idle dossiers. Sources remain inspectable read-only during and after extraction, with unchanged evidence-readiness and assessment gates.

Phase 5 is a separate decision-anchored Convex Workflow execution rather than an extension of the Phase 4 workflow. A protected start mutation verifies run ownership, the active approved immutable `CorpusRevision`, `corpus_approved + idle`, the absence of another running workflow, and the visitor execution limit. In the same transaction, it reads the latest effective decision head for every source from the revision's `sourceReviewItems` projection, verifies each `latestDecisionId` against its append-only `SourceDecision`, and freezes only heads whose effective decision is `accepted`. It requires at least one accepted head, persists each source and authoritative accepted-decision ID in the Phase 5 source projection, atomically claims the execution slot, increments the execution generation, and transitions to `extracting_evidence + running`. Historical accepted rows superseded by pending or rejected heads confer no authority.

The workflow is:

```text
approved CorpusRevision
→ accepted SourceDecision set
→ atomic Phase 5 execution claim
→ per-source retrieval and normalization
→ immutable SourceVersion records and stored artifacts
→ reproducible SourcePassage records
→ typed claim proposals
→ conservative cross-source canonicalization
→ non-overridable structural validation
→ versioned policy evaluation
→ targeted semantic verification when required
→ read-only claims-first Evidence Matrix
→ evidence_ready + idle
```

Per-source branches execute independently. One source failure cannot stop retrieval of unrelated accepted sources. Before I/O and again before persistence, functions recheck that the active approved revision is unchanged and that `sourceReviewItems.latestDecisionId` still equals the frozen accepted `SourceDecision` ID with decision `accepted`; workflow inputs and historical accepted rows are never authority. Approved revisions must reject in-place decision changes and require a new corpus revision, but the repeated head check remains a defense-in-depth fence. Pending and rejected sources cannot create files, versions, passages, claims, policy inputs, derived records, or progress events.

All product progress originates from persisted `RunEvent` records. Technical steps and attempts remain in operational records and protected administration surfaces rather than analyst-facing copy.

## Lifecycle Contract

Add `evidence_ready` between `extracting_evidence` and `assessing_dimensions`:

```text
corpus_approved + idle
→ extracting_evidence + running
→ evidence_ready + idle
→ assessing_dimensions + running
```

`evidence_ready` is a strong handoff, not a synonym for "the workflow stopped." It requires every frozen source branch to be terminal, at least one structurally valid reproducible passage, a terminal claim pipeline, and at least one structurally valid claim visible in the matrix. Individual sources may have failed, and policy outcomes may remain `needs_review` or `blocked`; those limitations remain visible without preventing the matrix from being ready.

When a live arbitrary dossier has valid retrieved passages but the deterministic adapter is not authorized for their hashes, the persisted tuple becomes `lifecycleState = extracting_evidence`, `executionStatus = paused`, `pauseReason = claim_generation_unavailable`, and the claim-generation `WorkflowStep` becomes `needs_review`. This is an inspectable technical stop, not an analyst judgment checkpoint, `Unknown`, evidence insufficiency, or successful Phase 5 completion. The current Phase 5 workflow records its terminal paused outcome and releases its workflow execution and visitor running slot; the run retains the workflow version and generation used for every artifact but has no active workflow ID. It does not unlock Phase 6.

The run owner may request `Retry claim generation`, or a protected administrator may retry on the owner's behalf, but the server first verifies that an authorized claim adapter is now available. If capability remains unavailable, the mutation performs no state change, claims no slot, increments no generation, and issues no external call. A valid retry atomically claims the visitor slot, advances the generation, starts a new current-version Phase 5 workflow from the persisted corpus artifacts, and schedules only the incomplete claim and policy steps. Cancellation from this paused state records `cancelled` and prevents retry until the existing explicit resume contract reclaims the run. This protocol requires the new pause reason and allowed same-lifecycle execution transition to be authoritative before implementation.

If no valid passage can be created, the workflow stops with a retryable typed failure or reviewable source outcome according to the terminal causes. It does not create empty claims or advance to `evidence_ready`.

This lifecycle change is now authoritative through ADR-023. Implementation must update validators, transition rules, pause reasons, workflow ownership rules, progress projections, and `ROADMAP.md` to match the exact protocol above.

## Domain and Persistence Model

### `SourceVersion`

Create a `SourceVersion` only after successful bounded retrieval and normalization. It belongs to one run, approved corpus revision, source, frozen effective accepted `SourceDecision`, and execution provenance. It stores content hash, media type, byte and page counts where applicable, canonical retrieval URL, retrieval and normalizer versions, retrieval metadata, and an `Id<"_storage">` for the normalized artifact. A source fetched again with changed content creates a new immutable version; retries with the same logical operation and hash reuse the existing result.

Large normalized artifacts live in Convex File Storage. Indexed database records retain bounded metadata and passage rows rather than embedding the whole document. A durable artifact-upload lease owns one logical operation and records `reserved`, `uploaded`, `committed`, or `orphaned`, plus the storage ID as soon as it is available. File upload and database commit are not atomic: the invariant is one committed referenced artifact per logical source-version operation, not zero transient duplicate uploads. A rejected or failed finalize marks the upload orphaned and deletes it best-effort. A paginated protected cleanup reconciles old upload leases and the `_storage` system table against referenced storage IDs after a safety interval, covering both recorded orphans and a crash between upload and lease attachment.

### `SourcePassage`

Each passage belongs to exactly one `SourceVersion` and stores its exact quotation, normalized quotation hash, stable order, and typed locator. A web locator contains canonical URL, source-version hash, heading path when available, exact quotation, bounding text, and bounded surrounding context. A PDF locator contains source-version hash, page number, exact quotation, and bounding box when available. A passage whose quotation cannot be reproduced against the stored version is structurally invalid and cannot support a claim.

### `Claim` and `ClaimEvidence`

A `Claim` is an atomic canonical proposal scoped to the approved corpus revision and extraction/task schema versions. Its classification is `Fact`, `Inference`, `Hypothesis`, or `Unknown`. It contains no analyst decision, final confidence, or workflow authority.

`ClaimEvidence` is the sole owner of the relationship between a claim and a passage. Its relation is `supporting`, `counter`, or `context`. Discovery category, source family, recommendation contribution, eligible role, and `companyLinkageBasis` never pre-assign this relation. Counter-evidence is determined only after passage analysis.

An `Unknown` must reference an unresolved `ResearchPlan` question and one or more context passages that establish why the question is material. A source-selection coverage gap alone cannot create an `Unknown`. If no passage exists, the result is a visible acquisition or coverage limitation rather than a fabricated claim.

### `ClaimDimensionLink`

Introduce an explicit immutable `ClaimDimensionLink` proposal record between one claim revision and one assessment dimension in one corpus/extraction revision. Its stable identity key is the corpus revision, claim revision, dimension key, proposal revision, and origin. At most one generated link exists for that tuple; retries reuse it. The record stores `origin = generated | analyst`, the proposing `AITaskResult` when generated, and a bounded rationale. It contains no effective decision.

Phase 6 writes append-only `ClaimDimensionDecision` rows that reference one link ID and record `accepted` or `rejected`, reviewer, reason, time, and optional superseded decision ID. The latest effective decision head owns the link's review status without mutating the proposal. Adding a missing relationship creates an immutable `origin = analyst` link and its first accepted decision atomically. Correcting a relationship creates a new link and explicit decisions rejecting or superseding the old effective link; historical links and decisions remain visible. Within one claim revision and dimension, at most one link may have an effective accepted decision, while multiple rejected or superseded proposals remain auditable.

### `EvidenceSourceStatus`

Maintain one mutable projection per frozen accepted source and execution generation with its authoritative accepted-decision ID, `queued`, `running`, `succeeded`, `partial`, or `failed`, plus bounded typed reasons and counts. It drives progress and coverage presentation but never replaces immutable source decisions, source versions, passages, provider calls, workflow events, or audit history. A failed source creates no `SourceVersion`.

### `AITaskResult` and `PolicyEvaluation`

Persist typed task schema versions, normalized inputs, validated outputs, execution mode, and task references in `AITaskResult`. Deterministic fixture execution is explicitly recorded as `fixture` or `showcase` and does not fabricate an external `ProviderCall`. Persist policy version, normalized observable inputs, executed rules, rule reasons, verifier references, and `pass`, `needs_review`, or `blocked` in `PolicyEvaluation`.

## Retrieval and Normalization

The frozen fan-out count is the actual number of accepted sources, never the source-recommendation ceiling or an assumed target.

Before any external I/O, each branch verifies ownership-derived authorization, the accepted decision, active corpus revision, active workflow and execution generation, paid-work switch, resource ceilings, and a durable `ProviderCall` lease. The logical operation key includes run ID, workflow version, execution generation, corpus revision ID, source ID, step key, and attempt. The generation and cancellation state are checked again immediately before dispatch and immediately before persistence.

SEC filings are retrieved directly by confirmed CIK and accession identity and normalized deterministically. Approved general-web URLs use Exa Contents only. Firecrawl is not a fallback unless repeated measured Phase 5 failures later satisfy a separately approved adoption threshold. Approved public PDFs use bounded direct retrieval and the page-aware normalizer contract; the Phase 5 implementation may use only deterministic fixture normalization until the real Unstructured adapter is authorized in the provider integration phase.

For every URL retrieval, authorization occurs before DNS resolution. The adapter validates scheme, host, every redirect, public address, MIME type, declared and decompressed size, time, page count where applicable, and response completeness. The connection uses the validated public address while preserving the original host for HTTP Host and TLS SNI. Timeouts are abortable, retries are bounded and application-owned, and unsupported media, missing configuration, timeout, oversize content, decompression violation, invalid locator, or provider exhaustion produces a typed per-source outcome.

A branch hashes the bounded artifact before file persistence. Late, cancelled, unauthorized, or stale-generation results cannot write domain records, advance workflow state, trigger fallback, or open another paid attempt.

## Claim Generation, Canonicalization, and Policy

`ClaimExtractionTask` consumes an ordered set of approved-corpus passages, unresolved `ResearchPlan` questions, corpus revision identity, prompt or adapter version, and input/output schema versions. It emits only typed proposal fields and passage references. It cannot emit approval, final confidence, a workflow transition, or an unsupported passage ID.

The deterministic adapter runs only when the complete normalized input matches a hash-identified fixture manifest. Fixture provenance and the `illustrative` or `showcase` label are part of the persisted result and visible presentation. An arbitrary live dossier may demonstrate retrieval, normalized artifacts, passages, and source failures, but it stops at `claim_generation_unavailable`; it never receives prefabricated claims.

Structural validation rejects claims whose passages do not belong to the active approved corpus, whose source decision is not accepted, whose quotation cannot be reproduced, whose locator is invalid, whose schema is invalid, or which has no passage. Structural failures are non-overridable.

Cross-source canonicalization is conservative. Claims merge automatically only when classification and normalized atomic text identity match. Semantically similar claims remain separate and receive a `needs_review` duplicate candidate rather than being merged by an unverified heuristic. This preserves provenance and avoids silently changing analytical meaning.

The versioned evidence policy combines source authority, recency, independent corroboration, passage diversity, claim classification, unresolved counter-evidence, and `ResearchPlan` question coverage. Source-selection metadata may be an inspectable policy input, but it cannot establish truth, support, contradiction, or dimension relevance. The policy emits `pass`, `needs_review`, or `blocked` with persisted rule reasons; it does not produce final assessment confidence.

Deterministic rules request a bounded semantic verifier only when entailment, contradiction, or dimension relevance cannot be decided mechanically. The verifier returns typed evidence-linked labels and remains an input to application policy, never the decision owner. In this Phase 5 slice, fixture-bound deterministic verifier outputs may exercise this path; real model routing remains deferred.

## Partial Success, Retry, and Cancellation

When at least one valid passage exists, the workflow may continue through the claim pipeline while retaining every failed or partial source and its coverage consequence. When zero valid passages exist, it stops without claims and exposes a retryable or reviewable analyst-safe result.

A resume reuses valid results for the same corpus revision and logical operation. It schedules only missing, expired, or explicitly retryable work. It never recreates a source version, passage, claim, link, task result, policy evaluation, quota reservation, or provider call already committed under the idempotency contract.

Cancellation prevents all new I/O and fallback. An already-dispatched call may finish physically, but its result has no authority after the generation or cancellation check and cannot advance state. Immutable artifacts committed before cancellation remain auditable and reusable only when a later explicitly authorized execution proves they match its corpus and idempotency contract.

Internal failure vocabulary distinguishes missing configuration, forbidden access, invalid document, unsupported media, resource limit, temporary retrieval failure, normalization failure, locator failure, structural claim failure, and claim-generation unavailability. Analyst-facing presentation maps these to consequence and next action without exposing provider names, environment variables, internal enum keys, request IDs, function names, or raw exceptions.

## Evidence Matrix Experience

The Evidence surface preserves the existing workbench shell, navigation rail, responsive behavior, design tokens, loading geometry, and motion language. Phase 5 replaces only the placeholder content with a read-only claims-first matrix. Phase 6 later adds analyst decisions without redefining the Phase 5 data projection.

Each claim row shows the atomic statement, classification, analyst-safe policy status, proposed dimensions, supporting/counter/context passage counts, independent source count, and visible limitations such as unresolved contradiction, weak coverage, or unavailable claim generation. Classification and evidence relation own their existing semantic colors; source-selection metadata does not reuse those truth signals.

Selecting a row opens a detail panel with exact quotations, reproducible locators, evidence relation, source version, and source identity. `authorityTier`, `documentKind`, `companyLinkageBasis`, declared roles, and eligible roles may appear in a visually separate provenance context. Copy must make clear that these metadata explain selection and source context rather than claim validity.

Controls are limited to inspection: filter and sort by classification, policy result, proposed dimension, counter-evidence presence, and processing state. There is no approve, reject, edit, correction, or dimension-link decision control in Phase 5.

A coverage region shows accepted sources, successfully processed sources, partial or failed sources, and unresolved `ResearchPlan` questions. Loading skeletons preserve the distinctive matrix rows, filters, coverage summary, and detail-panel geometry. Empty and error states are distinct. Recoverable loading failures use the shared load-error components, and retry boundaries must not discard surrounding analyst state. On narrow screens, the detail panel becomes a drawer. Motion may seat persisted claims and update persisted counts, but it cannot simulate progress or expose model reasoning.

Examples of analyst-facing copy include `Evidence is ready for review`, `Some approved sources could not be processed`, and `Claim generation is not available for this dossier yet`. Internal provider and workflow details remain available only in protected administration surfaces.

## Verification Strategy

### Domain and policy tests

- Only latest effective accepted-decision heads in the active approved corpus authorize retrieval or evidence persistence; a superseded historical acceptance never does.
- Pending, rejected, historical-revision, cancelled, stale-generation, and foreign-run inputs issue no I/O and create no downstream artifact.
- Passage locators reproduce exact quotations against the immutable source version.
- `Unknown` requires an unresolved research question and context passage; source-selection gaps alone never create it.
- Supporting, counter, and context relations are owned only by `ClaimEvidence`.
- Canonicalization merges only equal normalized text with equal classification and leaves semantic near-duplicates reviewable.
- Policy results are deterministic for versioned normalized inputs and preserve explicit reasons and verifier references.

### Convex workflow and persistence tests

- The Phase 5 start mutation claims the visitor slot atomically from `corpus_approved + idle`, increments generation, and freezes the accepted set.
- Concurrent start, retry, resume, and cancellation cannot duplicate committed referenced artifacts, provider calls, source versions, passages, claims, links, task results, or policy evaluations. Temporary unreferenced uploads are tolerated only under the bounded orphan-reconciliation contract.
- One failed source does not cancel unrelated branches; all source projections become terminal before successful handoff.
- File finalize failure marks the upload orphaned and triggers best-effort deletion; paginated cleanup proves that only old unreferenced storage objects and expired upload leases are removed.
- `evidence_ready + idle` requires at least one valid claim and terminal source branches.
- An unrecognized live input persists `extracting_evidence + paused + claim_generation_unavailable`, releases its workflow and running slot, and cannot enter Phase 6. An unavailable retry performs no mutation or I/O; an available retry atomically claims a new generation and reuses completed artifacts.

### Adapter and contract tests

- SEC identity and accession retrieval, Exa Contents mapping, MIME and size limits, redirect validation, public-address pinning, timeout, bounded retry, cancellation, and generation fencing are tested at the adapter boundary.
- Default and CI tests use deterministic adapters and make no paid or nondeterministic calls.
- Any live provider contract remains explicit, opt-in, bounded, and separately reported.
- The hash manifest proves that deterministic claims can run only for the intended showcase source versions.

### Component and browser tests

- Claims-first rows, filters, coverage summary, exact-passage inspection, policy exceptions, counter-evidence, and critical unknowns render from the Convex projection.
- The loaded, loading, empty, partial, unavailable, and recoverable-error states preserve geometry and analyst state at desktop and mobile sizes.
- Phase 5 contains no analyst decision controls and does not unlock Phase 6 in the reviewable live-dossier outcome.
- Analyst-facing copy includes the intended consequence and action while excluding raw backend states, providers, request IDs, configuration names, and exceptions.
- Reactive tests prove that persisted branch completion and claim availability update the matrix without fabricated client progress.

## Demonstration Contract

The minimum honest demonstration contains two clearly separated paths:

1. A curated showcase dossier whose manually approved source versions match the fixture manifest. It demonstrates retrieval provenance, atomic claims, supporting and counter-evidence, unknowns, policy outcomes, proposed dimension links, and the complete read-only Evidence Matrix. It may reach `evidence_ready + idle`.
2. A genuinely live dossier that demonstrates approved-source retrieval, normalization where supported, immutable provenance, progress, and partial failures. Until a real claim-generation provider is integrated, it stops in the typed reviewable claim-generation state and never displays fixture claims or unlocks Phase 6.

Cached, seeded, fixture, or precomputed data is always labelled. The distinction is visible in the product and persisted in task provenance, not merely explained during a demo.

## Required Documentation Changes Before Implementation

ADR-023 has been accepted and the product design, `context/TECH.md`, and `ROADMAP.md` have been aligned. At that checkpoint, ADR-017 through ADR-022 retained responsibility for source selection and approval; ADR-023 consumes their accepted decision boundary without rewriting them. At that checkpoint, ADR-004, ADR-009, and ADR-010 retained responsibility for provider boundaries; ADR-023 moves only approved-source SEC and Exa retrieval into Phase 5 without superseding them.

## Decision

Adopt a separate decision-anchored, provenance-first Phase 5 workflow with real retrieval for the exact accepted corpus, immutable source versions and passages, fixture-bound deterministic claim and policy adapters, a read-only claims-first Evidence Matrix, and a strong `evidence_ready + idle` handoff. Reserve successful Phase 5 completion for runs containing at least one structurally valid claim. Preserve arbitrary live retrieval results but pause honestly when claim generation is unavailable, without inventing evidence, `Unknown`, or Phase 6 readiness.
