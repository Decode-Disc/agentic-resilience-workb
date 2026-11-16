# Approval Requests and Honest Sources Time Limits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended) or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the system and any agent ask the human for approval in the chat through one typed mechanism, make the Sources window a deployment setting, make Sources outcomes honest, and reopen dossiers that failed because of the time-limit defect.

**Architecture:** Convex owns approval state in two tables written only by `convex/execution/approvals.ts`. A static catalogue (`convex/execution/approvalCatalog.ts`) declares each approvable action and delegates its effect to the existing owner, the same way `agentCatalog.ts` declares agents. Browser-safe contracts and copy (`approvalContracts.ts`, `approvalCopy.ts`, `agentIdentities.ts`) are shared by Convex and the frontend; the chat components stay Convex-free and render an approval part through a renderer supplied by the workspace.

**Tech Stack:** Convex 1.x with `convex-test`, `@convex-dev/workflow`, TanStack Router, React 19, assistant-ui 0.15.31 external-store runtime, shadcn `base-luma` with Hugeicons, Vitest with the shared Convex React harness, Playwright against the local backend, Biome.

**Spec:** [docs/brainstorming/2026-11-16-approval-requests-and-sources-time-limit.md](../brainstorming/2026-11-16-approval-requests-and-sources-time-limit.md)

## Global Constraints

- Follow [AGENTS.md](../../AGENTS.md): English everywhere, `@/` and `@convex/` imports, generated Convex types only, validators on every Convex function argument and return, no `any`, Hugeicons through `@/components/icon`.
- The approval mechanism is general: no file, table, type, function or field in it is named after the analyst. Requesters are `{ type: "system" }` or `{ type: "agent", missionId, messageId }`; deciders use the existing `auditActorValidator`.
- Agents are named only through `AGENT_IDENTITIES` in `convex/domain/agentIdentities.ts`. Copy never uses the bare word "Sources" for the agent; "Sources" remains the page name.
- `SOURCES_PREPARATION_WINDOW_MINUTES` is required when Sources is enabled, read only by `sourcePreparationWindowMs()` in `convex/resourceLimits.ts`, with no window value anywhere in code. Missing or invalid: `executionError("sources_configuration_unavailable")`.
- `SOURCES_QUALIFICATION_RESEARCH_WINDOW_MS` and `EXECUTION_WINDOW_MS` keep their non-Sources roles; neither may cap a Sources research mission.
- No new dependency. The assistant-ui approval card is adapted by hand from `pnpm dlx shadcn@latest view @assistant-ui/elements-approval-card`; its lucide icons and `surfaces` helpers are not installed.
- `src/components/chat/**` and `src/components/composer/**` import nothing from `@convex/_generated/api`; data reaches them through props or a renderer.
- Exact time-limit choice copy: title "The Sources Agent reached its time limit", buttons in this order "Use what's prepared" (outline), "Continue once" (outline), "Always continue" (default). Default choices: "Deny" (ghost), "Always allow" (outline), "Allow once" (default).
- Continuation has no count cap; it is bounded by the preparation's remaining envelope and model budget (`sourcesContinuationAvailable`).
- TDD: record each RED command and its failure in the handoff. After any backend edit, confirm a successful push in the watcher log `/tmp/workbench-audit-native-node24.log` before exercising behaviour; never start a second watcher.
- Commit steps run only when the user has authorized commits for this execution; otherwise leave the changes staged-free and report.
- Browser fixtures require `E2E_FIXTURES_ENABLED`; remove it at teardown and verify it is gone.

## Review Focus

1. **The same request decided from two places** (page and chat card, or two tabs): exactly one decision applies; the other caller gets the recorded decision or `approval_already_decided`, and its card shows "This was already decided. Showing the current state." Tests: Task 5 `deciding again…`, Task 8 `a refused decision…`.
2. **Always continue with nothing left to continue with:** the next time limit hands off automatically and raises no request, so a grant can never loop. Test: Task 6 `an Always continue grant never…`.
3. **The window setting removed or made invalid while a dossier waits at the time limit:** Continue shows its reason and is refused; Use what's prepared still works. Test: Task 6 `an invalid window setting…`.
4. **A request outlived by a manual `/pause`, `/resume` or Resume button:** the request reads `superseded`, its card shows no choices, and deciding it is refused. Tests: Task 5 `a request from an earlier generation…`, Task 8 `a superseded request…`.
5. **Reopening a failed dossier while the owner runs another dossier:** reopening succeeds (pausing needs no slot) and Continue is disabled with the slot reason. Test: Task 9 `reopening while another dossier runs…`.

---

### Task 1: Sources window as a required deployment setting

**Files:**

- Modify: `convex/convex.config.ts` (declare `SOURCES_PREPARATION_WINDOW_MINUTES: v.optional(v.string())` in `defineApp({ env })`)
- Modify: `convex/resourcePolicy.ts` (remove `SOURCE_PREPARATION_DEADLINE_MS`; add `requiredPositiveInteger`)
- Modify: `convex/resourceLimits.ts` (add `sourcePreparationWindowMs`)
- Modify: `convex/sourcePreparation.ts:335`, `convex/sourcePreparation.ts:1541-1543`, `convex/sourcePreparationEvaluation.ts:512-513`, `convex/execution/researchControl.ts:622`, `convex/e2eFixtures.ts:2752-2753`
- Modify: `convex/execution/missions.ts:149-162` (research mission deadline follows the preparation)
- Modify: `src/__tests__/setup/sources-mission.ts` (`activateSourcesMission` and `seedCapturedSources` stub the setting), `src/__tests__/setup/model-configuration.ts:8-16`
- Modify: `.env.example` (add `SOURCES_PREPARATION_WINDOW_MINUTES=15` under the Sources block)
- Test: `src/__tests__/convex/resource-limits.test.ts`, create `src/__tests__/convex/sources/sources-window-setting.test.ts`

**Interfaces:**

- Produces: `requiredPositiveInteger(value: string | undefined, label: string, maximum: number): number | undefined` in `convex/resourcePolicy.ts` (pure; `undefined` for missing or blank, throws for present-but-invalid).
- Produces: `sourcePreparationWindowMs(): number` in `convex/resourceLimits.ts`; calls `requiredPositiveInteger(env.SOURCES_PREPARATION_WINDOW_MINUTES, "Sources preparation window", Number.MAX_SAFE_INTEGER)` and throws `executionError("sources_configuration_unavailable")` when the result is `undefined`, the resolver throws, or `minutes * 60_000` is not a safe integer. No other bound is introduced.
- Produces: `SOURCES_TEST_WINDOW_MINUTES = 15` exported from `src/__tests__/setup/sources-mission.ts`.

- [ ] **Step 1: Write the failing tests**

In `resource-limits.test.ts`, add `test("requiredPositiveInteger distinguishes a missing setting from an invalid one")` asserting `requiredPositiveInteger(undefined, "Window", 10)` and `("  ", …)` return `undefined`, `("4", …)` returns `4`, and `"0"`, `"1.5"`, `"11"` throw.

In `sources-window-setting.test.ts` (fake timers, `vi.unstubAllEnvs()` in `afterEach`):

```ts
test("Sources does not start without a configured window", async () => {
    // seed a framed Sources run ready for claimForDiscovery, then:
    vi.stubEnv("SOURCES_PREPARATION_WINDOW_MINUTES", "");
    await expect(t.mutation(internal.sourcePreparation.claimForDiscovery, args))
        .rejects.toSatisfy((e) => executionFailureCode(e) === "sources_configuration_unavailable");
});
test("a new preparation takes the configured window", async () => {
    vi.stubEnv("SOURCES_PREPARATION_WINDOW_MINUTES", "30");
    // claimForDiscovery → preparation.deadlineAt === now + 30 * 60_000
});
test("a research mission deadline follows its preparation, not a fixed fifteen minutes", async () => {
    // preparation.deadlineAt = now + 40 * 60_000, run.executionHarnessDeadlineAt undefined
    // internal.execution.missions.start (research scope) → mission.deadlineAt === preparation.deadlineAt
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/__tests__/convex/resource-limits.test.ts src/__tests__/convex/sources/sources-window-setting.test.ts`
Expected: FAIL — `requiredPositiveInteger` is not exported; the claim succeeds with a 15-minute deadline; the mission deadline equals `now + 15 * 60_000`.

- [ ] **Step 3: Implement**

Add `requiredPositiveInteger` next to `configuredPositiveInteger` and `sourcePreparationWindowMs` next to `preparationModelLimits`, documented with purpose (Sources paid-work window per preparation and per Continue), unit (minutes), source (deployment setting) and exhaustion behaviour (the time-limit decision). Replace every `SOURCE_PREPARATION_DEADLINE_MS` use with `sourcePreparationWindowMs()`; delete the constant. In `missions.ts`, for `executionScope === "research"` with a preparation deadline, use `run.executionHarnessDeadlineAt ?? preparation.deadlineAt` before the `readCampaignResearchDeadline ?? now + EXECUTION_WINDOW_MS` fallback. Stub the setting in the two test setups with `SOURCES_TEST_WINDOW_MINUTES`.

- [ ] **Step 4: Run the tests and the existing Sources suites**

Run: `pnpm vitest run src/__tests__/convex/resource-limits.test.ts src/__tests__/convex/sources src/__tests__/convex/workflows src/__tests__/convex/execution && pnpm lint`
Expected: PASS, including `resource-policy:check` inside `pnpm lint`. `grep -rn "SOURCE_PREPARATION_DEADLINE_MS" convex src` prints nothing.

- [ ] **Step 5: Verify the watcher push, then commit**

Run: `tail -n 20 /tmp/workbench-audit-native-node24.log` — expect a successful push after the edit. Set the setting on the local deployment: `npx convex env set SOURCES_PREPARATION_WINDOW_MINUTES 15` (local only).

```bash
git add convex/convex.config.ts convex/resourcePolicy.ts convex/resourceLimits.ts convex/sourcePreparation.ts convex/sourcePreparationEvaluation.ts convex/execution/researchControl.ts convex/execution/missions.ts convex/e2eFixtures.ts .env.example src/__tests__
git commit -m "feat(sources): read the preparation window from a required deployment setting"
```

---

### Task 2: One owner for agent identities

**Files:**

- Create: `convex/domain/agentIdentities.ts`
- Modify: `convex/execution/agentDefinition.ts` (add required `identity` to `AgentDefinition`)
- Modify: `convex/domain/sourcesAgent.ts`, `convex/domain/workbenchAgent.ts`, `convex/domain/conversationValidation.ts`, `convex/domain/executionValidationAgent.ts`, `convex/domain/savedMaterialInspection.ts` (set `identity`)
- Modify: `src/components/chat/conversation-agent.ts` (derive ids and names, add icons only)
- Test: create `src/__tests__/convex/execution/agent-identities.test.ts`

**Interfaces:**

- Produces:

```ts
export type AgentIdentity = { readonly id: string; readonly name: string };
export const AGENT_IDENTITIES = {
    workbench: { id: "workbench", name: "Workbench Agent" },
    sources: { id: "sources", name: "Sources Agent" },
    investigation: { id: "investigation", name: "Investigation Agent" },
    synthesis: { id: "synthesis", name: "Synthesis Agent" },
} as const satisfies Record<string, AgentIdentity>;
export type AgentIdentityId = keyof typeof AGENT_IDENTITIES;
export function agentName(id: AgentIdentityId): string;
```

- Produces: `AgentDefinition["identity"]: AgentIdentityId`. Helper agents that act within a Workbench turn (`conversationValidation`, `executionValidation`, `savedMaterialInspection`) use `"workbench"`; `sources_v1` uses `"sources"`.
- Produces: `WORKBENCH_AGENT`, `SOURCES_AGENT`, `DEFAULT_CONVERSATION_AGENTS` keep their exported names and shapes, built as `{ ...AGENT_IDENTITIES.x, icon }`.

- [ ] **Step 1: Write the failing test**

```ts
test("every registered agent definition names a known identity", () => {
    for (const definition of registeredAgentDefinitions())
        expect(AGENT_IDENTITIES[definition.identity]).toBeDefined();
});
test("the chat agents take their names from the shared identities", () => {
    expect(DEFAULT_CONVERSATION_AGENTS.sources.name).toBe(AGENT_IDENTITIES.sources.name);
    expect(WORKBENCH_AGENT.name).toBe(AGENT_IDENTITIES.workbench.name);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/__tests__/convex/execution/agent-identities.test.ts`
Expected: FAIL — module `@convex/domain/agentIdentities` not found.

- [ ] **Step 3: Implement** the module, the required field and the derivation. `agentIdentities.ts` stays pure (no `_generated/server` import) so the browser can import it.

- [ ] **Step 4: Run it and the typecheck**

Run: `pnpm vitest run src/__tests__/convex/execution/agent-identities.test.ts src/__tests__/components/chat && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/domain/agentIdentities.ts convex/execution/agentDefinition.ts convex/domain src/components/chat/conversation-agent.ts src/__tests__/convex/execution/agent-identities.test.ts
git commit -m "refactor(agents): own agent display identities in one shared module"
```

---

### Task 3: Honest Sources outcomes, needs and copy

**Files:**

- Modify: `convex/domain/sources.ts` (`sourcesPhaseValidator`, `sourcesPreparationPhase`, new `SourcesSettlementCause`, `sourcesSettlementNote`)
- Modify: `convex/sourcesMission.ts:1016-1037` (`finish` passes cause-specific notes)
- Modify: `convex/sourcesWorkspace.ts:39-44, 405-460` (`on_hold` outcome from the phase)
- Modify: `convex/execution/researchControl.ts` (`researchStateSummary` copy through `agentName`)
- Modify: `src/components/workbench-ui/documentary-needs.tsx` (`on_hold` outcome; counts shown for `unfinished` and `on_hold`)
- Modify: `src/lib/presentation/sources.tsx` (`phaseCopy`, `sourcesPreparationView` summaries), `src/components/workspace/run-route-component.tsx:64`, `src/components/workspace/run-progress.tsx:157`
- Modify: `src/components/workspace/sources/sources-screens.tsx:148-235` (`inspectEmphasis` prop)
- Test: `src/__tests__/convex/sources/sources-phase.test.ts`, `src/__tests__/convex/sources/sources-time-limit.test.ts`, `src/__tests__/lib/presentation/sources.test.ts`, `src/__tests__/convex/execution/workbench-summary-wording.test.ts`

**Interfaces:**

- Consumes: `agentName` (Task 2).
- Produces: `SourcesPhase` gains `"ended_without_material"`: a settled preparation with status `blocked` (also on the legacy `awaiting_source_review` branch).
- Produces: `needOutcomeValidator` gains `"on_hold"`; a need without a handed-off result is `"in_progress"` only when the phase is `collecting`, otherwise `"on_hold"`.
- Produces: `type SourcesSettlementCause = "decision" | "allowance_exhausted" | "outcome_unknown" | "window_ended"` and `sourcesSettlementNote(cause: SourcesSettlementCause): string`, with this exact copy (agent name interpolated through `agentName("sources")`):
  - decision: "The Sources Agent stopped here because you chose to use what was prepared."
  - allowance_exhausted: "The Sources Agent stopped here because the dossier's searches, retrievals or checks were used up."
  - outcome_unknown: "The Sources Agent stopped here because the outcome of its last check is unknown."
  - window_ended: "The Sources Agent stopped here because its time window ended."
- Cause order in `finish`: `settlementRequestedAt` set → `decision`; else `sourcesContinuationAvailable(...) === false` → `allowance_exhausted`; else mission `blockCode === "operation_outcome_unknown"` → `outcome_unknown`; else `window_ended`.
- Produces: `phaseCopy.ended_without_material = { workState: "blocked", label: "No material", outcome: "No material", title: "No usable material prepared", detail: "The Sources Agent stopped without keeping any document. The documents it found remain listed as leads in Sources. Investigation is not available yet." }`. `phaseCopy.time_limit.title` becomes "The Sources Agent reached its time limit". Every other `detail` that begins with "Sources " names "The Sources Agent" instead.
- Produces: `SourcesPreparationScreen` prop `inspectEmphasis?: "primary" | "secondary"` (default `"primary"`; `"secondary"` renders "Inspect sources" with `variant="outline"`).

- [ ] **Step 1: Write the failing tests**

- `sources-phase.test.ts`: `test("a handover that keeps no document ends without material")` → `sourcesPreparationPhase({ lifecycleState: "sources_prepared", executionStatus: "idle" }, { status: "blocked" }, null)` is `"ended_without_material"`; `status: "partial"` stays `"completed_with_limits"`.
- `sources-time-limit.test.ts`:
  - `test("needs read on hold while the time-limit decision is pending")`: after `reachTimeLimit`, `api.sourcesWorkspace.overview` returns every unsettled need with `outcome: "on_hold"` and its `documents` and `contributions` counts.
  - `test("the handover after a decision explains its cause on each unfinished need")`: settle, run `finish`, assert each need's `unfinished` equals `[sourcesSettlementNote("decision")]`.
  - `test("an automatic handover without remaining capacity says the allowance was used up")`: same with the existing exhausted-capacity setup and `"allowance_exhausted"`.
- `sources.test.ts`: `test("Sources copy names the agent and never shows raw codes")` iterating every `SourcesPhase` value: `sourcesPhasePresentation(phase)` text does not match `/^Sources (is|used|handed|stopped|continues|reached)/` and does not match `/_[a-z]/`.
- `workbench-summary-wording.test.ts`: the `sources_time_limit` summary starts with "The Sources Agent reached its time limit."

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run src/__tests__/convex/sources/sources-phase.test.ts src/__tests__/convex/sources/sources-time-limit.test.ts src/__tests__/lib/presentation/sources.test.ts src/__tests__/convex/execution/workbench-summary-wording.test.ts`
Expected: FAIL — `blocked` maps to `completed_with_limits`; needs read `in_progress`; notes read "Sources execution ended before…"; copy starts with "Sources is".

- [ ] **Step 3: Implement** the phase, the need outcome (compute the phase in `overview` from the run, preparation and the mission it already reads), the cause notes, the `documentary-needs.tsx` legend `on_hold: { label: "On hold", legend: "Work stopped until research resumes" }` with counts shown beside the `On hold` and `Unfinished` badges, the `inspectEmphasis` prop, and the copy rewrite.

- [ ] **Step 4: Run the tests, then the React suites that render these surfaces**

Run: `pnpm vitest run src/__tests__/convex/sources src/__tests__/lib/presentation src/__tests__/components/workspace src/__tests__/routes/run-route-component.test.tsx src/__tests__/convex/execution/workbench-summary-wording.test.ts`
Expected: PASS after updating fixtures that assert old wording.

- [ ] **Step 5: Commit**

```bash
git add convex/domain/sources.ts convex/sourcesMission.ts convex/sourcesWorkspace.ts convex/execution/researchControl.ts src/components src/lib src/__tests__
git commit -m "fix(sources): report no-material handovers, on-hold needs and the real stop cause"
```

---

### Task 4: Approval contracts, tables, shared copy and action catalogue

**Files:**

- Create: `convex/execution/approvalContracts.ts` (browser-safe validators and types)
- Create: `convex/domain/approvalCopy.ts` (browser-safe labels used by receipts and cards)
- Create: `convex/execution/approvalCatalog.ts`
- Modify: `convex/execution/schema.ts` (tables `approvalRequests`, `approvalGrants`; `agentMessageDeliveries` fields `approvalRequestId`, `approvalDecision`; delivery literal `"notice"`)
- Modify: `convex/domain/validators.ts:130` (`auditEventActionValidator` gains `"run_reopened_at_time_limit"`)
- Modify: `scripts/check-execution-boundaries.ts:16-21` (`TABLE_OWNERS.approvalRequests = ["approvals"]`, `TABLE_OWNERS.approvalGrants = ["approvals"]`)
- Modify: `convex/sourcesMission.ts:1066-1112` (extract the body of `settle` into `requestSourcesSettlement`; the public `settle` mutation is deleted in Task 6)
- Test: create `src/__tests__/convex/execution/approval-catalog.test.ts`; move `seedExpiredPreparation`, `reachTimeLimit` and `client` from `sources-time-limit.test.ts` to create `src/__tests__/setup/sources-time-limit.ts`

**Interfaces:**

- Produces in `approvalContracts.ts`:

```ts
export const approvalActionValidator = v.union(
    v.literal("pause_research"),
    v.literal("resume_research"),
    v.literal("continue_sources_preparation"),
    v.literal("settle_sources_preparation"),
);
export type ApprovalAction = Infer<typeof approvalActionValidator>;
export const approvalRequesterValidator = v.union(
    v.object({ type: v.literal("system") }),
    v.object({
        type: v.literal("agent"),
        missionId: v.id("agentMissions"),
        messageId: v.id("agentMessageDeliveries"),
    }),
);
export type ApprovalRequester = Infer<typeof approvalRequesterValidator>;
/** Stored statuses. "superseded" is never stored: `approvalStatus` derives it from the run's generation. */
export const storedApprovalStatusValidator = v.union(
    v.literal("pending"), v.literal("approved"), v.literal("denied"),
);
export const approvalStatusValidator = v.union(
    storedApprovalStatusValidator, v.literal("superseded"),
);
export type ApprovalStatus = Infer<typeof approvalStatusValidator>;
/** "alternative" applies the request's named alternative action. */
export const approvalChoiceValidator = v.union(
    v.literal("once"), v.literal("always"), v.literal("alternative"), v.literal("deny"),
);
export type ApprovalChoice = Infer<typeof approvalChoiceValidator>;
export const approvalOutcomeValidator = v.union(
    v.object({ kind: v.literal("applied"), action: approvalActionValidator }),
    v.object({ kind: v.literal("none") }),
);
export const approvalDecisionValidator = v.object({
    choice: approvalChoiceValidator,
    /** How the choice was made: on a card, by a standing grant (recorded as "always"), or by an exact command (recorded as "once"). */
    via: v.union(v.literal("card"), v.literal("grant"), v.literal("command")),
    decidedBy: auditActorValidator,
    decidedAt: v.number(),
    outcome: approvalOutcomeValidator,
});
export type ApprovalDecision = Infer<typeof approvalDecisionValidator>;
export type AuditActor = Infer<typeof auditActorValidator>;
export const approvalRequestViewValidator = v.object({
    id: v.id("approvalRequests"),
    runId: v.id("researchRuns"),
    action: approvalActionValidator,
    alternative: v.union(approvalActionValidator, v.null()),
    requestedBy: approvalRequesterValidator,
    status: approvalStatusValidator,
    /** Why the action cannot run now; null when it can. Only meaningful while pending. */
    block: v.union(v.string(), v.null()),
    decision: v.union(approvalDecisionValidator, v.null()),
    grantActive: v.boolean(),
    createdAt: v.number(),
});
export type ApprovalRequestView = Infer<typeof approvalRequestViewValidator>;
```

- Produces tables in `convex/execution/schema.ts`:
  - `approvalRequests`: `runId`, `action`, `alternative?`, `requestedBy`, `expectedGeneration: number`, `status: storedApprovalStatusValidator`, `decision?`, `createdAt`; indexes `by_run_and_status ["runId","status"]` and `by_run_action_generation ["runId","action","expectedGeneration"]` (the request's identity; no string key).
  - `approvalGrants`: `runId`, `action`, `grantedBy: auditActorValidator`, `grantedAt`, `revokedAt?`, `revokedBy?`; index `by_run_and_action ["runId","action"]`.
  - `agentMessageDeliveries`: `approvalRequestId?: v.id("approvalRequests")`, `approvalDecision?: v.object({ requestId: v.id("approvalRequests"), confirmationMessageId: v.id("agentMessageDeliveries") })`, delivery union adds `v.literal("notice")`.
- Produces in `approvalCopy.ts` (all card and receipt wording is data here; no consumer branches on a specific action):

```ts
export type ApprovalActionCopy = {
    label: string;          // "Continue preparation"
    consequence: string;    // what approving does
    onceLabel: string;      // "Continue once"; for agent requests the card uses "Allow once"
    alwaysLabel: string;    // "Always continue"; for agent requests the card uses "Always allow"
    grantedLabel: string;   // "Continue preparation automatically" (Commands picker)
    /** Card title when the system raises this action, or null if the system never does. */
    systemTitle: string | null;
};
export const approvalActionCopy: Record<ApprovalAction, ApprovalActionCopy>;
export function approvalDecisionText(action: ApprovalAction, decision: ApprovalDecision): string; // "Continue preparation: always for this dossier"
export function approvalOutcomeText(view: ApprovalRequestView): string;
```

  Labels: "Pause research", "Resume research", "Continue preparation", "Use what's prepared". `continue_sources_preparation.systemTitle` is `` `The ${agentName("sources")} reached its time limit` ``; the others are `null`.
- Produces in `approvalCatalog.ts`:

```ts
export type ApprovalActionDefinition = {
    /** Grants that cannot coexist with a grant for this action. */
    readonly exclusiveWith: readonly ApprovalAction[];
    /** null when the action can run now, otherwise the refusal code. */
    availability(ctx: QueryCtx, run: Doc<"researchRuns">): Promise<string | null>;
    /** Called only after availability is null and the request's generation equals run.executionGeneration. */
    apply(ctx: MutationCtx, args: { run: Doc<"researchRuns">; actor: AuditActor }): Promise<void>;
};
export const approvalCatalog = { … } as const satisfies Record<ApprovalAction, ApprovalActionDefinition>;
```

  Entries. Resume and Continue read the one readiness verdict, so the window rule stays in `readResearchControlReadiness`:
  - `pause_research`: availability `(await readResearchControlReadiness(ctx, run, "pause")).block`; apply `pauseResearch`.
  - `resume_research`: readiness `"resume"`; its `block`, else `"sources_time_limit_decision"` when `transition === "renew_window"`; apply `resumeResearch`.
  - `continue_sources_preparation`: readiness `"resume"`; `"human_prerequisite_required"` unless `transition === "renew_window"`, else its `block`, else `"sources_capacity_exhausted"` when `sourcesContinuationAvailable` is false; apply `resumeResearch`. The `renew_window` branch of readiness also returns `"sources_configuration_unavailable"` when `sourcePreparationWindowMs()` throws, so a bad setting is refused before any effect.
  - `settle_sources_preparation`: availability `sourcesSettlementBlock(ctx, run)`; apply `requestSourcesSettlement`.
  - Continue and settle exclude each other.
- Produces in `sourcesMission.ts`: `export async function sourcesSettlementBlock(ctx: QueryCtx, run: Doc<"researchRuns">): Promise<string | null>` (`"stale_execution"` unless paused at `sources_time_limit` with a started preparation and no `settlementRequestedAt`), and `export async function requestSourcesSettlement(ctx: MutationCtx, args: { run: Doc<"researchRuns">; actor: AuditActor }): Promise<void>`, which throws that block when it is not null and otherwise performs the current `settle` effects.

- [ ] **Step 1: Write the failing tests**

```ts
test("Continue and Use what's prepared exclude each other's grants", () => {
    expect(approvalCatalog.continue_sources_preparation.exclusiveWith).toEqual(["settle_sources_preparation"]);
    expect(approvalCatalog.settle_sources_preparation.exclusiveWith).toEqual(["continue_sources_preparation"]);
});
test("at a time limit only the two Sources choices are available", async () => {
    const f = await seedExpiredPreparation(); await reachTimeLimit(f);
    // availability: continue → null, settle → null, resume → "sources_time_limit_decision", pause → "human_prerequisite_required"
});
test("a continue choice is unavailable when the allowance is used up", async () => { /* exhausted envelope → "sources_capacity_exhausted" */ });
test("a continue choice is unavailable while the window setting is invalid", async () => { /* stub "abc" → "sources_configuration_unavailable" */ });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run src/__tests__/convex/execution/approval-catalog.test.ts`
Expected: FAIL — module `@convex/execution/approvalCatalog` not found.

- [ ] **Step 3: Implement** the contracts, copy, schema fields, catalogue, `TABLE_OWNERS` entries and the `requestSourcesSettlement` extraction (the public `settle` temporarily calls it).

- [ ] **Step 4: Run the tests, the boundary check and the backend typecheck**

Run: `pnpm vitest run src/__tests__/convex/execution/approval-catalog.test.ts src/__tests__/convex/sources/sources-time-limit.test.ts && node --experimental-strip-types scripts/check-execution-boundaries.ts && pnpm convex:check`
Expected: PASS; watcher log shows a successful push with the new tables.

- [ ] **Step 5: Commit**

```bash
git add convex/execution/approvalContracts.ts convex/domain/approvalCopy.ts convex/execution/approvalCatalog.ts convex/execution/schema.ts convex/domain/validators.ts convex/sourcesMission.ts scripts/check-execution-boundaries.ts src/__tests__
git commit -m "feat(approvals): add approval contracts, tables and the action catalogue"
```

---

### Task 5: Approval requests, decisions and grants

**Files:**

- Create: `convex/execution/approvals.ts`
- Test: create `src/__tests__/convex/execution/approvals.test.ts`

**Interfaces:**

- Consumes: Task 4 contracts and catalogue.
- Produces:

```ts
/** Creates or reuses the request for this action at the run's generation. With an active grant and an available action, applies it inline (via "grant"); otherwise leaves it pending. */
export async function raiseApproval(ctx: MutationCtx, args: {
    run: Doc<"researchRuns">;
    action: ApprovalAction;
    alternative?: ApprovalAction;
    requestedBy: ApprovalRequester;
}): Promise<{ requestId: Id<"approvalRequests">; status: "pending" | "applied" }>;
/** An exact command message is itself the decision: records an approved request (via "command") and applies the action, or throws its availability code. */
export async function recordCommandApproval(ctx: MutationCtx, args: {
    run: Doc<"researchRuns">;
    action: "pause_research" | "resume_research";
    requestedBy: Extract<ApprovalRequester, { type: "agent" }>;
    decidedBy: AuditActor;
}): Promise<Id<"approvalRequests">>;
/** The single derivation of a request's status; every reader uses it. */
export function approvalStatus(request: Doc<"approvalRequests">, run: Doc<"researchRuns">): ApprovalStatus;
export async function readApprovalView(ctx: QueryCtx, request: Doc<"approvalRequests">): Promise<ApprovalRequestView>;
export async function activeGrant(ctx: QueryCtx, runId: Id<"researchRuns">, action: ApprovalAction): Promise<Doc<"approvalGrants"> | null>;
export async function readApprovalFacts(ctx: QueryCtx, run: Doc<"researchRuns">): Promise<{
    pending: { requestId: Id<"approvalRequests">; action: ApprovalAction; alternative: ApprovalAction | null; block: string | null }[];
    grants: ApprovalAction[];
}>;
/** The pending Continue request for the run's current generation, read by getMine and snapshot. */
export async function readSourcesDecisionRequestId(ctx: QueryCtx, run: Doc<"researchRuns">): Promise<Id<"approvalRequests"> | null>;
export const decide = mutation({ args: { requestId: v.id("approvalRequests"), choice: approvalChoiceValidator }, returns: approvalRequestViewValidator });
export const revokeGrant = mutation({ args: { runId: v.id("researchRuns"), action: approvalActionValidator }, returns: v.null() });
export const get = query({ args: { requestId: v.id("approvalRequests") }, returns: approvalRequestViewValidator });
export const listGrants = query({ args: { runId: v.id("researchRuns") }, returns: v.array(v.object({ action: approvalActionValidator, grantedAt: v.number() })) });
```

- Rules: `decide` authorizes with `requireWorkspaceRun`. When `approvalStatus` is `superseded` it throws `stale_execution` and writes nothing. `once` and `always` apply the action, `alternative` applies `alternative` (throws `approval_choice_unavailable` when absent), and `deny` records `{ kind: "none" }`. A decided request returns its view for the same choice and throws `approval_already_decided` for another. A non-null availability throws that code and leaves the request `pending`. `always` inserts a grant and revokes the active grants listed in `exclusiveWith`. Every decision by a visitor ends with `recordApprovalReceipt` (Task 6), introduced here as a no-op.

- [ ] **Step 1: Write the failing tests** (using `src/__tests__/setup/sources-time-limit.ts`; the request comes from `raiseApproval` inside `f.t.run`):

- `test("raising the same action twice for one generation keeps one pending request")`
- `test("allow once applies the action through its owner and records the decision")` → run `running`, generation +1, view `{ status: "approved", decision: { choice: "once", via: "card", decidedBy: { type: "visitor" }, outcome: { kind: "applied", action: "continue_sources_preparation" } } }`, no grant.
- `test("the alternative choice applies the named alternative")` → `settlementRequestedAt` set, outcome action `settle_sources_preparation`.
- `test("always allow saves a grant and the next request is applied by it")` → after a later time limit, `raiseApproval` returns `"applied"` and the request records `{ choice: "always", via: "grant" }`.
- `test("a superseded request is reported without being written")` → after a generation change, `get` returns `status: "superseded"` while the stored status is still `"pending"`.
- `test("granting Continue revokes an Always use-what's-prepared grant")`
- `test("revoking a grant brings the card back")` → next `raiseApproval` returns `"pending"`.
- `test("deny on an agent request changes nothing")` → run unchanged, status `denied`, outcome `none`.
- `test("a request from an earlier generation is superseded and refused")` (Review Focus 4: an `api.execution.researchControl.pause`/resume between raise and decide).
- `test("deciding again with the same choice returns the recorded decision; another choice is refused")` (Review Focus 1).
- `test("an unavailable action stays pending with its reason")` → paid work disabled: view `block: "paid_work_disabled"`; `decide("once")` throws `paid_work_disabled`; `decide("alternative")` succeeds.
- `test("only the dossier owner can decide")` → another identity is rejected.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run src/__tests__/convex/execution/approvals.test.ts`
Expected: FAIL — `api.execution.approvals` does not exist.

- [ ] **Step 3: Implement `convex/execution/approvals.ts`.** All writes to the two tables stay in this module.

- [ ] **Step 4: Run the tests and the boundary check**

Run: `pnpm vitest run src/__tests__/convex/execution/approvals.test.ts && node --experimental-strip-types scripts/check-execution-boundaries.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/execution/approvals.ts src/__tests__/convex/execution/approvals.test.ts
git commit -m "feat(approvals): raise, decide, grant and revoke approval requests"
```

---

### Task 6: Time-limit requests, chat notices and decision receipts

**Files:**

- Modify: `convex/execution/researchControl.ts:213-279` (`suspendResearchAtTimeLimit` raises the system request)
- Modify: `convex/execution/conversations.ts:139-219` (generalize `recordControlExchange`; add `recordApprovalNotice`)
- Modify: `convex/execution/piStore.ts:228-325` (`pendingControlInputs`, `recordControlInputs` accept an approval exchange)
- Modify: `convex/execution/approvals.ts` (`recordApprovalReceipt` writes the exchange)
- Modify: `convex/workbench.ts:535-560, 733-816` (`history` returns `approvalRequestId`; snapshot replaces `sourcesContinueBlock` with `sourcesDecisionRequestId`)
- Modify: `convex/researchRuns.ts` (`getMine` replaces `sourcesContinueBlock` with `sourcesDecisionRequestId`)
- Modify: `convex/sourcesMission.ts` (delete the public `settle` mutation)
- Modify: `convex/execution/fixtures.ts` (`reachSourcesTimeLimit`, `settleSourcesFixture` use the new path)
- Test: `src/__tests__/convex/sources/sources-time-limit.test.ts`, `src/__tests__/convex/execution/workbench-commands.test.ts`

**Interfaces:**

- Consumes: `raiseApproval`, `approvalDecisionText`, `approvalOutcomeText` (Tasks 4–5).
- Produces: `recordControlExchange(ctx, conversation, args)` where `args.exchange` is `{ kind: "command"; name: WorkbenchCommand }` or `{ kind: "approval"; requestId: Id<"approvalRequests">; text: string }` (the user-side text). The approval form writes `approvalDecision` instead of `controlCommand` and keeps the same `nativeControlStatus` and `nativeInputSequence` handling. `history` excludes messages carrying `approvalDecision` (and their confirmations): the card is the only visible receipt, and the exchange exists for the native history.
- Produces: `recordApprovalNotice(ctx: MutationCtx, conversation: Doc<"agentConversations">, args: { requestId: Id<"approvalRequests">; text: string }): Promise<Id<"agentMessageDeliveries">>` — role `assistant`, delivery `notice`, status `processed`, `requestKey: "approval-notice:" + requestId`, idempotent on that key; not synced natively (Workbench learns pending requests from its facts).
- Produces: `history` page items gain `approvalRequestId?: Id<"approvalRequests">`; `snapshot` and `getMine` expose `sourcesDecisionRequestId: Id<"approvalRequests"> | null`, both through `readSourcesDecisionRequestId`.
- Behaviour in `suspendResearchAtTimeLimit`:
  - With an active `settle_sources_preparation` grant, it does not pause: it sets `settlementRequestedAt` and returns `false`, so `finishChild` notifies and the normal handover settles (note cause `decision`). This keeps the grant out of the re-entrant `finishChild` call.
  - Otherwise, after pausing at `sources_time_limit`, it calls `raiseApproval({ action: "continue_sources_preparation", alternative: "settle_sources_preparation", requestedBy: { type: "system" } })`. An active Continue grant applies inline (the mission stays a recoverable stop until the scheduled `resumeMissions`, so no completion is notified). If the request stays pending and the dossier has a conversation, it posts the notice with `approvalActionCopy.continue_sources_preparation.systemTitle` followed by ". Choose whether to continue preparation or use what's prepared."

- [ ] **Step 1: Write the failing tests**

In `sources-time-limit.test.ts` (replace calls to `api.sourcesMission.settle` and the time-limit `api.execution.researchControl.resume` with `api.execution.approvals.decide`):

- `test("the time limit raises one system request and posts it in the conversation")` → one pending request `{ action: "continue_sources_preparation", alternative: "settle_sources_preparation", requestedBy: { type: "system" } }`; `api.workbench.history` returns one `notice` message carrying its `approvalRequestId`; `getMine.sourcesDecisionRequestId` equals it.
- `test("Always continue renews the window at the next time limit without asking")` → grant, second `reachTimeLimit`: run `running`, preparation deadline renewed, request `{ choice: "always", via: "grant" }`, no notice posted.
- `test("Always use what's prepared hands over at the next time limit without pausing")` → run never paused, `settlementRequestedAt` set, the handover notes carry `sourcesSettlementNote("decision")`.
- `test("a decision receipt does not appear in the visible conversation")` → after `decide`, `api.workbench.history` contains the notice and no `approvalDecision` exchange.
- `test("Always continue falls back to the card while another dossier holds the slot")` → request stays `pending` with `block: "execution_slot_unavailable"` (use the code `researchSlotBlock` returns).
- `test("an Always continue grant never loops when nothing is left to continue with")` (Review Focus 2) → exhausted envelope: no request, automatic handover.
- `test("an invalid window setting blocks Continue but not Use what's prepared")` (Review Focus 3) → stub `SOURCES_PREPARATION_WINDOW_MINUTES` to `"abc"`: `decide("once")` refused `sources_configuration_unavailable`; `decide("alternative")` succeeds.

In `workbench-commands.test.ts`:

- `test("an approval decision is recorded as a control exchange for the native history")` → after `decide("always")`, `internal.execution.piStore.pendingControlInputs` returns an entry whose `command` is `"Continue preparation: always for this dossier"` and whose `text` is the outcome text; `recordControlInputs` marks it recorded.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run src/__tests__/convex/sources/sources-time-limit.test.ts src/__tests__/convex/execution/workbench-commands.test.ts`
Expected: FAIL — no request is raised; `sourcesDecisionRequestId` is missing; `pendingControlInputs` rejects an exchange without `controlCommand`.

- [ ] **Step 3: Implement** the raise, notice, generalized exchange, piStore acceptance (the native write in `convex/integrations/piNativeInput.ts` is unchanged because it only reads `command` and `text`), the projections, the fixture updates and the deletion of `sourcesMission.settle`.

- [ ] **Step 4: Run the Sources, execution and workflow suites**

Run: `pnpm vitest run src/__tests__/convex/sources src/__tests__/convex/execution src/__tests__/convex/workflows`
Expected: PASS; watcher push confirmed.

- [ ] **Step 5: Commit**

```bash
git add convex src/__tests__
git commit -m "feat(sources): raise the time-limit decision as an approval request with chat receipts"
```

---

### Task 7: Workbench `request_approval`

**Files:**

- Modify: `convex/domain/workbenchContracts.ts:91-150` (`requestApprovalInput`; operation union member)
- Modify: `convex/domain/workbenchAgentOperations.ts:118-205, 274-352` (`instructionBehavior.pin` accepts `request_approval`; new operation)
- Modify: `convex/workbench.ts:818-976` (`performInstruction` branch)
- Modify: `convex/domain/workbenchAgent.ts:79, 160-200, 263-300, 440-520` (instructions, tool sets, gating, normalization)
- Modify: `convex/domain/workbenchContext.ts:130-140` (`research.approvals` facts)
- Modify: `convex/workbench.ts:362-372` (`operationView.approvalRequestId?`, read through `approvalRequestIdFromOperation`)
- Test: create `src/__tests__/convex/execution/workbench-approvals.test.ts`; `src/__tests__/convex/execution/operation-conformance.test.ts` (runs unchanged)

**Interfaces:**

- Consumes: `raiseApproval`, `recordCommandApproval`, `readApprovalFacts`, `approvalActionValidator`.
- Produces: `requestApprovalInput = v.object({ action: approvalActionValidator, messageId: v.id("agentMessageDeliveries") })`; operation `request_approval`, `version: 1`, `effectKind: "atomic_effect"`, result:

```ts
export const requestApprovalResultValidator = v.union(
    v.object({ status: v.literal("applied"), action: approvalActionValidator, requestId: v.id("approvalRequests") }),
    v.object({ status: v.literal("pending"), requestId: v.id("approvalRequests") }),
    v.object({ status: v.literal("unavailable"), reason: v.string() }),
);
/** Owned beside the result validator so conversation views never parse operation JSON themselves. */
export function approvalRequestIdFromOperation(request: Doc<"agentOperationRequests">): Id<"approvalRequests"> | undefined;
```

  Description: "Ask the person to approve a research action you inferred from their message. Nothing changes until they approve, unless the action is already allowed for this dossier. An exact pause or resume command applies immediately. If a request covering the same action is already pending, it is shown again."
- Behaviour in `performInstruction`: an exact command (`explicitResearchControl(text)` equal to `pause`/`resume` for `pause_research`/`resume_research`) → `recordCommandApproval` → `applied`; an unavailable action with no pending request covering it → `unavailable` with the catalogue code and no request; otherwise `raiseApproval({ requestedBy: { type: "agent", missionId, messageId } })` → `pending`, or `applied` through a grant. `raiseApproval` reuses a pending request at the current generation whose `action` or `alternative` equals the asked action (so asking to "use what's prepared" shows the system's time-limit card).
- `control_research` stays registered (recorded requests keep their pinned operation) but is never offered: `modelOperation` returns `null` for it and `nativeToolSets` uses mask bit 2 for `request_approval` instead. `request_approval` is offered when `snapshot.research.controlAvailable`.
- Instruction line 79 becomes: "Use request_approval when the person asks to pause, resume, continue preparation or use what's prepared, or asks for help with a pending decision. Never claim an action happened before its result confirms it. Use transmit_source_request for documentary instructions, identifying the original active message and interpreted need. Registration or transmission is separate from completed treatment."
- Facts: `research.approvals = await readApprovalFacts(ctx, run)`.

- [ ] **Step 1: Write the failing tests** (model the setup on the existing `control_research` tests: `grep -rln control_research src/__tests__/convex/execution`):

- `test("an exact command applies the action and records an approved request")`
- `test("an interpreted request creates a pending approval instead of acting")` → run still `running`, view `requestedBy: { type: "agent", missionId, messageId }`.
- `test("asking about a pending system decision shows the same request again")` → asking for `settle_sources_preparation` at a time limit returns `pending` with the system request's id.
- `test("an active grant applies the interpreted request")` → `{ status: "applied", action, requestId }` with `via: "grant"`.
- `test("an unavailable action creates no request")` → `resume_research` while running → `{ status: "unavailable", reason: "human_prerequisite_required" }`, and `readApprovalFacts(...).pending` is empty.
- `test("Workbench offers request_approval and no longer offers control_research")` → no set from `workbenchDefinition.nativeToolSets(...)` contains `control_research`; at least one contains `request_approval`.
- `test("Workbench facts list pending requests and grants")`

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run src/__tests__/convex/execution/workbench-approvals.test.ts`
Expected: FAIL — `request_approval` is not a registered operation.

- [ ] **Step 3: Implement** the contract, operation, branch, gating, tool sets, normalization, instruction text and facts.

- [ ] **Step 4: Run the Workbench and conformance suites**

Run: `pnpm vitest run src/__tests__/convex/execution && node --experimental-strip-types scripts/check-execution-boundaries.ts`
Expected: PASS, including `operation-conformance.test.ts` discovering `request_approval`.

- [ ] **Step 5: Commit**

```bash
git add convex/domain convex/workbench.ts src/__tests__/convex/execution
git commit -m "feat(workbench): request approval for inferred research actions"
```

---

### Task 8: Approval card in the chat and on the pages

**Files:**

- Create: `src/components/chat/approval-card.tsx` (neutral presentational card)
- Create: `src/lib/presentation/approvals.ts`
- Create: `src/lib/workspace/conversation-approvals.ts`
- Create: `src/components/workspace/approvals/connected-approval-card.tsx`
- Modify: `src/components/chat/workbench-conversation.tsx:640-720` (approval part renderer through context)
- Modify: `src/components/composer/slash-commands.tsx:43` (`ConversationCommandPicker` "Allowed actions" group)
- Modify: `src/components/workspace/start/connected-start-workspace.tsx` (message content parts; research controls use the connected card; grants)
- Modify: `src/components/workspace/sources/connected-sources.tsx` (card in `actions`; `inspectEmphasis="secondary"` while a decision is pending)
- Delete: `src/components/workspace/sources/sources-time-limit-decision.tsx`; move `sourcesContinueBlockCopy` from `src/lib/presentation/sources.tsx` into `approvalBlockCopy`
- Modify: `src/components/README.md` (ApprovalCard and ConnectedApprovalCard rows)
- Test: create `src/__tests__/components/chat/approval-card.test.tsx`; `src/__tests__/components/workspace/connected-start-workspace.test.tsx`; `src/__tests__/components/workspace/connected-sources.test.tsx`; `src/__tests__/lib/presentation/approvals.test.ts`

**Interfaces:**

- Consumes: `api.execution.approvals.get`, `.decide`, `.listGrants`, `.revokeGrant`; `ApprovalRequestView`, `approvalActionCopy`; `sourcesDecisionRequestId` (Task 6).
- Produces in `approval-card.tsx`:

```ts
export type ApprovalCardState = "request" | "running" | "done" | "denied" | "superseded";
export type ApprovalCardChoice<V extends string = string> = {
    value: V;
    label: string;
    variant: "default" | "outline" | "ghost";
    /** Shown and linked by aria-describedby; the choice is disabled while set. */
    disabledReason?: string;
};
export const DEFAULT_APPROVAL_CHOICES: readonly ApprovalCardChoice<"deny" | "always" | "once">[];
export function ApprovalCard<V extends string = "deny" | "always" | "once">(props: {
    title: string;
    description?: string;
    details?: readonly { label: string; value: string }[];
    state: ApprovalCardState;
    statusLabel?: string;
    choices?: readonly ApprovalCardChoice<V>[];
    onChoose?: (value: V) => void;
    /** Shown on a decided card, for example "Stop allowing". */
    receiptAction?: { label: string; onSelect: () => void };
    icon?: PlatformIcon;
    className?: string;
}): JSX.Element;
```

  Adapted from the registry source: `role="group"` with `aria-labelledby`/`aria-describedby`, choices rendered with the shared `Button`, Hugeicons, project tokens, no fixed pixel sizes.
- Produces in `approvals.ts`: `approvalCardPresentation(view: ApprovalRequestView): { title; description; details; state: ApprovalCardState; statusLabel?: string; choices: ApprovalCardChoice<ApprovalChoice>[] }` built only from `approvalActionCopy`, with no action-specific branch: a request with an `alternative` shows `[alternative.label (outline), action.onceLabel (outline), action.alwaysLabel (default)]` under `action.systemTitle`, which yields the exact Global Constraints time-limit copy; a request without one shows `DEFAULT_APPROVAL_CHOICES` under the action's `label`; `approvalBlockCopy(code: string): string`; `APPROVAL_STALE_COPY = "This was already decided. Showing the current state."`.
- Produces in `conversation-approvals.ts`: `conversationMessageContent(text: string, approvalRequestIds: readonly string[]): ThreadMessageLike["content"]` returning a text part followed by `{ type: "tool-call", toolCallId: id, toolName: "approval", args: { requestId: id } }` parts.
- Produces in `workbench-conversation.tsx`: prop `renderApproval?: (requestId: string) => ReactNode`, provided through a context and used by `MessagePrimitive.Parts components={{ Text: ConversationMarkdown, tools: { by_name: { approval: … } } }}`.
- Produces: `ConnectedApprovalCard({ requestId }: { requestId: Id<"approvalRequests"> })`.
- Produces in `ConversationCommandPicker`: prop `grants?: readonly { id: string; label: string; onRevoke: () => void }[]`, rendered as an "Allowed actions" group only when non-empty.

- [ ] **Step 1: Check the installed runtime API**

Run: `grep -rn "by_name\|ToolCallMessagePart\|tool-call" node_modules/@assistant-ui/react/dist/*.d.ts | head`
Expected: `MessagePrimitive.Parts` accepts `components.tools.by_name` and `ThreadMessageLike` content accepts `tool-call` parts. If the names differ, use the installed names and record the difference in the handoff.

- [ ] **Step 2: Write the failing tests**

- `approval-card.test.tsx`: `test("renders the default choices in order and reports the chosen value")` (Deny, Always allow, Allow once); `test("replaces the default choices")`; `test("a disabled choice exposes its reason")` (`toHaveAccessibleDescription`); `test("a superseded request shows no choices")` (Review Focus 4); `test("choices are reachable in order with Tab")`.
- `approvals.test.ts`: `test("the time-limit request names both options in the agreed order")`; `test("approval copy never shows raw codes")` over every action and block code used in Tasks 4–6.
- `connected-start-workspace.test.tsx` (mock `api.execution.approvals.get` in the harness): `test("a notice in the conversation renders its approval card")`; `test("Continue once decides through approvals with the request id")` → `decide` called with `{ requestId, choice: "once" }`; `test("a refused decision shows that it was already decided")` (Review Focus 1); `test("allowed actions can be revoked from the Commands picker")` → `revokeGrant` called with `{ runId, action: "continue_sources_preparation" }`; `test("a card decided with Always offers Stop allowing while its grant is active")` → the receipt button calls `revokeGrant` with the request's action.
- `connected-sources.test.tsx`: `test("the time-limit card replaces the old decision buttons on the Sources page")`.

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm vitest run src/__tests__/components/chat/approval-card.test.tsx src/__tests__/lib/presentation/approvals.test.ts src/__tests__/components/workspace`
Expected: FAIL — modules not found; the old decision component still renders.

- [ ] **Step 4: Implement** the card, presentation, content helper, renderer context, connected card, picker group, workspace wiring and deletion. Use `pnpm dlx shadcn@latest view @assistant-ui/elements-approval-card` only to read the reference source.

- [ ] **Step 5: Run the React suites, lint and typecheck**

Run: `pnpm vitest run src/__tests__/components src/__tests__/lib src/__tests__/routes && pnpm lint && pnpm typecheck`
Expected: PASS; `grep -rn "@convex/_generated/api" src/components/chat src/components/composer` prints nothing.

- [ ] **Step 6: Commit**

```bash
git add src convex/domain/approvalCopy.ts
git commit -m "feat(chat): show approval requests as cards in the conversation and on the pages"
```

---

### Task 9: Reopen dossiers failed by the time-limit defect

**Files:**

- Create: `convex/runRecovery.ts`
- Modify: `convex/researchWorkflow.ts:17-125` (`reattachSources` argument; extract `awaitSourcesHandoff`)
- Modify: `convex/sourcesMission.ts` (internal `reattach`)
- Modify: `convex/execution/missions.ts` (internal `rebindCompletionEvent`; the executor keeps ownership of mission completion fields)
- Test: create `src/__tests__/convex/sources/sources-reopen.test.ts`

**Interfaces:**

- Consumes: `raiseApproval`, `sourcesContinuationAvailable`, `recordResearchObservation`, `workflow.start` as in `convex/workflowControls.ts:53-63`.
- Produces:

```ts
// convex/runRecovery.ts
export const reopenAtSourcesTimeLimit = internalMutation({
    args: { runId: v.id("researchRuns"), reason: v.string() },
    returns: v.object({ reopened: v.boolean(), workflowId: v.union(v.string(), v.null()) }),
});
// convex/sourcesMission.ts
export const reattach = internalMutation({
    args: { preparationId: v.id("sourceSelectionProposalRebuilds"), expectedGeneration: v.number(), workflowId: v.string() },
    returns: v.object({ missionId: v.id("agentMissions"), eventId: vEventId() }),
});
// convex/researchWorkflow.ts
async function awaitSourcesHandoff(step: WorkflowStep, args: {
    preparationId: Id<"sourceSelectionProposalRebuilds">;
    eventId: EventId;
    executionGeneration: number;
    checkpoint: () => Promise<void>;
}): Promise<null>;
```

- Eligibility (refuse with `executionError(code)`): `run_not_eligible` unless `purpose === "research"`, not withdrawn, `executionStatus === "failed"`, documentary lifecycle phase, latest `runEvents` entry `run_failed`; `preparation_not_eligible` unless the current preparation is `started` with no `sourcesMission.result` and no `settlementRequestedAt`; `mission_not_eligible` unless the Sources mission is `blocked` with `execution_deadline` or `operation_outcome_unknown` and `deadlineAt <= now`. `reason` trimmed length 12–500 (as `admin.restoreQuota`). A run that already has a `run_reopened_at_time_limit` audit event returns `{ reopened: false, workflowId: run.workflowId ?? null }`.
- Effects: generation +1; run `paused`, `pauseReason: "sources_time_limit"`, `researchControlRevision` +1, new `workflowId` from `workflow.start(ctx, internal.researchWorkflow.run, { runId, executionGeneration, controlled: true, reattachSources: { preparationId } }, { onComplete, context })`; audit event with `actor: { type: "system" }`; `recordResearchObservation(ctx, runId, "research_time_limit")`. With continuation available: mission `blockCode: "execution_time_limit"` and `raiseApproval` (system, continue with settle alternative). Without: `settlementRequestedAt` set and mission `blockCode: "execution_deadline"`.
- `internal.execution.missions.rebindCompletionEvent({ missionId, eventId, expectedGeneration })` (returns `v.null()`) sets `completionEventId`, clears `completionNotified` and calls `finishChild` when the mission is already terminal and not a recoverable stop. `reattach` creates the event with `workflow.createEvent({ name: "sources:" + preparationId + ":reattach:" + expectedGeneration, workflowId })` and calls it; it never patches mission fields itself. The workflow's reattach branch runs `reattach` before its first checkpoint, then `awaitSourcesHandoff`.

- [ ] **Step 1: Write the failing tests** with a helper `failLikeNovember15(f)` that blocks the mission with `operation_outcome_unknown` past its deadline while the run is `running`, then calls `internal.researchWorkflow.onComplete` with `{ kind: "failed", error: "stale_execution" }` for the run's `workflowId` (set it in the seed):

- `test("a dossier failed by the time-limit defect reopens at the decision")`
- `test("Continue after reopening restarts the same mission")`
- `test("Use what's prepared after reopening hands over with limits")` (run `internal.sourcesMission.finish` as the workflow would after `reattach`)
- `test("a reopened dossier without remaining capacity goes straight to the handover")`
- `test.each([...])("reopening refuses a dossier that did not fail this way: %s")` (not failed, withdrawn, settled preparation, mission not blocked)
- `test("reopening twice does not repeat effects")`
- `test("reopening while another dossier runs succeeds and Continue shows the slot reason")` (Review Focus 5)

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run src/__tests__/convex/sources/sources-reopen.test.ts`
Expected: FAIL — `internal.runRecovery` does not exist.

- [ ] **Step 3: Implement** the recovery mutation, the reattach mutation and the workflow branch; the normal Sources path calls the extracted `awaitSourcesHandoff` unchanged.

- [ ] **Step 4: Run the Sources and workflow suites**

Run: `pnpm vitest run src/__tests__/convex/sources src/__tests__/convex/workflows`
Expected: PASS; watcher push confirmed.

- [ ] **Step 5: Commit**

```bash
git add convex/runRecovery.ts convex/researchWorkflow.ts convex/sourcesMission.ts src/__tests__/convex/sources/sources-reopen.test.ts
git commit -m "feat(recovery): reopen dossiers failed by the Sources time-limit defect"
```

---

### Task 10: Browser gate, references and full verification

**Files:**

- Modify: `convex/execution/fixtures.ts` (`requestApprovalFixture({ runId, fixtureKey })`: enqueues `request_approval` on the fixture's Workbench mission through `internal.execution.operations.enqueue`, as `seedCapturedSources` enqueues its read)
- Modify: `src/__tests__/e2e/sources-time-limit.spec.ts`
- Modify: `PRODUCT.md` (Workbench conversation and research control; Sources handoff paragraph), `context/TECH.md` (§Native commands and delivery; §Sources mission and prepared material; context and recovery), `docs/ROADMAP.md` (dated Phase 7 entry), `docs/decisions/027-settle-sources-at-limits-and-let-the-analyst-renew-the-window.md` (dated supersession note)
- Create: `docs/decisions/028-ask-for-approval-through-general-requests-and-dossier-grants.md`

**Interfaces:**

- Consumes: everything above.

- [ ] **Step 1: Extend the browser spec** (real anonymous admission; 1440px and 390px; reduced motion emulated in one run):

- the time-limit card appears in the conversation and on the Research and Sources pages with "Use what's prepared", "Continue once", "Always continue";
- at 1440px, "Always continue" → research resumes; a second `reachSourcesTimeLimit` continues without a card; the grant appears under "Allowed actions" in the Commands picker and revoking it brings the card back at the next limit;
- at 390px, `requestApprovalFixture` → the Workbench reply shows an approval card with "Deny", "Always allow", "Allow once"; Deny shows the denied receipt and the run is unchanged;
- keyboard: Tab moves through the choices in order; the body text never matches `/approval_|sources_time_limit|execution_time_limit|stale_execution|_research\b/`; no console errors.

- [ ] **Step 2: Run the browser gate**

Run: `npx convex env set E2E_FIXTURES_ENABLED true && pnpm test:e2e src/__tests__/e2e/sources-time-limit.spec.ts; npx convex env remove E2E_FIXTURES_ENABLED && npx convex env list | grep -c E2E_FIXTURES_ENABLED`
Expected: all scenarios PASS; the last command prints `0`.

- [ ] **Step 3: Update the references**

PRODUCT: approvals and grants in the Workbench section; named choices, automatic continuation and "No usable material prepared" in the Sources handoff. TECH: the approvals contract replacing `control_research` as an offered tool, decision exchanges in native delivery, the window setting and mission deadline, the re-attach workflow mode and the reopen recovery. ROADMAP: delivered capability, unverified live `request_approval` behaviour, unmeasured continuation quality, the pending ServiceNow reopen. ADR-028: decision, ruled-out options 2–4, consequences. ADR-027: "Superseded in part on 2026-11-16 by ADR-028: the time-limit decision is an approval request and grants may continue automatically."

- [ ] **Step 4: Run the full checks**

Run: `pnpm docs:check && pnpm check && pnpm build`
Expected: docs check with 0 errors; `pnpm check` passes except failures that also occur on a clean checkout of the base commit (record them with output); build succeeds.

- [ ] **Step 5: Commit**

```bash
git add convex src PRODUCT.md context/TECH.md docs
git commit -m "docs(approvals): record approval requests, grants and Sources time-limit honesty"
```

- [ ] **Step 6: Reopen the ServiceNow dossier only after explicit confirmation**

Run (local deployment, after the user confirms): `pnpm exec convex run runRecovery:reopenAtSourcesTimeLimit '{"runId":"k97ffmp1123pwtp8r4npe32d3x8j9r92","reason":"Failed by the Sources time-limit settlement defect of 2026-11-15"}'`
Expected: `{ "reopened": true, "workflowId": "…" }`; the dossier shows the time-limit card.
