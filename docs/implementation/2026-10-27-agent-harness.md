# Shared Agent Harness and Worktree Runtime Implementation Plan

> Execution: use `executing-plans` and `tdd`; the authorized two-worker split below overrides the skill's inline-only default. The parent owns integration and verification. No additional review agents are authorized.

**Goal:** centralize execution contracts and reusable business operations, preserve context and traceability across durable continuations, and allow independent local services in simultaneous worktrees.

**Status:** approved for implementation on 2026-10-27 in the `harnais-architecture` worktree. Planning and implementation are separately authorized; implementation was explicitly requested after this plan was accepted. This is the single active execution plan for this workstream and must be retired after verified closure.

**Architecture:** extend the installed Convex Workflow engine with durable missions, temporary invocations and persisted operation requests/results. Static versioned agent definitions bind domain-owned operations. Existing preparation calls become consumers of the same bounded invocation transport. Convex remains the state and policy owner; the AI SDK is an integration detail.

**Stack:** established pnpm lockfile, strict TypeScript, Convex, Convex Workflow, AI SDK, OpenRouter, Vitest/convex-test, existing Playwright and browser-preview service. No new dependencies or paid experiments are planned.

Current obligations belong to [the technical contract](../../context/TECH.md), [product requirements](../../PRODUCT.md) and [roadmap](../ROADMAP.md). The [accepted conception](../brainstorming/question-led-workbench/2026-10-26-agentic-execution-architecture.md) records rationale without introducing a second current contract.

## Scope and preservation

Implement the common foundation and bindings to existing saved-material operations. Do not implement adaptive Sources, framing, Investigation or Synthesis. Preserve the existing analyst interface, admission, corpus approval, preparation recovery, prompts, schemas, cache identity, routes and exact-capture integrity. No routine agent reasoning route becomes live by default. A scripted invocation is labelled simulation and creates no fictitious provider receipt.

| Surface | Treatment | Evidence and intended change |
| --- | --- | --- |
| Shared execution | Add | The accepted technical contract specifies missions and continuations; installed Workflow is reused. |
| Preparation model transport | Modify | `convex/integrations/sourceQualification.ts` already owns bounded structured attempts. Extract and reuse that implementation without changing protocol or routing. |
| Approved saved-source access | Modify | `sourceRetrieval.ts` and `sourceRetrievalActions.ts` own capture selection, hashes, membership and retained content. Add persisted mission authority at that boundary. |
| Provider receipts and dossier budgets | Modify | Extend existing accounting; preserve `researchRuns.sourcePreparationBudget` as the canonical cumulative record and distinguish factual receipt from result adoption. |
| Local commands and endpoints | Modify | Current scripts force Vite 3000, Convex defaults 3210/3211 and Impeccable 8400; tests hardcode endpoints. Preserve command names while consuming verified worktree endpoints. |
| Analyst surfaces and checkpoints | Preserve | The current product and technical transition contracts require existing interactions and authorization until their replacement is implemented and verified. |
| Primary checkout and live services | Preserve | Work happens exclusively in the existing architecture worktree; foreign processes and state must remain untouched. |

Review focus: authorization reconstructed from persisted authority, replay after partial commits, concurrent admission and cumulative budget reservation, SDK retry ownership, late receipts versus adoption, unknown external outcomes, exact quotations and context retention, deterministic repetition detection, native backend identity and simultaneous startup races. Tests must observe persisted outcomes through real module boundaries, not copies of production logic.

## Shared contracts and initial bounds

`convex/execution/` owns lifecycle, request admission, context assembly, repetition controls and causal trace. Business domains retain canonical operation schemas, versions, effects, result meaning and completion artifacts. Native and tool callers use the same operation; tool schemas are derived from canonical validators. Definitions are static and versioned, without a plugin framework or provider-specific domain records.

Persist four data families: `agentMissions`, `agentInvocations`, `agentOperationRequests`, and `agentExecutionEvents`. Use generated Convex document types and bounded indexed reads. Store exact usable observable input/output and explicit working notes, never hidden reasoning. Store the operation request before effects and the outcome before resuming. Ordinary handoffs suspend between operations. Serialize the first implementation's dispatches and revalidate authority and versions at each boundary.

Required internal boundaries:

```text
execution.missions.start({runId, corpusRevisionId, definitionId, requestKey, expectedGeneration})
execution.missions.resume({missionId, expectedGeneration})
execution.operations.dispatch({requestId, expectedGeneration})
execution.context.build({missionId, expectedGeneration})
```

The server derives the visitor and authority from the active authorized run, never from an untrusted supplied identity. Resume consumes a persisted result without accepting a replacement result or resetting consumption. Any transition to running claims the visitor's slot atomically. Cancellation fences the current run generation immediately; bounded cleanup is secondary.

Initial bounds: sequential operations, at most four requests per model response, existing 15-minute execution window, 60-second model timeout, 128 KiB complete input/context/schema envelope, 6144 output tokens, existing response and diagnostic limits, history pages of 20, and three consecutive turns without domain progress before an explicit stop. IDs, notes and events alone are not progress. Existing default dossier work/incident allowances of 120/40 remain canonical and cumulative across resumes. Unknown provider outcomes retain their reservation and cannot be blindly replayed.

Continuation context includes mission/scope, human instructions and decisions, current versions and constraints, work and open needs, mandatory obligations, the triggering request and returned result. Retain explicit avenues, hypotheses and rejection reasons as working notes rather than established facts. Exact prior observable history remains paginated and retrievable. Required context exceeding capacity blocks explicitly instead of silently dropping material. Completion requires authorized domain artifacts and no unfinished mandatory controls.

## Tasks

### Task 0 — Prepare the isolated execution workspace (parent)

- [ ] Save this plan and register its exact path in the AGENTS documentation policy; checkpoint the three approved conception/reference changes with explicit paths.
- [ ] Restore root dependencies with `sfw pnpm install --frozen-lockfile` and the existing nested browser service with `sfw npm ci`; preserve lockfiles and security settings. Check official package identities before networked restoration. Do not bypass a security rejection.
- [ ] Configure a fresh native project-local Convex deployment linked to the intended project, rejecting shared legacy or foreign instances. Never copy another checkout's environment, secrets or backend state.
- [ ] Generate ignored local invitation material using `pnpm invitations:generate --output=invitation-otp-codes.local` with exclusive private-file creation; never print its contents.
- [ ] Verify documentation links and clean scoped diffs. Keep execution evidence in the ignored plan ledger.

### Task 1 — Isolate local service ports and consumers (worker one)

Create `scripts/local-runtime.ts`, `scripts/local-dev.ts`, and `src/__tests__/config/local-runtime.test.ts`. Update the relevant package scripts, Vite/Playwright configuration, endpoint helpers, ignore rules and browser-preview readiness reporting.

- [ ] Use an ignored `.local-runtime/` versioned manifest with canonical worktree identity, deployment identity, process ownership and actual endpoint origins, without secrets. Native `.convex/local/default` and Impeccable connection files remain authoritative; the manifest is a verified readiness projection.
- [ ] Serialize native backend startup across repository worktrees with a short-lived lock in the Git common directory, released only after the correct backend is verified. Reuse native Convex free-port allocation and `/instance_name` verification. Reject shared legacy/foreign state; do not bypass native duplicate-instance protection.
- [ ] Let Vite and preview use an available port, prefer a prior endpoint on restart and publish the actual listener address. Remove the forced Impeccable port and let its native allocator work. Update preview logging to report `server.address()`.
- [ ] Preserve `dev`, `dev:web`, `convex:dev`, `dev:browser`, `dev:all`, `design:live`, `test:e2e`, and explicit `convex:sync --url`. Add `dev:urls --json`; `resolveLocalRuntime(root)` returns verified endpoints or a typed setup/readiness error.
- [ ] Update Playwright startup, helpers and WebSocket interception to consume this worktree's verified endpoints. Atomically update manifests and clean up only owned processes.
- [ ] Test CLI behavior using temporary worktrees and fake external process boundaries: disjoint endpoints, parallel startup, occupied ports, stale manifests, foreign backend, failed startup and shutdown ownership. Run the existing local sync regression.

### Task 2 — Persist missions, authority and accounting (parent)

- [ ] Add the four table families and common validators, lifecycle and internal mission APIs. First RED test: identical authorized start requests return one mission while foreign or revoked ownership is refused.
- [ ] Derive server authority from persisted workspace purpose, owner, approved revision, run generation, deadline and permitted operation scope. Preserve public read behavior for older approved revisions; mission execution additionally requires its active generation.
- [ ] Extend existing provider-call accounting for shared reasoning, with one cumulative budget owner. Do not rename or migrate the persisted budget field just to rename it. Preserve existing preparation semantics.
- [ ] Separate late factual receipt recording from business adoption. Verify cancellation, concurrent final-budget-unit reservation, unknown-outcome retention and legacy regressions.

### Task 3 — Bind canonical saved-material operations (worker two)

Modify `convex/sourceRetrieval.ts` and `convex/sourceRetrievalActions.ts`; create `convex/execution/operations.ts` and focused tests. Shared interfaces are agreed with the parent before implementation; the parent owns schema/generated files.

- [ ] Share approved-access and retained-content rules after interactive or persisted mission authorization. Never fabricate `ctx.auth` in Workflow.
- [ ] Preserve public search/read signatures, capture hashes, exact quotation locators and pinned membership. Derive tool schemas from canonical Convex validators with installed helpers.
- [ ] Bind `consult_mission_state`, `search_available_material({sourceId, query})`, and `read_in_context({sourceId, passageOrder})`. Keep content reads bounded and expose omissions or unavailable retained material explicitly. Never refetch missing/corrupt content.
- [ ] Define static `saved_material_inspection_v1` with read-only authority and completion references to authorized inspected captures; it grants no claim, qualification or human-decision authority.
- [ ] Persist requests and typed outcomes for native and agent callers. Verify equivalent quoted content and refusal for foreign/revoked authority, with an external-I/O trap.

### Task 4 — Extract the bounded invocation transport (worker two, parent integration)

- [ ] Establish passing characterization tests, then extract the real `runBoundedStructuredAttempt` from `sourceQualification.ts` into `convex/integrations/modelInvocation.ts`. Do not copy it. Add the shared bounded invocation boundary, including `invokeOneShot`, and wire qualification/comparison through it without changing their domain protocol, prompts, hashes, routes or fallback.
- [ ] Support structured attempts and deferred agent tool requests. Tools have no SDK `execute` callback; execution belongs to the durable kernel. Keep provider/SDK types in integrations.
- [ ] Preserve one application retry owner: SDK `maxRetries: 0`, Workflow action retry disabled for model work. An absent authorized agent route yields a typed configuration block, never an invented model selection.
- [ ] Distinguish nondispatched cancellation, invalid received output and unknown dispatched outcomes. Run existing transport, preparation budget and workflow regressions.

### Task 5 — Execute durable continuations, preserve context and stop loops (parent)

- [ ] Implement the mission Workflow and action using installed Workflow primitives: persisted request, authorized dispatch, retained outcome, fresh invocation. Reuse results after crash or resume without repeating completed effects.
- [ ] Automatically persist observable input/output/tool messages and explicit working notes. Assemble all required context and bounded exact history; block on capacity overflow without a separate save-memory tool or summarizer.
- [ ] Apply stable request identity and result reuse; count domain progress, preserve repetition state across restarts and stop after three no-progress turns. Keep dossier budgets, deadlines and handoff bounds cumulative.
- [ ] Record an outcome for every admitted batch request, serializing effects and checking versions after each one. Fence late/cancelled/stale work before calls and persistence.
- [ ] Complete only after domain artifact and mandatory-control verification. Test crashes before dispatch and after effect commit, stale versions, cancellation, unknown outcomes, invalid requests, repeat-stop restart and missing completion artifacts through persisted outcomes.

### Task 6 — Prove local acceptance and close (parent, runtime help from worker one)

- [ ] Add internal E2E fixtures gated by loopback and `E2E_FIXTURES_ENABLED`, deriving ownership from the existing claimed browser-test invitation. No public test endpoint, fabricated identity or CLI identity impersonation.
- [ ] Exercise the real Workflow with a scripted model and the real three saved-material operations. Label simulation and create no fictitious provider receipt. Verify real anonymous sign-in, access-code admission, continuation and retained state after reconnection.
- [ ] Prove simultaneous primary/worktree endpoints and state isolation. Preserve relevant protected desktop/mobile interactions, keyboard/focus and console behavior. Remove the fixture flag and verify teardown.
- [ ] Run focused checks during each task, then `pnpm check` once because schema, accounting and runtime changes cross project boundaries. Run nested preview tests/typecheck separately. A successful typecheck alone does not prove backend synchronization: verify the single worktree watcher push and changed runtime behavior.
- [ ] Review the final diff locally for authorization, design smells, duplication and documentation ownership. Record exact checks and remaining uncertainty. No additional review agent is authorized.
- [ ] Update the roadmap with verified capabilities and outstanding target mission phases; retire this plan and its policy entry only after actual completion. No paid provider gate, cloud deployment, push or PR is implied.

## Execution ownership and verification record

Worker one owns local runtime scripts/configuration and their focused tests. Worker two owns shared approved reads and then transport extraction. The parent owns schema, generated outputs, persisted authority, cumulative accounting, caller integration, Workflow/context/repetition, acceptance and commits. Workers receive explicit file allowlists and do not start competing watchers or edit the primary checkout.

Each functional change follows RED → GREEN → REFACTOR through the real owning boundary. Mock external/model nondeterminism only; imported production modules and persisted state remain real. Configuration/tooling uses executable before/after checks. Default tests never call paid providers. Read every delegated final report and rerun integration verification before recording completion.
