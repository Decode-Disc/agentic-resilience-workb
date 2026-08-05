# Phase 4 Company and Corpus Discovery Implementation Plan

> **Plan status:** Reconciled on 2026-08-05 with the current Phase 4
> implementation attempt, ADR-012 through ADR-014, and the implementation
> post-mortem. Checkboxes describe the required corrective execution sequence;
> they are not delivery evidence.
>
> **For agentic workers:** REQUIRED SUB-SKILLS: Read `writing-plans`, then the
> project `implementation-plan` skill, before revising this document. Use
> `executing-plans` only after explicit implementation authorization. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the first honest live vertical slice from company preflight
through an immutable approved `CorpusRevision`, ending at the persisted
`corpus_approved` handoff without simulating evidence extraction.

**Architecture:** TanStack Start owns the React web application, typed routing,
SSR, and request-scoped web concerns. Convex remains the authoritative domain
backend, state owner, reactive API, and durable workflow runtime. Convex Actions
perform SEC/URL/Exa I/O through application-owned integration adapters;
internal mutations alone persist typed results, progress, idempotency, and audit
records. The production workspace folds Prototype A's persistent rail into real
`/workspace` routes and reads only owner-authorized Convex projections.

**Tech Stack:** TypeScript 6, React 19, TanStack Start/Router, Convex 1.42,
Convex Workflow 0.4, Vitest 4, `convex-test`, `exa-js@2.16.0`, shadcn/base-luma,
Hugeicons through the shared `Icon`, Motion, pnpm, Node 24.

## Global Constraints

- Read `AGENTS.md`, `context/PROJECT.md`, `context/TECH.md`, ADR-004, and
  ADR-008 through ADR-014 before executing.
- Reconstruct the current worktree, routes, tests, and browser baseline before
  changing an existing surface. Planning does not authorize implementation.
- All production behavior follows one-test-at-a-time RED → GREEN → REFACTOR.
- Default and CI tests never call SEC, Exa, or another nondeterministic or paid
  provider.
- Use deterministic provider adapters in workflow tests; live contract tests
  are explicit, opt-in, and bounded.
- Provider adapters are infrastructure modules executed by Convex Actions. Their
  location under `convex/integrations/` identifies the server runtime; it does
  not make provider-specific types part of the domain or give adapters direct
  database access.
- Convex owns companies, runs, research plans, sources, corpus revisions,
  decisions, progress, provider calls, and the paid-work switch.
- Do not proxy Convex queries, mutations, or actions through TanStack Start
  server functions. Reserve `createServerFn` and server routes for genuine
  request-scoped web concerns such as SSR-only computation, redirects, cookies,
  or intentionally exposed HTTP endpoints.
- Preserve the existing Start page, composer, toolbar, Workbench Shell,
  `AnalyzedCompanyList`, persistent rail, source-review composition, shared
  `CutoutCard` composition, and their motion/responsive behavior. This plan
  connects real data and workflow behavior; it does not authorize redesigning
  those surfaces.
- Preserve the existing reference affordance and allow multiple public HTTPS
  URL candidates. Local file upload, pasted document bodies, and local PDF
  upload remain outside the MVP.
- Keep shared UI primitives neutral and configurable. Apply consumer-specific
  stacking, dimensions, motion, and copy at the consumer boundary.
- User-facing copy describes evidence, consequences, and next actions. It must
  not expose invitation inventory, quota mechanics, environment variables,
  provider error codes, raw Convex errors, internal event keys, lifecycle
  literals, or roadmap phases.
- Use the reusable four-digit access-code contract from ADR-014. The public
  Start surface establishes anonymous Auth silently; code admission occurs only
  when confirming a launch or entering a protected route. Logout, reconnection,
  role routing, and visitor rebinding are part of the verified journey.
- Exa search uses `contents: false`; `getContents` remains outside Phase 4.
- Use one active `executionStatus = running` workflow per visitor. Human-paused
  runs do not block a launch.
- Authorize ownership before external I/O. Bind retryable calls to workflow
  version, execution generation, corpus revision, step, and attempt; recheck the
  active generation before I/O and before persistence. Cancelled or stale work
  cannot advance state or open another provider attempt.
- URL retrieval validates every redirect and connects to the public address
  that was validated. Provider absence or disabled paid work is a typed,
  actionable state, never a silent empty success.
- Route files export only `Route`. Cross-directory imports use `@/` or
  `@convex/`.
- Keep product copy and source code in English.
- Do not edit generated Convex API or TanStack route-tree files by hand.
- Preserve `/prototype/workspace` as an explicitly labelled comparison until
  the production route passes its browser gate.
- Do not commit or push unless the user explicitly requests it.

---

## Preservation Contract

| Surface | Direction | Required preservation |
|---|---|---|
| `/workspace/start` | Modify behavior only | Existing hierarchy, evidence-layer composition, compact composer, toolbar, spacing, and visual language |
| `ResearchComposer` | Modify behavior only | Company picker, research direction, reference controls, explicit Continue/Back transition, and pop/fade motion |
| `SmoothDropdown` | Preserve shared defaults | Consumer supplies local stacking; search returns selectable candidates and never auto-selects |
| `WorkbenchShell` | Modify data only | Existing shell composition, responsive account controls, navigation placement, and route-aware state |
| `AnalyzedCompanyList` | Modify data/navigation only | Existing Qatalog-inspired desktop list, mobile `NestedMenu`, separators, active indicator, and compact new-analysis action |
| Dossier `CutoutCard` and skeleton | Preserve | Media, overlay, cutouts, pin, inset label, staggered content, footer, hover/focus action, and matching loading geometry |
| Persistent workspace rail | Modify state only | Six visible sections, responsive contextual panel/drawer, and persisted active/completed/locked states |
| Shared UI primitives | Preserve neutral API | No global default introduced to repair one consumer |

Any structural, visual, motion, or affordance change outside this table requires
an explicit user decision and a plan revision before code changes. Removing an
unsupported transport must not remove a supported intent: public HTTPS
references remain available although local upload is excluded.

Before modifying a listed surface, capture its current browser state at desktop
and narrow mobile sizes. After implementation, compare the same states and
verify keyboard focus, hover/focus actions, reduced motion when relevant,
loading geometry, and console output. Component tests alone do not authorize a
visual divergence.

## Non-goals

- Redesigning the Start page, composer, Workbench Shell, dossier cards, or
  workspace navigation.
- Replacing established shared primitives with simpler local markup.
- Adding local file/PDF upload, a general-purpose crawler, chat-first UI, or
  simulated workflow activity.
- Exposing internal architecture, access topology, provider configuration, raw
  errors, or workflow mechanics in analyst-facing copy.

## Runtime Responsibility Map

```text
TanStack Start web runtime
├── React rendering and hydration
├── typed routes, loaders, navigation, and route-level UI guards
├── SSR and web-request middleware
└── web-only server functions or server routes when explicitly required
              │
              │ generated Convex client and React hooks
              ▼
Convex public API
├── queries: reactive, owner-authorized projections
├── mutations: atomic domain transitions and persistence
├── actions: authenticated external I/O orchestration
└── workflows: durable post-confirmation steps, retries, and human checkpoints
              │
              │ application-owned interfaces
              ▼
convex/integrations/*
├── SEC HTTP transport
├── Exa SDK transport
└── URL metadata transport
```

The integration modules are plain TypeScript infrastructure boundaries. They
must not register public Convex functions, read or write the database, or expose
SDK response types to workflow or domain code. A Convex Action constructs the
production adapter, supplies explicit dependencies such as `fetch`, SDK
clients, configuration, clocks, and persistence callbacks, and maps the typed
result into internal mutations.

This separation is intentional:

- TanStack Start does not become a second backend or state authority merely
  because it supports server functions.
- Convex Actions own nondeterministic external calls because their results,
  attempts, rate limits, and lifecycle effects belong to the persisted run.
- Convex mutations remain deterministic and transactional; they never call
  SEC, Exa, or another external provider.
- Convex Workflow begins only after confirmation in Task 4. The Task 3
  preflight is a synchronous Convex Action with persisted telemetry, not a
  durable workflow.

## Public Interfaces Locked by This Plan

```ts
type CoveragePreset =
    | 'balanced'
    | 'first_party_depth'
    | 'independent_scrutiny';

type CompanyPreflightResult = {
    preflightId: Id<'companyPreflights'>;
    company: {
        legalName: string;
        ticker: string;
        exchange: string;
        cik: string;
        investorRelationsUrl?: string;
    };
    expiresAt: number;
};

type ConfirmAndStartInput = {
    preflightId: Id<'companyPreflights'>;
    idempotencyKey: string;
    coveragePreset: CoveragePreset;
    researchAngle?: string;
};

type SufficiencyDecision =
    | { kind: 'recheck'; decisionKey: string }
    | {
          kind: 'force_continue';
          decisionKey: string;
          reason: string;
      }
    | {
          kind: 'complete_insufficient';
          decisionKey: string;
          reason: string;
      };

type SourceReviewDecision = 'accepted' | 'rejected' | 'pending';
```

Public Convex boundaries:

```ts
api.companyResolution.search({ query })
api.companyResolution.preflight({ cik })
api.researchLaunch.confirmAndStart(input)
api.researchRuns.getMine({ runId })
api.researchRuns.listMine({})
api.evidenceSufficiency.decide({ runId, decision })
api.sources.addManualUrl({ runId, corpusRevisionId, url })
api.sources.decide({
    runId,
    corpusRevisionId,
    sourceId,
    decision,
    decisionKey,
    reason,
})
api.sources.listForReview({ runId, corpusRevisionId })
api.sources.approveCorpusRevision({
    runId,
    corpusRevisionId,
    decisionKey,
})
api.adminOperations.get({})
api.adminOperations.setPaidWorkEnabled({ enabled, reason })
```

The run-detail route is `/workspace/$runId` with validated search:

```ts
type WorkspaceSection =
    | 'progress'
    | 'sources'
    | 'evidence'
    | 'assessment'
    | 'map'
    | 'brief';
```

## Security and Durable-Execution Matrix

| Boundary | Authorization and validation before I/O | Durable identity and concurrency | Cancellation, retry, and failure outcome | Required proof |
|---|---|---|---|---|
| SEC company search and preflight | Public search remains bounded and validates normalized input; preflight validates CIK and output shape before persistence | Stable company identity is CIK; operation records use the normalized request and attempt, while ticker and name remain revalidated metadata | Bounded timeout and retry; typed unavailable, malformed-response, and rate-limited results; no raw provider error in public copy | Adapter tests plus a bounded live lookup by known CIK; live assertions do not pin mutable ticker metadata |
| Exa source discovery | Run ownership and active generation are checked before SDK construction or request dispatch | Lease key includes run, workflow version, generation, corpus revision, query step, and attempt; duplicate execution cannot issue a second paid call | Application-owned retry/fallback ceiling; cancellation and generation are rechecked before persistence; missing configuration and partial results remain typed and visible | Negative spies for unauthorized, cancelled, stale, and duplicate attempts; bounded live call only after explicit approval |
| Analyst-added public HTTPS source | Run ownership is checked before DNS or HTTP; scheme, host, resolved addresses, response size/type, and every redirect are validated | Operation key binds the source URL to run, generation, corpus revision, step, and attempt; replay returns the durable result | Connect to the validated public address with the original host/SNI; reject private or changed destinations; cancellation or stale generation cannot persist metadata or advance the run | Deterministic DNS-rebinding, private-redirect, replay, timeout, and oversized-response tests with zero-I/O assertions on rejected authorization |
| Sufficiency recheck or forced continuation | Owner, decision payload, current checkpoint, and latest corpus revision are validated in the mutation | The same mutation atomically claims the visitor's single running slot and increments the execution generation | A competing run leaves this run paused; late work from the prior generation is ignored; retries reuse the durable decision result | Convex concurrency tests for recheck, force, competing run, duplicate decision key, cancellation, and late persistence |
| Corpus approval and workflow resume | Owner and complete source-review state are validated before transition | Approval decision and running-slot claim are atomic; the resumed generation is persisted before scheduling work | Duplicate approval is idempotent; stale or cancelled callbacks cannot emit later events or start extraction | Convex tests for incomplete review, foreign run, duplicate approval, competing run, stale callback, and single resume |

No task may weaken these rows to accommodate a provider SDK. Provider-specific
types stay inside `convex/integrations/*`; durable domain records retain the
application-owned operation identity and typed outcome.

## User-Facing Copy Contract

| Durable or provider state | Analyst-facing message | Available next action | Must never be rendered |
|---|---|---|---|
| Company lookup temporarily unavailable | The company directory could not be checked right now; no dossier was started | Retry the lookup or return to the current workspace | Provider code, endpoint, request ID, stack trace, environment-variable name |
| Discovery unavailable because paid work is disabled or unconfigured | Source discovery is not available for this run yet | Return later, review already available sources, or use an enabled analyst action | API-key name, deployment configuration, quota mechanics, internal workflow state |
| Partial discovery result | Some candidate sources are ready for review; the missing portion is identified without overstating coverage | Review the available sources, retry the failed portion when permitted, or add public HTTPS sources | Raw SDK response, prompt, provider retry counters, internal event keys |
| Insufficient public evidence | The current public evidence cannot support a reliable assessment | Recheck after adding sources, continue with an audited reason, or complete as insufficient | Model self-confidence, fabricated score, backend enum, persistence mechanics |
| Corpus ready for analyst approval | Candidate sources have been reviewed and the accepted set is ready to lock | Approve the corpus or revise a source decision | Extraction internals, hidden reasoning, future roadmap phases |
| Access required or role mismatch | Access is required for this workspace, or this account cannot open the requested area | Enter the reusable access code, reconnect, sign out, or return to the permitted area | Access-code inventory, digests, anonymous-session mechanics, role topology |

Presentation tests must assert both the actionable message and the absence of
the forbidden details. Protected administration may show secondary diagnostic
detail only after a readable status and only when the role permits it.

## Verification Matrix

| Exit criterion | Deterministic proof | Browser proof | Live proof | Blocking condition |
|---|---|---|---|---|
| Public Start preserves the accepted composition while using real company candidates | Route and component tests cover explicit selection, multiple HTTPS references, access drawer, and absence of auto-selection | Fresh desktop and narrow-mobile snapshots; keyboard, focus, hover, Back/Continue motion, reduced motion, and console checks | SEC lookup by known CIK after deterministic gates | Any unapproved visual restructuring, missing reference affordance, simulated state, or console error |
| Admission, reconnection, and role routing match the reusable access-code contract | Convex and route tests cover public anonymous Start, admission confirmation, logout, stable visitor rebind, analyst route, and administrator route | Exercise the whole journey as the intended analyst and administrator roles | Deployment smoke test with configured reusable code, without printing it | Testing only a public page, mocked context, or unauthenticated rejection |
| Workflow reaches durable human checkpoints without duplicate work | Convex tests cover atomic slot claims, idempotency, generation checks, cancellation, late results, and persisted events | Observe persisted progress, sufficiency actions, source review, approval, and `corpus_approved` after reload | One explicitly approved bounded Exa run with recorded request count and latency | Duplicate provider call, state advanced by stale work, or UI activity not backed by persisted events |
| Public URLs are retrieved without SSRF or replay gaps | Adapter/action tests cover authorization-before-I/O, DNS rebinding, every redirect, size/type/time limits, replay, and cancellation | Add and review more than one valid HTTPS source; verify inline actionable failures | Optional bounded public URL fetch after deterministic safety gates | A second unvalidated DNS resolution, private redirect, or provider I/O before authorization |
| Existing workbench and dossier surfaces remain visually intact | Component tests preserve owned slots, states, source selection, and neutral primitive defaults | Before/after desktop and mobile evidence for the rail, shell, source panel, dossier card, isomorphic skeleton, keyboard, hover, focus, reduced motion, and console | Not required | Replacement by generic cards/navigation/skeletons or a consumer-specific global primitive default |
| Full quality gate remains honest | Focused suites, affected suites, then all commands in `context/TECH.md` with failures attributed | Critical journey uses real protected routes and removes temporary QA fixtures | Live gates remain separately reported and bounded | Targeted green tests used to claim completion while required full, browser, or live gates are missing |

---

### Task 0: Establish an Honest Baseline Gate

**Files:**

- Inspect: `package.json`
- Inspect: `vitest.config.ts`
- Inspect: `src/__tests__/convex/access/private-access.test.ts`
- Inspect: `src/__tests__/convex/workflows/durable-workflow.test.ts`
- Inspect: `src/__tests__/routes/start.test.tsx`

**Interfaces:**

- Consumes: the current Phase 1–3 public Convex boundaries.
- Produces: a dated baseline note in the execution handoff, not a repository
  file.

- [ ] **Step 1: Run the current focused backend baseline**

Run:

```bash
TMPDIR=/tmp TEMP=/tmp pnpm exec vitest run \
  src/__tests__/convex/access/private-access.test.ts \
  src/__tests__/convex/research-runs/research-run-persistence.test.ts \
  src/__tests__/convex/workflows/durable-workflow.test.ts
```

Expected before Phase 4 work: 3 files and 13 tests pass.

- [ ] **Step 2: Capture the project-wide baseline**

Run:

```bash
pnpm typecheck
pnpm test
pnpm convex:check
git diff --check
```

Expected at plan-authoring time:

- `pnpm convex:check` passes.
- `pnpm typecheck` reports the unrelated `IndexPage` test import and unused
  `ToolbarIconButton`.
- `pnpm test` reports existing UI/probe failures.

If these project-wide failures still exist at execution time, stop before Task
1 and ask whether to repair them as a separately reviewed prerequisite. Do not
silently absorb unrelated UI repair into Phase 4 and do not call Phase 4
complete with a failing full gate.

---

### Task 1: Add the Phase 4 Domain and Lifecycle Records

**Files:**

- Modify: `convex/domain/validators.ts`
- Modify: `convex/domain/transitions.ts`
- Modify: `convex/schema.ts`
- Modify: `convex/researchRuns.ts`
- Test: `src/__tests__/convex/research-runs/phase-4-lifecycle.test.ts`

**Interfaces:**

- Consumes: `researchRuns.reserve`, `researchRuns.transition`, append-only
  `RunEvent` and `AuditEvent`.
- Produces: typed Company, preflight, sufficiency, plan, Source,
  `CorpusRevision`, source decision, provider-call, and paid-work-control
  persistence plus the `corpus_approved` lifecycle handoff.

- [ ] **Step 1: Write the failing lifecycle test**

Create
`src/__tests__/convex/research-runs/phase-4-lifecycle.test.ts` using the existing
`convexTest(schema, import.meta.glob('/convex/**/*.ts'))` convention. Exercise
the real internal transition boundary:

```ts
import schema from '@convex/schema';
import { makeFunctionReference } from 'convex/server';
import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';

const modules = import.meta.glob('/convex/**/*.ts');

const createDraft = makeFunctionReference<
    'mutation',
    Record<string, never>,
    string
>('researchRuns:createDraft');
const transition = makeFunctionReference<
    'mutation',
    {
        runId: string;
        lifecycleState:
            | 'checking_public_evidence'
            | 'awaiting_evidence_sufficiency_review'
            | 'discovering_sources'
            | 'awaiting_source_review'
            | 'corpus_approved';
        executionStatus: 'running' | 'paused' | 'idle';
        stepKey:
            | 'check_public_evidence'
            | 'evidence_sufficiency_review'
            | 'discover_sources'
            | 'source_review';
    },
    null
>('researchRuns:transition');
const getRun = makeFunctionReference<'query', { runId: string }, unknown>(
    'researchRuns:get',
);

test('ends discovery at the corpus-approved handoff', async () => {
    const t = convexTest(schema, modules);
    const runId = await t.mutation(createDraft, {});

    await t.mutation(transition, {
        runId,
        lifecycleState: 'checking_public_evidence',
        executionStatus: 'running',
        stepKey: 'check_public_evidence',
    });
    await t.mutation(transition, {
        runId,
        lifecycleState: 'discovering_sources',
        executionStatus: 'running',
        stepKey: 'discover_sources',
    });
    await t.mutation(transition, {
        runId,
        lifecycleState: 'awaiting_source_review',
        executionStatus: 'paused',
        stepKey: 'source_review',
    });
    await t.mutation(transition, {
        runId,
        lifecycleState: 'corpus_approved',
        executionStatus: 'idle',
        stepKey: 'source_review',
    });

    await expect(t.query(getRun, { runId })).resolves.toMatchObject({
        lifecycleState: 'corpus_approved',
        executionStatus: 'idle',
    });
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
TMPDIR=/tmp TEMP=/tmp pnpm exec vitest run \
  src/__tests__/convex/research-runs/phase-4-lifecycle.test.ts
```

Expected: FAIL because the new validators and lifecycle states do not exist.

- [ ] **Step 3: Add the closed unions and transition graph**

Add `coveragePresetValidator` and these lifecycle, step, event, and audit
members:

```ts
export const coveragePresetValidator = v.union(
    v.literal('balanced'),
    v.literal('first_party_depth'),
    v.literal('independent_scrutiny'),
);

// ResearchRun lifecycle
v.literal('checking_public_evidence');
v.literal('awaiting_evidence_sufficiency_review');
v.literal('corpus_approved');

// Workflow step keys
v.literal('check_public_evidence');
v.literal('evidence_sufficiency_review');

// Run events
v.literal('company_confirmed');
v.literal('evidence_sufficiency_evaluated');
v.literal('research_plan_created');
v.literal('source_discovery_progress');
v.literal('corpus_revision_approved');

// Audit actions
v.literal('company_confirmed');
v.literal('evidence_sufficiency_overridden');
v.literal('evidence_sufficiency_completed');
v.literal('source_decided');
v.literal('manual_source_added');
v.literal('corpus_revision_approved');
v.literal('paid_work_toggled');
```

Replace the single `nextLifecycle` lookup with an explicit allowed-edge table:

```ts
const allowedTransitions: Record<
    ResearchRunLifecycle,
    ReadonlyArray<ResearchRunLifecycle>
> = {
    draft: ['checking_public_evidence'],
    checking_public_evidence: [
        'awaiting_evidence_sufficiency_review',
        'discovering_sources',
    ],
    awaiting_evidence_sufficiency_review: [
        'checking_public_evidence',
        'discovering_sources',
        'completed',
    ],
    discovering_sources: ['awaiting_source_review'],
    awaiting_source_review: ['corpus_approved'],
    corpus_approved: ['extracting_evidence', 'awaiting_source_review'],
    extracting_evidence: ['assessing_dimensions'],
    assessing_dimensions: ['awaiting_assessment_review'],
    awaiting_assessment_review: ['completed', 'awaiting_source_review'],
    completed: ['awaiting_source_review'],
};
```

Map `corpus_approved` to `idle` and
`awaiting_evidence_sufficiency_review` to `paused`. Keep completion outcome
validation separate from lifecycle validation.

- [ ] **Step 4: Add the Phase 4 tables and indexes**

Add exactly these records to `convex/schema.ts`:

```ts
companies: defineTable({
    cik: v.string(),
    legalName: v.string(),
    ticker: v.string(),
    exchange: v.string(),
    investorRelationsUrl: v.optional(v.string()),
    canonicalizedAt: v.number(),
}).index('by_cik', ['cik']),

companyPreflights: defineTable({
    ownerVisitorId: v.id('visitors'),
    query: v.string(),
    companyId: v.id('companies'),
    resolverVersion: v.string(),
    status: v.union(v.literal('resolved'), v.literal('consumed')),
    expiresAt: v.number(),
    createdAt: v.number(),
}).index('by_owner_and_status', ['ownerVisitorId', 'status']),

evidenceAvailabilityEvaluations: defineTable({
    runId: v.id('researchRuns'),
    policyVersion: v.string(),
    secFilingCount: v.number(),
    investorRelationsPresent: v.boolean(),
    manualCandidateCount: v.number(),
    outcome: v.union(
        v.literal('sufficient'),
        v.literal('insufficient'),
    ),
    reasons: v.array(v.string()),
    createdAt: v.number(),
}).index('by_run', ['runId']),

researchPlans: defineTable({
    runId: v.id('researchRuns'),
    version: v.number(),
    coveragePreset: v.union(
        v.literal('balanced'),
        v.literal('first_party_depth'),
        v.literal('independent_scrutiny'),
    ),
    researchAngle: v.optional(v.string()),
    queries: v.array(
        v.object({
            query: v.string(),
            category: v.string(),
            dimensionKeys: v.array(v.string()),
        }),
    ),
    createdAt: v.number(),
}).index('by_run_and_version', ['runId', 'version']),

sources: defineTable({
    runId: v.id('researchRuns'),
    canonicalUrl: v.string(),
    title: v.string(),
    origin: v.union(
        v.literal('sec'),
        v.literal('exa'),
        v.literal('analyst_url'),
    ),
    category: v.string(),
    publishedAt: v.optional(v.number()),
    providerReference: v.optional(v.string()),
    createdAt: v.number(),
}).index('by_run_and_url', ['runId', 'canonicalUrl']),

corpusRevisions: defineTable({
    runId: v.id('researchRuns'),
    revision: v.number(),
    status: v.union(v.literal('draft'), v.literal('approved')),
    approvedByVisitorId: v.optional(v.id('visitors')),
    approvedAt: v.optional(v.number()),
    createdAt: v.number(),
}).index('by_run_and_revision', ['runId', 'revision']),

sourceDecisions: defineTable({
    runId: v.id('researchRuns'),
    corpusRevisionId: v.id('corpusRevisions'),
    sourceId: v.id('sources'),
    decisionKey: v.string(),
    decision: v.union(
        v.literal('accepted'),
        v.literal('rejected'),
        v.literal('pending'),
    ),
    reviewerVisitorId: v.optional(v.id('visitors')),
    supersedesDecisionId: v.optional(v.id('sourceDecisions')),
    reason: v.optional(v.string()),
    occurredAt: v.number(),
})
    .index('by_revision_and_source', ['corpusRevisionId', 'sourceId'])
    .index('by_run_and_decision_key', ['runId', 'decisionKey']),

providerCalls: defineTable({
    runId: v.optional(v.id('researchRuns')),
    service: v.union(
        v.literal('sec'),
        v.literal('exa'),
        v.literal('url_metadata'),
    ),
    operation: v.string(),
    operationKey: v.string(),
    status: v.union(
        v.literal('started'),
        v.literal('succeeded'),
        v.literal('failed'),
    ),
    attempt: v.number(),
    latencyMs: v.optional(v.number()),
    usage: v.optional(v.any()),
    reportedCost: v.optional(v.number()),
    errorCode: v.optional(v.string()),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
}).index('by_operation_key', ['operationKey']),

providerRateLimits: defineTable({
    provider: v.literal('sec'),
    nextAllowedAt: v.number(),
}).index('by_provider', ['provider']),

paidWorkControls: defineTable({
    key: v.literal('global'),
    enabled: v.boolean(),
    updatedByVisitorId: v.optional(v.id('visitors')),
    reason: v.optional(v.string()),
    updatedAt: v.number(),
}).index('by_key', ['key']),
```

Extend `researchRuns` with:

```ts
companyId: v.optional(v.id('companies')),
companyPreflightId: v.optional(v.id('companyPreflights')),
coveragePreset: v.optional(coveragePresetValidator),
researchAngle: v.optional(v.string()),
activeCorpusRevisionId: v.optional(v.id('corpusRevisions')),
completionOutcome: v.optional(
    v.union(
        v.literal('completed_assessment'),
        v.literal('insufficient_public_evidence'),
    ),
),
executionGeneration: v.number(),
```

Add indexes `researchRuns.by_owner_and_execution_status` and
`corpusRevisions.by_run_and_revision`.

Extend `runEvents` with bounded observable progress fields:

```ts
messageKey: v.optional(v.string()),
current: v.optional(v.number()),
total: v.optional(v.number()),
failureCode: v.optional(v.string()),
```

These fields carry counts and failure codes only, never prompts or model
reasoning.

- [ ] **Step 5: Make existing run creators supply `executionGeneration: 0`**

Update `reserve` and `createDraft` without changing their public behavior.

- [ ] **Step 6: Verify GREEN and the affected lifecycle suite**

Run:

```bash
TMPDIR=/tmp TEMP=/tmp pnpm exec vitest run \
  src/__tests__/convex/research-runs/phase-4-lifecycle.test.ts \
  src/__tests__/convex/research-runs/research-run-persistence.test.ts
```

Expected: both files pass with no warning.

---

### Task 2: Enforce Public HTTPS URL Safety

**Files:**

- Modify: `convex/domain/publicSourceUrl.ts`
- Modify: `convex/sourceActions.ts`
- Test: `src/__tests__/convex/sources/public-source-url.test.ts`

**Interfaces:**

- Consumes: analyst-provided URL strings.
- Produces:

```ts
type PublicSourceTarget = {
    canonicalUrl: string;
    hostname: string;
    approvedAddresses: ReadonlyArray<string>;
};

async function validatePublicSourceUrl(
    rawUrl: string,
    resolveAddresses: (hostname: string) => Promise<ReadonlyArray<string>>,
): Promise<PublicSourceTarget>;
```

- [ ] **Step 1: Write parameterized RED tests**

Cover:

```ts
test.each([
    'http://example.com/report',
    'https://user:pass@example.com/report',
    'https://127.0.0.1/report',
    'https://[::1]/report',
    'https://169.254.169.254/latest/meta-data',
    'https://10.0.0.4/report',
    'https://192.168.1.3/report',
])('rejects unsafe URL %s', async (url) => {
    await expect(
        validatePublicSourceUrl(url, async () => ['93.184.216.34']),
    ).rejects.toThrow();
});

test('canonicalizes a public HTTPS URL', async () => {
    await expect(
        validatePublicSourceUrl(
            'https://Example.com:443/report#section',
            async () => ['93.184.216.34'],
        ),
    ).resolves.toEqual({
        canonicalUrl: 'https://example.com/report',
        hostname: 'example.com',
        approvedAddresses: ['93.184.216.34'],
    });
});

test('rejects a hostname resolving to a private address', async () => {
    await expect(
        validatePublicSourceUrl('https://example.com/report', async () => [
            '10.0.0.1',
        ]),
    ).rejects.toThrow('public network');
});

test('connects to the validated public address instead of resolving again', async () => {
    const target = await validatePublicSourceUrl(
        'https://example.com/report',
        async () => ['93.184.216.34'],
    );
    const attempts: Array<{ address: string; servername: string }> = [];

    await expect(fetchPublicSourceMetadata(target, {
        connect: async ({ address, servername }) => {
            attempts.push({ address, servername });
            throw new Error('expected test stop');
        },
    })).rejects.toThrow('expected test stop');
    expect(attempts).toEqual([
        { address: '93.184.216.34', servername: 'example.com' },
    ]);
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
TMPDIR=/tmp TEMP=/tmp pnpm exec vitest run \
  src/__tests__/convex/sources/public-source-url.test.ts
```

Expected: FAIL because `publicSourceUrl.ts` is absent.

- [ ] **Step 3: Implement the pure validator**

Use `URL`, `node:net`, and injected DNS resolution. Reject non-HTTPS schemes,
credentials, non-default ports, localhost, IP literals in prohibited ranges,
and any DNS result that is loopback, link-local, private, reserved, multicast,
or unspecified. Remove fragments and the default port from the canonical URL.

Keep DNS and network I/O in the `"use node"` action module. Fetch metadata with
`redirect: 'manual'`, validate each redirect through the same function, cap
redirects at 5, response bytes at 2 MiB, and timeout at 10 seconds. Persist no
body before corpus approval. Connect each request to one of the public addresses
returned by validation while preserving the original hostname for HTTP Host and
TLS SNI. Do not validate an address and then let `fetch` perform an unrelated
DNS lookup.

The public action must authorize the visitor and run ownership before DNS or
HTTP work. Add a negative action test whose DNS and fetch spies remain untouched
for an unknown or foreign run. Provider-call telemetry and the operation lease
are created only after authorization succeeds.

- [ ] **Step 4: Verify GREEN**

Run the focused file and expect all cases to pass.

---

### Task 3: Resolve and Persist Company Preflights Through SEC

**Files:**

- Modify: `convex/integrations/sec.ts`
- Modify: `convex/providerCalls.ts`
- Modify: `convex/companyResolution.ts`
- Modify: `convex/schema.ts`
- Test: `src/__tests__/convex/company-resolution/company-preflight.test.ts`
- Test: `src/__tests__/convex/integrations/sec-adapter.test.ts`

**Interfaces:**

- Consumes: a partial company name, ticker, CIK, or SEC company URL for search,
  followed by an explicitly selected CIK for preflight.
- Produces: a bounded list of `SecCompanyMatch` candidates, then
  `CompanyPreflightResult`.
- Runtime ownership:
    - `convex/integrations/sec.ts` implements the external transport and mapping
      only. It has no Convex registration and no database access.
    - `convex/companyResolution.ts` exports the anonymous-Auth-backed public
      Convex Action and composes the production adapter. Access-code admission
      is not required for this non-billable boundary.
    - `convex/providerCalls.ts` exposes internal mutations for atomic rate-limit
      reservations and attempt persistence.
    - TanStack Start calls the generated Convex action directly; it does not
      repeat or proxy this orchestration in a server function.
- Provider contract:

```ts
type SecCompanyMatch = {
    cik: string;
    legalName: string;
    ticker: string;
    exchange: string;
    investorRelationsUrl?: string;
};

interface SecCompanyResolver {
    search(query: string): Promise<ReadonlyArray<SecCompanyMatch>>;
    revalidate(cik: string): Promise<SecCompanyMatch>;
}
```

- [ ] **Step 1: Write the preflight service and persistence RED tests**

Test the exported application service with an injected `SecCompanyResolver`,
then authenticate an anonymous Convex Auth identity and exercise the real
internal persistence mutation with that typed result. Do not expose a test-only
Convex action.
Assert:

```ts
await expect(analyst.action(searchCompanies, { query: 'CCC' })).resolves.toEqual([
    expect.objectContaining({
        legalName: 'CCC Intelligent Solutions Holdings Inc.',
        cik: '1818201',
        ticker: expect.any(String),
        exchange: expect.any(String),
    }),
]);

await expect(
    analyst.action(preflightCompany, { cik: '1818201' }),
).resolves.toMatchObject({
    company: {
        legalName: 'CCC Intelligent Solutions Holdings Inc.',
        cik: '1818201',
        ticker: expect.any(String),
        exchange: expect.any(String),
    },
});
```

Also assert unauthenticated rejection, empty search rejection, partial-name
matching, ticker/CIK/SEC-URL matching, explicit CIK revalidation, and a finite
expiration timestamp. CIK is the stable assertion. Ticker and exchange are
revalidated metadata and must not be pinned to a recalled live value.

- [ ] **Step 2: Verify RED**

Expected: FAIL because no company preflight boundary exists.

- [ ] **Step 3: Implement provider-call persistence and the SEC adapter**

Use SEC's company ticker/submission JSON endpoints through server-side `fetch`.
Set a configured identifying `User-Agent` containing application identity and
contact. Add an atomic provider-rate-limit reservation that spaces aggregate SEC
requests by at least 125 ms. Persist started/succeeded/failed `ProviderCall`
records around each request.

Keep CIK, SEC URL, and exact ticker paths deterministic. Normalize legal names
for punctuation, spacing, diacritics, and compact-word comparison. Use Fuse.js
only when deterministic company-name matching returns no result, with bounded
token search, a tested score cutoff, and no fuzzy matching for short tickers.
Deterministic matches must never be polluted with fuzzy candidates. Cover
spaced, concatenated, misspelled, and false-positive company-name cases.

Keep the transport in `convex/integrations/sec.ts`. Export a factory that accepts
`fetch`, clock, user-agent, rate-limit reservation, and attempt-recorder
dependencies and returns `SecCompanyResolver`. The adapter must return only
`SecCompanyMatch`; SEC response types must not escape the integration module.
The reservation and recorder dependencies call internal Convex mutations from
the Action context because the adapter itself has no `ActionCtx` or database
authority.

- [ ] **Step 4: Implement the public preflight action**

Authenticate the anonymous Convex Auth identity without requiring an admitted
visitor. The search Action normalizes a query to 1–160 characters and returns
at most eight ranked SEC-index candidates without persisting a selection or
revalidating every result. The preflight Action accepts only the explicitly
selected CIK, revalidates that company through SEC submissions data, upserts it
by CIK, and inserts a 15-minute `companyPreflights` record owned by that Auth
user. Do not reserve an analysis or start a workflow. Keep both orchestrations
in exported functions that accept `SecCompanyResolver`; the public Convex
Actions supply the production SEC adapter and deterministic tests supply a
fake.

Map configuration, provider, and authorization failures to typed application
errors. The Start presentation boundary translates them into actionable
analyst copy; it never renders raw Convex messages, request IDs, function names,
or environment-variable instructions.

The Action uses `ctx.runMutation` for rate-limit reservations, provider-call
attempts, and final preflight persistence. It does not write the database
directly. Do not add a TanStack Start server function: Task 8 invokes
`api.companyResolution.search` and `api.companyResolution.preflight` through the
generated Convex client.

- [ ] **Step 5: Verify GREEN**

Run both company-resolution and SEC-adapter test files. Provider tests inject
`fetch` and the clock; they do not access sec.gov.

---

### Task 4: Confirm, Reserve, Revalidate, and Enforce One Running Workflow

**Files:**

- Modify: `convex/researchLaunch.ts`
- Modify: `convex/researchRuns.ts`
- Modify: `convex/workflowControls.ts`
- Modify: `convex/researchWorkflow.ts`
- Test: `src/__tests__/convex/research-runs/research-launch.test.ts`
- Test: `src/__tests__/convex/access/private-access.test.ts`

**Interfaces:**

- Consumes: an unexpired owned preflight, idempotency key, coverage preset, and
  optional research angle.
- Produces: `{ runId, remainingAnalyses }`.

- [ ] **Step 1: Write the launch tracer RED test**

Through the public `researchLaunch.confirmAndStart` action, assert that a valid
owned preflight:

1. consumes the preflight once;
2. reserves exactly one analysis;
3. binds the canonical company and coverage preset to the run;
4. starts workflow version 2 and execution generation 1;
5. revalidates the CIK before evidence checks.

Use the reusable access-code admission helper pattern from ADR-014 and a
deterministic resolver. Do not recreate one-time invitation semantics in tests.

- [ ] **Step 2: Write the concurrency RED test**

Create two distinct valid preflights for the same visitor and start them with
`Promise.allSettled`. Assert exactly one run reaches `running`. Move that run to
a human-paused sufficiency state and assert the second launch may then start.

- [ ] **Step 3: Verify RED**

Expected: FAIL because reserve accepts no company binding and no running guard
exists.

- [ ] **Step 4: Implement atomic confirmation and reservation**

Move the quota increment and run creation into an internal mutation that:

- validates active visitor ownership and preflight expiry/status;
- checks `researchRuns.by_owner_and_execution_status` for `running`;
- deduplicates by owner plus idempotency key;
- marks the preflight consumed;
- creates the company-bound run and draft `CorpusRevision 1`;
- records `analysis_reserved` and `company_confirmed` audit events.

Trim research angle to 500 characters. Do not let it alter dimensions or policy.

- [ ] **Step 5: Make `startReserved` claim the running slot atomically**

In the same mutation that calls `workflow.start`, set
`executionStatus: 'running'`, increment `executionGeneration`, and persist
workflow version 2. A concurrent start must observe the first running record.

- [ ] **Step 6: Revalidate inside the workflow**

The first workflow action calls `SecCompanyResolver.revalidate(cik)`. On CIK or
listing mismatch, persist a typed failure and stop; do not silently replace the
confirmed company.

- [ ] **Step 7: Verify GREEN**

Run research-launch, private-access, and durable-workflow suites.

---

### Task 5: Implement the Public-Evidence Sufficiency Checkpoint

**Files:**

- Modify: `convex/domain/evidenceAvailabilityPolicy.ts`
- Modify: `convex/evidenceSufficiency.ts`
- Modify: `convex/workflow.ts`
- Modify: `convex/researchWorkflow.ts`
- Modify: `convex/domain/validators.ts`
- Test: `src/__tests__/convex/workflows/evidence-sufficiency.test.ts`

**Interfaces:**

- Consumes: authoritative company metadata, available SEC filing metadata,
  investor-relations presence, and validated manual URL candidate count.
- Produces: a versioned deterministic evaluation and one of
  `sufficient | insufficient`.

- [ ] **Step 1: Write one RED test for each observable branch**

Use deterministic availability inputs:

- sufficient → workflow continues to `discovering_sources`;
- insufficient → workflow pauses at
  `awaiting_evidence_sufficiency_review`;
- `force_continue` without a reason of at least 12 characters is rejected;
- justified `force_continue` continues and persists an audit event;
- `complete_insufficient` ends with lifecycle `completed` and
  `completionOutcome = insufficient_public_evidence`;
- `recheck` returns to `checking_public_evidence` without consuming another
  analysis;
- `recheck` and `force_continue` atomically reclaim the visitor's running slot,
  increment the execution generation, and remain paused if another run is
  already running;
- cancellation before or during resume prevents an event or late result from
  advancing the run.

- [ ] **Step 2: Verify RED**

Expected: FAIL because the checkpoint and event do not exist.

- [ ] **Step 3: Implement policy version `public-evidence-v1`**

Keep the policy pure and code-defined. It returns normalized metrics, bounded
reason codes, and an outcome. It never accepts model confidence.

- [ ] **Step 4: Add the durable event**

Define:

```ts
export const evidenceSufficiencyDecided = defineEvent({
    name: 'evidenceSufficiencyDecided',
    validator: v.union(
        v.object({
            kind: v.literal('recheck'),
            decisionId: v.id('checkpointDecisions'),
        }),
        v.object({
            kind: v.literal('force_continue'),
            decisionId: v.id('checkpointDecisions'),
        }),
        v.object({
            kind: v.literal('complete_insufficient'),
            decisionId: v.id('checkpointDecisions'),
        }),
    ),
});
```

Extend checkpoint decision storage to include the typed decision and reason.
Persist an append-only audit record before sending the event.

- [ ] **Step 5: Implement the workflow loop**

After each `recheck`, recompute availability using the new validated manual
candidate count. On force, proceed without changing the policy result. On
completion, set the honest completion outcome and return.

The same mutation that resumes executable work must claim the visitor's
`running` slot and advance the execution generation before sending the workflow
event. The workflow validates that generation before its next external call and
before persistence. A competing run or cancellation leaves the checkpoint
intact and records no false progress.

- [ ] **Step 6: Verify GREEN**

Run the focused workflow test with fake timers and
`finishAllScheduledFunctions`.

---

### Task 6: Build the Research Plan and Discover Source Metadata

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `convex/domain/researchPlan.ts`
- Modify: `convex/integrations/exa.ts`
- Modify: `convex/researchPlanning.ts`
- Modify: `convex/sourceDiscovery.ts`
- Modify: `convex/researchWorkflow.ts`
- Test: `src/__tests__/convex/research-plans/research-plan.test.ts`
- Test: `src/__tests__/convex/integrations/exa-adapter.test.ts`
- Test: `src/__tests__/convex/sources/source-discovery.test.ts`

**Interfaces:**

- Consumes: company, ten fixed dimensions, optional research angle, and one
  coverage preset.
- Produces: a versioned plan and metadata-only source candidates in draft
  `CorpusRevision 1`.

- [ ] **Step 1: Install the verified SDK**

Run:

```bash
pnpm add exa-js@2.16.0
```

Expected: `package.json` and `pnpm-lock.yaml` contain the exact version.

- [ ] **Step 2: Write the deterministic plan RED test**

Assert `balanced` produces regulatory, investor-relations, official-product,
official-commercial, and independent-analysis queries covering all ten
dimension keys. Assert `first_party_depth` and `independent_scrutiny` change
priority/query budgets but never remove regulatory or counter-evidence
coverage. Assert the optional angle appears only as a query qualifier.

- [ ] **Step 3: Write the Exa boundary RED test**

Inject a fake Exa client and assert the adapter passes:

```ts
{
    type: 'auto',
    numResults: configuredLimit,
    contents: false,
}
```

Assert the adapter maps URL, title, published date, and provider reference into
application-owned candidate metadata. It must not persist snippets as evidence.
Also assert:

- missing Exa configuration produces typed `exa_not_configured` blocked or
  reviewable state rather than an empty successful discovery;
- a started operation lease prevents the same external call from executing
  twice;
- cancellation or generation change during the call rejects the late result
  and opens no fallback or retry attempt;
- partial query failure remains visible while unrelated successful metadata is
  preserved.

- [ ] **Step 4: Verify RED**

Run the three focused files. Expected: missing plan/discovery modules.

- [ ] **Step 5: Implement the pure plan builder**

Use the ten fixed dimensions and the source-priority policy. Bound the angle,
query count, results per query, and total candidates through configuration.

- [ ] **Step 6: Implement SEC and Exa discovery adapters**

SEC supplies filing metadata. Exa uses `exa.search(query, { contents: false })`.
Deduplicate candidates by canonical URL before persistence. Record every
attempt in `ProviderCall`.

Keep `convex/integrations/exa.ts` transport-only: inject the Exa client, map SDK
responses into application-owned candidate metadata, and expose no Convex
function or SDK type. `sourceDiscovery.ts` is the Action/workflow boundary that
records attempts and passes mapped candidates to internal persistence
mutations. Do not introduce a TanStack Start server-function path for discovery.

Before each call, authorize the run and reserve an operation lease keyed by
run, workflow version, execution generation, corpus revision, query/step, and
attempt. Recheck the active generation before candidate persistence. Bounded
fallback may start only when the same active generation permits it; a cancelled
or stale attempt cannot trigger another paid call.

- [ ] **Step 7: Persist candidates as pending decisions**

For every new source, insert a `pending` `SourceDecision` tied to the draft
revision. Repeated discovery with the same operation key must not duplicate a
source or decision.

- [ ] **Step 8: Emit real progress**

Emit persisted `RunEvent` records for plan creation, discovery start, query
completion counts, partial failures, and total candidates. Do not emit prompts,
reasoning, or synthetic percentages.

- [ ] **Step 9: Verify GREEN**

Run plan, adapter, source-discovery, and workflow tests. Confirm no test accesses
the network. Include cancellation-during-call, duplicate-attempt,
missing-configuration, and late-result regression cases.

---

### Task 7: Review Sources, Add HTTPS URLs, and Approve Corpus Revision 1

**Files:**

- Modify: `convex/sources.ts`
- Modify: `convex/sourceActions.ts`
- Modify: `convex/researchWorkflow.ts`
- Modify: `convex/workflow.ts`
- Test: `src/__tests__/convex/sources/corpus-revisions.test.ts`
- Test: `src/__tests__/convex/workflows/phase-4-workflow.test.ts`

**Interfaces:**

- Consumes: owner-authorized source decisions and validated manual URLs.
- Produces: immutable approved `CorpusRevision 1` and lifecycle
  `corpus_approved` with execution `idle`.

- [ ] **Step 1: Write the corpus RED tests**

Cover:

- owner can change a source from pending to accepted or rejected by appending a
  decision;
- another visitor cannot read or decide the source;
- manual HTTPS URL becomes a pending candidate;
- multiple manual HTTPS URLs can be added without removing the existing
  reference affordance;
- unsafe/manual duplicate URL is rejected;
- a foreign or unknown run is rejected before DNS resolution or HTTP fetch;
- DNS rebinding and a redirect to a private address are rejected without a
  second unvalidated resolution;
- repeated operation key replays persisted metadata without another request;
- revision approval succeeds with accepted plus pending sources;
- accepted count must be at least one;
- rejected and pending source IDs are absent from the approved source
  projection;
- approval is idempotent by decision key;
- a second mutation cannot modify an approved revision;
- approval atomically claims the running slot before workflow resumption and
  remains reviewable if another run already owns it;
- approval transitions the run to `corpus_approved` and `idle`.

- [ ] **Step 2: Verify RED**

Expected: FAIL because public source/corpus boundaries are absent.

- [ ] **Step 3: Implement owner-authorized source projections and decisions**

Resolve the active visitor on every query, mutation, and action. Use the latest
append-only source decision per source. Reject changes to an approved revision.

- [ ] **Step 4: Implement manual URL metadata capture**

Run the Task 2 URL safety boundary, fetch bounded metadata only, deduplicate by
canonical URL, persist origin `analyst_url`, and append the initial pending
decision. Content retrieval remains forbidden. Authorize ownership before DNS
or HTTP, connect to the validated public address, validate every redirect, and
wrap the request in a replayable provider-call lease with latency and typed
failure telemetry.

- [ ] **Step 5: Implement revision approval and the workflow handoff**

In one mutation:

- verify run ownership and paused source-review state;
- verify the revision is draft and belongs to the run;
- compute accepted/rejected/pending counts from effective decisions;
- require at least one accepted source;
- atomically claim the visitor's running slot and increment execution
  generation before resuming;
- mark the revision approved and bind it to the run;
- append checkpoint and audit records;
- send a typed `corpusRevisionApproved` workflow event.

The resumed workflow verifies the approved revision ID, transitions lifecycle
to `corpus_approved` with execution `idle`, and returns successfully without
emitting extraction progress. A cancellation or generation mismatch before the
handoff leaves no late transition or duplicate event.

- [ ] **Step 6: Verify GREEN**

Run corpus-revision and end-to-end Phase 4 workflow tests. The final assertion
must show an approved revision and no `extract_evidence` step or event.

---

### Task 8: Connect the Composer to the Real Launch Boundary

**Files:**

- Preserve visual structure / Modify behavior:
  `src/components/workspace/research-composer.tsx`
- Modify: `src/components/workspace/company-resolution-card.tsx`
- Modify: `src/components/workspace/coverage-preset-picker.tsx`
- Modify: `src/components/workspace/composer-toolbar-actions.tsx`
- Modify: `src/components/workspace/invitation-access-drawer.tsx`
- Modify: `src/components/workspace/protected-workspace-route.tsx`
- Modify: `src/components/workspace/invitation-access-context.tsx`
- Preserve visual structure / Modify behavior: `src/routes/workspace/start.tsx`
- Modify: `src/routes/workspace/_protected/route.tsx`
- Test: `src/__tests__/routes/start.test.tsx`
- Test: `src/__tests__/routes/protected-workspace-route.test.tsx`

**Interfaces:**

- Consumes: `api.companyResolution.search`,
  `api.companyResolution.preflight`, reusable access-code admission, and
  `api.researchLaunch.confirmAndStart`.
- Produces: typed navigation to `/workspace/$runId`.
- Runtime boundary: the component uses generated Convex React hooks directly.
  TanStack Start owns rendering and navigation; it does not proxy the Convex
  Actions.

- [ ] **Step 1: Replace the local-catalog expectations with RED behavior**

Test that:

- searching by partial name, ticker, CIK, or SEC URL returns selectable company
  candidates without submitting a preflight;
- selecting a candidate explicitly submits preflight for its CIK;
- selection never changes view automatically; only Continue opens
  confirmation;
- the resolved company card displays legal name, ticker, exchange, and CIK;
- no quota is consumed before confirmation;
- the default preset is `Balanced`;
- confirming launches once and navigates by real run ID;
- field-level query errors render inline;
- provider/permission failures render an actionable inline error or non-field
  toast according to `AGENTS.md`;
- company resolution is available before access-code admission;
- confirming as an unadmitted visitor opens the access-code top drawer and
  launches only after successful reusable-code admission;
- logout followed by the same code rebinds the same stable visitor, dossiers,
  role, and quota; the previous Auth identity loses protected access;
- admitted administrators route to Operations and analysts route to Dossiers;
- protected workspace children remain unmounted until an active visitor is
  resolved;
- `ToolbarIconButton` and the reference affordance remain in their established
  position, support multiple public HTTPS URLs, and show their count;
- local file/drop/upload controls remain absent;
- analyst copy contains no invitation inventory, quota mechanics, environment
  names, provider codes, raw errors, or internal workflow literals.

- [ ] **Step 2: Verify RED**

Expected: fictional-catalog and auto-selection tests fail against the new
contract before production changes. Existing visual-preservation assertions
remain green until behavior intentionally changes.

- [ ] **Step 3: Refactor the composer into a controlled boundary**

Preserve the existing Start-page hierarchy, evidence-layer composition,
compact composer, toolbar, and motion. Do not replace them with a generic form
or a newly composed page. Use generated Convex API types; do not hand-write
server DTOs. Keep the optional research angle and company query in UI state only
until submitted. Present
coverage presets as `Balanced`, `First-party depth`, and
`Independent scrutiny`; they adjust priorities, not required workflow stages.
Invoke search, preflight, and confirmation with `useAction` against the
generated `api.companyResolution` and `api.researchLaunch` references. Do not
add `createServerFn`, an internal HTTP route, or an ad-hoc `fetch` wrapper.
Establish the anonymous Convex Auth session silently for the public Start
surface. Keep `/workspace/start` outside the pathless protected layout.

Preserve `SmoothDropdown` as a configurable shared primitive. Apply the
composer's stacking class at the composer boundary; do not add a shared z-index
default for this one toolbar. Preserve `ToolbarIconButton` and route its
reference action to the multiple-HTTPS-URL flow without reintroducing local
upload.

- [ ] **Step 4: Add the confirmation card and launch state**

Preserve layout dimensions with a skeleton during search and preflight. Require
explicit candidate selection and keep the populated composer available so the
analyst can complete the research direction and references. Only an explicit
Continue action replaces the composer in place with the confirmation controls
rather than appending them below it. Do not add numbered steps or redundant view
titles. A Back control restores the populated composer. Disable duplicate
submission only while the mutation is pending; server
idempotency remains authoritative. Request access-code admission in the shared
top drawer only at confirmation or on direct entry to a protected route. Use
pop/fade causality rather than slide motion and preserve the populated composer
on Back. Respect reduced motion.

- [ ] **Step 5: Verify access, copy, and visual preservation**

Verify analyst and administrator admission, logout/reconnection with the same
code, role destinations, protected-route gating, actionable copy, and absence
of raw technical details. Compare the pre-change and post-change Start surface
at desktop and narrow mobile sizes. Exercise keyboard selection, Continue/Back,
reference count, hover/focus states, reduced motion, and console output.

- [ ] **Step 6: Verify GREEN**

Run Start, protected-route, access-context, and Workbench Shell tests and expect
all behavior to pass without weakening existing layout or interaction
assertions.

---

### Task 9: Connect Real Workspace State Without Replacing the Existing UI

**Files:**

- Modify: `src/routes/workspace/_protected/$runId.tsx`
- Modify: `src/components/workspace/run-route-component.tsx`
- Modify: `src/components/workspace/workspace-navigation-rail.tsx`
- Modify: `src/components/workspace/run-progress.tsx`
- Modify: `src/components/workspace/source-review.tsx`
- Modify: `src/components/workspace/source-context-panel.tsx`
- Preserve visual structure / Modify data:
  `src/components/workbench-shell/workbench-shell.tsx`
- Preserve visual structure / Modify data and navigation:
  `src/components/workbench-shell/analyzed-company-list.tsx`
- Test: `src/__tests__/routes/run-workspace.test.tsx`
- Test: `src/__tests__/components/workbench-shell/analyzed-company-list.test.tsx`

**Interfaces:**

- Consumes: `api.researchRuns.getMine`, `api.researchRuns.listMyEvents`,
  `api.sources.listForReview`.
- Produces: persistent rail, real progress, dedicated source review, desktop
  context panel, and mobile drawer.

- [ ] **Step 1: Write the production-workspace RED tests**

Assert:

- all six rail sections remain visible;
- current/completed/locked states come from persisted run state;
- a locked item exposes its exact prerequisite;
- Sources is the active dedicated mode at `awaiting_source_review`;
- selected source detail opens beside the list on desktop and in a drawer on
  mobile;
- accepted/rejected/pending counts remain visible;
- approving with pending sources shows the exclusion consequence;
- `corpus_approved` displays a truthful handoff and no extraction activity;
- loading uses stable skeletons, empty is distinct, and partial discovery
  failures remain visible;
- Workbench Shell and `AnalyzedCompanyList` retain their established desktop
  and mobile composition, separators, active indicator, compact new-analysis
  action, and `NestedMenu` behavior;
- no raw provider error, event key, internal lifecycle literal, environment
  variable, quota mechanism, or “Phase 4” copy reaches the analyst;
- selecting a newly added source updates the context panel reactively.

- [ ] **Step 2: Verify RED**

Expected: route and production rail modules are absent.

- [ ] **Step 3: Create the route with only the `Route` export**

Validate `section` search against the six `WorkspaceSection` literals. Import
the route component from its sibling production component. Generate the route
tree with:

```bash
pnpm generate:routes
```

- [ ] **Step 4: Reuse visual primitives, not prototype data**

Reuse `LiquidGlassCard`, `ResizablePanelGroup`, `ScrollArea`,
`useResponsive`, `surface-floating`, and shared icons. Do not import
`prototype-data.ts`, `PrototypeNotice`, or variant-switching code.

Reuse means preserve the existing production composition and replace only
static data and inactive controls with real projections. It does not authorize
a generic rail, generic SaaS cards, a simplified header, or new local styling.
Capture the current shell and workspace before changes and list the exact
visible differences expected; when only data changes, the expected visual
difference is limited to real content and states.

- [ ] **Step 5: Make company navigation real**

Change `AnalyzedCompanyList` to owner-scoped run/company data and typed links to
`/workspace/$runId`. Remove the mock fallback from production navigation; show
loading, empty, and error states explicitly. Keep the curated showcase clearly
labelled when it is added through Phase 9 data.

Preserve the Qatalog-inspired desktop list, mobile `NestedMenu`, separators,
purple active indicator, name/ticker presentation, and compact start action.
Do not restore or invent a destructive control without a real audited server
contract. Translate loading, empty, and error states inside the same compact
navigation footprint.

- [ ] **Step 6: Verify GREEN**

Run the two focused frontend files, route generation, and import checks:

```bash
TMPDIR=/tmp TEMP=/tmp pnpm exec vitest run \
  src/__tests__/routes/run-workspace.test.tsx \
  src/__tests__/components/workbench-shell/analyzed-company-list.test.tsx
pnpm generate:routes
node --experimental-strip-types scripts/check-imports.ts
```

Then verify the real workspace in desktop and narrow mobile viewports with an
admitted analyst session. Exercise rail navigation, reactive source selection,
desktop panel/mobile drawer, keyboard focus, loading geometry, and console
output. A public Start render or mocked projection is not this gate.

---

### Task 10: Add the Minimal Admin Operations Surface

**Files:**

- Modify: `convex/adminOperations.ts`
- Modify: `src/routes/workspace/_protected/admin.tsx`
- Modify: `src/components/admin/operations-page.tsx`
- Modify: `src/components/workbench-shell/workbench-shell.tsx`
- Test: `src/__tests__/convex/admin/admin-operations.test.ts`
- Test: `src/__tests__/routes/admin-operations.test.tsx`

**Interfaces:**

- Consumes: admin role, runs, checkpoints, provider calls, quota restoration,
  and global paid-work control.
- Produces: admin-only read projection and audited paid-work switch.

- [ ] **Step 1: Write RED authorization and switch tests**

Assert analysts and anonymous users cannot read operations or change the
switch. Assert the admin can disable new paid work with a reason of at least 12
characters, the audit event is appended, existing human checkpoints remain
reviewable, and a new paid workflow step is rejected server-side.

- [ ] **Step 2: Verify RED**

Expected: admin operations boundary is absent.

- [ ] **Step 3: Implement the bounded admin projection**

Return active/running/paused/failed runs, current checkpoints, recent provider
calls with available usage/cost, and remaining visitor reservations. Do not
return secrets, prompt bodies, invitation digests, or provider credentials.

- [ ] **Step 4: Implement the UI**

Use the current visitor role to expose a typed admin link. Render an explicit
confirmation dialog for disabling paid work, inline operational errors, and the
existing audited quota-restore mutation. Do not add dynamic provider, model, or
policy editing. Keep operational copy readable first; raw diagnostic detail is
secondary and remains inside this protected administration surface.

- [ ] **Step 5: Verify GREEN**

Run the focused Convex and route tests.

---

### Task 11: Verify Live Contracts and the Honest Deployment Gate

**Files:**

- Modify: `src/__tests__/live/sec.contract.test.ts`
- Modify: `src/__tests__/live/exa.contract.test.ts`
- Modify: `.env.example`
- Modify: `context/TECH.md` only if implementation evidence changes a documented
  boundary
- Modify: `docs/ROADMAP.md` only after each exit criterion has evidence

**Interfaces:**

- Consumes: real SEC and Exa credentials/configuration only when explicitly
  enabled.
- Produces: measured provider contract evidence and a deployment-readiness
  report.

- [ ] **Step 1: Add explicit live-test guards**

Live files must exit without a provider call unless
`RUN_LIVE_PROVIDER_TESTS=1`. Bound SEC requests to one known CIK lookup and
Exa to one metadata-only query with at most two results and
`contents: false`. Assert the SEC identity and response shape without pinning a
mutable ticker. Validate that local test-process variables and Convex deployment
environment variables are configured separately; never print either value.

- [ ] **Step 2: Run focused deterministic verification**

```bash
TMPDIR=/tmp TEMP=/tmp pnpm exec vitest run \
  src/__tests__/convex/company-resolution \
  src/__tests__/convex/access \
  src/__tests__/convex/research-runs \
  src/__tests__/convex/sources \
  src/__tests__/convex/workflows \
  src/__tests__/convex/admin \
  src/__tests__/routes/start.test.tsx \
  src/__tests__/routes/protected-workspace-route.test.tsx \
  src/__tests__/routes/run-workspace.test.tsx \
  src/__tests__/routes/admin-operations.test.tsx
```

Expected: all affected deterministic tests pass with no paid requests. The
suite includes authorization-before-I/O, DNS pinning and redirects, operation
lease replay, cancellation during a provider call, generation mismatch, late
result rejection, atomic resume, missing provider configuration, access-code
rebinding, and analyst/admin authorization.

- [ ] **Step 3: Run project quality gates**

```bash
pnpm convex:check
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
git diff --check
```

Expected: every command passes. Do not weaken assertions, skip tests, or label
remaining failures as unrelated without the Task 0 baseline evidence and user
direction.

- [ ] **Step 4: Run browser verification**

Use the project's AXI-first browser procedure on desktop and a narrow mobile
viewport. Verify:

1. public Start establishes anonymous Auth without asking for a code;
2. partial name, spaced/misspelled name, ticker, CIK, and SEC URL searches show
   bounded candidates without auto-selection;
3. explicit selection stays in the composer until Continue; Back restores the
   company, direction, and references;
4. multiple HTTPS references and their toolbar count remain available while
   local file upload remains absent;
5. no reservation occurs before confirmation;
6. confirmation opens the top access-code drawer; admitted analysts reach
   Dossiers and administrators reach Operations;
7. logout and reuse of the same code restore the same visitor, role, quota, and
   dossiers while invalidating the previous Auth identity;
8. persisted progress appears after launch;
9. insufficiency checkpoint URL and override paths work using deterministic test
   data;
10. source review handles pending candidates and reactive source selection;
11. immutable corpus approval claims the execution slot safely;
12. `corpus_approved` shows Evidence/Assessment/Map/Brief visibly locked and no
    extraction activity;
13. Workbench Shell, Qatalog navigation, persistent rail, dossier cards,
    matching skeletons, desktop panel, and mobile drawer preserve their visual
    contracts;
14. keyboard, hover/focus actions, and reduced motion behave correctly;
15. analyst-facing copy contains no raw error, request ID, provider code,
    environment name, access inventory, quota mechanics, or roadmap phase;
16. console output contains no errors and all progress is persisted, never
    simulated.

Capture fresh snapshots after each meaningful action. Run the protected journey
with real admitted analyst and administrator states. A public page render,
mocked component, or expected `Not authenticated` response does not satisfy this
gate. Remove temporary QA routes and fixtures after verification.

- [ ] **Step 5: Run bounded live contracts only with explicit approval**

```bash
RUN_LIVE_PROVIDER_TESTS=1 \
SEC_USER_AGENT="$SEC_USER_AGENT" \
EXA_API_KEY="$EXA_API_KEY" \
TMPDIR=/tmp TEMP=/tmp \
pnpm exec vitest run src/__tests__/live
```

Report exact request counts, latency, returned metadata shape, and any provider
usage/cost. Never include secrets. Re-run cancellation and generation guards
with deterministic adapters after live contracts so provider evidence cannot
replace durable-execution evidence.

- [ ] **Step 6: Update roadmap evidence**

Mark only the Phase 4 criteria actually demonstrated. Keep Phases 5–8 unchecked.
The deployable outcome is:

```text
real company resolution
+ real persisted discovery progress
+ explicit corpus review and approval
+ lifecycle = corpus_approved
+ executionStatus = idle
+ no evidence extraction claim
```

---

## Self-Review

- Spec coverage: Phase 4 covers preflight, confirmation, reservation,
  revalidation, insufficiency choices, deterministic plan, SEC/Exa discovery,
  HTTPS URL addition, pending source decisions, immutable corpus approval,
  production navigation rail, and minimal admin operations.
- Deferred by design: source content retrieval, Unstructured Jobs,
  `SourceVersion`, passages, typed claim tasks, policy adjudication, dimension
  review, progressive map/brief generation, and model providers belong to
  Phases 5–8 and remain unavailable in this release.
- Type consistency: public function names and lifecycle literals match the
  locked interfaces and current product/technical contracts.
- Runtime-boundary consistency: TanStack Start owns the web runtime, Convex owns
  domain state and durable execution, Actions own external I/O orchestration,
  mutations own persistence, and `convex/integrations/*` adapters own transport
  mapping without becoming a second public API.
- Preservation consistency: existing Start, composer, toolbar, shell,
  navigation, rail, cards, skeletons, source review, motion, and responsive
  behavior change only where this plan explicitly says so.
- Access consistency: public preflight, top-drawer reusable code admission,
  stable visitor rebinding, role routing, logout, and reconnection match
  ADR-012 through ADR-014.
- External-I/O consistency: authorization precedes I/O; DNS targets, leases,
  retries, generations, cancellation, atomic resume, late results, and missing
  configuration all have deterministic regression coverage.
- Copy consistency: presentation mappings expose evidence, consequences, and
  next actions without leaking backend or deployment language.
- Verification consistency: the actual admitted desktop/mobile journey is a
  blocking gate; targeted tests and public-page smoke checks cannot substitute
  for it.
- Placeholder scan: the plan contains no unspecified implementation steps or
  generated-file edits.
- Honesty gate: the final Phase 4 state is `corpus_approved` plus `idle`; no
  downstream progress is emitted.

## Execution Handoff

Plan complete at
`docs/superpowers/plans/2026-07-27-phase-4-company-corpus-discovery.md`.

Execution must use `executing-plans` in this repository and stop at reviewer
gates between tasks. Do not use subagent-driven implementation unless the user
explicitly asks for delegation. Do not begin Task 1 until the Task 0 baseline
gate is resolved.
