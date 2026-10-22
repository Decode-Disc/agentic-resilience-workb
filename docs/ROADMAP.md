# Prototype Roadmap

## Purpose

This living checklist sequences the smallest coherent vertical slices needed to build the Agentic Resilience Evidence Workbench prototype.

This document owns delivery state and sequence. [PRODUCT.md](../PRODUCT.md) owns product requirements and acceptance, [context/TECH.md](../context/TECH.md) owns technical contracts, and [AGENTS.md](../AGENTS.md) owns working and verification rules. A checked item records delivery within its stated verification boundary; it does not imply activation, remote deployment or completion of the entire phase.

## Recorded delivery state, 2026-10-22

The phase responsibilities below follow the current [source-preparation contract](../context/TECH.md#source-preparation-and-selection). [ADR-024](decisions/024-qualify-source-content-before-corpus-approval.md) and [ADR-025](decisions/025-use-versioned-scoped-evidence-retrieval.md) retain the historical rationale. Implementation, local verification, provider experiments and runtime activation are separate facts. This documentation reconciliation does not recheck or change runtime configuration.

| Capability | Implementation and recorded evidence | Remaining boundary |
| --- | --- | --- |
| Company resolution, discovery and corpus review | Implemented; [live retrieval and protected review checks](verification/2026-10-20-source-recovery-contract-repairs.md) are recorded. | Historical checks establish the tested slice and date, not every future source. |
| Candidate capture, qualification and targeted comparison | Implemented with immutable preparation artifacts; [grouped provider experiments](verification/2026-10-21-source-quality-second-batch.md) retain schema and semantic failures. | General preparation activation and useful fresh end-to-end behavior are not accepted by these reports. |
| Structured lexical and optional hosted-embedding retrieval | Implemented; native comparison, [retention replay and interpretation correction](verification/2026-10-21-evidence-retrieval-repair.md), and scope regressions are recorded. | No definitive retrieval winner or dynamic-source robustness is established. |
| Source adjustment, revision approval and capture materialization | Protected local and illustrative checks are recorded in the [source-review corrections](verification/2026-10-22-source-review-corrections.md). | Captured bytes and pinned references do not prove every unselected passage is reachable by later analytical work. The remote preview-service correction is not deployed. |
| Analytical claims and Evidence Matrix | The hash-gated deterministic showcase path is implemented. | Arbitrary live dossiers pause at `claim_generation_unavailable`; real analytical generation and verification remain unfinished. |
| Dimension review, derived map and brief | Required later slices. | No completed live invitation-to-brief journey is certified. |

Dossier navigation uses a single desktop divider and stable identities for its three loading slots. The original separator-count assertion is retained. Fifteen shell/navigation tests and focused Biome checks passed in the development working tree, with protected desktop/mobile checks preserving navigation geometry, links, keyboard interaction and reconnection. Those browser checks included other uncommitted development work. Local-only evidence is under `/tmp/workbench-navigation-fixes-4papzivd/`.

The immediate evidence-quality work is to identify useful material lost at actual stage boundaries across several companies and dossier types, while accepting explicit uncertainty. The historical 32 conditions are not a product completion target. Audit source retention, capture identity, selected context and later analytical availability separately. The 600-character comparison explanation limit remains an open, deferred issue after that evidence-preservation work. No new experiment, model replacement or activation follows from this roadmap update.

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

Outcome: only visitors with a configured access code can reserve analyses within the prototype limits.

- [x] Seed exactly five stable access slots through an idempotent setup path.
- [x] Implement server-side visitor admission, session rebinding, and authorization.
- [x] Reserve at most three analyses per admitted visitor atomically.
- [x] Verify concurrency, persistence across sessions, and audited quota restoration.

## Phase 3 — Durable Workflow Skeleton

Outcome: a deterministic research run can progress, pause, resume, fail, retry, and cancel durably.

- [x] Implement the provider-independent Convex Workflow skeleton.
- [x] Make persisted `RunEvent` records the only source of UI progress.
- [x] Add the durable source-approval and analyst-review checkpoints.
- [x] Verify resumption, bounded retries, cancellation, and idempotency with deterministic adapters.

## Phase 4 — Company Discovery and Corpus Preparation

Outcome: an analyst can review a useful proposed source set backed by inspected content, visible limitations and exact capture provenance, then approve the corpus. Preparation need not settle every analytical question.

- [x] Preflight-resolve, confirm, reserve, and authoritatively revalidate a supported US-listed technology company.
- [x] Pause on insufficient public evidence with HTTPS URL addition, explicit completion, or justified force-continuation paths.
- [x] Build and persist a company-specific research plan with one of the approved source-coverage presets.
- [x] Discover and rank proposed SEC and web sources with visible, persisted progress.
- [x] Implement bounded capture, normalization, qualification and targeted comparison before approval under preparation authority; inspect existing alternatives before one finite supplement.
- [x] Preserve exact captures, qualification references, restricted uses, unavailable-reading outcomes and analyst-supplied references without granting factual authority.
- [x] Implement structured retrieval and optional hosted embeddings within the accepted resource limits, with explicit lexical degradation and no local embedding model.
- [x] Approve a versioned corpus containing accepted sources while preserving rejected and pending candidates.
- [x] Persist corpus approval and atomically hand accepted sources to the Phase 5 workflow. Preserve the protected start path for historical idle approved dossiers.
- [x] Enforce one running workflow per visitor and prevent analytical source versions, analytical passages and claims before explicit corpus-revision approval.
- [ ] Establish the remaining preparation acceptance evidence using useful source content, visible omissions and protected handoff, without requiring exhaustive answers or perfect source selection.
- [ ] Before proposing activation, evaluate the actual current qualification/comparison inputs and outputs across different companies and dossier types. Historical model responses and exact-reference scores alone do not satisfy this gate.
- [ ] Verify fresh prepared runs and legacy drafts through the protected journey, including reconnection, desktop/mobile review, keyboard/focus behavior, cancellation and exact approved capture reuse. Existing illustrative checks do not establish fresh live preparation. Any provider calls or runtime activation require separate explicit authorization.

### Demonstration Checkpoint A — Honest Live Run

- [x] Start a genuinely new company run.
- [x] Show confirmed company resolution, source discovery, and persisted progress.
- [x] Stop at the explicit corpus-approval checkpoint.
- [x] Confirm that no cached or precomputed work is presented as live.

These historical discovery checks do not certify activation of the subsequently added content-preparation workflow.

## Phase 5 — Evidence Matrix and Provenance

Outcome: approved sources become inspectable, precisely cited evidence rather than an unsupported narrative.

- [x] Materialize the exact inspected captures selected by corpus approval, validating stored content and pinned references; missing or corrupt captures fail explicitly without silent replacement retrieval.
- [x] Retain real SEC and Exa Contents retrieval for legacy approved sources without preparation captures, with visible partial failures.
- [x] Reuse captured normalized text for prepared sources. Page-aware PDF normalization remains a deterministic fixture contract until real Unstructured is integrated in Phase 8.
- [x] Create stable, reproducible source passages and locators.
- [x] Extract typed atomic `Fact`, `Inference`, `Hypothesis`, and `Unknown` claim proposals through a hash-gated deterministic showcase adapter.
- [x] Apply non-overridable structural validation and versioned deterministic policy evaluation.
- [x] Trigger typed semantic verification only when deterministic rules require it.
- [x] Link each canonical material claim to exact passages and separately decided dimension links.
- [x] Preserve supporting evidence, counter-evidence, and critical unknowns.
- [x] Exclude rejected sources from every downstream artifact.
- [x] End successful Phase 5 work at the `evidence_ready + idle` handoff.
- [x] Preserve arbitrary live retrieval provenance but pause honestly at `claim_generation_unavailable` without fabricated claims or Phase 6 unlock.

Note: [Phase 5 deterministic/local certification](verification/2026-08-15-phase-5-evidence-matrix-provenance.md) and [real SEC/Exa retrieval checks](verification/2026-10-20-source-recovery-contract-repairs.md) are dated evidence. Earlier failures remain recorded. Real Unstructured, general live claim generation and semantic-verifier integration remain Phase 8 work. Preparation already has separate real model adapters and bounded experiments. Later analytical stages are not yet an available recovery mechanism for every preparation omission.

- [ ] Verify the handoff for useful content beyond the initial selection: retain the source and capture, approve it, locate the needed passage and produce a reproducible downstream citation through the actual supported path. Do not infer this from capture storage alone or raise the 512-passage materialization limit without a separate justified change.

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

- [x] Implement the bounded OpenRouter preparation adapters, configuration-owned qualification/comparison routes, output validation, application-owned fallback and telemetry under ADR-024.
- [ ] Complete capability-based routing for remaining analytical tasks and the approved Codex subscription transport.
- [ ] Add the real Unstructured Pipeline Jobs HTTP adapter for page-aware PDF normalization.
- [ ] Integrate real model-provider claim generation, semantic verification, and fallback routing.
- [ ] Keep retries and explicit fallback application-controlled and fully audited.
- [ ] Validate structured provider output before it becomes usable evidence.
- [ ] Record best-effort usage, latency, status, retries, and reported cost.
- [ ] Enforce configurable breadth limits, bounded retries, and the paid-work emergency switch.
- [ ] Add the minimal admin operations surface for runs, checkpoints, provider calls, quota restoration, and paid-work shutdown.
- [ ] Verify partial failures and late results cannot corrupt or advance cancelled runs.

Source acquisition now belongs to pre-approval preparation for new prepared dossiers, with post-approval retrieval retained for legacy corpora. Phase 8 completes real analytical model integration, page-aware PDF normalization and the remaining operational guards. Existing preparation adapters and experiments do not establish acceptance of those future tasks. The unchecked cross-cutting items above concern the remaining analytical workflow, even where preparation already implements equivalent safeguards.

## Phase 9 — CCC Showcase and Evaluation

Outcome: one carefully curated dossier demonstrates original, contested, and measurable analytical judgment.

- [ ] Freeze the CCC source cutoff date and bounded workflow scope.
- [ ] Curate and approve a corpus with suitable independent evidence.
- [ ] Define expected claims, known contradictions, and deliberate unknowns after manual review.
- [ ] Resolve open evaluation questions: extraction and locator quality, whether the bounded CCC corpus discriminates the competing interpretations, and the minimum evidence questions needed per dimension.
- [ ] Reuse the curated CCC dossier as the first regression corpus instead of creating a parallel golden dossier.
- [ ] Add small deterministic fixtures for isolated policy rules.
- [ ] Include at least one material, justified analyst override.
- [ ] Evaluate citation validity, entailment, classification, contradiction retrieval, and unsupported-claim rate.
- [ ] Record duration, available provider usage or cost, and analyst corrections.
- [ ] Label the completed dossier and all fixtures as curated or precomputed.
- [ ] Allow the curated Phase 5 dossier to demonstrate the read-only Evidence Matrix while keeping showcase labelling in Phase 9.
- [ ] Evaluate source preparation across several companies, source families and dossier types, separately from the curated showcase. Include broad research, targeted questions, supplied references and uncertain arguments without requiring multiple completed showcase dossiers.
- [ ] Distinguish exact-reference retention, useful equivalent evidence, displayed qualification and downstream answer quality. Report corpus reuse, reference authorship, known controls and unverified transfer explicitly.

### Demonstration Checkpoint B — Completed Showcase

- [ ] The evidence matrix makes provenance, counter-evidence, and uncertainty immediately legible.
- [ ] The assessment demonstrates technical-economic judgment rather than vendor-message synthesis.
- [ ] The architecture map and brief contain no unsupported material.
- [ ] Infrastructure remains secondary to the analyst value demonstrated.

## Phase 10 — End-to-End Demo Readiness

Outcome: the complete invitation-to-brief journey is reliable, honest, and ready for the candidature demonstration.

- [ ] Verify the full invited-analyst journey against [MVP acceptance](../PRODUCT.md#mvp-acceptance).
- [ ] Run focused, affected, full, type, lint, format, and critical browser checks.
- [ ] Verify responsive, keyboard-accessible, and non-color-dependent critical screens.
- [ ] Exercise empty, loading, partial-failure, needs-review, cancelled, and insufficient-evidence states.
- [ ] Rehearse the separate live-run and curated-showcase paths.
- [ ] Publish only measured methodology, limitations, duration, and provider usage.
- [ ] Document remaining risks, deployment constraints, and known gaps before recording the demo.

## MVP Completion Gate

- [ ] Record evidence against every criterion in [MVP acceptance](../PRODUCT.md#mvp-acceptance), with incomplete gates and remaining risks explicit. No completed invitation-to-brief journey is certified by the present roadmap.
