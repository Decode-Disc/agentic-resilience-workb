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

- [ ] Define the first required domain schemas and runtime validators.
- [ ] Enforce research-run and workflow-step lifecycle transitions server-side.
- [ ] Persist append-only run events and audit events in Convex.
- [ ] Verify valid transitions, invalid transitions, and audit preservation.

## Phase 2 — Private Access and Quotas

Outcome: only invited visitors can reserve analyses within the prototype limits.

- [ ] Seed exactly five invitations through an idempotent setup path.
- [ ] Implement server-side visitor admission and authorization.
- [ ] Reserve at most three analyses per admitted visitor atomically.
- [ ] Verify concurrency, persistence across sessions, and audited quota restoration.

## Phase 3 — Durable Workflow Skeleton

Outcome: a deterministic research run can progress, pause, resume, fail, retry, and cancel durably.

- [ ] Implement the provider-independent Convex Workflow skeleton.
- [ ] Make persisted `RunEvent` records the only source of UI progress.
- [ ] Add the durable source-approval and analyst-review checkpoints.
- [ ] Verify resumption, bounded retries, cancellation, and idempotency with deterministic adapters.

## Phase 4 — Company and Corpus Discovery

Outcome: an analyst can start a real company investigation and approve a proposed source corpus.

- [ ] Resolve supported US-listed technology companies and detect insufficient public evidence.
- [ ] Build and persist a company-specific research plan.
- [ ] Discover and rank proposed sources with visible, real progress.
- [ ] Build corpus review with accept, reject, manual URL, and PDF upload paths.
- [ ] Version the approved corpus and prevent extraction before explicit approval.

### Demonstration Checkpoint A — Honest Live Run

- [ ] Start a genuinely new company run.
- [ ] Show real company resolution, source discovery, and persisted progress.
- [ ] Stop at the explicit corpus-approval checkpoint.
- [ ] Confirm that no cached or precomputed work is presented as live.

## Phase 5 — Evidence Matrix and Provenance

Outcome: approved sources become inspectable, precisely cited evidence rather than an unsupported narrative.

- [ ] Retrieve and normalize approved sources with visible partial failures.
- [ ] Create stable, reproducible source passages and locators.
- [ ] Extract atomic `Fact`, `Inference`, `Hypothesis`, and `Unknown` claims.
- [ ] Link every material claim to exact passages and relevant dimensions.
- [ ] Preserve supporting evidence, counter-evidence, and critical unknowns.
- [ ] Exclude rejected sources from every downstream artifact.

## Phase 6 — Dimension Assessment and Human Review

Outcome: analysts can inspect and revise evidence-backed proposals across all ten dimensions.

- [ ] Propose separate position, confidence, and three-year direction outputs.
- [ ] Derive confidence from inspectable evidence characteristics.
- [ ] Show supporting claims, counter-evidence, and unknowns before review.
- [ ] Implement accept and justified override decisions.
- [ ] Preserve proposals, analyst decisions, overrides, and revision history append-only.
- [ ] Verify weak-evidence outcomes without forcing certainty or an aggregate score.

## Phase 7 — Derived Analyst Outputs

Outcome: validated evidence produces useful secondary views without introducing unsupported assertions.

- [ ] Build an evidence-backed architecture map with uncertainty and coverage cues.
- [ ] Require validated supporting claims for every map relationship.
- [ ] Generate a draft brief from analyst-approved claims only.
- [ ] Preserve brief revisions and their evidence inputs.
- [ ] Add the methodology and limitations surface.

## Phase 8 — Real Providers and Operational Guards

Outcome: the deterministic workflow can use real services safely through provider-independent boundaries.

- [ ] Implement capability-based model routing and configuration-driven model selection.
- [ ] Add the approved Codex subscription transport and OpenRouter adapters.
- [ ] Add the approved discovery, retrieval, and normalization adapters.
- [ ] Validate structured provider output before it becomes usable evidence.
- [ ] Record best-effort usage, latency, status, retries, and reported cost.
- [ ] Enforce configurable breadth limits, bounded retries, and the paid-work emergency switch.
- [ ] Verify partial failures and late results cannot corrupt or advance cancelled runs.

## Phase 9 — CCC Showcase and Evaluation

Outcome: one carefully curated dossier demonstrates original, contested, and measurable analytical judgment.

- [ ] Freeze the CCC source cutoff date and bounded workflow scope.
- [ ] Curate and approve a corpus with suitable independent evidence.
- [ ] Define expected claims, known contradictions, and deliberate unknowns after manual review.
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
- [ ] Atomic claims have precise citations, counter-evidence, and explicit unknowns.
- [ ] All ten dimensions expose position, confidence, and three-year direction for review.
- [ ] Analyst overrides require justification and remain auditable.
- [ ] The architecture map is backed by validated claims.
- [ ] The draft brief contains only analyst-approved claims.
- [ ] Methodology, limitations, provider usage, and duration are inspectable.
- [ ] No aggregate resilience score, investment recommendation, simulated progress, or unlabeled precomputed output is present.
