# Prototype Roadmap

## Purpose

This living checklist sequences the smallest coherent vertical slices needed to build the Agentic Resilience Workbench prototype. It owns delivery state and sequence; [PRODUCT.md](../PRODUCT.md) owns product requirements and acceptance, [context/TECH.md](../context/TECH.md) owns technical contracts, and [AGENTS.md](../AGENTS.md) owns working and verification rules. Checked items record delivery within their verification boundary; they do not imply global activation, remote deployment, or full-phase completion.

## Current Delivery State

The accepted [question-led conception](brainstorming/question-led-workbench/2026-10-23-question-led-workbench-conception.md), its three mission designs, and shared execution contracts are promoted into product and technical references. Phases 0–5 preserve the historical corpus-approval and dimension-based delivery record; Phases 6–10 sequence the transition and remaining target. No completed live end-to-end analytical journey is certified. Pre-pruning historical verification reports and earlier decision records (`ADR-024`, `ADR-025`, `ADR-030`, pre-2026-11-09 verification reports, and implementation logs) remain recoverable at git tag `docs-checkpoint-2026-11-18` (`bd07b1bf756d8538547477a700c15aeb6391675d` for earlier verification artifact paths).

| Capability | Recorded delivery | Remaining boundary |
| --- | --- | --- |
| Company resolution, discovery, capture & scoped retrieval | Canonical SEC/Exa resolution, immutable captures, whole-document qualification, bounded comparison, configurable preparation concurrency, and structured lexical / optional hosted-embedding retrieval are implemented. | Retrieval remains unweighted for general live quality; dynamic-source robustness and unresolved SEC reading failures stay open. |
| Source review & corpus approval | UI retired on 2026-11-15 to `archive/legacy-source-review/` (see [PRODUCT](../PRODUCT.md#sources-view)); new starts use only the Sources mission while legacy Convex data remains readable for historical dossiers. | Legacy fixture checks do not establish fresh usefulness; remote preview-service alignment stays undeployed. |
| Claims and Evidence Matrix | Hash-gated deterministic showcase claim extraction and provenance validation are implemented. | Live arbitrary dossiers pause at `claim_generation_unavailable`; general live analytical claim generation remains unimplemented. |
| Administration | Purpose-scoped dossier lists (`research`, `evaluation`, `browser_test`), native pagination, five `Invitation` access slots, private browser contexts, provider blocking, and dossier purge/reopening are implemented. | Operational guards for general readiness remain tracked in Phase 10; pre-existing repo-wide import-lint/formatting exceptions stay separately scoped. |
| Workspace shell & question-led UI library | Design tokens, shared controls, four-section dock, in-context Inventory sheet, reusable START/conversation components, and Sources matrix/reader projections are implemented. On 2026-11-18, Overview gained the stage panel and History disclosure while Sources became the document library. | Connected Investigation, grouped appraisal review, and Synthesis screens stay disabled until backed by real domain artifacts; browser qualification for the 2026-11-18 Overview/Sources split and stage-panel retrieval-failure alert carry-over remain pending. |
| Shared agent execution & invocation journal | Pi Durable v1 handles new agent missions on fenced Convex persistence/leases, native compaction, recoverable operation observations, and paginated admin journals, keeping Workflow/AI SDK compatibility for historical runs. | Default local/campaign evaluation exercises mechanics (`pnpm workbench:qualify`); deployed-backend latency, semantic summary fidelity, and long-history model usefulness remain open gates. |
| Question-led framing, Workbench & Sources mission | Persistent framing dossier, `/pause` & `/resume` controls, queue/steering, `request_approval` cards and dossier grants ([ADR-028](decisions/028-ask-for-approval-through-general-requests-and-dossier-grants.md)), time-limit settlement/renewal ([ADR-027](decisions/027-settle-sources-at-limits-and-let-the-analyst-renew-the-window.md)), shared `domain/researchState` projection, and Sources documentary binding (`sources_mission_v1`) are implemented. | Live model task quality, unsupported next-action advice in tested runs, advisory response controller calibration (off by default), `coveragePreset` execution (`ADR-029`), public-event lookup during framing, and semantic acceptance remain open. |
| Investigation, grouped appraisal review & Synthesis | Target architecture specified in [ADR-026](decisions/026-use-typed-analytical-controls-and-materialized-question-outcomes.md) and [TECH](../context/TECH.md#analytical-control-and-question-outcome-contracts). | Investigation, grouped appraisal review, question-outcome projection, and Synthesis missions/UI remain unimplemented. |

### Superseded Preparation Gate & Open Verification Limits

The former legacy preparation gate was superseded on 2026-11-15 when corpus approval was retired and all 13 legacy local research dossiers were purged (`dossierPurge.purgeResearchDossiers`); evaluation and test dossiers were kept (`docs-checkpoint-2026-11-18:docs/ROADMAP.md` preserves the dated chronology). Open workspace-level verification limits are:

- Analytical control and question-outcome contracts ([ADR-026](decisions/026-use-typed-analytical-controls-and-materialized-question-outcomes.md)) are unimplemented in Investigation and Synthesis; current `deriveQuestionCoverage` still counts linked evidence including `Unknown`, blocking answer labels and transition gates under [PRODUCT](../PRODUCT.md#evidence-matrix-and-analytical-review).
- Deterministic and simulated browser suites certify persistence, fencing, reconnection, and recovery mechanics (see [2026-11-16](verification/2026-11-16-approval-requests-and-sources-time-limit.md) and [2026-11-17](verification/2026-11-17-native-generation-recovery.md)); they do not certify fresh model usefulness, deployed latency, external favicon CORS reliability, or semantic-controller calibration.
- Checked Phases 0–5 records describe retained legacy infrastructure; do not treat fixed dimensions or routine corpus approval as target requirements, while keeping compatibility guards until verified replacements ship.

## Phases 0–5 — Legacy Foundation & Compatibility Baseline

- [x] **Phase 0 — Application Foundation:** TanStack Start, React, TypeScript, pnpm, Convex dev foundation, shadcn `base-luma` baseline, Biome/Vitest/CI checks, and documentation policy boundaries.
- [x] **Phase 1 — Domain and Persistence Backbone:** Domain schemas/validators, server-side run/step lifecycle transitions, append-only `RunEvent` and `AuditEvent` persistence, and state-transition tests.
- [x] **Phase 2 — Private Access and Quotas:** Five seeded `Invitation` access slots, HMAC-SHA-256 reusable codes, session rebinding, atomic 3-analysis reservation, and audited quota restoration.
- [x] **Phase 3 — Durable Workflow Skeleton:** Provider-independent Convex Workflow skeleton, `RunEvent`-driven progress, durable human checkpoints, and bounded retry/cancellation/idempotency tests.
- [x] **Phase 4 — Company Discovery, Preparation & Checkpoint A:** SEC/Exa company resolution, research-plan seeding, bounded discovery/capture/qualification/comparison, scoped lexical/hybrid retrieval (`structured-v1`, `stable-passages-v1`), immutable corpus-revision approval, one-running-workflow enforcement, recovery after expiry/errors, and Demonstration Checkpoint A (honest live discovery stop at approval).
- [ ] **Phase 4 remaining legacy gates (superseded for new starts):** Fresh cross-company preparation acceptance, multi-company evaluation, and protected live journey on the retired corpus-review UI are not pursued for new dossiers; compatibility paths remain guarded.
- [x] **Phase 5 — Evidence Matrix and Provenance:** Exact capture materialization with SHA/passage-locator checks, hash-gated deterministic showcase claim extraction (`Fact`/`Inference`/`Hypothesis`/`Unknown`), structural/policy validation, matrix provenance handoff (`evidence_ready + idle`), `claim_generation_unavailable` honest pause for arbitrary live dossiers, saved-source passage search beyond initial selection, and multi-company retention regressions.
- [ ] **Phase 5 remaining open delivery:** Real Unstructured page-aware PDF adapter, general live claim generation, and semantic-verifier integration.

## Phase 6 — Framing and Controlled Transition

Outcome: the analyst can frame one persistent dossier, launch the question-led workflow, and collaborate with Workbench without weakening dossier authority.

- [x] Persistent framing dossier created on company confirmation with optimistic versioned revisions, analyst-edit precedence (baseline-anchored edits, max 128 revisions), explicit whole-program preservation grammar (EN/FR), and refusal receipts for failed framing writes.
- [x] Atomic, idempotent explicit `Start research` consuming one analysis reservation, fixing framing, pinning `sources_mission_v1`, and enforcing documentary question capacity (`framing_question_capacity` / `sources_need_capacity`).
- [x] Phase-aware Workbench turns with default message queuing, explicit turn steering, `/pause` and `/resume` typed commands (`workbench.command`, zero model generation), native assistant-ui slash/command pickers, and shared actor/operation Activity UI.
- [x] Administrator-managed OpenRouter model catalogue, per-agent assignments, immutable turn pins, offline serializer calibration (`Update model`), and capability-aware reasoning selection (`recommended` vs explicit levels).
- [x] Shared pause/resume controls preserving engaged operations, pending instructions, cumulative consumption, and single active research slot.
- [ ] Define remaining target mandate, exception-threshold, and cross-slice compatibility contracts for Investigation/Synthesis before schema migration.
- [ ] Implement and qualify the [public-context framing operation](../context/TECH.md#public-context-during-framing) (`verified` event provenance on dated company events, ambiguity, unavailability, and stale-turn guards).
- [ ] Qualify broader semantic framing compliance, useful immediate company/activity scope (without invented financial calculations), and dossier-wide Workbench consultation/coordination ([conversation contract](../context/TECH.md#workbench-conversation-steering-and-instructions)) as Investigation and Synthesis bindings land.
- [ ] Browser-qualify the 2026-11-18 Overview stage panel and History disclosure, Sources document library split, and carry the former progress page retrieval-failure alert into the stage panel.

## Phase 7 — Shared Execution and Sources

Outcome: one controlled execution mechanism supports adaptive documentary inquiry and preserves useful work across interruptions.

- [x] Replaced new agent runtime with `pi-durable` v1 (`@earendil-works/pi-durable`, Chord 1.4.0) with fenced 90s/25s writer leases, closed operation effect/result contracts, canonical `sourceId`/`captureId`/`contentHash` pins, fragmented logs/journals (>512 KiB, 32 MiB conversation cap), and historical Workflow/AI SDK retention.
- [x] Delivered [native Workbench continuity](../context/TECH.md#accepted-native-conversation-and-model-interface) (definition v4 shared session across turns, exact original-argument JSON validation, definition-owned completion correction, optimistic transcript reconciliation, passive command/approval native sync) and [native context/compaction](../context/TECH.md#accepted-native-context-and-compaction-design) (admitted-state proof, ordered observation/command delivery, FIFO admission, `known_final_v1` reservation/settlement).
- [x] Delivered the shared `sources_mission_v1` agent binding (`convex/sourcesWorkspace.ts`, `domain/researchState`, `consult_run_state` v2, `consult_prepared_material`, up to 32 recent reading refs, server quotation materialization, `source_actions_v4` structured documentary controls, bounded non-progress restoration).
- [x] Delivered limit-time settlement/renewal ([ADR-027](decisions/027-settle-sources-at-limits-and-let-the-analyst-renew-the-window.md): `execution_time_limit` → `sources_time_limit`, `renew_window` vs `requestSourcesSettlement`, `runRecovery.reopenAtSourcesTimeLimit`) and general approval requests + revocable dossier grants ([ADR-028](decisions/028-ask-for-approval-through-general-requests-and-dossier-grants.md): `request_approval`, `ApprovalCard`). See [2026-11-16 verification](verification/2026-11-16-approval-requests-and-sources-time-limit.md).
- [x] Extended original-argument refusal/native correction to structured agents, unified persistent stop facts across Workbench/context/Sources, and preserved recoverable child waits across `execution_interrupted` and settlement ([2026-11-17 verification](verification/2026-11-17-native-generation-recovery.md)).
- [x] Delivered bounded local qualification campaigns v1/v2 (`pnpm workbench:qualify`, backend & browser surfaces, zero-provider fixtures, `investigator_v2` with `@earendil-works/pi-coding-agent@1.5.0`, `native_subscription` / `api_cost`); mechanical and offline review evidence recorded in [2026-11-09](verification/2026-11-09-pi-codex-authentication-smoke.md), [2026-11-10](verification/2026-11-10-pi-subscription-campaign-backend.md), [2026-11-11](verification/2026-11-11-resource-policy-ccc-live-qualification.md), and [2026-11-12](verification/2026-11-12-native-api-ccc-live-qualification.md).
- [ ] Apply the selected [coveragePreset in the active Sources mandate and handoff](../context/TECH.md#sources-mission-and-prepared-material) ([ADR-029](decisions/029-ground-workbench-framing-and-carry-coverage-through-handoffs.md)); compare all three presets on the same dossier before relying on preset-driven discovery.
- [ ] Qualify model-backed summary fidelity, long-history compaction, advisory response control calibration (off by default), and live Sources documentary quality under a newly authorized bounded mandate. Note: on 2026-11-15 Sources and live Workbench were enabled on the local deployment only (`SOURCES_MISSION_ENVELOPE` matching `SOURCES_QUALIFICATION_ENVELOPE`) for hands-on testing without accepting general documentary quality or global activation.
- [ ] Extend documentary targeted-control diagnostics and dependent checks to downstream analytical artifacts as Investigation and Synthesis land.

## Phase 8 — Investigation and Grouped Appraisal Review

Outcome: a common inquiry produces reasoned appraisals with inspectable evidence, objections, and unknowns for meaningful human judgment.

- [ ] Implement the accepted appraisal-submission operation and typed semantic findings under [TECH's analytical control contract](../context/TECH.md#analytical-control-and-question-outcome-contracts), keeping deterministic admission and disposition separate from technical execution.
- [ ] Add the materialized Investigation-owned question-outcome projection before enabling answer labels or dependent transitions; keep evidence presence (`Unknown`-only evidence included) separate from substantive proposed/retained answers, justified insufficiency, required revision, and technical incompleteness.
- [ ] Enrich one reusable company inventory through controlled assertions and separate supporting/opposing/contextual question uses, admitted before use without routine human confirmation of every assertion or link.
- [ ] Conduct one common inquiry across questions comparing rival interpretations; group decisive missing information into at most one bounded autonomous Sources documentary complement, then re-examine returned material without another search cycle.
- [ ] Submit an appraisal or justified insufficiency for every assigned question (sourced figures/ratios with definitions and limits; no invented financial calculations), and implement grouped review with append-only decisions over identifiable appraisal versions (empty retained sets stay at review and cannot start Synthesis).
- [ ] Evaluate admission and appraisal semantics separately from documentary preparation, including reconnection, source/matrix inspection, and contextual material-exception handling.

## Phase 9 — Synthesis, CCC Showcase and Evaluation

Outcome: retained appraisals support an immediately useful economic interpretation, with its diagram and fully reasoned note controlled together.

- [ ] Implement the accepted joint diagram/note and alternative-finding control operation under [TECH's analytical control contract](../context/TECH.md#analytical-control-and-question-outcome-contracts), producing a traceable mechanism diagram and derived argued note (or reasoned non-establishment on an instructed retained base without adding a final approval stop).
- [ ] Control transversal inferences and diagram-to-note fidelity; route necessary uninstructed premises or appraisal concerns back to bounded Investigation re-examination (no extra documentary phase), preserve targeted human review for material changes to retained appraisals, and block coherent synthesis when central premises are contested.
- [ ] Freeze the CCC source cutoff and photo-led auto physical damage scope; curate material, expected assertions, rival interpretations, contradictions, and deliberate unknowns as the first regression corpus with at least one material analyst override.
- [ ] Evaluate citation validity, entailment, classification, contradiction retrieval, appraisal reasoning, unsupported assertions, and diagram-note coherence separately from multi-company preparation quality; explicitly label showcase/fixture data and publish methodology with measured limitations.

### Demonstration Checkpoint B — Completed Showcase

- [ ] A decisive economic question and its scoped interpretation are immediately useful to Raphaëlle and her analysts, with provenance inspectable while coordination remains secondary.
- [ ] Appraisals expose shared evidence, objections, and unknowns with identifiable human judgments; the mechanism diagram and note express the same supported interpretation (or honest non-establishment).

## Phase 10 — End-to-End Demo Readiness

Outcome: the complete question-led journey is reliable, honest, and ready for the candidature demonstration.

- [ ] Complete capability-based analytical routing, semantic verification, experimental Codex subscription transport, and real Unstructured Pipeline Jobs adapter (do not claim live delivery before completion).
- [ ] Verify exposed I/O authorization, validation, idempotency, bounded retry, telemetry, cancellation, late-result protections, administrative inspection, audited withdrawal/restoration, and emergency paid-work disable switch.
- [ ] Verify the full admitted-analyst journey against [MVP acceptance](../PRODUCT.md#mvp-acceptance) (Start research, grouped review, synthesis outcomes, reconnection, desktop/mobile, keyboard/focus, non-color cues, reduced motion, empty/loading/partial/blocked/contested states) and run focused + CI aggregate checks.
- [ ] Rehearse live and curated paths and record measured methodology, limitations, duration, usage, and remaining risks before demonstration.

## MVP Completion Gate

- [ ] Record evidence against every criterion in [MVP acceptance](../PRODUCT.md#mvp-acceptance), with incomplete gates and remaining risks explicit. Reference updates alone certify no completed end-to-end journey.
