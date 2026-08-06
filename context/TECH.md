# Technical Context

## Purpose and Authority

This document consolidates the active technical contract for the Agentic Resilience Evidence Workbench. Read it before changing production code, configuration, dependencies, schemas, workflows, provider integrations, security controls, or tests.

[PROJECT CONTEXT](./PROJECT.md) governs product purpose and framing. The product design defines the complete MVP contract. Accepted ADRs remain authoritative for the decisions they record; this file summarizes those decisions without replacing their rationale.

If this document conflicts with an accepted ADR, the product design, or `AGENTS.md`, stop and surface the conflict.

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
- `RunEvent`
- `Source`
- `SourceDecision`
- `CorpusRevision`
- `SourceVersion`
- `SourcePassage`
- `Claim`
- `ClaimEvidence`
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
→ Persist proposed CorpusRevision
→ Await explicit corpus-revision approval
→ Retrieve and normalize approved sources
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

`corpus_approved` is the persisted handoff between the Phase 4 and Phase 5
vertical slices. Phase 4 may finish its workflow execution with
`executionStatus = idle` in that lifecycle state; it must not emit extraction
progress until a later workflow version actually starts extraction.

Enforce transitions server-side. A client must not bypass checkpoints or directly mark workflow stages complete.

Track execution separately from the analytical lifecycle with `idle`, `running`, `paused`, `failed`, `cancelled`, and `completed`. A paused run records whether it awaits source review or assessment review. This separation keeps failure and cancellation from inventing analytical stages.

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

Source discovery and evidence extraction are separate phases. The durable
corpus-revision approval event is mandatory before retrieval and extraction
proceed.

Follow the source priority order in the product design and the acquisition boundaries in ADR-004. Source relevance is an estimate, not a truth score. Establish support at claim level through exact provenance, corroboration, and counter-evidence.

Represent source-scope choice as one of three bounded presets: `balanced`,
`first_party_depth`, or `independent_scrutiny`. Presets alter query priority and
budgets only. They never disable required workflow stages, regulatory coverage,
provenance enforcement, or counter-evidence handling.

Every accepted passage needs a stable, reproducible locator appropriate to its
source, such as page and bounding text for a public PDF or URL plus anchored
text or section for a web document. Reject passages that cannot be located
reproducibly.

An approved `CorpusRevision` includes accepted sources only. A candidate may
remain `pending`, but it is excluded from all downstream work. Accepting a
pending source or an external counter-evidence lead later creates a new corpus
revision and another durable checkpoint.

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
connection. Local file and PDF upload is outside the MVP. Public PDFs reachable
through an approved HTTPS URL remain supported after approval.

Preserve source retrieval and extraction failures as visible structured states. Failure of one source must not erase it or terminate unrelated retrieval work.

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

Routing considers capability, quality, approximate cost, configured resource guards, availability, and prior failures. Model names are configuration data.

Required provider boundaries are:

- a Codex subscription provider option;
- OpenRouter;
- an extension contract for future providers.

Use the upstream CLIProxyAPI distribution as the prototype-only experimental Codex subscription transport defined by ADR-003. It is a pragmatic infrastructure adapter, not the application-level router, a permanent production architecture, or an officially endorsed OpenAI integration. Keep credentials and management surfaces private.

Use `ai` with `@openrouter/ai-sdk-provider` for OpenRouter. Use `ai` with
`@ai-sdk/openai-compatible` only for the private CLIProxyAPI inference surface.
Do not route OpenRouter through CLIProxyAPI.

Use `exa-js` for source discovery with `contents: false`; call `getContents`
only with URLs or search results belonging to an approved corpus revision.
Query SEC EDGAR directly over HTTP with an identifying `User-Agent` and a
shared aggregate request limiter below the SEC maximum. Use direct HTTP for the
current Unstructured Pipeline Jobs API; the available JavaScript client targets
the legacy Partition endpoint and is not an MVP dependency.

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

Keep `Progress`, `Sources`, `Evidence`, `Assessment`, `Map`, and `Brief`
visible. Derive active, completed, and locked states from persisted workflow
state; locked items explain their prerequisite. Use a retractable contextual
panel on desktop and a drawer on smaller screens. Source review is a dedicated
mode. The architecture map and brief update incrementally from approved claims,
show incomplete coverage, and never simulate progress.

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

### Minimum Automated Coverage

Cover at minimum:

- atomic access-code attempt limits, visitor rebinding, and analysis
  reservation under concurrency;
- persistent five-visitor and three-analysis limits;
- configured research and provider-call guards;
- valid and invalid workflow transitions;
- workflow resumption, cancellation, retries, and idempotency;
- mandatory source approval before extraction;
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
5. Build the Phase 4 vertical slice: bounded company-candidate search, explicit
   CIK selection, preflight confirmation, reservation, authoritative CIK
   revalidation, evidence-sufficiency checkpoint, research plan, real SEC and
   Exa source discovery, HTTPS URL entry, and `CorpusRevision` approval.
6. Build normalization, stable passages, typed claim tasks, structural
   validation, versioned policy evaluation, claim evidence, and
   counter-evidence handling.
7. Build exception-driven grouped claim review, canonical claim and
   dimension-link decisions, per-dimension proposals, confidence inputs,
   atomic assessment decisions, overrides, and revision history.
8. Build progressive architecture-map and approved-claims-only brief revisions
   with persisted contribution previews.
9. Complete the remaining model and retrieval adapters, application-owned
   routing and fallback, best-effort telemetry, admin operations, bounded
   retries, and partial-failure behavior. This step does not defer the real SEC
   and Exa boundaries required by the Phase 4 slice.
10. Curate the CCC showcase corpus, then derive expected evaluation material
    after manual approval. Add deterministic policy fixtures.
11. Verify the complete access-code-admission-to-brief journey and document
    measured limitations before the candidature demo.

Do not postpone core invariants until a final hardening phase. Do not scaffold every final-state abstraction before its vertical slice needs it.

## Evaluation and Demo Verification

Curate CCC first under its accepted showcase scope. Define expected claims,
known contradictions, and deliberately unresolved questions only after manual
corpus approval, then reuse that same dossier as the first regression corpus.
Use small deterministic fixtures for isolated policy rules. Add ServiceNow or
another company only when it closes a measured gap; do not make multiple
completed dossiers an implementation prerequisite.

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

Read the corresponding record in `docs/decisions/` before revisiting any of these decisions.
