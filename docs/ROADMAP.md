# Prototype Roadmap

## Purpose

This living checklist sequences the smallest coherent vertical slices needed to build the Agentic Resilience Evidence Workbench prototype.

Each phase should be brainstormed, planned, and implemented in a separate session or in subagent-driven-development. A phase is complete only when its exit checklist is satisfied without weakening the product invariants in `AGENTS.md`, `context/PROJECT.md`, or `context/TECH.md`.

## Working Rules

- Build phases in order unless measured evidence justifies a documented change.
- Preserve provenance, uncertainty, human approval, auditability, and idempotency in every relevant slice.
- Introduce domain concepts only when the current observable behavior requires them.
- Use deterministic adapters and fixtures in default tests; keep paid or nondeterministic checks explicit and bounded.
- Keep the evidence matrix primary. Treat the architecture map and brief as derived views.
- Keep CCC Intelligent Solutions configurable and clearly label curated or precomputed showcase data.

## Phase 0 — Application Foundation

Outcome: a runnable, testable application foundation ready for product work.

- [x] Initialize TanStack Start, React, TypeScript, and pnpm.
- [x] Connect the Convex development foundation.
- [x] Apply the selected shadcn preset and institutional shell baseline.
- [x] Configure Biome, Vitest, type checking, and CI quality checks.
- [x] Document the product, technical, and decision boundaries.

## Phase 1 — Domain and Persistence Backbone

Outcome: the minimum typed, persisted model needed to express real product state.

- [x] Define the first required domain schemas and runtime validators.
- [x] Enforce research-run and workflow-step lifecycle transitions server-side.
- [x] Persist append-only run events and audit events in Convex.
- [x] Verify valid transitions, invalid transitions, and audit preservation.

## Phase 2 — Private Access and Quotas

Outcome: only invited visitors can reserve analyses within the prototype limits.

- [x] Seed exactly five invitations through an idempotent setup path.
- [x] Implement server-side visitor admission and authorization.
- [x] Reserve at most three analyses per admitted visitor atomically.
- [x] Verify concurrency, persistence across sessions, and audited quota restoration.

## Phase 3 — Durable Workflow Skeleton

Outcome: a deterministic research run can progress, pause, resume, fail, retry, and cancel durably.

- [x] Implement the provider-independent Convex Workflow skeleton.
- [x] Make persisted `RunEvent` records the only source of UI progress.
- [x] Add the durable source-approval and analyst-review checkpoints.
- [x] Verify resumption, bounded retries, cancellation, and idempotency with deterministic adapters.

## Phase 4 — Company and Corpus Discovery

Outcome: an analyst can start a real company investigation and approve a proposed source corpus.

- [ ] Preflight-resolve, confirm, reserve, and authoritatively revalidate a supported US-listed technology company.
- [ ] Pause on insufficient public evidence with HTTPS URL addition, explicit completion, or justified force-continuation paths.
- [ ] Build and persist a company-specific research plan with one of the approved source-coverage presets.
- [ ] Discover and rank proposed SEC and web sources with visible, persisted progress.
- [ ] Approve a versioned corpus containing accepted sources while preserving rejected and pending candidates.
- [ ] End the Phase 4 execution honestly at the persisted `corpus_approved` handoff.
- [ ] Enforce one running workflow per visitor and prevent extraction before explicit corpus-revision approval.

### Demonstration Checkpoint A — Honest Live Run

- [ ] Start a genuinely new company run.
- [ ] Show confirmed company resolution, source discovery, and persisted progress.
- [ ] Stop at the explicit corpus-approval checkpoint.
- [ ] Confirm that no cached or precomputed work is presented as live.

## Phase 5 — Evidence Matrix and Provenance

Outcome: approved sources become inspectable, precisely cited evidence rather than an unsupported narrative.

- [ ] Retrieve and normalize approved sources with visible partial failures.
- [ ] Create stable, reproducible source passages and locators.
- [ ] Extract typed atomic `Fact`, `Inference`, `Hypothesis`, and `Unknown` claim proposals.
- [ ] Apply non-overridable structural validation and versioned deterministic policy evaluation.
- [ ] Trigger typed semantic verification only when deterministic rules require it.
- [ ] Link each canonical material claim to exact passages and separately decided dimension links.
- [ ] Preserve supporting evidence, counter-evidence, and critical unknowns.
- [ ] Exclude rejected sources from every downstream artifact.

## Phase 6 — Dimension Assessment and Human Review

Outcome: analysts can inspect and revise evidence-backed proposals across all ten dimensions.

- [ ] Propose separate position, confidence, and three-year direction outputs.
- [ ] Derive confidence from inspectable evidence characteristics.
- [ ] Present exception-driven grouped claim review while persisting individual append-only decisions.
- [ ] Unlock dimension review when its claims and dimension links have decisions.
- [ ] Record one atomic assessment decision per dimension with justified field overrides.
- [ ] Support AI-assisted cited replacement claims without mutating original proposals.
- [ ] Preserve proposals, analyst decisions, overrides, and revision history append-only.
- [ ] Verify weak-evidence outcomes without forcing certainty or an aggregate score.

## Phase 7 — Derived Analyst Outputs

Outcome: validated evidence produces useful secondary views without introducing unsupported assertions.

- [ ] Build a progressively updated evidence-backed architecture map with uncertainty and coverage cues.
- [ ] Require validated supporting claims for every map relationship.
- [ ] Incrementally compose a draft brief from analyst-approved claims only.
- [ ] Preserve brief revisions and their evidence inputs.
- [ ] Show the persisted map and brief contribution after each dimension decision.
- [ ] Keep incomplete coverage explicit until all ten dimensions are decided.
- [ ] Add the methodology and limitations surface.

## Phase 8 — Real Providers and Operational Guards

Outcome: the deterministic workflow can use real services safely through provider-independent boundaries.

- [ ] Implement capability-based model routing and configuration-driven model selection.
- [ ] Add direct AI SDK adapters for OpenRouter and the approved Codex subscription transport.
- [ ] Add SEC HTTP, Exa SDK, and Unstructured Pipeline Jobs HTTP adapters.
- [ ] Keep retries and explicit fallback application-controlled and fully audited.
- [ ] Validate structured provider output before it becomes usable evidence.
- [ ] Record best-effort usage, latency, status, retries, and reported cost.
- [ ] Enforce configurable breadth limits, bounded retries, and the paid-work emergency switch.
- [ ] Add the minimal admin operations surface for runs, checkpoints, provider calls, quota restoration, and paid-work shutdown.
- [ ] Verify partial failures and late results cannot corrupt or advance cancelled runs.

## Phase 9 — CCC Showcase and Evaluation

Outcome: one carefully curated dossier demonstrates original, contested, and measurable analytical judgment.

- [ ] Freeze the CCC source cutoff date and bounded workflow scope.
- [ ] Curate and approve a corpus with suitable independent evidence.
- [ ] Define expected claims, known contradictions, and deliberate unknowns after manual review.
- [ ] Reuse the curated CCC dossier as the first regression corpus instead of creating a parallel golden dossier.
- [ ] Add small deterministic fixtures for isolated policy rules.
- [ ] Include at least one material, justified analyst override.
- [ ] Evaluate citation validity, entailment, classification, contradiction retrieval, and unsupported-claim rate.
- [ ] Record duration, available provider usage or cost, and analyst corrections.
- [ ] Label the completed dossier and all fixtures as curated or precomputed.
- [ ] Add another evaluation company only if it closes a measured gap.

### Demonstration Checkpoint B — Completed Showcase

- [ ] The evidence matrix makes provenance, counter-evidence, and uncertainty immediately legible.
- [ ] The assessment demonstrates technical-economic judgment rather than vendor-message synthesis.
- [ ] The architecture map and brief contain no unsupported material.
- [ ] Infrastructure remains secondary to the analyst value demonstrated.

## Phase 10 — End-to-End Demo Readiness

Outcome: the complete invitation-to-brief journey is reliable, honest, and ready for the candidature demonstration.

- [ ] Verify the full invited-analyst journey against the product Definition of Done.
- [ ] Run focused, affected, full, type, lint, format, and critical browser checks.
- [ ] Verify responsive, keyboard-accessible, and non-color-dependent critical screens.
- [ ] Exercise empty, loading, partial-failure, needs-review, cancelled, and insufficient-evidence states.
- [ ] Rehearse the separate live-run and curated-showcase paths.
- [ ] Publish only measured methodology, limitations, duration, and provider usage.
- [ ] Document remaining risks, deployment constraints, and known gaps before recording the demo.

## MVP Completion Gate

- [ ] An invited analyst can start an analysis within enforced quotas.
- [ ] Real source-discovery progress is visible from persisted events.
- [ ] The analyst can approve a proposed corpus and resume the durable workflow.
- [ ] An evidence-sufficiency checkpoint supports URL addition, honest completion, and justified continuation.
- [ ] Atomic claims have precise citations, counter-evidence, and explicit unknowns.
- [ ] Structural validity and analytical policy outcomes remain distinct and auditable.
- [ ] All ten dimensions expose position, confidence, and three-year direction for review.
- [ ] Analyst overrides require justification and remain auditable.
- [ ] The architecture map is backed by validated claims.
- [ ] The progressive map and draft brief contain only analyst-approved claims and show incomplete coverage.
- [ ] Methodology, limitations, provider usage, and duration are inspectable.
- [ ] No aggregate resilience score, investment recommendation, simulated progress, or unlabeled precomputed output is present.
