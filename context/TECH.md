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

Do not hard-code model names, provider routing, prototype resource guards, invitation codes, showcase companies, or deployment URLs. These are configuration data.

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

Use stable identifiers and idempotency keys at every retryable boundary. Persist workflow transitions and external-call metadata before presenting them as completed. Cancellation must prevent late external results from advancing a cancelled run.

## Domain Model

The completed design contains these explicit concepts:

- `Visitor`
- `Invitation`
- `Company`
- `ResearchRun`
- `ResearchPlan`
- `RunEvent`
- `Source`
- `SourceVersion`
- `SourcePassage`
- `Claim`
- `ClaimEvidence`
- `Relationship`
- `AssessmentDimension`
- `ScoreProposal`
- `AnalystDecision`
- `BriefRevision`
- `ProviderCall`

This is the completed domain model, not an instruction to scaffold unused records. Introduce each concept when observable behavior requires it while preserving these boundaries and names unless an explicit design change is approved.

Use runtime validation for persisted and external data. Represent lifecycle states with closed unions or enums matching the design. Preserve source-corpus versions and assessment revisions; later additions must not silently mutate an existing result.

## Workflow and Lifecycle Contract

Implement the research flow as deterministic, inspectable stages:

```text
Resolve company
→ Build research plan
→ Discover sources in parallel
→ Persist proposed corpus
→ Await explicit source approval
→ Retrieve and normalize approved sources
→ Extract passages and atomic claims
→ Search for counter-evidence
→ Propose dimension assessments
→ Await analyst review
→ Generate derived views
```

Valid step states are `queued`, `running`, `completed`, `needs_review`, `failed`, and `skipped`.

Valid research-run transitions are:

```text
draft
→ discovering_sources
→ awaiting_source_review
→ extracting_evidence
→ assessing_dimensions
→ awaiting_assessment_review
→ completed
```

Enforce transitions server-side. A client must not bypass checkpoints or directly mark workflow stages complete.

Retries, resumptions, and cancellation must be durable and idempotent. They must not duplicate claims, quota reservations, provider-call records, or external side effects. Persisted `RunEvent` records are the only source of UI progress.

## Evidence Acquisition and Provenance

Source discovery and evidence extraction are separate phases. The durable corpus approval event is mandatory before retrieval and extraction proceed.

Follow the source priority order in the product design and the acquisition boundaries in ADR-004. Source relevance is an estimate, not a truth score. Establish support at claim level through exact provenance, corroboration, and counter-evidence.

Every accepted passage needs a stable, reproducible locator appropriate to its source, such as page and bounding text for a PDF or URL plus anchored text or section for a web document. Reject passages that cannot be located reproducibly.

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

## Provider and Model Architecture

Implement a provider-agnostic `ModelRouter`. Workflow code requests capabilities rather than named models:

- `source-relevance`
- `claim-extraction`
- `contradiction-search`
- `dimension-assessment`
- `brief-generation`

Routing considers capability, quality, approximate cost, configured resource guards, availability, and prior failures. Model names are configuration data.

Required provider boundaries are:

- a Codex subscription provider option;
- OpenRouter;
- an extension contract for future providers.

Use the upstream CLIProxyAPI distribution as the prototype-only experimental Codex subscription transport defined by ADR-003. It is a pragmatic infrastructure adapter, not the application-level router, a permanent production architecture, or an officially endorsed OpenAI integration. Keep credentials and management surfaces private.

Treat DeepSeek V4 Pro and Momo 2.5 Pro only as candidate configuration examples when they are verified as available. Never assume their identifiers, capabilities, availability, or pricing.

For each provider call, persist the requested capability, resolved provider and model, prompt/schema version, available usage and cost data, latency, status, retry number, and references to structured input and output. Do not store secrets or unnecessary sensitive prompt data.

Neither CLIProxyAPI production readiness nor precise dossier economics is a prerequisite for the candidature implementation or demonstration.

## Access, Quotas, and Resource Guards

- Create exactly five invitation records through an idempotent seed or administrative setup path.
- Admit at most five distinct visitors in total.
- Allow each admitted visitor to reserve at most three analyses in total.
- Enforce both limits atomically in server-side Convex mutations and persist them across sessions.
- Consume a launch reservation once. Retries and resumes consume no additional analysis; abandoned or voluntarily deleted analyses remain counted.
- Require an append-only audited reason for administrative quota restoration.
- Bound workflow retries and research breadth through configuration, including source, document-page, and provider-call limits where appropriate.
- Use provider-side spending controls when available and provide an emergency server-side switch that prevents new paid work.
- Record provider-reported usage, latency, and cost when available.

Do not build transactional dollar reservations, a settlement ledger, list-price-equivalent accounting for free tiers, or precise per-dossier cost enforcement. ADR-006 supersedes ADR-005 on this point.

Never rely on disabled UI controls for invitation, analysis, or resource-limit enforcement.

## UI Engineering Constraints

Build an institutional analyst workbench: dense enough for serious research, calm, legible, and provenance-forward. Prioritize matrices, citations, review state, unknowns, counter-evidence, and audit history over decorative AI effects.

The required screens are listed in the product design.

Implement responsive, keyboard-accessible layouts with semantic HTML, visible focus, sufficient color contrast, explicit labels, and non-color status cues. Treat loading, empty, partial-failure, needs-review, cancelled, and insufficient-evidence states as first-class UI states.

The summary may emphasize at most five priority dimensions while preserving access to all ten. Architecture visualizations must communicate uncertainty and evidence coverage rather than imply complete knowledge of an internal architecture.

Do not make chat the primary interface. Do not add automatic translation until the English MVP is complete and verified.

## Security Boundaries

- Keep secrets server-side and out of logs, client bundles, fixtures, and version control.
- Validate authorization and invitation state in every protected server operation.
- Validate URLs, uploaded file types, file sizes, and parsed content.
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
7. For user-visible critical flows, run the relevant browser-level test against the real application boundary.

Record the RED command and expected failure in the implementation handoff. If a test passes on its first run, strengthen or correct it; it does not prove new behavior.

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

- atomic invitation and analysis reservation under concurrency;
- persistent five-visitor and three-analysis limits;
- configured research and provider-call guards;
- valid and invalid workflow transitions;
- workflow resumption, cancellation, retries, and idempotency;
- mandatory source approval before extraction;
- exclusion of rejected sources everywhere downstream;
- stable passage and citation validation;
- provider output schema rejection and bounded retry;
- claim classification and evidence linkage;
- counter-evidence preservation;
- analyst-decision preservation across retries and revisions;
- map relationships backed by validated claims;
- brief generation from approved claims only;
- partial source and provider failures;
- access control for protected queries, mutations, and actions.

Use deterministic fixtures. Default and CI suites must not call paid or nondeterministic providers. Before completion, report exact commands and results. If a check cannot run, state why and what remains unverified.

Documentation-only changes do not require a failing automated test. Validate links, structure, and consistency directly.

Pure tooling or configuration changes require executable before-and-after validation when feasible. Verify generated files through their generator or consumer rather than by inspection alone.

## Implementation Sequence

Build runnable vertical slices in this order unless measured evidence justifies a change:

1. Initialize the project, quality tooling, environment validation, and institutional shell.
2. Define typed domain schemas, lifecycle transitions, audit events, and Convex persistence.
3. Implement invitation admission plus atomic visitor and analysis reservations.
4. Implement a provider-independent workflow skeleton with persisted progress and durable checkpoints, using deterministic fake adapters in tests only.
5. Build company resolution, research planning, source discovery, corpus review, manual URL entry, and PDF upload.
6. Build normalization, stable passages, atomic claims, claim evidence, and counter-evidence handling.
7. Build dimension proposals, confidence inputs, analyst decisions, overrides, and revision history.
8. Build the derived architecture map and approved-claims-only brief generation.
9. Add real provider adapters, routing, best-effort telemetry, bounded retries, and partial-failure behavior.
10. Create the curated showcase dossier and evaluation fixtures.
11. Verify the complete invitation-to-brief journey and document measured limitations before the candidature demo.

Do not postpone core invariants until a final hardening phase. Do not scaffold every final-state abstraction before its vertical slice needs it.

## Evaluation and Demo Verification

Maintain a small curated evaluation set for two or three companies with approved corpora, expected claims, known contradictions, and deliberately unresolved questions. Build it incrementally: one candidature-ready showcase company is the first milestone; additional companies should close a measured gap rather than block the first credible dossier.

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

Read the corresponding record in `docs/decisions/` before revisiting any of these decisions.
