# Technical Context

## Purpose and Authority

This document consolidates the active technical contract for the Agentic Resilience Evidence Workbench. Read it before changing production code, configuration, dependencies, schemas, workflows, provider integrations, security controls, or tests.

[PROJECT CONTEXT](./PROJECT.md) governs product purpose and framing. The product design defines the complete MVP contract. Accepted ADRs remain authoritative for the decisions they record; this file summarizes those decisions without replacing their rationale.

If this document conflicts with an accepted ADR, the product design, or `AGENTS.md`, stop and surface the conflict.

Delivery and activation evidence is indexed in the [roadmap's recorded delivery state](../docs/ROADMAP.md#recorded-delivery-state-2026-10-22). Contracts below describe the accepted behavior, including implemented preparation and still-unfinished analytical stages. Dated tests and provider experiments are not a claim of current runtime activation or completed live analysis.

## Current Technical Posture

- Use TanStack Start rather than Next.js.
- Use TypeScript with strict type checking. Avoid `any` and validate data at trust boundaries.
- Use Convex as the authoritative database, reactive backend, artifact store, audit-event store, and quota state owner.
- Use Convex Workflow as the default durable orchestrator, including awaited human events, retries, cancellation, and resumption.
- Use Convex reactive queries for live progress instead of a separate SSE or WebSocket service.
- Use shadcn components as accessible primitives composed into a restrained institutional research interface.
- Use the Vercel AI SDK where it provides useful provider, structured-output, or streaming primitives. AI Elements may support secondary AI interactions, but the product must not become chat-first.
- Target Vite 8 or newer when compatible with TanStack Start and the selected packages. Use Vite+ only if a concrete benefit is established without destabilizing the stack.
- Prefer Bun only if the complete dependency and deployment stack is compatible; otherwise use pnpm. Use exactly one package manager and commit its lockfile.
- Use Vitest for unit and integration tests. Add browser-level tests for critical user journeys when the relevant surface exists.
- Vercel Hobby is acceptable only if its current documented limits support the prototype's runtime, workflow, and cost requirements.

Do not add Eve, Vercel Workflow, PostgreSQL, a separate object store, or a custom realtime transport unless measured implementation evidence establishes a requirement Convex cannot satisfy cleanly and the user approves the change.

Do not hard-code model names, provider routing, prototype resource guards,
access codes, showcase companies, or deployment URLs. These are configuration
data.

## Architecture Boundaries

Keep these concerns separate:

- domain records and invariants;
- Convex persistence functions;
- durable workflow orchestration;
- external source discovery and document retrieval;
- document normalization and stable passage location;
- model capability routing and provider adapters;
- evidence extraction and assessment logic;
- UI projections and review interactions;
- evaluation fixtures and metrics.

UI components must not own domain rules. Provider-specific SDK types and model names must not leak into domain records or workflow business logic. Convex is the state owner; do not create competing state authorities.

Use stable identifiers and idempotency keys at every retryable boundary. For SEC
companies, persist CIK as the canonical identity. Treat ticker, legal name,
exchange, and other directory metadata as mutable values that are revalidated;
never use them as retry, association, or deduplication identities unless a
deterministic fixture owns the value.

Persist workflow transitions and external-call metadata before presenting them
as completed. Authorization and the active execution generation must be checked
before external I/O and again before persistence. Cancellation must prevent
late external results from advancing a cancelled run or opening another paid
attempt.

## Domain Model

The completed design contains these explicit concepts:

- `Visitor`
- `Invitation` (compatibility persistence name for a reusable access slot)
- `Company`
- `ResearchRun`
- `ResearchPlan`
- `ResearchPlanQuestion`
- `RunEvent`
- `Source`
- `SourceSelectionProposal`
- `SourceSelectionProposalItem`
- `SourceDecision`
- `CorpusRevision`
- `SourceCapture`
- `SourceVersion`
- `SourcePassage`
- `Claim`
- `ClaimEvidence`
- `ClaimDimensionLink`
- `ClaimDecision`
- `ClaimDimensionDecision`
- `Relationship`
- `AssessmentDimension`
- `ScoreProposal`
- `AssessmentDecision`
- `BriefRevision`
- `ProviderCall`
- `AITaskResult`
- `PolicyEvaluation`
- `EvidenceSourceStatus`
- `ArtifactUploadLease`

`ResearchPlanQuestion` is an immutable, versioned record created with the
research plan. Every `Unknown` claim references at least one unresolved
question and at least one context passage; coverage is derived from claims and
passages rather than stored by mutating the question. `ClaimDimensionLink` is
an immutable proposal record between one claim revision and one assessment
dimension; it contains no effective decision. `EvidenceSourceStatus` is a
mutable projection per frozen accepted source and execution generation.
`ArtifactUploadLease` owns one logical artifact-upload operation and records
`reserved`, `uploaded`, `committed`, or `orphaned`. See ADR-023.

The persistence backbone also uses `WorkflowStep`, `AuditEvent`, and `CheckpointDecision` as operational support records. `RunEvent` remains exclusively the product-progress stream; security, access-code, and quota history belongs in `AuditEvent`.

This is the completed domain model, not an instruction to scaffold unused records. Introduce each concept when observable behavior requires it while preserving these boundaries and names unless an explicit design change is approved.

Use runtime validation for persisted and external data. Represent lifecycle
states with closed unions or enums matching the design. Preserve corpus, claim,
dimension-link, assessment, map, and brief revisions; later additions must not
silently mutate an existing result. One canonical claim may inform several
dimensions. Claim decisions and dimension-link decisions remain separate.

## Workflow and Lifecycle Contract

Implement the research flow as deterministic, inspectable stages:

```text
Search a bounded company-candidate set
→ Require explicit analyst selection
→ Preflight-revalidate the selected CIK and confirm company
→ Reserve analysis and revalidate canonical identity
→ Check public-evidence sufficiency
→ Await evidence decision when insufficient
→ Build research plan
→ Discover sources in parallel
→ Capture and qualify public candidates under preparation authority
→ Inspect one bounded supplement when documentary needs remain
→ Persist proposed CorpusRevision and SourceSelectionProposal
→ Await explicit corpus-revision approval
→ Materialize exact inspected captures for approved sources (legacy approved corpora retain retrieval)
→ Extract passages and atomic claims
→ Run structural validation and targeted semantic verification
→ Search for counter-evidence inside the approved corpus
→ Propose dimension assessments
→ Await exception-driven analyst decisions by dimension
→ Incrementally update derived views
→ Finalize after all ten dimension decisions
```

Valid step states are `queued`, `running`, `completed`, `needs_review`, `failed`, and `skipped`.

Valid research-run transitions are:

```text
draft
→ checking_public_evidence
→ awaiting_evidence_sufficiency_review (when required)
→ discovering_sources
→ awaiting_source_review
→ corpus_approved
→ extracting_evidence
→ evidence_ready
→ assessing_dimensions
→ awaiting_assessment_review
→ completed
```

`completionOutcome` is `completed_assessment` or
`insufficient_public_evidence`. The insufficiency branch is a human checkpoint,
not a generic failure: the analyst may add public HTTPS URLs and re-evaluate,
complete with insufficient evidence, or force continuation with an audited
reason. Force continuation does not weaken any later provenance or confidence
rule.

`corpus_approved` is the persisted handoff between the Phase 4 and Phase 5 vertical slices. New approvals continue automatically: the final Phase 4 handoff records approval and starts the separate Phase 5 workflow in one mutation, using the shared protected start implementation and a deterministic revision-bound key. The execution slot is claimed atomically without an observable idle gap. Historical dossiers at `corpus_approved + idle` retain the owner-authorized start boundary. Extraction progress is emitted only when Phase 5 actually starts. Sources remain inspectable read-only throughout extraction and its terminal states. See the 2026-10-19 amendment to ADR-023.

Phase 5 is a separate decision-anchored workflow definition on the existing
Convex Workflow engine, not a second engine or persistence authority. A
protected start mutation freezes the effective accepted `SourceDecision` heads
from the approved `CorpusRevision`, atomically claims the visitor's execution
slot, increments the generation, and transitions to `extracting_evidence +
running`. The run stores the active workflow ID only while a workflow is
running; Phase 4 `onComplete` success compare-and-clears the stored ID when it
still matches the completed handle, so a newer execution cannot be erased by a
late completion. See ADR-023.

`evidence_ready` is the strong handoff between Phase 5 and Phase 6. It
requires every frozen source branch to be terminal, at least one structurally
valid reproducible passage, a terminal claim pipeline, and at least one
structurally valid claim visible in the matrix. Individual sources may have
failed, and policy outcomes may remain `needs_review` or `blocked`; those
limitations remain visible without preventing the matrix from being ready.

When a live dossier has valid retrieved passages but the deterministic claim
adapter is not authorized for their hashes, the run pauses at
`extracting_evidence + paused + claim_generation_unavailable`. This is an
inspectable technical stop, not an analyst judgment checkpoint, `Unknown`,
evidence insufficiency, or successful Phase 5 completion. The workflow
releases its execution and the visitor running slot; the run has no active
workflow ID. A retry first verifies that an authorized claim adapter is now
available; if capability remains unavailable, the mutation performs no state
change, claims no slot, increments no generation, and issues no external call.
A valid retry atomically claims the slot, advances the generation, starts a new
Phase 5 workflow, and schedules only incomplete claim and policy steps. See
ADR-023.

Pre-approval preparation rolls out behind `SOURCE_QUALIFICATION_ENABLED`, disabled unless its value is `true`. The main workflow snapshots that setting into an optional `prepareSources` argument when started. Existing workflows without the argument retain their original discovery-to-review sequence. Public preparation starts reject while disabled. Activation requires the bounded model and protected-journey gates in the implementation plan.

Enforce transitions server-side. A client must not bypass checkpoints or directly mark workflow stages complete.

Track execution separately from the analytical lifecycle with `idle`, `running`, `paused`, `failed`, `cancelled`, and `completed`. A paused run records whether it awaits source review, assessment review, or `claim_generation_unavailable`. This separation keeps failure and cancellation from inventing analytical stages.

Retries, resumptions, and cancellation must be durable and idempotent. They
must not duplicate claims, quota reservations, provider-call records, or
external side effects. Retryable operation keys include run ID, workflow
version, execution generation, corpus revision, step key, and attempt. Any
resume that can make work `running` atomically claims the visitor's single
running slot and advances the execution generation. Recheck that generation
immediately before external I/O and before persisting its result; reject stale
or cancelled work without advancing state or issuing another paid call.
Persisted `RunEvent` records are the only source of UI progress.

## Evidence Acquisition and Provenance

### Pre-approval source qualification

[ADR-024](../docs/decisions/024-qualify-source-content-before-corpus-approval.md) permits bounded retrieval, normalization and qualification before corpus approval. New prepared drafts use immutable captures and qualification references. Legacy approved corpora without those captures retain their recorded post-approval acquisition path. No title, model confidence, domain count or inclusion decision establishes truth or promotes provenance authority.

The preparation objective is enough useful, inspectable material for subsequent analysis at bounded cost. Preserve useful imperfect sources with explicit limitations rather than requiring every source or question to be fully verified here. A low rank, unavailable reading, incomplete context or failed model response must not be described as proof that relevant material does not exist. Keep source inclusion, documentary coverage, permitted passage use and factual support distinct.

Inspect existing non-rejected candidates, including alternatives, before one dossier-wide supplement capped at three searches, four additions per search and twelve additions total. Preserve the initial discovery ceiling of 48, recommendation ceiling of 24 and all history under a separate historical ceiling of 60. Resume cannot reset the supplement. Documentary availability is available, limited or not established with a precise reason. Partial/unavailable reading never proves irrelevance.

A canonical typed qualification groups document purpose, company relationship, period, forecasts, attributed arguments, asserted facts and observed outcomes with reproducible passage references. Keep source authority deterministic. Useful imperfect sources have enforced passage-use restrictions. Supporting factual authority/corroboration excludes contextual, opposing and restricted argument citations. Required factual verification that is unavailable remains blocked or unknown.

Capture the exact normalized representation in Convex storage before qualification and pin its immutable hash/reference on the proposal. After approval, materialize the same artifact with required accepted-decision authority. Missing/corrupt captures never silently fetch replacement bytes. Cleanup protects both captures and analytical versions. Public PDF qualification uses Exa text with representation-relative locators; page-aware parsing remains deferred.

Capture identity includes the source, requested/resolved URL, retrieval time, stored representation, content hash and retrieval/normalization versions. Passage references bind offsets and quotations to that representation. Whole-capture storage, derived search candidates, model-selected context and approved analytical passages are separate artifacts. The 512-passage materialization ceiling does not delete the retained capture, but storage alone does not prove that later analytical work can retrieve every unselected passage. Pinned qualification references are preserved or materialization fails explicitly. End-to-end use of additional relevant content through the later analytical path remains a verification gap, not an assumed recovery guarantee.

Limits: existing 16 MiB acquisition/artifact bounds, 128 KiB serialized qualification input including instructions, context and the JSON response schema, 6,144 output tokens, 60-second model attempts, at most primary plus one technical fallback, two concurrent source operations, 15-minute persisted preparation deadline, at most 48 initial candidates, 60 retained candidates after supplementation and 120 model attempts. Resume preserves the original deadline. A genuinely new manual source has its own 15-minute window restricted to that new content, without rereading older documents, resetting dossier-wide limits or starting another supplement. Resume of that manual operation preserves its deadline. New links retained while another dossier runs are grouped as new-content-only work; their reading window starts when the execution slot is claimed. The source-intake request identity is independent of execution generation, and authenticated replay lookup precedes the paused-state requirement so a successful response remains replayable after automatic preparation starts. SDK/workflow automatic model retries are disabled. The shared passage extractor and qualification input give descriptive prose, tables and examples priority over short navigation when the reading allowance is full. This formatting priority does not qualify evidence. Original paragraph identities and offsets are preserved. Input omissions and partial reading are persisted. Existing immutable captures and qualifications are reused when their logical inputs and versions match.

Server configuration selects DeepSeek V4 Flash 0731 via Reka and MiMo V2.6 Flash via DeepInfra FP8. Require structured outputs, application-owned fallback and route ceilings of $0.15/M input and $0.60/M output. Valid uncertainty, missing configuration, disabled paid work, cancellation and account billing errors never trigger another model. Telemetry records authority, hashes, versions, resolved route, usage and typed outcomes without secrets or reasoning.

Preparation extends the existing workflow engine and rebuild operation owner. Preserve a legacy main workflow waiting for approval and store its preparation handle separately. Resume claims the execution slot atomically; pre-I/O and pre-persistence fences include run, workflow version, generation, revision, preparation/step and attempt. Cancel active handles and reject late results. Preserve grouped approval and all existing review affordances. Legacy upgrades require explicit refresh/rebuild rather than paid work on page render.

Source preparation and analytical evidence extraction are separate phases. ADR-024 permits bounded candidate retrieval and qualification before approval. The durable corpus-revision approval event remains mandatory before materializing analytical source versions/passages and extracting claims. Preparation captures confer no analytical authority.

Follow the source priority order in the product design and the acquisition boundaries in ADR-004. Source relevance is an estimate, not a truth score. Establish support at claim level through exact provenance, corroboration, and counter-evidence.

### Homogeneous source contributions

Source qualification protocol 3 keeps one grouped call and the existing fifteen-finding overall envelope. Each documentary role is absent or has at most two homogeneous contributions, each with its own kind, period, dependency and up to three exact inspected references. Mixed or uncertain content is explicit and restricted from factual support. The selected-source query projects per-finding usage from the same policy used by claim creation and policy evaluation. Role availability remains a documentary summary, never passage-level factual verification. Attributed hypotheses select the intended contribution when a role is ambiguous and remain constructed from approved records. Immutable protocol-2 captures and approved pins stay readable, while cached responses retain their exact old input identities. New model success requires evaluation of the actual changed input/schema, not synthetic annotation of saved outputs.

### Targeted comparison contract

For new versioned preparations, group otherwise eligible attributed arguments and forecasts from one capture and compare them with relevant primary passages already captured for the dossier. The same-run primary source must remain eligible under the active revision's decisions and existing authority policy. Older captures may be supporting context for new manual content without reopening their retrieval or qualification. Bound selection to sixty candidate metadata records, eight primary captures, sixteen MiB per capture, thirty-two MiB aggregate storage reads, six primary passages per finding plus structural context, sixty-four primary passages per task and the existing full 128-KiB serialized request envelope. Retrieval ranking is a heuristic, never an agreement verdict. Record input omissions and completeness.

Keep raw qualifications and comparison results distinct. Persist comparison provenance and exact target/primary capture, hash, quotation and span pins through existing task results. Require comparable primary references for no conflict observed, scoped only to the selected passages. Possible conflict and inconclusive outcomes remain inspectable and restrict affected automatic arguments, without asserting a proven error or disproved thesis. Match applicable issues across later qualifications by target capture/hash and overlapping span. New positive output cannot silently clear earlier issues. Pin comparison status and applicable issue history in proposal items, fingerprints and approval. Apply one shared finding-use rule to selection, source reading and actual hypothesis/citation validation. Missing or stale checks never grant new attributed-hypothesis permission. Preserve independent useful contributions and historical documentary use.

Use existing model routes, response/time limits, shared 120-attempt dossier reservation, technical fallback, telemetry and execution fences. Comparison uses the existing preparation model routes and workflow owner. Optional non-generative retrieval is separately governed by ADR-025; no per-need human confirmation is introduced. New preparation snapshots opt into comparison steps; legacy workflow journals without the snapshot retain their sequence. Complete the current round's pending capture/qualification batches before comparisons so later primary captures can inform earlier contributions, then evaluate supplementation or final publication. Supplemental captures enter that same ordering before final coverage evaluation. Comparisons retain two-operation concurrency and exact-input caching within the existing authority and allowance.

The comparison request uses deterministic compact primary reference aliases, resolved only against the exact prepared input. Every alias retains full source, capture, content hash, passage and span provenance in that input and in persisted materialized results. This avoids repeated long identifiers in bounded model output. Alias changes alter exact input/cache identity without rewriting historical results or relaxing reference validation.

All primary passages included in an exact grouped comparison request are available for citation by every contribution in that request. The per-finding lexical shortlist is a retrieval suggestion, not a second evidence authority boundary. Schema and materialization share this full supplied set while retaining the same per-result citation bound, target spans, capture eligibility and rejection of foreign or omitted keys. Historical outputs retain their exact request identities. Technical citation validity does not establish semantic agreement or permit activation by itself.

The comparison response currently requires a non-empty explanation of at most 600 characters. The [second-batch report](../docs/verification/2026-10-21-source-quality-second-batch.md) records the resulting output rejections. Changing this contract is deferred until the evidence-preservation investigation is addressed; no larger limit or output-repair call is accepted here. Dated comparison results and failures remain in the [live evaluation report](../docs/verification/2026-10-20-source-comparison-live-evaluation.md).

### Scoped capture retrieval

[ADR-025](../docs/decisions/025-use-versioned-scoped-evidence-retrieval.md) owns the accepted retrieval change. New preparation snapshots may specify `structured-v1` and a lexical or hybrid retrieval mode. Absent configuration retains the historical preparation path. Derived `sourceSearchCaptures`, `sourceSearchPassages` and `sourceEmbeddingCache` records are preparation artifacts. Native full-text search and a 1024-dimensional vector index remain in Convex. Search scope binds the active run, corpus revision, capture hash and policy. The embedding cache binds exact searchable text and an opaque profile version. Parsing is bounded to 100,000 blocks and 20,000 searchable units per capture, with an explicit unavailable outcome before index writes if expansion exceeds these limits. Approval materialization prioritizes all qualification references and adjacent context, failing explicitly when they cannot fit.

The optional provider adapter calls Workers AI directly, with at most 32 inputs, two active embedding attempts per dossier, a 30-second timeout, no redirects or automatic retry, no input truncation, and a 1 MiB response bound. A cumulative 833,333 submitted-byte ceiling conservatively bounds the dossier embedding allowance at USD 0.01 under the verified USD 0.012 per million token ceiling, assuming one token per UTF-8 byte. Unknown outcomes retain their allowance. The separate frozen evaluation ceiling is USD 0.10. Missing configuration or partial embeddings produce lexical retrieval with requested/effective modes and an explicit degradation reason. These diagnostics remain internal.

`SOURCE_RETRIEVAL_MODE` is optional and accepts `lexical` or `hybrid`. `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_AI_TOKEN` are optional action-side configuration for uncached embeddings and must use secure deployment environment channels. No new subscription, Worker, Vectorize index, local embedding model or remote deployment is required. New preparations alone receive the snapshot. Existing running preparations are not reinterpreted.

Evaluation commands and their offline versus backend/provider effects are documented in the [evaluation README](../scripts/evaluations/source-selection/README.md). Internal local-only fixtures require both the E2E fixture flag and a loopback deployment URL. They reuse admitted fixture visitors and do not create invitations or reserve production analyses.

Retrieval applies capture eligibility before native limits. Lexical searches read at most 64 hits for one capture per query transaction, then combine capture rankings through the existing reciprocal-rank fusion and retain 64 hits per research query. Vector search filters by a composite run/revision/retrieval-version/profile/capture key before its top 256. Hydration still rechecks eligibility. Existing vectors with the former scope key explicitly degrade to lexical until reindexing relinks their exact-text cache entries. This does not change embedding models or authorize provider calls. Historical prepared inputs and recorded outcomes are not rewritten.

### Comparison context retention

For versioned retrieval inputs, per-finding six-passage priority lists and up to two structural context passages remain suggestions rather than a hard limit on the shared evidence set. The comparison preparer promotes a covering quotation at the best rank of its contained units, then fills spare context with other retrieved passages while respecting a 32-KiB serialized expansion budget. This includes response-schema bytes. Existing priority context is not removed to satisfy this softer expansion budget. The hard bounds remain 64 passages and 128 KiB, with at most eight output citations per finding. Unversioned selection is unchanged. Exact prepared input still owns cache identity and provenance.

### Source proposals and metadata compatibility

Represent source-scope choice as one of three bounded presets: `balanced`,
`first_party_depth`, or `independent_scrutiny`. Presets alter query priority and
budgets only. They never disable required workflow stages, regulatory coverage,
provenance enforcement, or counter-evidence handling.

After discovery, create one immutable, versioned `SourceSelectionProposal` for the active draft corpus revision and immutable `SourceSelectionProposalItem` records for its candidates. Store the policy version, adaptive recommendation ceiling, candidate-input fingerprint, status, and per-source disposition, rank, and reason codes. Proposal states are `recommended`, `needs_attention`, and `alternative`; they are system recommendations, not analyst decisions.

The following v5/v6 metadata rules describe legacy proposals and metadata-only qualification, not a prohibition on ADR-024 content inspection. From `source-selection-v5`, each immutable item persists `companyLinkageBasis`, `declaredCoverageRoles`, and `eligibleCoverageRoles`. Its metadata linkage values are `structural`, `discovery_metadata`, `unverified`, or `not_evaluated`. `structural` preserves the existing CIK, official-domain, decoded-path domain-alias, and complete legal-name path checks. `discovery_metadata` is limited to declared institutional publishers and shared IR hosts whose discovery title contains either the complete normalized legal-name sequence or the exact confirmed website-domain alias as a token of at least five characters. It may support a recommendation contribution, but it never establishes structural identity, document kind, duplicate identity, evidence, or automatic coverage. `declaredCoverageRoles` records registry capability; `eligibleCoverageRoles` records candidate-specific automatic eligibility, and every non-structural discovered candidate in this metadata-only path has an empty eligible-role list. Analyst-supplied and historical items use `not_evaluated` rather than inventing a linkage proof. See ADR-022. Prepared content can establish relevance and purpose under ADR-024 without promoting publisher authority.

Build the proposal without a model call. `source-selection-v5` treats search category as discovery intent only and classifies each candidate through the versioned authority-capability registry, structured SEC form and accession, confirmed CIK and company identity, authority-compatible URL structure, normalized period or event identity, confirmed company domain, date, coverage preset and research angle. Each candidate persists declared and candidate-eligible coverage roles; only an eligible role can be filled automatically. Shared IR hosts first use the existing exact website-domain label or complete normalized legal-name sequence in the decoded path for structural linkage; bounded discovery-title metadata may create only the separate `discovery_metadata` linkage defined in ADR-022. Company linkage never comes from query parameters, partial tokens, generic legal-name words, or ticker-only matches. Institutional publishers have only their declared independent or news capabilities, and qualified partners cannot satisfy first-party roles or be automatically selected without an eligible role. A company-matched unverified counter-evidence lead remains an inspectable manual-review alternative with no automatic roles, and reseller terms are corroborative manual-review material rather than canonical commercial terms. Titles never prove structural company identity, document type, role eligibility, duplicate identity, or a coverage contribution. Automatic document classification uses explicit decoded URL-path tokens and approved path sequences, never arbitrary URL substrings. Remove canonical and metadata-proven duplicates only when stable identity exists, preserve analyst-supplied sources, cover preset document roles, then add only candidates with a distinct coverage or metadata-triage contribution. Limit annual and interim series to two periods, material events to three, each official family to four contributions, and independent producers to four or six under `independent_scrutiny`. Missing roles remain visible gaps; indexes, Community content, aggregators, low-information documents and unverified publishers remain inspectable alternatives. The discovery recommendation ceiling defaults to half the candidate limit, rounded up, and counts only discovered recommendations; it is a circuit breaker rather than a fill target.

From `source-selection-v6`, immutable proposal items persist metadata-only triage in `recommendationContributions`, separately from `coverageContributions`. Every `discovery_metadata` candidate has empty coverage contributions and empty eligible coverage roles; its recommendation contribution may compose the proposed corpus but cannot establish family coverage, automatic role satisfaction, duplicate identity, evidence, or document classification. Historical items hydrate `recommendationContributions: []` rather than being reinterpreted, and draft proposals from earlier policies require the existing explicit rebuild path.

Policy `source-selection-v12` preserves valid analyst references as default recommendations when inspection is unavailable, without granting documentary coverage or factual authority. Qualified periodic documents retain reporting-period novelty under the existing series limits. One included document can satisfy multiple explicitly qualified ordinary roles. Independent-perspective roles still require distinct producers. Passage-local caveats restrict the referenced contributions and explicit dependencies; unlocated caveats remain global. Draft v10 and v11 proposals use the existing local refresh operation to create a v12 proposal from saved candidates and qualifications, without discovery, provider calls or rewriting analyst decisions. Earlier policy migrations retain their existing behavior.

Source ordering preserves authority, provider order, recency and research-angle precedence, then uses canonical URL identity before database identity to break otherwise equal ranks. Recreating identical source records must not change which distinct documents are recommended merely because their database IDs changed. The [source-review correction report](../docs/verification/2026-10-22-source-review-corrections.md) records the tested boundaries and remaining limits.

Recommend every valid analyst-supplied source by default with the visible reason `Added by analyst`. Analyst-supplied sources are included before and outside the discovery recommendation ceiling; the ceiling counts only discovered recommendations. Manual removal remains possible before approval. `needs_attention` is non-blocking; only no accepted source, stale proposal state, failed integrity checks, or failed authorization blocks approval.

Keep proposal state separate from `SourceDecision`. Proposal generation writes no accepted or rejected decision. Analyst adjustments use the existing append-only decision history: include writes `accepted`, remove writes `rejected`, and undo writes a superseding `pending` decision. `Approve proposed corpus` is one atomic, idempotent server operation that revalidates ownership, active execution generation, draft revision, current policy, proposal version, and candidate fingerprint; preserves explicit overrides; writes an individual accepted decision for each still-pending recommended source; leaves other candidates pending; approves the corpus revision; records the checkpoint and audit event; and resumes the workflow. A candidate-set or current-policy metadata change marks the proposal stale and requires recomputation without overwriting analyst decisions. A draft produced by an older policy is `outdated`, cannot be approved, and requires the separately authorized rebuild action. That action owns one durable lease for the run, revision, generation, expected proposal and policy, blocks concurrent external calls, revalidates the current pointer immediately before dispatch and persistence, and exposes `complete`, `partial` or `blocked` with affected discovery families. A partial proposal remains reviewable with a visible coverage consequence; a blocked rebuild leaves the outdated draft and analyst decisions unchanged, then becomes retryable after a short cooldown through a new fenced cycle that rejects late work from earlier cycles. Approved corpus revisions remain immutable.

Draft source review also supports owner-authorized recovery on the current policy: retry only failed discovery families or perform a bounded metadata search for one unconfirmed coverage role. Recovery extends the existing rebuild lease with a stable request identifier and target, serializes work per draft revision, preserves terminal request replay, and fences dispatch and persistence against approval, cancellation, generation changes, supersession, and lease expiry. An expired request cannot dispatch again under the same identifier. It does not move the research run out of its human checkpoint or retrieve document bodies. Current coverage is a bounded server projection of effective included sources and immutable eligibility metadata, preserving source diversity and automatic-coverage restrictions. Recommendation refreshes preserve discovery failures until an actual recovery resolves them. The existing Add source link toolbar action, inspector, mobile menu, and approval affordance remain intact. See the 2026-10-19 amendment to ADR-018.

Recovery distinguishes a rejected request from an unavailable search. Non-retryable rejections receive no automatic retry. The existing persisted cooldown determines when explicit retry becomes available, with a visible countdown at the search action. A targeted search keeps its coverage popover open through pending and terminal feedback. Coverage inspection shows the bounded matching candidate set in the existing review layout, with an explicit return to the full set. The metadata-only Exa HTTP search omits the `contents` field. Exa Contents text requests respect the provider's 1,000,000-character maximum in addition to the application's byte limit.

Every accepted passage needs a stable, reproducible locator appropriate to its
source, such as page and bounding text for a public PDF or URL plus anchored
text or section for a web document. Reject passages that cannot be located
reproducibly.

An editable draft `CorpusRevision` can receive multiple source additions and decisions without creating a revision for each URL. An approved revision is immutable and includes accepted sources only. Changing that approved membership requires a new draft revision and another durable approval checkpoint; several changes may be grouped in that draft. Pending and rejected sources cannot supply analytical outputs. Bounded preparation of an eligible pending source is allowed under ADR-024 before approval. Unchanged captures and exact-input qualifications may be reused under their existing cache rules; this does not establish a complete incremental recomputation contract for downstream claims, assessments or briefs.

Creating a corpus revision builds its initial proposal from the persisted run pointing to that new revision. A reopened legacy corpus without a waiting discovery workflow uses the existing evidence-execution handoff on approval. That owner freezes the accepted sources, claims execution and starts the existing workflow in the same transaction. The original revision and append-only decisions remain intact.

`SourceDecision` remains the append-only authority for analyst choices.
`sourceReviewItems` is a mutable, derived read model for one source and corpus
revision: insertions and decisions update it in the same transaction, while an
idempotent admin backfill reconstructs it from source and decision history.
Review summaries use bounded indexed reads, collection pages use native Convex
cursor pagination, and approval checks the first indexed accepted projection.
The projection must never replace, rewrite, or relax the decision history.

Analysts may add public HTTPS URLs only. Treat them as proposed sources and
apply server-side URL canonicalization, DNS and redirect validation, SSRF
protection, bounded timeout/content type/size/decompression, and the normal
corpus decision flow. Authorize the caller and run before DNS or HTTP work.
Validate every redirect destination and connect to the public address that was
validated while preserving the original host for HTTP Host and TLS SNI; do not
validate one DNS result and then permit an unrelated resolution for the actual
connection. Local file and PDF upload is outside the MVP. Validated public PDF URLs support bounded captured-text preparation before approval and analytical materialization afterward; page-aware parsing remains deferred.

All analyst URL entry uses one public Convex action. Before launch, the action
returns a short-lived server-owned preparation receipt after URL validation and
bounded metadata inspection; the receipt is not a source or corpus member.
Launch accepts only preparation IDs and atomically consumes every valid receipt
while creating pending candidates in revision one. Active dossiers call the
same action and persist through the same pending-source helper. Missing,
expired, foreign, or invalid preparations create no run and consume no analysis
quota. Expected failures use stable structured application codes with an
explicit retryability policy; analyst-facing copy never parses or renders raw
backend errors.

Preserve source retrieval and extraction failures as visible structured states. Failure of one source must not erase it or terminate unrelated retrieval work.

Phase 5 materializes the exact approved captures for prepared dossiers. Legacy approved sources without capture pins use real SEC direct HTTP for confirmed CIK/accession identity and real Exa Contents for general-web URLs. Real Unstructured page-aware PDF normalization and general live model-provider claim generation remain Phase 8 deferrals; their Phase 5 contracts use deterministic fixture adapters. Preparation qualification and comparison have separate real provider adapters under ADR-024. See ADR-023 for the honest `claim_generation_unavailable` boundary.

Phase 5 numeric safety limits: `MAX_APPROVED_SOURCE_BYTES = 16 MiB` (declared
and decompressed), `MAX_NORMALIZED_ARTIFACT_BYTES = 16 MiB`, `MAX_PDF_PAGES =
400`, `MAX_PASSAGES_PER_SOURCE = 512`, `MAX_QUOTATION_CHARS = 4,000`,
`MAX_REDIRECTS = 5`, two total attempts per source, SEC and direct HTTP timeout
10 seconds (abortable), Exa Contents outer timeout 120 seconds (abortable), and
accepted-source count capped by the existing `SOURCE_CANDIDATE_LIMIT = 48`. The
frozen fan-out count is the actual number of accepted sources, never the
source-recommendation ceiling or an assumed target. ADR-024 extends the historical/frozen ceiling to 60 for prepared dossiers while initial discovery remains 48. See ADR-023.

Treat retrieved documents and model output as untrusted input. Generated structured output must pass schema validation before persistence as usable evidence. Bound retries. If validation or evidentiary support remains inadequate, downgrade the result rather than laundering it into a fact.

Rejected sources cannot contribute to passages, claims, assessments, maps, or briefs.

## Assessment Contract

Support these ten dimensions:

1. Context ownership
2. Workflow control
3. System-of-action capability
4. Orchestration position
5. Model and platform dependency
6. Data defensibility
7. Switching costs
8. Pricing resilience
9. Learning loops
10. Abstraction exposure

Position is `-2`, `-1`, `0`, `+1`, or `+2`. Confidence is `Low`, `Medium`, or `High`. Direction is `Declining`, `Stable`, or `Improving` over three years.

`Orchestration position` means economic orchestration position: control of intent, operational context, workflow execution, and business outcomes. Never derive it from the sophistication of a company's internal LLM harness alone.

Confidence must remain inspectable and tied to question coverage, source authority, recency, independent corroboration, unresolved counter-evidence, and the ratio of facts to inferences. Do not ask a model to invent a confidence label without those inputs.

Represent model work as versioned typed tasks. Generated task results are
proposals and cannot directly set `approved`, final confidence, quality gates,
or workflow authority.

Apply two evaluation layers:

1. non-overridable structural validation for schema, approved-source
   membership, required provenance, and stable locators;
2. an application-owned, code-defined, versioned policy that deterministically
   combines observable evidence characteristics and typed semantic-verifier
   results into `pass`, `needs_review`, or `blocked`.

Deterministic rules trigger semantic verifier tasks only where mechanical
checks are insufficient. Persist policy version, normalized inputs, executed
rules, outcomes, and any verifier task references. A policy change requires
tests and an explicit evaluation revision; it never silently rewrites history.

The default analyst experience is exception-driven. The UI may approve a
reviewed group in one action while the server persists individual claim and
dimension-link decisions. Corrections create a cited replacement claim and
visible diff. Each dimension decision atomically records position, confidence,
three-year direction, and any justified override.

## Provider and Model Architecture

Implement a provider-agnostic `ModelRouter`. Workflow code requests capabilities rather than named models:

- `source-relevance`
- `claim-extraction`
- `contradiction-search`
- `claim-entailment`
- `contradiction-verification`
- `dimension-relevance`
- `claim-correction`
- `dimension-assessment`
- `brief-generation`

`SourceSelectionProposal` composition remains deterministic and does not call `source-relevance`. ADR-024 preparation uses separate typed qualification and targeted-comparison tasks whose inspected, validated outputs inform composition. Model results cannot own inclusion, provenance authority or analyst decisions. General analytical capabilities above remain distinct from those preparation integrations.

Routing considers capability, quality, approximate cost, configured resource guards, availability, and prior failures. Model names are configuration data.

Required provider boundaries are:

- a Codex subscription provider option;
- OpenRouter;
- an extension contract for future providers.

Use the upstream CLIProxyAPI distribution as the prototype-only experimental Codex subscription transport defined by ADR-003. It is a pragmatic infrastructure adapter, not the application-level router, a permanent production architecture, or an officially endorsed OpenAI integration. Keep credentials and management surfaces private.

Use `ai` with `@openrouter/ai-sdk-provider` for OpenRouter. Use `ai` with
`@ai-sdk/openai-compatible` only for the private CLIProxyAPI inference surface.
Do not route OpenRouter through CLIProxyAPI.

Use metadata-only Exa search for discovery; the HTTP search request omits the `contents` field. Exa Contents may retrieve eligible candidate content under ADR-024 preparation authority, or retrieve legacy approved sources under ADR-023. Exact prepared captures are reused after approval instead of silently fetching replacement bytes. Query SEC EDGAR directly over HTTP with an identifying `User-Agent` and a shared aggregate request limiter below the SEC maximum. The selected Unstructured Pipeline Jobs integration is a direct-HTTP contract; the legacy Partition client is not an MVP dependency.

The provider-SDK preference applies where a current SDK owns the selected API
surface. SEC EDGAR is an intentional direct-HTTP institutional-source boundary,
and Unstructured remains a direct-HTTP exception until its JavaScript client
adds material value for the current Pipeline Jobs API.

Treat DeepSeek V4 Pro and Momo 2.5 Pro only as candidate configuration examples when they are verified as available. Never assume their identifiers, capabilities, availability, or pricing.

For each provider call, persist the requested capability, resolved provider and
model, task/prompt/input/output schema versions, available usage and cost data,
latency, status, retry number, fallback reason, and references to structured
input and output. Do not store secrets or unnecessary sensitive prompt data.

The application owns bounded retries and fallback. Each task configuration
declares one primary and at most one explicit fallback. OpenRouter may route
infrastructure for the same configured model under explicit parameter and
privacy constraints, but it may not silently substitute the application model.
Validate every fallback result through the same task schema and policy.

Missing provider configuration, disabled paid work, exhausted application
limits, and partial provider failure are explicit typed outcomes with an
analyst-relevant consequence and next action. They must not be persisted or
rendered as an empty successful result. Raw provider errors, configuration
names, and internal workflow state remain outside analyst-facing copy.

Neither CLIProxyAPI production readiness nor precise dossier economics is a prerequisite for the candidature implementation or demonstration.

## Access, Quotas, and Resource Guards

- Create exactly five stable access-slot records through an idempotent seed or
  administrative setup path. They remain persisted as `Invitation` records for
  compatibility.
- Use Convex Auth anonymous sessions with reusable, server-digested four-digit
  access codes as defined by ADR-014. Keep one slot as administrator and four
  as analysts.
- The first valid use creates the slot's stable `Visitor`. A later valid use
  atomically rebinds that visitor to the new anonymous Auth user, preserves its
  role, quota, dossiers, and audit history, and removes protected access from
  the previous Auth identity.
- Consume access-code attempts atomically before digest verification:
  allow at most five attempts per anonymous Auth identity and 25 attempts
  deployment-wide in a 15-minute window.
- As defined by ADR-012, allow an anonymous Auth identity to use the public
  Start surface and non-billable company preflight before workspace access.
  Require an active admitted `Visitor` before quota reservation, workflow
  creation, dossier access, or administrative operations.
- As defined by ADR-015, preflight may use bounded Exa search only to resolve visual company website metadata. This may consume provider credits but never reserves visitor analysis quota, changes SEC CIK identity, or blocks a valid SEC preflight. Consult the CIK cache first, retain stale cache entries on refresh failure, and fall back to SEC investor-relations metadata and then the existing company icon.
- Maintain at most five stable visitors in total.
- Allow each admitted visitor to reserve at most three analyses in total.
- Enforce both limits atomically in server-side Convex mutations and persist them across sessions.
- Allow at most one `running` workflow per visitor. Runs paused at a human
  checkpoint do not block another launch.
- Consume a launch reservation once. Retries and resumes consume no additional analysis; abandoned or voluntarily deleted analyses remain counted.
- Require an append-only audited reason for administrative quota restoration.
- Bound workflow retries and research breadth through configuration, including source, document-page, and provider-call limits where appropriate.
- Set `COMPANY_SEARCH_RESULT_LIMIT` to the maximum ranked SEC candidate set
  returned by one search (40 for the prototype), then paginate that immutable
  result locally in the composer. Set `SOURCE_CANDIDATE_LIMIT` to the explicit
  per-dossier candidate scope (48 for the prototype). Enforce source capacity
  before external URL inspection or discovery, again inside persistence, and
  stop later provider calls when no capacity remains. Never truncate an
  existing dossier during migration.
- Set the server-owned `SOURCE_RECOMMENDATION_CEILING` to `ceil(SOURCE_CANDIDATE_LIMIT / 2)` by default and validate it as a positive integer no greater than the candidate limit. The ceiling is never a quota; stop earlier when no reliable coverage contribution remains.
- Use provider-side spending controls when available and provide an emergency server-side switch that prevents new paid work.
- Record provider-reported usage, latency, and cost when available.
- Provide an admin-only operational projection for running workflows,
  checkpoints, failures, provider calls, available usage/cost, audited quota
  restoration, and the emergency paid-work switch.

Do not build transactional dollar reservations, a settlement ledger, list-price-equivalent accounting for free tiers, or precise per-dossier cost enforcement. ADR-006 supersedes ADR-005 on this point.

Never rely on disabled UI controls for access, analysis, or resource-limit enforcement.

## UI Engineering Constraints

Build an institutional analyst workbench: dense enough for serious research, calm, legible, and provenance-forward. Prioritize matrices, citations, review state, unknowns, counter-evidence, and audit history over decorative AI effects.

The required screens are listed in the product design. The selected production
direction is Prototype A's persistent navigation rail, folded into real
`/workspace` routes rather than promoted with static prototype data.

Existing user-authored surfaces are the implementation baseline, not disposable
scaffolding. Connecting live Convex data or workflow behavior does not authorize
recomposing the Start page, research composer, toolbar, Workbench Shell,
analyzed-company navigation, dossier cards and card-shaped skeletons, source
review, persistent rail, or their established responsive, keyboard, motion,
loading, hover, and focus behavior. Preserve public HTTPS reference controls
even though local upload is excluded. Shared primitives remain neutral;
consumer-specific stacking, sizing, motion, and copy stay at the consumer unless
they become a documented shared contract. Any material visual or structural
change requires an explicit product decision before implementation.

Keep `Progress`, `Sources`, `Evidence`, `Assessment`, `Map`, and `Brief` visible. Derive active, completed, and locked states from persisted workflow state; locked items explain their prerequisite. The navigation rail stays sticky below the shell header. From `md` (768px), it defaults to expanded and reserves its actual width in the layout; below `md`, it defaults to collapsed and preserves overlay expansion. Explicit collapse choices persist, while mobile auto-collapse after section selection does not overwrite that preference. Keep responsive rail sizing values in one object in the rail component file. Use a retractable contextual panel on desktop and a drawer on smaller screens. Source review is a dedicated, summary-first mode: the proposal summary, family coverage, gaps, exceptions, adjustments, and `Approve proposed corpus` action form the primary surface.

The protected dossier route owns source-review navigation through validated `view` and `coverage` search parameters under `section=sources`. Omit `view` for the proposal overview, use `adjust` for the adjustment board or `inspect` for candidate inspection, and accept a canonical coverage-role key only during inspection. Refresh, direct links, and browser history restore that context. Showing all candidates removes `coverage`; returning to the proposal removes both parameters. Query parameters never trigger discovery, source decisions, or approval. Standalone prototype consumers retain local navigation through the same component interface.

Use `DiscreteTabs` for the mutually exclusive current source-review groups, keeping the labels `Recommended`, `Needs attention`, and `Alternatives`. `Recommended` contains the effective included set, including analyst additions; `Needs attention` contains undecided, excluded items originally flagged for review; `Alternatives` contains the remaining excluded candidates, including explicit removals. Preserve the immutable system disposition and reasons, show analyst overrides, and retain attention warnings on manually included sources. Overview card actions save the existing append-only source decisions directly, offer undo, and update membership and counts from the same bounded adjustment-set query used by `Adjust proposal`. Keep incremental loading in the overview. Source moves use distinct neutral action buttons, separate from metadata badges. Source-card footers group the move button and quieter `Use original recommendation` action inline, wrapping only when needed. A separate information control reveals the original recommendation and its inclusion or exclusion consequence on demand without changing the source; the toast Undo restores the previous analyst decision. Below `md`, the summary toolbar uses a labeled `Source actions` popover while approval and direct source moves remain visible; from `md`, toolbar actions remain inline. `Add source link` opens the existing public-HTTPS intake dialog directly from the overview and remains available in inspection while the revision is editable. `Adjust proposal` retains its separate `Included` and `Available` working sets. `Inspect all candidates` preserves the existing master-detail list, server cursor pagination, selected-source detail, desktop resizing, mobile drawer, preview, and manual URL action. Keep Convex query state, corpus approval, and domain decisions in their owning containers and server modules. Secondary list filters may use `AnimatedListFilter` only after it has accessible popup semantics, keyboard and focus handling, Escape and outside-click behavior, reduced-motion support, English copy, and focused tests.

The architecture map and brief update incrementally from approved claims, show incomplete coverage, and never simulate progress.

Implement responsive, keyboard-accessible layouts with semantic HTML, visible focus, sufficient color contrast, explicit labels, and non-color status cues. Treat loading, empty, partial-failure, needs-review, cancelled, and insufficient-evidence states as first-class UI states.

The summary may emphasize at most five priority dimensions while preserving access to all ten. Architecture visualizations must communicate uncertainty and evidence coverage rather than imply complete knowledge of an internal architecture.

Do not make chat the primary interface. Do not add automatic translation until the English MVP is complete and verified.

## Security Boundaries

- Keep secrets server-side and out of logs, client bundles, fixtures, and version control.
- Validate authorization and access-slot state in every protected server operation.
- For external I/O, validate the caller and every applicable ownership, active
  workflow generation, resource-limit, and operation-lease condition before
  DNS, SDK, or HTTP work. Revalidate generation and cancellation before
  persistence; unauthorized, stale, cancelled, or duplicate attempts perform no
  provider I/O.
- Enforce access-code format and attempt limits on the server; the OTP
  input is not a security boundary.
- Validate URLs, redirects, response types, sizes, decompression, and parsed
  content. Local file upload is not exposed in the MVP.
- Treat source content as evidence, never as system instruction; defend tools and model prompts against embedded instructions.
- Restrict outbound fetching to safe protocols and mitigate SSRF, redirects to private networks, oversized responses, and decompression bombs.
- Escape or sanitize rendered source content and generated text.
- Apply least privilege to Convex functions and provider credentials.
- Preserve an audit trail without recording credentials, session secrets, or unnecessary personal data.

Security controls are required in proportion to the features actually exposed; they are not permission to build an unrelated enterprise security platform before the relevant slice exists.

Preview cache reads require authenticated, active ownership and a claimed invitation bound to that visitor, just like rendering. Rendering rechecks eligibility before I/O, after receipt and atomically before cache persistence. The standalone preview service sends Chromium connections through a per-render authenticated loopback CONNECT proxy that connects only to a validated numeric public address. TLS remains end-to-end in Chromium. Redirect responses are paused and validated before continuation, including the five-hop limit. Subresources use the same egress boundary; service workers, WebSockets, downloads and non-GET browser requests are blocked. The proxy has a bounded lifetime, connection count and aggregate transfer limit. This service is separately packaged, so its URL policy remains independent of the Convex runtime; the dedicated browser gate must preserve parity for private-address ranges and redirect policy. See [the correction verification record](../docs/verification/2026-10-22-source-review-corrections.md) for executed checks, environment limitations and deployment status.

## Test and Verification Contract

All production behavior changes follow the TDD policy in `AGENTS.md`. The detailed cycle is:

1. Write one minimal test that expresses the next observable behavior through its public boundary.
2. Run the narrowest relevant Vitest target and verify that it fails for the expected missing behavior, not because of broken setup.
3. Implement the smallest coherent production change that makes it pass.
4. Run the focused test and confirm it passes without unexpected errors or warnings.
5. Refactor without adding behavior, rerunning the focused test after meaningful changes.
6. Run the affected suite, the full project suite, type checking, linting, and formatting.
7. For user-visible critical flows, run the relevant browser-level test against
   the real application boundary and intended role/access state. A public page,
   mocked component, or unauthenticated rejection is not a substitute for the
   protected workflow.

Record the RED command and expected failure in the implementation handoff. If a test passes on its first run, strengthen or correct it; it does not prove new behavior.

Critical browser gates cover the complete access-code admission, protected
route, logout, and reconnection journey for the relevant analyst and
administrator roles. Verify meaningful desktop and narrow-mobile states,
keyboard navigation, visible focus, action-revealing hover/focus behavior,
reduced motion when animation changes, loading and partial-failure states, and
the browser console. Use fresh post-action observations. If the required role
or admitted session is unavailable, report the gate as incomplete rather than
substituting a nearby public surface.

### Test Boundaries

- Test domain invariants with fast deterministic unit tests.
- Test Convex queries, mutations, actions, authorization, atomic reservations, and transitions at their real server boundary where practical.
- Test workflows with deterministic source and provider adapters, persisted events, retries, checkpoint resumption, cancellation, and idempotency.
- Use contract tests for each real model or retrieval adapter. Keep live-provider tests explicit, opt-in, and budget-limited.
- Test UI behavior through observable outcomes and accessibility semantics, not component implementation details.
- Maintain at least one integration or import test that loads each important production module through its real export path.
- Use concurrency tests for quotas, idempotency, and race-sensitive audit behavior.

Mock only nondeterministic or external boundaries. Do not copy production logic into tests, mock the domain behavior being tested, rely solely on snapshots for core rules, or assert only mock call counts when a real result is observable.

### Reactive Browser-Test Architecture

Use three distinct verification layers. They are complementary and must not be substituted for one another:

1. **React integration tests with Vitest and React Testing Library** verify rendering, loading, errors, interaction semantics, and component-to-hook wiring. Mock `convex/react` only through the shared harness under `src/__tests__/helpers/`. The harness routes generated function references to stable query snapshots and explicit mutation or action implementations; tests must never dispatch mock results by hook call order. Query fixtures may be deliberately partial because this layer tests presentation projections rather than reconstructing complete persisted documents.
2. **Convex tests with `convex-test`** verify server authorization, validators, persistence, transitions, workflow contracts, idempotency, and deterministic fixture behavior. They import real Convex modules and use mocked identities or external adapters only where the server boundary requires them. `convex-test` does not simulate the React client's live subscription lifecycle and must not be presented as proof of browser reactivity.
3. **Playwright tests against the real local Convex backend** verify critical protected journeys whose contract depends on subscriptions or persisted workflow events. The browser performs real anonymous sign-in and access-code admission, then uses the normal authorized UI mutations and reactive queries. Assertions cover fresh user-visible post-action state and, when needed, a guarded internal read model of the same persisted scenario.

The Playwright harness is local-only and follows these controls:

- `playwright.config.ts` starts the local Convex deployment and Vite application, runs Chromium serially with one worker, and captures traces, screenshots, and video on failure.
- Global setup reads invitation material from the ignored local OTP file, configures only `--deployment local`, enables `E2E_FIXTURES_ENABLED`, and bootstraps the normal invitation records.
- Internal functions in `convex/e2eFixtures.ts` derive ownership from a claimed invitation slot. They never accept a visitor ID, auth user ID, or fabricated browser identity. Scenario keys are deterministic and idempotent.
- E2E fixtures may create bounded local records and a minimal real workflow, but they must reuse production mutations, projections, authorization-sensitive browser operations, and workflow events for the behavior under test.
- Fixture inspection is internal, read-only, bounded, and limited to evidence needed for assertions such as lifecycle state, source decisions, revision status, and provider-call count.
- Default browser scenarios configure no paid provider work and assert that no provider call was persisted when the journey should remain provider-free.
- Global teardown removes `E2E_FIXTURES_ENABLED`. A verification run is incomplete if the flag remains on the local deployment afterward.
- No E2E command may target a cloud dev, preview, or production deployment. No public test endpoint, `--identity` impersonation, client-side authorization bypass, or manually edited generated Convex type is permitted.

Use Playwright selectively for behavior that cannot be proven honestly by the first two layers, especially subscription-driven row/count/detail updates, protected checkpoint transitions, durable reconnection, and persisted progress. Keep deterministic domain and component coverage in the faster layers.

### Minimum Automated Coverage

Cover at minimum:

- atomic access-code attempt limits, visitor rebinding, and analysis
  reservation under concurrency;
- persistent five-visitor and three-analysis limits;
- configured research and provider-call guards;
- valid and invalid workflow transitions;
- workflow resumption, cancellation, retries, and idempotency;
- mandatory source approval before analytical materialization and claim extraction, with bounded preparation separately authorized;
- adaptive source-recommendation ceiling without forced filling; deterministic composition separate from model-backed preparation;
- deterministic dynamic source-family coverage, proposal versioning, stale detection, and manual-source inclusion;
- grouped proposal approval writing individual append-only source decisions atomically and idempotently;
- exclusion of rejected sources everywhere downstream;
- stable passage and citation validation;
- provider output schema rejection and bounded retry;
- non-overridable structural validation and versioned policy outcomes;
- targeted semantic-verifier triggering and typed result persistence;
- claim classification and evidence linkage;
- grouped review writing individual decisions;
- canonical-claim and dimension-link decision separation;
- counter-evidence preservation;
- analyst-decision preservation across retries and revisions;
- map relationships backed by validated claims;
- brief generation from approved claims only;
- progressive map and brief revisions preserving incomplete coverage;
- one-running-workflow-per-visitor enforcement;
- evidence-sufficiency URL, completion, and justified-override paths;
- partial source and provider failures;
- access control for protected queries, mutations, and actions.

Use deterministic fixtures. Default and CI suites must not call paid or nondeterministic providers. Before completion, report exact commands and results. If a check cannot run, state why and what remains unverified.

Documentation-only changes do not require a failing automated test. Validate links, structure, and consistency directly.

Pure tooling or configuration changes require executable before-and-after validation when feasible. Verify generated files through their generator or consumer rather than by inspection alone.

## Implementation Sequence

Build runnable vertical slices in this order unless measured evidence justifies a change:

1. Initialize the project, quality tooling, environment validation, and institutional shell.
2. Define typed domain schemas, lifecycle transitions, audit events, and Convex persistence.
3. Implement access-code admission, stable visitor rebinding, and atomic
   analysis reservations.
4. Implement a provider-independent workflow skeleton with persisted progress and durable checkpoints, using deterministic fake adapters in tests only.
5. Build company selection, preflight, canonical revalidation, evidence sufficiency, research planning, SEC/Exa discovery and HTTPS intake. Prepare bounded captures, qualification, retrieval and targeted comparisons before deterministic source composition, summary-first review and atomic corpus approval.
6. Materialize exact approved captures and pinned passages, retain legacy approved-source retrieval, then build typed analytical claims, structural validation, policy evaluation and counter-evidence handling. Keep the deterministic showcase boundary explicit until real analytical tasks are integrated.
7. Build exception-driven grouped claim review, canonical claim and
   dimension-link decisions, per-dimension proposals, confidence inputs,
   atomic assessment decisions, overrides, and revision history.
8. Build progressive architecture-map and approved-claims-only brief revisions
   with persisted contribution previews.
9. Complete the remaining analytical model and page-aware PDF adapters, application-owned routing, telemetry, admin operations and partial-failure behavior. This step does not defer the discovery, acquisition, qualification/comparison or optional embedding adapters already required by preparation.
10. Curate the CCC showcase corpus, then derive expected evaluation material
    after manual approval. Add deterministic policy fixtures.
11. Verify the complete access-code-admission-to-brief journey and document
    measured limitations before the candidature demo.

Do not postpone core invariants until a final hardening phase. Do not scaffold every final-state abstraction before its vertical slice needs it.

## Evaluation and Demo Verification

Keep CCC as the primary curated showcase under its accepted scope. Define its expected claims, known contradictions and unresolved questions after manual corpus approval, then reuse that dossier for regression rather than creating a parallel golden dossier. Use small deterministic fixtures for isolated policy rules.

Evaluate source preparation separately across multiple companies, source families and dossier types, including broad research, targeted questions, analyst-supplied references and uncertain arguments. This does not require multiple completed showcase dossiers. Historical four-company replays reuse observed captures and model outputs; they establish neither unfamiliar-company robustness nor fresh discovery or new-angle model quality.

Separate exact-reference retention from useful equivalent evidence, displayed qualification and downstream analytical correctness. The [Snowflake correction](../docs/verification/2026-10-21-evidence-retrieval-repair.md#interpretation-correction-2026-10-22) demonstrates why a missing reference offset cannot alone establish missing useful evidence. Keep historical raw results immutable, record investigator authorship and unresolved judgments, and do not turn a count out of 32 conditions into the product objective or a definitive technology choice. Any revised selection threshold or activation decision requires explicit acceptance. Existing replay commands and their input prerequisites belong in the [evaluation README](../scripts/evaluations/source-selection/README.md).

Measure citation validity, entailment, classification, contradiction retrieval, question coverage, unsupported-claim rate, duration, available provider usage or cost, and analyst corrections.

The demo has two honest paths:

1. a completed, carefully evaluated showcase dossier;
2. a genuinely new run showing live company resolution, source discovery, persisted progress, and the corpus checkpoint.

Never present cached, seeded, or precomputed output as live. Label showcase and fixture data clearly.

## Decision Index

- ADR-001: evidence-first analyst workbench and mandatory human review.
- ADR-002: Convex reactive persistence and durable workflows.
- ADR-003: upstream CLIProxyAPI as the experimental Codex subscription transport.
- ADR-004: SEC, Exa, and Unstructured source-acquisition boundaries.
- ADR-005: retained historical cost-ceiling decision, superseded by ADR-006.
- ADR-006: lightweight prototype usage guards.
- ADR-007: anonymous Convex Auth and the original one-time invitation contract,
  superseded in part by ADR-014.
- ADR-008: versioned research revisions and exception-driven analyst review.
- ADR-009: typed AI tasks and deterministic, versioned policy adjudication.
- ADR-010: application-controlled provider routing, retries, and fallback.
- ADR-011: public HTTPS URL-only manual source intake for the MVP.
- ADR-012: public company preflight before access-code-gated research launch,
  with reuse semantics amended by ADR-014.
- ADR-013: four-digit access-code format and rate limits; its original
  single-use property is superseded by ADR-014.
- ADR-014: reusable access codes for stable visitor sessions.
- ADR-015: bounded Exa company website enrichment before admission.
- ADR-016: centralized public-HTTPS manual source intake with expiring preparations.
- ADR-017: deterministic source-selection proposals and grouped corpus approval, with ranking and fixed-target sections superseded by ADR-018.
- ADR-018: adaptive authority- and document-aware source selection, outdated-draft rebuild, and recommendation ceiling.
- ADR-019: transient visual preview, separate from documentary captures and analytical evidence.
- ADR-020: historical counter-evidence selection decision, superseded by ADR-021.
- ADR-021: source provenance and declared role capability separated from candidate-specific automatic role eligibility, as amended by ADR-022.
- ADR-022: durable company-linkage basis and bounded discovery-metadata recommendations without automatic coverage eligibility.
- ADR-023: decision-anchored Phase 5 evidence workflow, effective-head freeze, `evidence_ready`, `claim_generation_unavailable`, immutable `ResearchPlanQuestion`, provenance/claim/policy records, upload lease cleanup, real SEC/Exa approved-source retrieval, deferred real Unstructured/model generation, and hybrid showcase/live boundary.

- ADR-024: bounded pre-approval content qualification, immutable captures, one finite discovery supplement, controlled inexpensive model routing and enforceable restricted evidence use.
- ADR-025: versioned scoped retrieval, optional hosted embeddings, preservation of pinned passages, and bounded comparison context; exact-reference metrics do not settle useful-evidence quality.

Read the corresponding record in `docs/decisions/` before revisiting any of these decisions.
