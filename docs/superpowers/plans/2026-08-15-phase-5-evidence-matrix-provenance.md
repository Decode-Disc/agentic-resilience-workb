# Phase 5 Evidence Matrix and Provenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` after explicit implementation authorization. Before execution, read `writing-plans`, the project `implementation-plan` overlay, `tdd`, `vitest`, `convex`, `convex-expert`, `frontend-ui-engineering`, `playwright-best-practices`, and `chrome-devtools-axi`. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn only the effective analyst-accepted sources of an approved corpus into immutable, precisely locatable evidence; render a read-only claims-first Evidence Matrix; and finish the curated showcase path at the strong `evidence_ready + idle` handoff without fabricating claims for arbitrary live dossiers.

**Architecture:** Phase 4 remains a separate workflow that stops at `corpus_approved + idle`. A protected mutation atomically freezes the current accepted `SourceDecision` heads, claims the visitor's single execution slot, increments the run generation, and starts a separate Phase 5 definition on the existing Convex Workflow engine. Per-source actions retrieve approved SEC or Exa content behind application-owned safety and telemetry, persist immutable artifacts, versions, and reproducible passages, then a hash-gated deterministic showcase adapter creates typed claims, evidence relations, proposed dimension links, and policy results. Owner-authorized Convex projections drive the existing workspace shell and a read-only matrix. Unrecognized live inputs retain their real provenance and pause honestly at `claim_generation_unavailable`.

**Tech Stack:** TypeScript 6, React 19, TanStack Start/Router, Convex 1.42.1, `@convex-dev/workflow` 0.4.4, Exa JS 2.16.0, Convex File Storage, Vitest 4.1.10, `convex-test`, Playwright 1.62.1, shadcn/base-luma, Hugeicons through the shared `Icon`, Motion, pnpm 10, Node 24.

## Global Constraints

- Planning is not implementation authorization. Do not modify production code, schemas, dependencies, deployment state, provider state, or data until Task 1's ADR and authority updates are accepted and the user explicitly authorizes plan execution.
- Preserve the user's current uncommitted edits in `context/TECH.md` and `docs/decisions/017-use-deterministic-source-selection-proposals.md`; reconcile overlapping Task 1 edits line-by-line and never replace those files wholesale.
- Keep Phase 4 ending at `corpus_approved + idle`; no retrieval, normalization, passage, or claim work may happen before the durable corpus checkpoint.
- Use the existing Convex Workflow component and `WorkflowManager`. A separate Phase 5 workflow definition is not a second workflow engine or persistence authority.
- `SourceDecision` remains the append-only inclusion authority. `sourceReviewItems` is only the effective-head projection. A historical accepted decision superseded by pending or rejected is never sufficient authority.
- Authorize before DNS, HTTP, Exa, SEC, storage cleanup, or another side effect. Recheck the active run, corpus revision, frozen decision head, workflow version, generation, and cancellation immediately before I/O and again before persistence.
- Default and CI tests perform no live or paid provider calls. Live provider tests are explicit, opt-in, bounded, and reported separately.
- No Firecrawl, real model provider, real Unstructured adapter, general crawler, local file upload, aggregate resilience score, investment recommendation, dimension assessment, architecture map generation, or brief generation enters this slice.
- Deterministic claims, verifier results, and policy fixtures run only when the complete normalized input hash matches a versioned showcase manifest. The execution mode is persisted and the UI visibly labels showcase data.
- An arbitrary live dossier can persist real accepted-source retrieval, source versions, passages, and partial failures, but must pause at `extracting_evidence + paused + claim_generation_unavailable`. It must not receive fixture claims, a fabricated `Unknown`, `evidence_ready`, or Phase 6 access.
- `ResearchPlanQuestion` is an immutable, versioned record created with the research plan. Every `Unknown` references at least one unresolved question and at least one context passage; coverage is derived from claims and passages rather than stored by mutating the question.
- Every material claim is atomic and has one or more `ClaimEvidence` rows to reproducible passages. `ClaimEvidence` alone owns `supporting`, `counter`, and `context` semantics.
- Structural invalidity is non-overridable. Source selection metadata may appear as provenance context but cannot establish claim truth, contradiction, dimension relevance, or confidence.
- File upload and database commit are not atomic. The invariant is one committed referenced artifact per logical source-version operation; transient duplicates are tolerated only under the upload-lease and orphan-cleanup contract.
- All Convex functions use object syntax, explicit `args` and `returns` validators, internal visibility by default, bounded indexed reads, and generated client types. Do not hand-edit `convex/_generated/*` or the TanStack route tree.
- Route files export only `Route`. Cross-directory imports use `@/` or `@convex/`; same-directory imports may use `./`.
- Keep code, product copy, ADRs, implementation documents, fixtures, and test descriptions in English.
- Preserve the current workbench shell, header, admission flow, analyzed-company navigation, persistent six-section rail, source-review checkpoint, design tokens, responsive breakpoints, keyboard behavior, motion language, reduced-motion behavior, and geometry-preserving loading states.
- Use only shared analyst-safe loading and error primitives: `LoadErrorBoundary` around query-owning subtrees and `LoadErrorAlert` for recoverable errors. Do not expose raw errors, provider names, environment variables, request IDs, enum keys, function names, workflow mechanics, or roadmap phases in analyst-facing copy.
- Execute one public-behavior test at a time through strict RED → GREEN → REFACTOR. Do not write broad horizontal schema tests that prove no user-visible slice.
- Do not commit, stage, push, deploy, or mutate live/cloud data unless the user separately requests that action.

---

## 1. Plan Status and Revision Date

- **Status:** Ready for Task 1 documentation execution; Tasks 2–10 are blocked until the new ADR and aligned authoritative documents are reviewed and accepted.
- **Closure status (2026-08-22):** Tasks 1–10 all complete; deterministic/local Phase 5 certification passed; live SEC/Exa provider certification deferred pending explicit authorization. See `docs/verification/2026-08-15-phase-5-evidence-matrix-provenance.md`.
- **Revision date:** 2026-08-15.
- **Design input:** `docs/plans/2026-08-15-phase-5-evidence-matrix-provenance-design.md`, validated by the user on 2026-08-15 but explicitly design-only.
- **Additional contract accepted on 2026-08-15:** persist immutable versioned `ResearchPlanQuestion` records; `Unknown` references those records; question coverage remains derived.
- **Current worktree:** only `context/TECH.md` and ADR-017 are modified by the user. `git diff --check` passes.
- **Current automated baseline:** `pnpm typecheck` passes and `pnpm lint` passes. The complete suite has 519 tests: 509 pass and 10 fail across three pre-existing UI suites because `SourceBrowserView` reaches `useAction` without a `ConvexProvider` and jsdom lacks `window.scrollTo`. `pnpm format:check` reports 19 pre-existing formatting errors. These failures are baseline debt, not Phase 5 acceptance evidence.
- **Current browser baseline:** an admitted analyst at `/workspace/$runId?section=evidence` sees the existing shell and expanded six-section rail at 1440×1000 and 390×844; `Evidence` remains locked at `corpus_approved`, and the main region renders the generic Evidence placeholder. The console contains one existing 404 resource error. Baseline captures are `/tmp/phase5-evidence-baseline-desktop.png` and `/tmp/phase5-evidence-baseline-mobile.png` for the current session only; execution must recapture durable verification images under `docs/verification/artifacts/`.

### Completion checklist

- [x] Task 1: accept ADR-023 and align product, technical, roadmap, and design authority.
- [x] Task 2: persist stable research questions and establish the Phase 5 lifecycle contract.
- [x] Task 3: atomically freeze effective accepted heads and start the separate Phase 5 workflow.
- [x] Task 4: complete the SEC HTML provenance tracer from accepted decision to reproducible passage.
- [x] Task 5: add Exa Contents and bounded public-PDF retrieval with per-source partial outcomes.
- [x] Task 6: add fixture-gated atomic claims, evidence relations, canonicalization, and proposed dimensions.
- [x] Task 7: add structural validation, deterministic policy, targeted verification, `Unknown`, and honest unavailable pause/retry.
- [x] Task 8: complete durable orchestration, idempotent reuse, cancellation, cleanup, and strong handoff.
- [x] Task 9: replace only the Evidence placeholder with the reactive read-only Evidence Matrix.
- [x] Task 10: certify the protected showcase and live-dossier boundaries, then publish verification evidence.

## 2. Authoritative Requirements and Accepted Decisions

Read these sources before executing any task, in this precedence order:

1. `AGENTS.md` — agent conduct, product invariants, implementation discipline, UI preservation, provider safety, and verification requirements.
2. `context/PROJECT.md` — candidature objective, audience, and scope proportionality.
3. `context/TECH.md` — active architecture and implementation contracts; currently user-modified and not yet aligned with the Phase 5 design.
4. `docs/product-architecture/2026-07-20-agentic-resilience-evidence-workbench-design.md` — complete MVP journey and evidence model; its lifecycle currently lacks `evidence_ready`.
5. Accepted ADRs: `002-convex-reactive-persistence-and-workflows.md`, `004-use-sec-exa-and-unstructured-for-source-acquisition.md`, `008-use-versioned-research-revisions-and-exception-driven-review.md`, `009-use-typed-ai-tasks-and-deterministic-policy-adjudication.md`, `010-keep-provider-routing-retries-and-fallback-application-controlled.md`, `011-restrict-manual-source-intake-to-public-https-urls.md`, `014-use-reusable-access-codes-for-stable-visitors.md`, and ADR-017 through ADR-022.
6. `docs/ROADMAP.md` — current delivery ordering; it still places the real SEC/Exa/Unstructured adapter work in Phase 8.
7. `docs/plans/2026-08-15-phase-5-evidence-matrix-provenance-design.md` — validated design input, not authority until Task 1 completes.

Task 1 must resolve these verified conflicts rather than selecting an interpretation silently:

- The product design, `context/TECH.md`, `convex/domain/validators.ts`, and `convex/domain/transitions.ts` currently go directly from `extracting_evidence` to `assessing_dimensions`; they do not define `evidence_ready` or `claim_generation_unavailable`.
- The product design names Phase 5 evidence records, but `convex/schema.ts` contains none of them.
- ADR-004 selects real Unstructured normalization for approved PDFs, while the validated Phase 5 slice deliberately implements only its page-aware contract and deterministic showcase adapter; Task 1 must state this deferral without silently superseding ADR-004's final architecture.
- `docs/ROADMAP.md` assigns SEC, Exa, and Unstructured adapter implementation to Phase 8, while the selected hybrid slice moves only approved-source SEC and Exa retrieval into Phase 5.
- The existing research plan persists discovery queries only. The accepted `ResearchPlanQuestion` contract must be added explicitly so `Unknown` has a stable semantic reference.
- `researchRuns.workflowId` currently survives successful Phase 4 completion even though the workflow is finished. Task 1 must define it as the active workflow handle, require compare-and-clear on successful or reviewable terminal completion, and retain historical generation/version provenance on artifacts and events.

## 3. Non-Goals

- No claim approval, rejection, editing, correction, or claim-dimension decision controls; those begin in Phase 6.
- No assessment position, confidence, three-year direction, aggregate score, map, brief, export, or publication behavior.
- No redesign of `/workspace`, `/workspace/start`, the Workbench Shell, the navigation rail, source review, account controls, invitation admission, or dossier navigation.
- No promotion of hard-coded `/prototype/workspace` or `/prototype/source-review` data into production truth.
- No real LLM extraction, model routing, prompt-provider fallback, or real Unstructured call.
- No Firecrawl fallback. Reconsider only through a later ADR after repeated measured failures meet a precommitted threshold.
- No local files, private documents, authentication bypass, identity arguments, cloud fixture flags, cloud deployment, or paid provider work in default E2E.
- No mutable status field on `ResearchPlanQuestion`; coverage and answered/unanswered presentation are computed from the evidence projection.
- No mutable generated claim, claim-evidence relation, claim-dimension proposal, policy evaluation, or task output. A retry creates or reuses immutable versioned records by logical identity.
- No source-selection role, category, disposition, company-linkage basis, or publisher authority reinterpreted as evidence relation or claim truth.

## 4. Current-State Evidence and Change Classification

| Surface or contract | Current owner and evidence | Direction | Required result |
|---|---|---|---|
| Phase 4 durable workflow | `convex/researchWorkflow.ts` waits for corpus approval, verifies it, transitions to `corpus_approved + idle`, and returns | Preserve | Phase 4 still performs no extraction; only clear its completed active workflow handle through compare-and-clear completion logic |
| Lifecycle and transition graph | `convex/domain/validators.ts`, `convex/domain/transitions.ts`, and `researchRuns.pauseReason` omit the new handoff and pause | Modify | Add `evidence_ready`, exact same-lifecycle unavailable pause semantics, Phase 5 step/event values, and status constraints after Task 1 authority |
| Research plan | `convex/domain/researchPlan.ts` returns search queries; `researchPlans` has no stable questions | Modify | A versioned plan template emits immutable bounded `ResearchPlanQuestion` rows with stable keys and dimension links |
| Source inclusion authority | `sourceDecisions` is append-only; `sourceReviewItems.latestDecisionId` is the mutable effective projection | Preserve and strengthen | Freeze only current accepted heads, store their exact decision IDs, and revalidate before I/O and persistence |
| Approved handoff verification | `convex/sources.ts::verifyApprovedHandoff` checks only generation, active revision, and approved status | Replace for Phase 5 start | New transactional freeze verifies every projection head against its decision row and requires at least one accepted source |
| Execution-slot claim | `convex/domain/executionClaim.ts` supports paused Phase 4 checkpoints only | Extend | Add a Phase 5-specific claim from `corpus_approved + idle` and unavailable retry, preserving one running run per visitor |
| Workflow ownership | `researchRuns.workflowId` is written on start and not cleared on successful Phase 4 completion | Modify | Treat it as active-only; compare-and-clear on completed/paused terminal outcomes; history remains in generation/version-bound records |
| Provider attempt lease | `convex/providerCalls.ts` owns operation-key replay, paid-work gating, generation checks, and lease expiry for SEC/Exa/URL metadata | Modify | Add retrieval operations and bounded typed usage references without weakening existing guards |
| Resource ceilings | `convex/resourceLimits.ts` owns source/search/preview limits | Modify | Add approved-document byte/page/passage/provider-attempt ceilings chosen and recorded by ADR-023 |
| Retrieval adapters | `convex/integrations/sec.ts` resolves filing metadata; `convex/integrations/exa.ts` searches with `contents: false` | Extend | Add provider-independent approved-content results, SEC filing-body retrieval, Exa Contents mapping, and direct safe PDF retrieval |
| Phase 5 persistence | No source version, passage, claim, evidence, link, task, policy, source-status, question, or upload-lease tables exist | Create | Introduce records only with the vertical slice that observes them, using bounded indexes and immutable logical keys |
| Evidence section | `src/components/workspace/run-route-component.tsx` renders a generic placeholder for Evidence | Replace placeholder only | Render an owner-authorized read-only matrix while preserving the surrounding route, header, rail, errors, and source checkpoint |
| Navigation unlock | `workspace-navigation-rail.tsx` unlocks Evidence at `extracting_evidence` and Assessment at `assessing_dimensions` | Modify state mapping only | Evidence unlocks at `evidence_ready`; Assessment remains locked throughout this plan |
| Presentation copy | `src/lib/presentation/research-copy.ts` owns lifecycle, execution, and event labels | Modify centrally | Add safe evidence-ready, partial, unavailable, and failure mappings; never render raw domain/provider values |
| Static prototypes | `/prototype/*` and prototype data are hard-coded comparison surfaces | Preserve and isolate | Do not import fixture truth into `/workspace/$runId`; retain explicit prototype/showcase labels |
| Authentication and protected routes | `ProtectedWorkspaceRoute`, invitation drawer, anonymous session, and `api.visitors.current` gate private UI | Preserve | All new public Evidence APIs derive the visitor server-side and enforce run ownership |
| Existing test debt | 10 UI failures and 19 formatting errors exist before Phase 5 | Isolate, then repair only where touched | Every task records focused before/after results; final acceptance requires no new failures and an explicit disposition of overlapping baseline debt |

## 5. Preservation Contract

### Preserve without visual or behavioral redesign

- `WorkbenchShell`, `WorkbenchHeader`, admission drawer, account controls, logout/reconnection, role navigation, and `AnalyzedCompanyList`.
- The run company header and the persistent six-section `WorkspaceNavigationRail`, including collapsed/expanded storage, desktop/mobile widths, responsive auto-collapse, focus order, tooltips, `aria-current`, locked hints, and reduced-motion behavior.
- Source proposal review and approved source inspection, including summary-first composition, desktop resizable master/detail panels, narrow Drawer detail, source preview disclosure, filters, approval controls, pagination, and loading/error silhouettes.
- `surface-panel`, `surface-floating`, `LiquidGlassCard`, semantic evidence tokens, base-luma components, shared `Icon`, and the established typography/elevation language.
- `LoadErrorBoundary`, `LoadErrorAlert`, `MotionAnimatePresence`, `DirectionAwareTabs`, `Drawer`, `ResizablePanelGroup`, and `useResponsive` as existing shared owners.
- Persisted `RunEvent` as the only progress truth. Motion may seat persisted rows and counts; it may not simulate work or expose reasoning.

### Expected visible differences

- At `evidence_ready`, Evidence is a real link with `aria-current="page"` when selected; Assessment, Map, and Brief remain locked.
- The Evidence placeholder becomes a coverage summary, read-only filters, claims rows, and exact-passage detail.
- Desktop uses the established resizable master/detail composition; tablet/mobile use list plus Drawer detail.
- Loading, empty, partial, unavailable, and recoverable error states preserve the same matrix/filter/summary/detail geometry.
- Showcase claims carry a visible `Showcase evidence` or `Illustrative` disclosure derived from persisted task provenance.
- A live dossier without claim capability shows `Claim generation is not available for this dossier yet`, retains source processing coverage, and does not show claim rows or unlock Assessment.

### Forbidden divergence

- No purple-dominant surface, generic SaaS KPI grid, new global primitive default, custom icon surface, hard-coded color, decision button, chat composer, or decorative progress animation.
- No removal or simplification of existing rail, source-review detail, preview, mobile drawer, keyboard affordance, or loading geometry.
- No raw source-selection metadata badge colored as Fact, Inference, Hypothesis, Unknown, or counter-evidence.

Before Task 9, recapture the current Evidence placeholder and source-review master/detail at desktop 1440×1000, tablet 900×900, and mobile 390×844. After Task 9, capture the exact same routes and sizes, compare shell/rail geometry, and record intentional deltas only.

## 6. Runtime Responsibility Map

```text
TanStack Start + React
├── protected route and existing workbench shell
├── generated Convex subscriptions and mutations
├── read-only matrix filters, selection, panel/drawer state
└── analyst-safe presentation copy and geometry-preserving states
                         │
                         │ generated api.* references
                         ▼
Convex public boundary
├── api.evidenceExecution.start / retryClaimGeneration
└── api.evidenceMatrix.getSummary / listClaims / getClaimDetail
                         │
                         │ ownership + transactional state
                         ▼
Convex mutations and queries
├── effective accepted-decision freeze
├── active workflow/generation/slot ownership
├── immutable evidence records and mutable source-status projection
├── artifact upload leases and bounded cleanup
└── RunEvent, WorkflowStep, audit, and owner projections
                         │
                         │ existing WorkflowManager
                         ▼
convex/evidenceWorkflow.ts
├── accepted-source fan-out
├── branch terminalization
├── claim/policy pipeline
├── unavailable paused outcome
└── evidence_ready strong handoff
                         │
                         │ actions call application-owned adapters
                         ▼
convex/integrations/*
├── SEC approved filing retrieval
├── Exa Contents approved-web retrieval
├── safe direct public-PDF retrieval
├── deterministic HTML/PDF normalization contract
└── hash-gated showcase claim/verifier adapters
```

Convex actions may perform HTTP/SDK/File Storage work but may not read or write the database directly. They receive authorized, generation-fenced work descriptors from internal queries, then pass typed outputs to internal mutations that revalidate authority before persistence. Integration modules remain plain TypeScript and never register public functions, read Convex state, or leak provider SDK types into the domain.

## 7. Locked Public and Domain Interfaces

Task 1 must make these contracts authoritative. Later tasks may deepen private implementation but must not rename or weaken them without revising the ADR and this plan.

```ts
type EvidenceClassification = "Fact" | "Inference" | "Hypothesis" | "Unknown";
type EvidenceRelation = "supporting" | "counter" | "context";
type PolicyResult = "pass" | "needs_review" | "blocked";
type EvidenceSourceState = "queued" | "running" | "succeeded" | "partial" | "failed";
type EvidenceExecutionMode = "live" | "showcase";

type ResearchPlanQuestion = {
    runId: Id<"researchRuns">;
    researchPlanId: Id<"researchPlans">;
    planVersion: number;
    questionKey: string;
    prompt: string;
    dimensionKeys: string[];
    createdAt: number;
};

type EvidenceStartResult = {
    runId: Id<"researchRuns">;
    corpusRevisionId: Id<"corpusRevisions">;
    executionGeneration: number;
    acceptedSourceCount: number;
};
```

The versioned question template creates exactly one bounded question per assessment dimension with key `dimension:<dimensionKey>` and prompt `What public evidence supports or challenges <dimension label> for <confirmed company legal name>?`. When a non-empty research angle exists, it creates `research-angle` with prompt `What public evidence addresses this research focus: <bounded research angle>?`. The existing centralized dimension keys own identity; a shared presentation mapping owns labels. Provider output, discovery titles, and source categories cannot create or rewrite plan questions.

Public mutations and queries:

```ts
api.evidenceExecution.start({ runId, requestKey })
api.evidenceExecution.retryClaimGeneration({ runId, requestKey })
api.evidenceMatrix.getSummary({ runId })
api.evidenceMatrix.listClaims({ runId, filters, paginationOpts })
api.evidenceMatrix.getClaimDetail({ runId, claimId })
```

`start` is idempotent by owner/run/request key. It accepts only an owned `corpus_approved + idle` run with an active approved revision, no active workflow handle, no other running run for the visitor, and at least one effective accepted source. In one transaction it validates each `sourceReviewItems.latestDecisionId`, freezes accepted source/decision pairs in `evidenceSourceStatuses`, increments the generation, sets `extracting_evidence + running`, persists the active workflow version, and starts `internal.evidenceWorkflow.run` through the existing manager.

`retryClaimGeneration` accepts only the exact unavailable tuple and first runs a capability check that performs no paid call. If the manifest/capability remains unavailable, it returns the existing paused projection without mutation or I/O. If available, it atomically claims the visitor slot, increments generation, starts the existing manager with the new generation, and reuses valid committed artifacts.

Stable logical identities:

```text
ResearchPlanQuestion: researchPlanId + questionKey
EvidenceSourceStatus: runId + corpusRevisionId + sourceId + acceptedDecisionId + executionGeneration
ArtifactUploadLease: runId + corpusRevisionId + sourceId + acceptedDecisionId + contentHash + normalizerVersion
SourceVersion: corpusRevisionId + sourceId + acceptedDecisionId + contentHash + normalizerVersion
SourcePassage: sourceVersionId + locatorVersion + quotationHash + order
AITaskResult: runId + corpusRevisionId + taskKind + inputHash + schemaVersion + adapterVersion
Claim: corpusRevisionId + extractionRevision + normalizedAtomicTextHash + classification
ClaimEvidence: claimId + sourcePassageId + relation
ClaimDimensionLink: corpusRevisionId + claimId + dimensionKey + proposalRevision + origin
PolicyEvaluation: claimId + policyVersion + normalizedInputHash
ProviderCall: operationKey + service + operation + attempt + runId
```

The evidence projection returns generated Convex types. React components must derive their props from `FunctionReturnType<typeof api.evidenceMatrix.*>` and must not redefine DTOs.

## 8. Task Dependency Order

```text
Task 1 authority
  └─ Task 2 questions + lifecycle
       └─ Task 3 atomic freeze/start
            ├─ Task 4 SEC provenance tracer
            └─ Task 5 Exa/PDF partial tracer
                 └─ Task 6 claims and relations
                      └─ Task 7 validation/policy/unavailable
                           └─ Task 8 durable orchestration/handoff
                                └─ Task 9 reactive UI
                                     └─ Task 10 certification
```

Tasks 4 and 5 may be developed in parallel only after Task 3 is reviewed because they write the same provenance contracts. Their integration must occur sequentially through the focused tests listed below.

## 9. Concrete TDD Tasks

### Task 1: Accept ADR-023 and Align Authority

**Outcome:** The selected lifecycle, records, workflow ownership, hybrid provider boundary, `ResearchPlanQuestion`, numeric safety limits, and demonstration claims become authoritative before code changes.

**Files:**

- Create: `docs/decisions/023-use-decision-anchored-phase-5-evidence-workflow.md`
- Modify: `docs/product-architecture/2026-07-20-agentic-resilience-evidence-workbench-design.md`
- Modify carefully: `context/TECH.md`
- Modify: `docs/ROADMAP.md`
- Modify: `docs/plans/2026-08-15-phase-5-evidence-matrix-provenance-design.md`
- Preserve carefully: `docs/decisions/017-use-deterministic-source-selection-proposals.md`

**Directions:** ADR-023 must accept the separate workflow definition on the existing engine, effective-head freeze, active-only `workflowId`, `evidence_ready`, exact unavailable pause/retry tuple, immutable `ResearchPlanQuestion`, provenance/claim/policy records, upload lease/cleanup, real SEC/Exa retrieval, deferred real Unstructured/model provider, and visible hybrid showcase/live boundary. It must define `MAX_APPROVED_SOURCE_BYTES = 16 MiB`, `MAX_NORMALIZED_ARTIFACT_BYTES = 16 MiB`, `MAX_PDF_PAGES = 400`, `MAX_PASSAGES_PER_SOURCE = 512`, `MAX_QUOTATION_CHARS = 4,000`, `MAX_REDIRECTS = 5`, two total attempts, SEC/direct HTTP timeout 10 seconds, Exa Contents outer timeout 120 seconds, and actual accepted-source count capped by the existing 48-source candidate ceiling. If the accepted ADR changes any number, revise every later test and table in this plan before production code.

**Preserve:** ADR-017's user-authored adaptive-ceiling correction and ADR-018 through ADR-022 source-selection authority. ADR-023 consumes the accepted corpus; it does not rewrite how proposals are composed.

**Risks:** A documentation edit could silently supersede ADR-004, overwrite the user's adaptive-ceiling correction, or make a design-only value appear authoritative. Review the complete overlapping diff and stop until the user accepts ADR-023.

**RED:** Run authority searches and record the current mismatches.

```bash
rg -n 'evidence_ready|claim_generation_unavailable|ResearchPlanQuestion' context/TECH.md docs/product-architecture docs/ROADMAP.md docs/decisions
rg -n 'Phase 5|Phase 8|Phase 9|SEC|Exa|Unstructured' docs/ROADMAP.md
```

Expected: no accepted ADR defines the new state/question contract, lifecycle authority lacks the states, and ROADMAP assigns all adapter work to Phase 8.

**GREEN:** Write ADR-023 and align the four authority documents. Update the design status to reference the accepted ADR and include `ResearchPlanQuestion`. In ROADMAP, move only approved-source SEC/Exa retrieval into Phase 5, retain real Unstructured/model integration in Phase 8, and keep showcase labelling in Phase 9 while allowing the curated Phase 5 dossier to demonstrate the matrix.

```bash
rg -n 'ADR-023|evidence_ready|claim_generation_unavailable|ResearchPlanQuestion' context/TECH.md docs/product-architecture docs/ROADMAP.md docs/decisions/023-*.md docs/plans/2026-08-15-phase-5-evidence-matrix-provenance-design.md
git diff --check
git diff -- context/TECH.md docs/decisions/017-use-deterministic-source-selection-proposals.md
```

Expected: the new contract is consistent, diff check passes, and the ADR-017 adaptive-ceiling edits remain intact.

**REFACTOR / review:** Perform a conflict review against ADR-004, ADR-009, ADR-010, ADR-017 through ADR-022, and the product invariants. Stop if any document implies pre-approval retrieval, fixture claims for arbitrary input, a second engine, or automatic Phase 6 unlock from `extracting_evidence`.

**Browser inspection:** None; documentation only.

**Handoff gate:** Obtain explicit user acceptance of ADR-023 and the aligned authority diff. Do not start Task 2 on a draft or proposed ADR.

### Task 2: Persist Stable Questions and Establish the Phase 5 State Contract

**Outcome:** Research plans contain immutable semantic questions, lifecycle validators know the strong handoff and unavailable pause, completed workflow handles clear safely, and no extraction starts yet.

**Files:**

- Modify: `convex/domain/researchPlan.ts`
- Modify: `convex/researchPlanning.ts`
- Modify: `convex/domain/validators.ts`
- Modify: `convex/domain/transitions.ts`
- Modify: `convex/schema.ts`
- Modify: `convex/researchRuns.ts`
- Modify: `convex/researchWorkflow.ts`
- Modify: `convex/workflowControls.ts`
- Modify: `convex/adminOperations.ts`
- Modify: `src/lib/presentation/research-copy.ts`
- Create: `src/__tests__/convex/research-runs/phase-5-lifecycle.test.ts`
- Modify: `src/__tests__/convex/research-runs/phase-4-lifecycle.test.ts`
- Modify: `src/__tests__/convex/workflows/phase-4-workflow.test.ts`
- Create: `src/__tests__/convex/admin/phase-5-authority-backfill.test.ts`

**Directions:** Advance the deterministic research-plan template version and emit the locked bounded semantic questions separately from search queries. Persist question rows atomically with new plans and reuse them on idempotent plan creation. Add a protected, paginated, idempotent backfill that generates the same versioned questions for existing plans from their persisted confirmed company snapshot, dimension keys, and bounded research angle; it must not alter the original plan or infer from provider output. Add `evidence_ready`, `claim_generation_unavailable`, Phase 5 step keys, and evidence event types. Represent the unavailable pause through an explicit transition helper rather than weakening the lifecycle-to-status map globally. Add a compare-and-clear internal mutation for an active workflow ID and call it from Phase 4 `onComplete` success only when the stored ID still matches. The same backfill inspects existing `corpus_approved + idle` workflow handles through the installed Workflow Manager status API and clears only terminal Phase 4 handles; it retains in-progress or unknown handles and reports them for review.

**Preserve:** Phase 4's public behavior and event sequence through `corpus_approved + idle`; current access, launch, quota, source-review, and retry semantics.

**Risks:** Existing approved dossiers predate questions and retain completed workflow handles. A non-idempotent backfill could duplicate questions or clear a genuinely active workflow, so every row is keyed and every handle is status-checked and compare-cleared.

**Locked validator delta:** lifecycle adds `evidence_ready`; pause reason adds `claim_generation_unavailable`; step keys add `retrieve_approved_sources`, `normalize_sources`, `generate_claims`, `validate_claims`, and `evaluate_evidence_policy`; event types add `evidence_source_progress`, `claim_generation_paused`, and `evidence_ready`.

**RED:** Add tests first.

```ts
it("persists stable versioned questions with the research plan", async () => {
    const scenario = await createDiscoveringRun(t);
    const planId = await t.mutation(internal.researchPlanning.createForRun, scenario);
    const questions = await t.run(async (ctx) =>
        ctx.db.query("researchPlanQuestions").withIndex("by_plan_and_key", q => q.eq("researchPlanId", planId)).collect(),
    );
    expect(questions).not.toHaveLength(0);
    expect(new Set(questions.map(question => question.questionKey)).size).toBe(questions.length);
});

it("allows extracting evidence to finish only at evidence_ready idle", () => {
    expect(() => assertLifecycleTransition("extracting_evidence", "evidence_ready", "idle")).not.toThrow();
    expect(() => assertLifecycleTransition("extracting_evidence", "assessing_dimensions", "running")).toThrow();
});
```

Run:

```bash
TMPDIR=/tmp TEMP=/tmp pnpm exec vitest run src/__tests__/convex/research-runs/phase-5-lifecycle.test.ts src/__tests__/convex/research-runs/phase-4-lifecycle.test.ts src/__tests__/convex/workflows/phase-4-workflow.test.ts src/__tests__/convex/admin/phase-5-authority-backfill.test.ts
```

Expected: FAIL because the table, validators, transition, and workflow-handle cleanup do not exist.

**GREEN:** Add the smallest validators, question persistence, transition rule, unavailable-pause mutation, and compare-and-clear completion behavior to pass the tests. Keep all new schema fields additive; do not narrow or delete existing data.

**REFACTOR:** Centralize lifecycle/pause validation in `convex/domain/validators.ts`; keep presentation labels in `research-copy.ts`. Replace any new unbounded collection with a bounded indexed read. Run `pnpm typecheck` and `pnpm lint`.

**Browser inspection:** Open a Phase 4 approved fixture and verify its visible state remains `Source set approved`; Evidence remains locked until an actual Phase 5 successful handoff exists.

**Handoff gate:** Review generated schema/API changes, prove Phase 4 still performs zero evidence writes, and record focused test results.

### Task 3: Freeze Effective Accepted Heads and Start Phase 5 Atomically

**Outcome:** An owned approved run can start exactly one generation-bound Phase 5 execution from the actual accepted source set; rejected, pending, stale, foreign, or superseded decisions cause no workflow start or I/O.

**Files:**

- Create: `convex/domain/evidenceAuthority.ts`
- Create: `convex/evidenceExecution.ts`
- Create: `convex/evidenceWorkflow.ts`
- Modify: `convex/schema.ts`
- Modify: `convex/domain/executionClaim.ts`
- Modify: `convex/sources.ts`
- Modify: `convex/workflow.ts`
- Create: `src/__tests__/convex/research-runs/phase-5-start.test.ts`
- Modify: `src/__tests__/convex/sources/corpus-revisions.test.ts`
- Modify: `src/__tests__/convex/workflows/durable-workflow.test.ts`

**Directions:** Add only the `evidenceSourceStatuses` table needed for this tracer. The public mutation derives the active visitor from auth, loads the owned run and approved revision, reads source-review heads through the revision indexes, fetches each exact `latestDecisionId`, validates matching run/revision/source and `decision === "accepted"`, and freezes the accepted subset with `queued` status. It requires at least one accepted head, checks the visitor running index, increments generation, sets `extracting_evidence + running`, starts the new workflow definition through the existing manager, then stores the returned active workflow ID in the same transaction supported by the component API. If manager start cannot participate atomically in the mutation under the installed version, stop and revise the ADR/plan; do not emulate atomicity client-side.

**Preserve:** Append-only decisions, source-review projection semantics, approved corpus immutability, one-running-run visitor guard, Phase 4 workflow definition, and existing source-revision restart flow.

**Risks:** Starting a workflow and recording its handle must remain one transactional authority boundary. If the installed component API cannot provide that guarantee, implementation must stop rather than leave a running workflow without an owned run generation.

**RED cases:** owner success; actual accepted count rather than recommendation target; no accepted sources; foreign owner; non-approved revision; stale active revision; projection decision ID missing/mismatched; historical acceptance superseded by rejected/pending; concurrent starts with different request keys; replay with the same request key; another running run; stale completed workflow handle.

```ts
it("freezes only effective accepted heads", async () => {
    const scenario = await createApprovedCorpusWithSupersededAcceptance(t);
    const result = await scenario.asOwner.mutation(api.evidenceExecution.start, {
        runId: scenario.runId,
        requestKey: "phase5-start-1",
    });
    expect(result.acceptedSourceCount).toBe(1);
    const frozen = await listFrozenSources(t, scenario.runId, result.executionGeneration);
    expect(frozen.map(item => item.acceptedDecisionId)).toEqual([scenario.currentAcceptedDecisionId]);
    expect(scenario.workflowStartCount()).toBe(1);
});
```

Run:

```bash
TMPDIR=/tmp TEMP=/tmp pnpm exec vitest run src/__tests__/convex/research-runs/phase-5-start.test.ts src/__tests__/convex/sources/corpus-revisions.test.ts src/__tests__/convex/workflows/durable-workflow.test.ts
```

Expected: FAIL because the API, freeze table, authority helper, and workflow do not exist.

**GREEN:** Implement the transactional freeze/start with explicit validators and idempotent request-key lookup. The initial workflow may do nothing except verify its inputs and finish a test-only terminal failure; do not introduce retrieval yet.

**REFACTOR:** Keep authority checks in `evidenceAuthority.ts`, workflow orchestration in `evidenceWorkflow.ts`, and public auth/start in `evidenceExecution.ts`. Add a composite index for the request key and for run/revision/generation/source; no `.filter()` or unbounded cross-run scan.

**Browser inspection:** None until the workflow has an honest terminal product state. Confirm that no UI control starts Phase 5 prematurely.

**Handoff gate:** Review zero-I/O assertions for every rejected start, concurrency behavior, and the exact frozen decision IDs.

### Task 4: Deliver the SEC HTML Provenance Tracer

**Outcome:** One frozen accepted SEC filing can be retrieved, normalized, uploaded, finalized into one immutable `SourceVersion`, split into reproducible `SourcePassage` rows, and reflected as a terminal source status.

**Files:**

- Create: `convex/domain/evidenceArtifacts.ts`
- Create: `convex/domain/sourcePassages.ts`
- Create: `convex/evidenceArtifacts.ts`
- Create: `convex/evidenceActions.ts`
- Create: `convex/integrations/approvedSourceRetrieval.ts`
- Create: `convex/integrations/secEvidence.ts`
- Create: `convex/integrations/evidenceNormalization.ts`
- Modify: `convex/integrations/sec.ts`
- Modify: `convex/providerCalls.ts`
- Modify: `convex/resourceLimits.ts`
- Modify: `convex/schema.ts`
- Modify: `convex/evidenceWorkflow.ts`
- Create: `src/__tests__/convex/evidence/sec-provenance-tracer.test.ts`
- Modify: `src/__tests__/convex/integrations/sec-adapter.test.ts`
- Modify: `src/__tests__/convex/integrations/provider-calls.test.ts`

**Directions:** Introduce `artifactUploadLeases`, `sourceVersions`, and `sourcePassages` only. The SEC adapter receives confirmed CIK/accession identity, uses the existing identifying User-Agent, 10-second abortable timeout, two attempts, 16 MiB declared/decompressed limit, and provider lease. Normalize deterministic HTML to a bounded canonical artifact, hash before upload, produce stable heading/offset locators, and prove each quotation replays against the stored normalized artifact. The action uploads through `ctx.storage.store(new Blob(...))`, immediately attaches the `_storage` ID to its lease, then calls a finalize mutation that revalidates the active head/generation and commits or reuses the logical source version. A failed finalize marks the lease orphaned and best-effort deletes the storage object.

**Preserve:** Existing SEC company resolution and discovery behavior; no pre-approval filing body retrieval; current provider-call attempt semantics.

**Risks:** SEC content changes, storage upload is non-atomic with database commit, and loose locator normalization can create false reproducibility. Hash, lease, replay, and exact-quotation tests are release gates, not optional hardening.

**RED cases:** happy path; exact quote replay; same hash replay reuses version/passages/provider success; changed hash creates new version; rejected or superseded head issues zero fetch and zero storage write; cancellation before dispatch; cancellation after response prevents persistence; timeout retry; oversize; unsupported response; upload succeeds/finalize fails/orphan is recorded and deletion attempted.

```ts
expect(await reproducePassage(storedArtifact, passage.locator)).toBe(passage.exactQuotation);
expect(await countCommittedVersions(t, logicalKey)).toBe(1);
expect(fetchSpy).not.toHaveBeenCalledForRejectedSource();
```

Run:

```bash
TMPDIR=/tmp TEMP=/tmp pnpm exec vitest run src/__tests__/convex/evidence/sec-provenance-tracer.test.ts src/__tests__/convex/integrations/sec-adapter.test.ts src/__tests__/convex/integrations/provider-calls.test.ts
```

Expected: FAIL because approved-content retrieval, storage ownership, versions, passages, and locator replay do not exist.

**GREEN:** Implement the single SEC HTML tracer and the minimum workflow step that invokes it for SEC sources. Keep the branch outcome typed as `succeeded`, `partial`, or `failed`; a failed branch creates no `SourceVersion`.

**REFACTOR:** Separate transport, deterministic normalization, locator logic, action orchestration, and transactional persistence. Ensure stored metadata is bounded and artifacts remain in File Storage. Query `_storage` through `ctx.db.system.get(storageId)` when metadata is needed; do not use deprecated `getMetadata`.

**Browser inspection:** Use only the protected source coverage projection if exposed for development; do not render claims or unlock Evidence yet.

**Handoff gate:** Reviewer reproduces a quotation from downloaded local-test storage bytes and confirms no source-selection metadata was used as evidence.

### Task 5: Add Exa Contents, Safe Public PDFs, and Partial Source Outcomes

**Outcome:** Frozen accepted general-web sources use Exa Contents, accepted public PDFs use the direct safe retrieval and page-aware contract, and unrelated source branches continue when one source is partial or failed.

**Files:**

- Create: `convex/integrations/exaEvidence.ts`
- Create: `convex/integrations/publicPdfEvidence.ts`
- Modify: `convex/integrations/exa.ts`
- Modify: `convex/integrations/approvedSourceRetrieval.ts`
- Modify: `convex/integrations/evidenceNormalization.ts`
- Modify: `convex/evidenceActions.ts`
- Modify: `convex/evidenceArtifacts.ts`
- Modify: `convex/evidenceWorkflow.ts`
- Modify: `convex/providerCalls.ts`
- Modify: `convex/schema.ts`
- Create: `src/__tests__/convex/evidence/web-pdf-provenance-tracer.test.ts`
- Modify: `src/__tests__/convex/integrations/exa-adapter.test.ts`
- Create: `src/__tests__/convex/integrations/exa-contents-adapter.test.ts`

**Directions:** Exa Contents requests text only for an already authorized canonical URL, use a 120-second outer timeout and at most two attempts, and map provider SDK output into the same provider-independent retrieved artifact. Public PDF retrieval reuses existing HTTPS/credential/port/DNS/private-address/redirect/pinning protections, validates every redirect, enforces 16 MiB and 400 pages, and never follows a second unvalidated resolution. Phase 5 supports deterministic page-aware fixture normalization only; a non-fixture PDF returns typed `normalizer_unavailable`, produces no `SourceVersion`, and contributes a visible partial/failed source status without an Unstructured call.

**Preserve:** Exa discovery remains `contents: false`; approved retrieval is a separate operation. Firecrawl is absent. Existing manual-source metadata intake remains bounded at its current 2 MiB because it is a different pre-approval purpose.

**Risks:** Exa response drift, decompression bombs, redirects, DNS rebinding, and unsupported PDFs can turn a retrieval helper into an SSRF or resource-exhaustion boundary. Each failure remains source-local and cannot weaken URL validation or trigger an unapproved fallback.

**RED cases:** authorized Exa happy path; missing API configuration; paid-work disabled; provider partial/no text; two-attempt exhaustion; redirect to private address; DNS rebinding; PDF oversize/page limit; deterministic fixture PDF locator replay; non-fixture PDF normalizer unavailable; one branch fails while another commits; all branches become terminal.

Run:

```bash
TMPDIR=/tmp TEMP=/tmp pnpm exec vitest run src/__tests__/convex/evidence/web-pdf-provenance-tracer.test.ts src/__tests__/convex/integrations/exa-adapter.test.ts src/__tests__/convex/integrations/exa-contents-adapter.test.ts src/__tests__/convex/integrations/provider-calls.test.ts
```

Expected: FAIL because production `getContents`, approved PDF normalization, and multi-branch terminalization do not exist.

**GREEN:** Add Exa and PDF branches behind the common retrieval result and persist bounded typed outcomes. Use the actual frozen accepted count as progress total.

**REFACTOR:** Deduplicate only application-owned safety and result contracts; do not merge pre-approval metadata inspection with post-approval content persistence. Keep SDK and HTTP-specific errors inside integration modules.

**Browser inspection:** Verify source processing counts can represent accepted, processed, partial, and failed without showing provider names or raw codes.

**Handoff gate:** Review the external-I/O safety matrix in Section 10 against the code and tests before claim work begins.

### Task 6: Generate Fixture-Gated Atomic Claims and Evidence Relations

**Outcome:** Only a complete hash-identified showcase input can create immutable atomic claims, explicit supporting/counter/context relations, conservative canonicalization results, and proposed dimension links.

**Files:**

- Create: `convex/domain/claims.ts`
- Create: `convex/domain/claimCanonicalization.ts`
- Create: `convex/domain/showcaseManifest.ts`
- Create: `convex/claimGeneration.ts`
- Create: `convex/integrations/showcaseClaimAdapter.ts`
- Modify: `convex/schema.ts`
- Modify: `convex/evidenceWorkflow.ts`
- Create: `src/__tests__/convex/evidence/claim-generation-tracer.test.ts`
- Create: `src/__tests__/convex/evidence/claim-canonicalization.test.ts`
- Create: `src/__tests__/fixtures/evidence/ccc-showcase-manifest.ts`

**Directions:** Add `aiTaskResults`, `claims`, `claimEvidence`, and `claimDimensionLinks`. Normalize and hash the ordered approved passage input, plan questions, corpus revision, schema version, and adapter version. The adapter refuses every hash not in the manifest. Persist `executionMode = "showcase"`, fixture ID/version, normalized input hash, validated output, and schema version in `AITaskResult`; do not create a fake `ProviderCall`. Validate passage IDs against the active corpus before insertion. Canonicalize only exact normalized atomic text plus equal classification; near-duplicates remain separate and receive a bounded review-candidate reference. Proposed dimension links contain no decision.

**Preserve:** Claims are proposals, not analyst decisions. No claim mutation, confidence, assessment output, or Phase 6 control is introduced.

**Risks:** A permissive manifest match could leak curated claims into live dossiers, while aggressive canonicalization could erase analytical distinctions. Match the complete normalized input and merge only exact normalized atomic text with equal classification.

**RED cases:** exact showcase hash succeeds; one-byte changed input refuses; foreign/rejected passage refuses; claim with no passage refuses; explicit counter/context relationships persist; source category does not infer relation; exact equal claims merge; different classification does not merge; semantic near-duplicate does not merge; retries reuse task/claim/evidence/link identities; generated links contain no effective decision.

```ts
expect(result.executionMode).toBe("showcase");
expect(result.providerCallId).toBeUndefined();
expect(counterEvidence.relation).toBe("counter");
expect(nearDuplicate.claimIds).toHaveLength(2);
```

Run:

```bash
TMPDIR=/tmp TEMP=/tmp pnpm exec vitest run src/__tests__/convex/evidence/claim-generation-tracer.test.ts src/__tests__/convex/evidence/claim-canonicalization.test.ts
```

Expected: FAIL because the claim records and adapter do not exist.

**GREEN:** Implement the smallest complete showcase claim tracer using only persisted passages and manifest-bound output.

**REFACTOR:** Keep fixture data under test/fixture ownership and keep production manifest matching in a small versioned domain module. Never import the existing UI prototype data into Convex production code.

**Browser inspection:** None; the Evidence UI remains locked until policy and workflow handoff are complete.

**Handoff gate:** Reviewer manually traces every showcase claim to its exact passage and confirms changed input cannot reuse fixture output.

### Task 7: Enforce Structural Policy, Unknown Semantics, and Honest Capability Pause

**Outcome:** Claims receive immutable structural and policy results; targeted deterministic verifier output is application-controlled; valid `Unknown` claims require questions plus context; arbitrary live inputs pause without mutation on unavailable retry.

**Files:**

- Create: `convex/domain/evidencePolicy.ts`
- Create: `convex/domain/claimValidation.ts`
- Create: `convex/policyEvaluations.ts`
- Create: `convex/integrations/showcaseVerifierAdapter.ts`
- Modify: `convex/claimGeneration.ts`
- Modify: `convex/evidenceExecution.ts`
- Modify: `convex/evidenceWorkflow.ts`
- Modify: `convex/researchRuns.ts`
- Modify: `convex/schema.ts`
- Create: `src/__tests__/convex/evidence/evidence-policy.test.ts`
- Create: `src/__tests__/convex/evidence/claim-generation-unavailable.test.ts`

**Directions:** Add immutable `policyEvaluations` with policy version, normalized observable inputs, executed rules, reasons, verifier task reference, and result. Structural validation blocks invalid locators, non-active-corpus passages, non-accepted decisions, missing evidence, schema violations, or irreproducible quotations and cannot be overridden. `Unknown` requires at least one `researchPlanQuestionId` and one `context` evidence row. Policy uses authority, recency, independent corroboration, passage diversity, classification, unresolved counters, and derived question coverage, but it never converts those into final assessment confidence. Request deterministic verifier output only for the bounded entailment/contradiction/dimension cases identified by policy; persist it as an `AITaskResult` input, not the decision owner.

**Preserve:** Weak evidence may remain Hypothesis, Unknown, needs review, blocked, or insufficient; never force a confident Fact.

**Risks:** Conflating technical unavailability, acquisition limitations, and analytical Unknown would fabricate evidence or hide a capability gap. Persist and test the three concepts independently, and keep structural blocks non-overridable.

**RED cases:** invalid quote is non-overridable; Unknown without question fails; Unknown without context fails; selection gap alone creates no Unknown; question coverage is derived; deterministic policy replay; verifier requested only by specified rule; verifier cannot override structural block; arbitrary live hash transitions to exact paused tuple and clears active workflow ID; unavailable retry returns without state/I/O; newly available retry atomically claims slot/new generation and reuses artifacts.

Run:

```bash
TMPDIR=/tmp TEMP=/tmp pnpm exec vitest run src/__tests__/convex/evidence/evidence-policy.test.ts src/__tests__/convex/evidence/claim-generation-unavailable.test.ts src/__tests__/convex/research-runs/phase-5-lifecycle.test.ts
```

Expected: FAIL because policy, structural validation, and retry capability checks do not exist.

**GREEN:** Implement the policy and exact pause/retry protocol. The claim-generation step becomes `needs_review`; the run remains `extracting_evidence`; the visitor running slot is released because `executionStatus` is paused; the completed workflow ID is compare-and-cleared.

**REFACTOR:** Centralize internal reason codes and keep analyst-safe copy out of domain modules. Bound policy reasons and task payloads. Prove no unavailable retry writes an event, increments generation, or opens a provider attempt.

**Browser inspection:** Add a temporary test projection only if needed; product rendering belongs to Task 9. Verify no route unlock is changed early.

**Handoff gate:** Review the distinction among analytical `Unknown`, acquisition limitation, structural block, and technical claim-generation unavailability.

### Task 8: Complete Durable Fan-Out, Idempotent Reuse, Cleanup, and Strong Handoff

**Outcome:** The Phase 5 workflow runs all frozen sources independently, schedules only incomplete work on retry, performs bounded orphan reconciliation, handles cancellation/stale results, and reaches `evidence_ready + idle` only under the strong predicate.

**Files:**

- Modify: `convex/evidenceWorkflow.ts`
- Modify: `convex/evidenceExecution.ts`
- Modify: `convex/evidenceActions.ts`
- Modify: `convex/evidenceArtifacts.ts`
- Modify: `convex/researchRuns.ts`
- Modify: `convex/workflowControls.ts`
- Modify: `convex/schema.ts`
- Create: `src/__tests__/convex/workflows/phase-5-workflow.test.ts`
- Create: `src/__tests__/convex/evidence/artifact-cleanup.test.ts`
- Modify: `src/__tests__/convex/workflows/durable-workflow.test.ts`

**Directions:** Fan out by the persisted frozen source rows, not client input or recommendation ceiling. Every branch terminalizes its `EvidenceSourceStatus`. Continue when at least one valid passage exists. Schedule claim/policy work only when not already committed for the logical input. The success mutation verifies all frozen rows are terminal, at least one reproducible passage exists, the claim pipeline is terminal, and at least one structurally valid claim exists before transitioning to `evidence_ready + idle` and compare-clearing the workflow handle. Zero passages produces a typed failed/retryable outcome without claims. Cancellation increments generation, prevents new I/O, and makes late results non-authoritative. Cleanup is an internal/admin-protected paginated mutation: reconcile expired upload leases, referenced storage IDs, and `_storage` after a safety interval; delete only old unreferenced objects and mark reconciled leases.

**Preserve:** Existing workflow manager retry behavior, provider attempt history, immutable committed artifacts, and cancellation semantics. Do not call `workflow.cleanup` while audit history is still needed.

**Risks:** Durable redelivery can duplicate side effects, and cleanup can destroy valid evidence if reference checks are stale. Logical keys, generation fences, compare-and-clear, safety intervals, and immediate pre-delete reference checks are mandatory.

**RED cases:** one branch fails while another succeeds; all-failed stops; partial plus valid claim succeeds; nonterminal branch blocks handoff; zero claims blocks handoff; duplicated workflow delivery reuses all records; retry schedules only missing work; cancellation before/after dispatch; stale generation; cleanup keeps referenced object; cleanup deletes only expired unreferenced object; crash before lease attachment is discovered through paginated `_storage` reconciliation; compare-and-clear does not erase a newer workflow ID.

Run:

```bash
TMPDIR=/tmp TEMP=/tmp pnpm exec vitest run src/__tests__/convex/workflows/phase-5-workflow.test.ts src/__tests__/convex/evidence/artifact-cleanup.test.ts src/__tests__/convex/workflows/durable-workflow.test.ts src/__tests__/convex/integrations/provider-calls.test.ts
```

Expected: FAIL until orchestration and cleanup are complete.

**GREEN:** Implement the end-to-end deterministic workflow with fixture adapters and exact terminal predicates.

**REFACTOR:** Audit every query for an index and bound, every action for pre/post fences, and every logical write for idempotent reuse. Keep source status mutable but all authority/provenance/task/policy records immutable.

**Browser inspection:** Inspect persisted RunEvents and source statuses through guarded local fixture inspection; do not infer progress from workflow logs.

**Handoff gate:** Reviewer runs the complete Phase 5 workflow test twice against the same fixture and compares record/provider/storage counts.

### Task 9: Replace Only the Evidence Placeholder with the Reactive Read-Only Matrix

**Outcome:** An owner sees coverage, claims, limitations, filters, and exact passage provenance in the existing workbench; loading/error/empty/partial/unavailable states are explicit; no Phase 6 decisions appear.

**Files:**

- Create: `convex/evidenceMatrix.ts`
- Create: `src/components/workspace/evidence-matrix.tsx`
- Create: `src/components/workspace/evidence-claim-list.tsx`
- Create: `src/components/workspace/evidence-claim-detail.tsx`
- Create: `src/components/workspace/evidence-coverage-summary.tsx`
- Modify: `src/components/workspace/run-route-component.tsx`
- Modify: `src/components/workspace/workspace-navigation-rail.tsx`
- Modify: `src/components/workspace/run-progress.tsx`
- Modify: `src/lib/presentation/research-copy.ts`
- Modify: `src/routes/workspace/_protected/$runId.tsx` only if search validation needs no change; route file must continue exporting only `Route`
- Create: `src/__tests__/components/workspace/evidence-matrix.test.tsx`
- Modify: `src/__tests__/routes/run-route-component.test.tsx`
- Modify: `src/__tests__/routes/run-workspace.test.tsx`
- Modify: `src/__tests__/components/workspace/run-progress.test.tsx`

**Directions:** Public queries derive the visitor and enforce run ownership. `getSummary` returns accepted/processed/partial/failed counts, question coverage, execution mode, and analyst-safe state inputs. `listClaims` uses native Convex pagination and indexed bounded filters for classification, policy result, proposed dimension, counter presence, and processing state. `getClaimDetail` verifies the claim belongs to the run and returns exact quotes, locators, version identity, relation, source identity, and separate provenance context. React registers generated refs through `convex-react-harness`; do not mock hook order. Reuse SourceReview's desktop resizable panel and narrow Drawer interaction pattern, `MotionAnimatePresence`, and reduced-motion handling.

**Preserve:** Existing route query shape, run header, rail composition, source review, generic panels for later sections, localStorage rail behavior, breakpoints, focus order, and source preview architecture.

**Risks:** The new surface could accidentally become a Phase 6 decision screen, leak raw technical state, or replace the established responsive shell. Negative control/copy assertions and before/after browser comparisons gate the task.

**RED component cases:** geometry-preserving loading; true empty; partial sources; unavailable live dossier; recoverable query error/retry; showcase disclosure; Fact/Inference/Hypothesis/Unknown rows; counter evidence and unresolved limitation; filters; desktop detail panel; mobile Drawer; exact quote/locator; owner query args; no approve/reject/edit/link decision controls; no raw provider/workflow copy; Evidence unlock only at `evidence_ready`; Assessment remains locked; keyboard and reduced motion.

```ts
expect(screen.getByText("Evidence is ready for review")).toBeVisible();
expect(screen.getByText("Showcase evidence")).toBeVisible();
expect(screen.queryByRole("button", { name: /approve|reject|edit/i })).not.toBeInTheDocument();
expect(screen.queryByText(/claim_generation_unavailable|EXA_API_KEY|request id/i)).not.toBeInTheDocument();
```

Run:

```bash
TMPDIR=/tmp TEMP=/tmp pnpm exec vitest run src/__tests__/components/workspace/evidence-matrix.test.tsx src/__tests__/routes/run-route-component.test.tsx src/__tests__/routes/run-workspace.test.tsx src/__tests__/components/workspace/run-progress.test.tsx
```

Expected: FAIL because the queries/components are missing and the route renders the placeholder.

**GREEN:** Add the projections and replace only the Evidence branch in `RunRouteComponent`. Keep state-specific copy in `research-copy.ts`, not in domain or duplicated components.

**REFACTOR:** Split query-owning boundary from presentational rows/detail; derive props from generated API types; preserve selected claim/filter state above the narrow `LoadErrorBoundary`; ensure all icons use `Icon`; run affected format/lint/typecheck.

**Browser inspection:** With a real admitted local analyst, verify at 1440×1000, 900×900, and 390×844: rail collapsed/expanded, Evidence active, Assessment locked, summary/filter/list/detail geometry, Drawer focus trap and return focus, keyboard row selection, reduced motion, persisted reactive updates, loading/empty/partial/unavailable/error states, and console/network. Compare with the baseline captures; record every intentional delta.

**Handoff gate:** A UI reviewer confirms shell/source-review continuity and a domain reviewer confirms no source metadata is presented as claim truth.

### Task 10: Certify Protected Showcase and Live-Dossier Boundaries

**Outcome:** Local deterministic E2E proves the protected reactive journey and honest boundary; opt-in live contracts prove adapters without turning external drift into CI truth; verification records exact passed, failed, deferred, and baseline gates.

**Files:**

- Modify: `convex/e2eFixtures.ts`
- Create: `e2e/support/evidence-matrix-fixture.ts`
- Create: `e2e/evidence-matrix-reactivity.spec.ts`
- Create: `src/__tests__/convex/e2e/evidence-matrix-fixture.test.ts`
- Create: `src/__tests__/live/sec-evidence-retrieval.contract.test.ts`
- Create: `src/__tests__/live/exa-contents.contract.test.ts`
- Create: `docs/verification/2026-08-15-phase-5-evidence-matrix-provenance.md`
- Modify: `docs/ROADMAP.md` only after the exact gates pass

**Directions:** Extend the existing local-only fixture gate. Derive ownership from a claimed reusable invitation code; never accept visitor/auth IDs. Seed an approved corpus whose artifact hashes match the showcase manifest, start the real Phase 5 workflow, and inspect only a bounded internal read model. The browser must enter through anonymous auth and normal code admission, navigate to the real protected run, observe persisted source progress and claims reactively, inspect an exact passage, log out, prove the private route is denied, reuse the same code to rebind the visitor, and recover the dossier. Add a second deterministic live-boundary fixture that reaches the unavailable paused state with real-looking but non-manifest content and proves no fixture claims/Assessment unlock/provider calls.

**Preserve:** `E2E_FIXTURES_ENABLED` local-only safeguard, global teardown, no `--identity`, no cloud deployment, no paid provider by default, and current invitation ownership model.

**Risks:** Fixture APIs can become an authorization bypass, reusable access material can leak into artifacts, and live-provider drift can be mistaken for deterministic correctness. Keep fixture entry points local-gated, ownership-derived, bounded, and separately reported from live evidence.

**RED:** The new fixture and E2E spec fail because no Phase 5 seeding/inspection API exists.

Run focused deterministic gates:

```bash
TMPDIR=/tmp TEMP=/tmp pnpm exec vitest run src/__tests__/convex/e2e/evidence-matrix-fixture.test.ts src/__tests__/convex/workflows/phase-5-workflow.test.ts src/__tests__/components/workspace/evidence-matrix.test.tsx
pnpm exec playwright test e2e/evidence-matrix-reactivity.spec.ts
```

**GREEN:** Implement the guarded fixture/inspection contract and pass the real local Convex browser journey with zero paid provider calls.

**REFACTOR:** Remove diagnostic fixture helpers not needed by the final bounded contract. Ensure teardown removes the fixture flag even on failure. Store screenshots/traces only under Playwright/verification artifacts, never commit OTP material.

**Live opt-in gates:** Run only with explicit user authorization and configured credentials.

```bash
RUN_LIVE_PROVIDER_TESTS=1 SEC_USER_AGENT='approved identifying value' TMPDIR=/tmp TEMP=/tmp pnpm exec vitest run src/__tests__/live/sec-evidence-retrieval.contract.test.ts
RUN_LIVE_PROVIDER_TESTS=1 EXA_API_KEY='configured outside the command history' TMPDIR=/tmp TEMP=/tmp pnpm exec vitest run src/__tests__/live/exa-contents.contract.test.ts
```

Do not place real secrets directly in shell history; load them from the existing local environment. Report source URLs, dates, adapter versions, attempts, latency, byte counts, locator reproduction, and external limitations without printing credentials or full copyrighted bodies.

**Final automated gates:** First fix or explicitly quarantine the known baseline harness/`scrollTo` failures if they overlap touched files. The final change must add no failure and should restore the affected suites to green.

```bash
TMPDIR=/tmp TEMP=/tmp pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
pnpm convex:check
pnpm build
pnpm test:e2e
```

`pnpm build` runs only here after the substantial integrated change, not after every task.

**Browser inspection:** Capture desktop, tablet, and mobile screenshots; normal and reduced-motion interaction; empty/partial/unavailable/showcase states; logout/reconnection; focus restoration; no horizontal overflow; no raw error copy; no unexpected console errors. Investigate the baseline 404 and record whether it is unchanged or fixed.

**Handoff gate:** The verification document separates deterministic CI evidence, real local Convex E2E evidence, live external-provider evidence, deferred real Unstructured/model-provider gates, and remaining baseline debt. Check Phase 5 ROADMAP boxes only for gates actually proven.

## 10. External I/O, Security, and Durable-Workflow Matrix

| Boundary | Authorization before I/O | Validation and ceilings | Timeout and retry | Idempotency and telemetry | Cancellation / stale result | Typed outcome |
|---|---|---|---|---|---|---|
| SEC filing retrieval | Internal query verifies owned active run, approved revision, frozen current accepted head, active generation/workflow | Confirmed CIK and accession, SEC host/path, 16 MiB declared/decompressed, supported HTML/text | 10 seconds abortable; two total attempts for timeout/network/408/429/5xx only | Operation key binds run, workflow version, generation, revision, source, decision, step, attempt; `ProviderCall` records latency/usage/error | Recheck before dispatch and persistence; late response cannot upload or commit | `succeeded`, `partial`, or `failed` with bounded internal reason |
| Exa Contents | Same authority fence plus paid-work switch before SDK call | One approved canonical URL, text only, 16 MiB normalized output, no search/crawl | 120-second outer abort; two total attempts for retryable provider failures | Separate approved-content operation; record provider result reference, latency, usage, reported cost when supplied | No fallback or second paid call after cancellation/generation change | success, partial/no-text, missing configuration, paid disabled, exhausted |
| Direct public PDF | Authority before DNS | HTTPS, no credentials/custom port, public DNS, every redirect, pinned address with Host/SNI, MIME, 16 MiB, 400 pages, decompression bounds | 10 seconds abortable; two total attempts for timeout/network/408/429/5xx only | Stable direct-retrieval operation key and provider-call attempt record | Validate again before each redirect/dispatch and before storage | retrieved fixture-normalizable, normalizer unavailable, invalid, oversize, temporary failure |
| Convex File Storage upload | Final work descriptor already authority-fenced | 16 MiB normalized artifact and known content hash | One logical upload attempt per lease; storage errors are retryable only through expired lease reconciliation | `ArtifactUploadLease` records reserved/uploaded/committed/orphaned and storage ID as soon as available | Finalize rechecks authority; rejected finalize marks orphan and best-effort deletes | committed/reused, retryable upload failure, orphaned |
| Artifact cleanup | Protected internal/admin call, local/authorized scheduler only | Pagination, safety interval, expired lease, `_storage` metadata, referenced-ID exclusion | Bounded page; retry next page by cursor | Cleanup run key/cursor; audit counts, no domain content | Recheck reference immediately before delete | deleted orphan, retained referenced/recent, retryable page failure |
| Showcase claim/verifier adapter | Active corpus and generation plus exact complete input hash in manifest | Versioned schemas, ordered passage IDs, bounded text and outputs | Deterministic; no retry beyond idempotent replay | `AITaskResult` by input/schema/adapter hash; no fake ProviderCall | Pre/post active check; stale output cannot persist | showcase success or `claim_generation_unavailable` |
| Phase 5 start/retry | Server-derived active visitor and owned run | Exact lifecycle/status/pause tuple, approved active revision, current decision heads, one running run, request-key bounds | Transactional; replay returns prior result | Request key + generation + workflow ID; RunEvent/AuditEvent | Concurrent transaction loses slot and creates no second workflow | started, replayed, unavailable-noop, unauthorized, stale, concurrent |
| Live contract tests | Explicit environment flag and user authorization | Frozen bounded source list, no secrets/body logging | Same production bounds; one test run | Test report records date/adapter/result, not production data | Abort on failed guard or changed external state | pass, external limitation, skipped/unconfigured |

## 11. Analyst-Facing Copy Contract

Copy lives in `src/lib/presentation/research-copy.ts` or focused presentation helpers. Domain modules persist stable internal codes only.

| Persisted condition | Required analyst-facing copy | Required consequence / action | Forbidden leakage |
|---|---|---|---|
| `evidence_ready + idle` | `Evidence is ready for review` | Invite inspection of claims and source passages | `evidence_ready`, workflow/generation details |
| Some sources partial/failed | `Some approved sources could not be processed` | Show processed/partial/failed counts and allow source-level inspection | Exa/SEC error codes, HTTP details, request IDs |
| Claim generation unavailable | `Claim generation is not available for this dossier yet` | Explain that retrieved source material is preserved and Assessment remains unavailable | `claim_generation_unavailable`, provider/config/env names |
| Showcase execution | `Showcase evidence` and `Illustrative` where context requires | State that claims use a curated deterministic corpus | Fixture hashes, adapter internals |
| No accepted sources at start | `Approve at least one source before preparing evidence` | Return to Sources | projection/decision IDs |
| No reproducible passages | `The approved sources did not yield citable passages` | Review failed/partial source outcomes and retry when appropriate | locator/parser exceptions |
| Recoverable query error | `We couldn't load the evidence matrix. Try again.` | Shared Retry control remounts only query subtree | raw Convex error/function name |
| True empty ready projection | `No reviewable claims were produced` | Explain coverage limitation; do not imply loading | internal terminal predicate |
| Structural block | `This claim could not be validated against its cited passage` | Keep visible as blocked/limitation if policy projection permits | stack trace, schema/path details |

Tests must assert both required copy and absence of internal enum keys, provider names, environment variables, request IDs, raw exceptions, quota mechanics, and workflow terminology.

## 12. Verification Matrix

| Invariant / behavior | Unit or domain | Convex integration | React integration | Real local E2E | Optional live |
|---|---|---|---|---|---|
| Only effective accepted heads authorize | `evidenceAuthority` tests | Phase 5 start and workflow tests with supersession | Coverage projection fixture | Rejected source absent from matrix | Not needed |
| No pre-approval retrieval | Adapter dispatch guard | Phase 4 and start tests assert zero I/O | Source review unchanged | Approve then observe first retrieval event | Not needed |
| Stable questions and valid Unknown | Research-plan/policy tests | Claim persistence rejects missing question/context | Matrix renders unresolved question | Showcase Unknown opens context passage | Not needed |
| Reproducible passage | Normalizer/locator tests | Stored artifact replay | Detail renders quote/locator | Browser inspects exact citation | SEC/Exa sample relocation |
| Idempotent artifacts/claims/provider calls | Hash/key tests | Replay/retry/cancel workflow counts | Reactive rows do not duplicate | Reload/reconnect keeps counts | Bounded adapter replay |
| Partial branches remain visible | Outcome reducer tests | One source fails, another succeeds | Partial summary and limitation | Fixture updates reactively | Optional provider partial sample |
| Unavailable live path is honest | Manifest capability test | Exact paused tuple/no-op retry | Safe copy, no rows, Assessment locked | Non-manifest fixture proves boundary | Not required until model provider exists |
| Strong ready handoff | Terminal predicate tests | All terminal + passage + valid claim required | Evidence unlocked only when ready | Showcase reaches ready; no early unlock | Not needed |
| Analyst decision controls absent | N/A | No Phase 6 mutation exposed | Negative role/name assertions | Keyboard audit finds inspection only | N/A |
| Ownership and admission | N/A | Foreign visitor APIs reject | Protected route tests | logout, denial, reusable-code reconnection | N/A |
| Loading/error geometry | N/A | Query errors typed/bounded | Skeleton/empty/error tests | screenshots at three widths | N/A |
| Motion/progress integrity | N/A | Persisted events only | reduced-motion and event-driven animation tests | trace/snapshot after persisted updates | N/A |

## 13. Live and Browser Certification Gates

### Deterministic browser gate

1. Start the existing local-only Convex/Vite Playwright stack; verify hostnames remain `127.0.0.1` and deployment is local.
2. Claim a reusable analyst code through the normal drawer; never use `--identity` or client-supplied ownership.
3. Seed the owned approved showcase corpus through guarded `e2eFixtures` and start Phase 5 through `api.evidenceExecution.start`.
4. Observe persisted source counts update without client timers, then observe `Evidence is ready for review` and the Evidence rail link unlock.
5. Filter claims by classification and counter-evidence, select a row, inspect exact supporting/counter/context passages and their locators, and confirm the showcase disclosure.
6. At 1440×1000 verify resizable master/detail; at 900×900 and 390×844 verify list plus Drawer, focus trap, Escape close, and focus restoration.
7. Repeat with reduced motion; functional state feedback remains while ornamental movement is removed.
8. Seed the non-manifest live-boundary fixture; verify source coverage persists, unavailable copy renders, claims remain absent, and Assessment stays locked.
9. Log out, verify the private route is unavailable, start a fresh anonymous session, reuse the same code, and recover the same dossier.
10. Inspect console and network after each state-changing action. Fresh snapshots, not stale refs, are the evidence.

### Live provider gate

- Run SEC and Exa live contracts separately and only after explicit approval. Use current official provider behavior and installed-package types; external success is evidence for the dated run, not a permanent guarantee.
- Keep the corpus bounded and public. Record exact source identity/URL, retrieval date, provider/adapter version, attempt count, status, latency, byte count, and locator reproduction outcome.
- Never commit or display credentials, reusable invitation codes, complete copyrighted bodies, or cloud fixture flags.
- Real PDF normalization and real model extraction remain explicitly deferred and cannot be marked passed.

### Baseline debt gate

- Before final certification, rerun the three initially failing UI suites. If Task 9 touches their shared browser/preview path, repair the `ConvexProvider` harness and `window.scrollTo` test environment in a separate focused RED/GREEN change. If unrelated, report them as unchanged baseline failures and require every Phase 5 focused suite to pass.
- Run `pnpm format:check`; format touched files only. Do not mechanically reformat unrelated user files unless separately authorized.
- The final verification report must state counts from the current run, not repeat the historical 283/419-test closure reports.

## 14. Self-Review Checklist

- [x] Task 1 authority is accepted and no conflict remains among ADR-023, product design, TECH, ROADMAP, validators, and this plan.
- [x] The user's ADR-017 and TECH adaptive-ceiling corrections remain present.
- [x] Phase 4 still ends at `corpus_approved + idle` with zero Phase 5 records or provider work.
- [x] `workflowId` is active-only and compare-and-clear cannot erase a newer execution.
- [x] Every accepted source branch is frozen from the exact effective decision head and revalidated before I/O and persistence.
- [x] Pending, rejected, superseded, historical, foreign, cancelled, and stale inputs produce zero unauthorized side effects.
- [x] External I/O satisfies authorization, URL/redirect/DNS/pinning, size/page, timeout, retry, lease, telemetry, cancellation, and typed-outcome requirements.
- [x] File Storage finalize and cleanup preserve referenced artifacts and bound transient orphans.
- [x] Every passage quotation reproduces from its immutable source version.
- [x] Every claim is atomic and every material claim has explicit evidence relations.
- [x] `Unknown` has a stable question and context passage; source-selection gaps never fabricate it.
- [x] Structural validation is non-overridable and policy remains versioned/application-owned.
- [x] Fixture execution is hash-gated, persisted as showcase, visibly labelled, and creates no fake ProviderCall.
- [x] Arbitrary live input pauses honestly, unavailable retry is a no-op, and Phase 6 remains locked.
- [x] Strong ready requires all frozen branches terminal, at least one reproducible passage, terminal claim/policy work, and at least one structurally valid claim.
- [x] Evidence Matrix is read-only and preserves shell, rail, source review, breakpoints, keyboard, motion, reduced motion, and loading geometry.
- [x] Presentation copy is actionable and excludes raw technical details.
- [x] Generated types own React projections; no hand-written Convex DTOs or generated-file edits exist.
- [x] Focused tests, typecheck, lint, Convex check, final build, protected E2E, and explicitly authorized live contracts are reported separately with exact results.
- [x] No unrequested stage, commit, push, deployment, cloud fixture, or paid-provider action occurred.

## 15. Known Deferrals and Stop Conditions

Known deferrals after this plan completes:

- Real Unstructured page-aware PDF normalization remains in the later provider-integration slice under ADR-004.
- Real model-provider claim extraction, semantic verification, routing, retries, and fallback remain in Phase 8 under ADR-009 and ADR-010.
- Claim and dimension-link analyst decisions, append-only overrides, and Phase 6 review UI remain Phase 6.
- Dimension assessment, map, brief, export, and production deployment remain later phases.
- Firecrawl remains deferred unless new measured approved-source failures satisfy a separately approved threshold.

Stop execution and revise authority/plan when any of these occurs:

- The installed Convex Workflow version cannot atomically start/store the active workflow from the protected mutation contract.
- File Storage behavior or `_storage` system-table access differs from the installed Convex 1.42.1 types/guidelines.
- A provider requires a second unvalidated DNS resolution or cannot meet the approved timeout/size/cancellation contract.
- The final curated corpus exceeds an ADR-023 ceiling or cannot produce reproducible locators under the deterministic normalizer.
- Fixture inputs cannot be isolated by complete normalized hash without risk of matching arbitrary live content.
- An authority document conflicts with ADR-023, or implementation evidence invalidates the strong handoff/pause protocol.
- The required UI would need a shell, navigation, source-review, responsive, motion, or decision-control redesign not authorized here.
- A test proposal turns an implementation assumption into product truth or hides a known baseline failure.

When implementation is explicitly authorized, execute task-by-task with reviewer checkpoints. Recommended mode: subagent-driven development with one isolated implementation agent and one reviewer per task. Alternative: inline execution in this task using the same RED → GREEN → REFACTOR and handoff gates.
