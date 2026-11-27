---
type: structure-outline
repos:
  - identifier: "Decode-Disc/agentic-resilience-workb"
    sha: "4c93c661e3a6b66d20f1dd7bacd5dbbba4a293e7"
---

# Implementation Outline: Qualification Latency Optimization

Implement the approved [Technical Design](04-tdd-qualification-latency-optimization.md) in six independently testable phases: isolate Tier 1 and Tier 2 Convex V8 mutation bundles first so every subsequent harness call drops from ~240–300 ms to ~22–28 ms, then harden `piLease` fencing and collapse pre-call queries, deduplicate the turn loop with atomic local mutations, add the bounded in-slice wait for fast background operations, and finally share the sanitized preflight validation cache across campaigns.

## Desired End State

Hot-path Tier 1 Convex execution mutations (`piStore`, `piControl`, `providerCallReceipts`) compile under `<250 KB` with zero `zod`, `typebox`, `@convex-dev/auth`, or `ai` closures; Tier 2 execution modules (`operations`, `invocationLifecycle`) drop `typebox`, `@earendil-works/pi-ai`, `@convex-dev/auth`, and `@convex/schema`; per-turn RPCs drop from ~25–35 to ~8–12 with writer-epoch fencing across all four paid/mutating boundaries; fast background operations like `readSkillOperation` complete in-slice without cold-restarting the 3.90 MB Node worker; and consecutive qualification lots on the same commit reuse verified preflight results atomically under a sanitized child environment.

## Implementation Overview

- [ ] Phase 1: Isolate Tier 1 V8 hot-path mutations (`piStore`, `piControl`, `providerCallReceipts`) and enforce Tier 1 static boundaries
- [ ] Phase 2: Isolate Tier 2 V8 execution modules (`operations`, `invocationLifecycle`) and enforce Tier 2 static boundaries
- [ ] Phase 3: Enforce `piLease` across all four paid/mutating boundaries and batch `invokeAgentModel` pre-call reads
- [ ] Phase 4: Deduplicate `piMission` turn preparation and add atomic `operations.executeLocal` + `settleLocalRollback`
- [ ] Phase 5: Add `piResultWakeVersion` + `adoptedWakeCount` bounded in-slice wait for fast background operations
- [ ] Phase 6: Share cross-campaign preflight cache with sanitized child environment and atomic publication

## Phase 1: Isolate Tier 1 V8 hot-path mutations (`piStore`, `piControl`, `providerCallReceipts`) and enforce Tier 1 static boundaries

This phase breaks the 2.73 MB V8 transitive closure on the three highest-frequency mutation modules (`piStore`, `piControl`, and the mission-model receipt path) and locks the boundary in `scripts/check-execution-boundaries.ts`. It comes first because cutting per-mutation V8 load from ~240–300 ms to ~22–28 ms delivers the largest latency reduction and provides an immediate static guardrail for all subsequent phases.

### Change Outline

Split pure utilities, pure `convex/values` validators, versioned authority metadata, and hot mission-model receipt mutations into narrow zero-Zod owners:

```diff
 convex/
 ├── domain/
+│   ├── hashing.ts                  # sha256Hex + stableStringify (0 deps; re-exported by sourcePassages.ts)
 │   └── browserFixtureAccess.ts     # adds runMatchesWorkspace alongside workspaceForVisitor
 ├── execution/
+│   ├── tableValidators.ts          # pure convex/values doc/field validators (0 zod; imported by convex/schema.ts & Tier 1)
+│   ├── agentAuthorityCatalog.ts    # single source of truth keyed by (definitionId, version); agentCatalog.ts imports & asserts equality
 │   ├── authority.ts                # imports hashing.ts, browserFixtureAccess.ts, agentAuthorityCatalog.ts
 │   ├── piStore.ts                  # imports tableValidators.ts; legacy inputSnapshot calls ctx.runQuery(internal.execution.context.build)
 │   ├── piControl.ts                # reads analystTurnDeliveries directly; calls suspendInterruptedResearch via ctx.runMutation; uses zero-Zod auxiliary helper
+│   └── providerCallReceipts.ts     # hot mission-model receipt mutations (recordMissionModelAttempt, observeGeneration, requestBilling)
 ├── integrations/
 │   ├── modelRouting.ts             # reads PI_AI_VERSION from @earendil-works/pi-ai/package.json
 │   ├── modelInput.ts               # drops @earendil-works/pi-ai (Type.Unsafe + estimateContextTokens)
+│   └── piModelAdapter.ts           # V8-compatible (no "use node"): piToolMetadata + piRequiredContextTokens (imported by piMission.ts & conversations.ts)
 └── providerCalls.ts                # retains api.providerCalls.retryBilling and framing/acquisition/preparation/admin branches
```

Add transitive value-import enforcement for Tier 1 in `scripts/check-execution-boundaries.ts`:

```ts
const TIER1_ZERO_ZOD_MODULES = [
    "convex/execution/piStore.ts",
    "convex/execution/piControl.ts",
    "convex/execution/providerCallReceipts.ts",
] as const;
// Forbids transitive value imports of: typebox, @earendil-works/pi-ai, @convex-dev/auth, ai, zod, convex-helpers/server/zod4, @convex/schema
```

Update `agentCatalog.ts` so `bindAgentDefinition` asserts structural equality against `getAgentAuthority(definition.id, definition.version)` across all 17 versioned bindings, and update internal callers (`invokeAgentModel.ts`, `piMission.ts`) to call `internal.execution.providerCallReceipts.*` for mission-model receipts.

### Validation

#### Automated Verification

- [ ] `pnpm convex:check` — verifies TypeScript types across all Convex modules after the split.
- [ ] `node --experimental-strip-types scripts/check-execution-boundaries.ts` — verifies Tier 1 transitive import restrictions and `FUNCTION_OWNERS` rules.
- [ ] `node --experimental-strip-types scripts/check-imports.ts` — verifies repository import rules.
- [ ] `pnpm exec vitest run src/__tests__/convex/execution/pi-store.test.ts src/__tests__/convex/execution/pi-storage.test.ts src/__tests__/convex/execution/pi-mission.test.ts` — verifies Pi store, replay, authority, and mission-model receipt behavior unchanged.

#### Manual Verification

- Inspect compiled V8 module closure sizes in `.convex/local/default/convex_local_storage/modules/` after a local backend sync to confirm `piStore.js`, `piControl.js`, and `providerCallReceipts.js` each compile under `<250 KB`.

## Phase 2: Isolate Tier 2 V8 execution modules (`operations`, `invocationLifecycle`) and enforce Tier 2 static boundaries

This phase decouples `operations.ts` and `invocationLifecycle.ts` from `@convex/schema`, `@convex-dev/auth`, `typebox`, and `@earendil-works/pi-ai` while keeping their runtime Zod validation contracts intact. It comes second because Phase 4's `operations.executeLocal` (`adjust_framing`) and Phase 3's `forExecutionBundle` (`modelConfiguration`) depend on pure-DB framing and model-configuration helpers free of `@convex/schema` and `@convex-dev/auth`.

### Change Outline

Extract auth-free, schema-free DB helpers from `framing.ts`, `modelConfiguration.ts`, `conversations.ts`, and `approvals.ts`/`researchState.ts` so Tier 2 modules no longer pull `@convex/schema`, `@convex-dev/auth/server`, or `conversations.ts`:

```diff
 convex/
 ├── framing.ts                      # delegates pure-DB framing persistence to framingCore.ts (retains auth/schema wrappers)
+├── domain/framingCore.ts           # pure-DB saveFraming + applyFromWorkbenchInTx (0 schema, 0 auth)
 ├── modelConfiguration.ts           # delegates pure-DB reads/pinning to modelConfigurationCore.ts (retains requireAdmin/schema)
+├── execution/modelConfigurationCore.ts # pinMissionModel, missionModel, readResponseControlPolicy (0 schema, 0 auth)
 ├── execution/
+│   ├── conversationCore.ts         # requireInstructionVersion, readPreparedTurnWording, publishTurn (0 schema, 0 auth, 0 piModelAdapter)
 │   ├── operations.ts               # imports conversationCore.ts, framingCore.ts, pure approval/researchState helpers
 │   └── invocationLifecycle.ts      # imports conversationCore.ts, modelConfigurationCore.ts
```

Add Tier 2 transitive value-import enforcement in `scripts/check-execution-boundaries.ts`:

```ts
const TIER2_NO_HEAVY_CLOSURE_MODULES = [
    "convex/execution/operations.ts",
    "convex/execution/invocationLifecycle.ts",
] as const;
// Forbids transitive value imports of: typebox, @earendil-works/pi-ai, @convex-dev/auth, @convex/schema
```

### Validation

#### Automated Verification

- [ ] `pnpm convex:check` — verifies Convex backend compilation.
- [ ] `node --experimental-strip-types scripts/check-execution-boundaries.ts` — verifies both Tier 1 and Tier 2 static boundary rules pass.
- [ ] `pnpm exec vitest run src/__tests__/convex/execution/dispatch.test.ts src/__tests__/convex/execution/operation-conformance.test.ts src/__tests__/convex/execution/pi-mission.test.ts` — verifies operation dispatch, framing, and invocation lifecycle regressions pass.

#### Manual Verification

- Inspect compiled V8 module closures for `operations.js` and `invocationLifecycle.js` to confirm `typebox`, `@convex-dev/auth`, and the 703 KB merged super-chunk are eliminated.

## Phase 3: Enforce `piLease` across all four paid/mutating boundaries and batch `invokeAgentModel` pre-call reads

This phase replaces redundant inline `storage.renewLease()` RPCs with atomic writer-epoch fencing across all four paid/mutating boundaries and collapses `invokeControlledGeneration`'s three sequential pre-call queries into one warm V8 query. It comes before turn-loop deduplication so lease safety is locked down before removing inline renewals in `piMission.ts`.

### Change Outline

Add `piLeaseValidator` (`{ sessionId, writer, epoch }`) and enforce `session.missionId === mission._id && session.generation === args.expectedGeneration && session.writer === piLease.writer && session.epoch === piLease.epoch && session.leaseUntil > Date.now()` independently of `args.piSessionId` (`taskKey` stays unchanged):

```diff
 // Enforced on all 4 paid/mutating boundaries when mission.executionRuntime === "pi-durable":
 1. convex/execution/invocationLifecycle.ts -> begin(args)
 2. convex/execution/invocationLifecycle.ts -> retainRequest(args) + authorizeDispatch(args)
 3. convex/execution/providerCallReceipts.ts -> recordMissionModelAttempt(args) (+ providerCalls.ts -> recordAttempt(args))
 4. convex/execution/operations.ts -> claim(args)
 // Reply/cost retention (retainOutput, recordModelReply, observeGeneration) stays expectedGeneration-only.
```

Add `forExecutionBundle` in `convex/execution/invocationLifecycle.ts` and wire it in `convex/execution/invokeAgentModel.ts`:

```ts
// forExecutionBundle returns:
// { ...forExecutionResult, configuredModel: simulated ? null : await missionModel(ctx, mission._id),
//   firstFragment: { kind: "ready", fragment } | { kind: "error", code } }
// invokeControlledGeneration preserves early returns (blocked, !route, !OPENROUTER_API_KEY)
// before checking firstFragment.kind === "error", keeps forExecution (line 286) & executionInputFragment (index >= 1).
```

Drop redundant inline `storage.renewLease()` calls in `convex/integrations/piMission.ts` (`dispatchRetainedOperation`, `submit_completion`, and `beforeDispatch`), threading `storage.lease` as `piLease` through `invokeControlledGeneration` and `dispatchRetainedOperation`.

Add tests in `src/__tests__/convex/execution/pi-mission.test.ts` and `pi-recovery.test.ts` verifying: same-generation epoch takeover (`epoch 1 -> 2`) fences `begin`, `retainRequest`/`recordMissionModelAttempt`/`authorizeDispatch`, and `operations.claim` with `pi_writer_fenced`; mid-stream `retainOutput`/`observeGeneration` still succeeds after lease expiry; `forExecutionBundle` preserves `blocked`/`!route` early returns on corrupt/missing fragments and loops multi-fragment inputs.

### Validation

#### Automated Verification

- [ ] `pnpm convex:check` — verifies updated internal mutation/query signatures.
- [ ] `pnpm exec vitest run src/__tests__/convex/execution/pi-mission.test.ts src/__tests__/convex/execution/pi-recovery.test.ts src/__tests__/convex/execution/pi-native-transport.test.ts` — verifies writer-epoch fencing, pre-call batching, and recovery invariants.

#### Manual Verification

None required for this phase; all fencing and early-return invariants are verified deterministically by `convex-test`.

## Phase 4: Deduplicate `piMission` turn preparation and add atomic `operations.executeLocal` + `settleLocalRollback`

This phase cuts per-turn Convex RPCs from ~25–35 to ~8–12 by eliminating duplicate `afterTools` / `section.render` / `request` round-trips, gating `root.configure` against `AgentDoc`, and executing the four pure-DB local operations inside one atomic `internalMutation`. It depends on Phase 2's pure-DB `framingCore.ts` and Phase 3's `piLease` fencing.

### Change Outline

Update `convex/integrations/piNativeInput.ts` so `synchronize` and `synchronizeObservations` return `{ hadQueued: boolean }` (true whenever any submission returned `status === "queued"` or deferred steering), and update `convex/integrations/piMission.ts`:

```ts
let pendingTurnContext: BuiltMissionContext | null = null;
let afterToolsPrepared = false;
let afterToolsHadQueuedInputs = false;
let activeAgentConfig = await root.agent(context); // seed from AgentDoc, never transcript getCurrentTools

// Startup: guard initial root.configure({ model, thinkingLevel, instructions }) against activeAgentConfig;
//   never populate pendingTurnContext during startup refreshTools().
// afterTools(): settle -> { hadQueued } = syncInputs() -> ctx = refreshTools() (configure only if modelTools changed)
//   pendingTurnContext = ctx; afterToolsPrepared = true; afterToolsHadQueuedInputs = hadQueued;
// section.render(): const ctx = pendingTurnContext ?? await buildContext();
//   if (pendingTurnContext === null) { afterToolsPrepared = false; afterToolsHadQueuedInputs = false; }
//   pendingTurnContext = null;
// onYield() / changedPreparation() / retry: reset all 3 flags to null/false.
// request(): consume skipSettle = afterToolsPrepared, skipSync = afterToolsPrepared && !afterToolsHadQueuedInputs;
//   reset flags BEFORE auxiliary branch; skip settle/sync only when permitted.
```

Add `executeInTransaction?: (ctx: MutationCtx, args: ExecuteOperationArgs) => Promise<unknown>` to `AgentOperationDefinition` (`convex/execution/executionProtocol.ts`) for `consult_mission_state` (keeping its internal `ctx.runQuery(internal.execution.context.build)` sub-query), `consult_conversation`, `consult_run_state`, and `adjust_framing` (via `applyFromWorkbenchInTx` with `recoverableWorkbenchRefusal` scoped strictly before `saveFraming`'s first DB write and receipt size/schema pre-validated before writing).

Add `operations.executeLocal` and authorized `operations.settleLocalRollback` in `convex/execution/operations.ts` (registering ownership in `scripts/check-execution-boundaries.ts`):
- `claimOperationInTx` accepts `atomicLocal?: boolean` to skip `expiryJobId`/`waitEventId` scheduling+cancellation inside the same transaction.
- `executeLocal` enforces `piLease`, preserves `observeOperationOutcome` wrapping, settles unexpected read failures atomically via `settleDispatchFailureInTx`, and lets post-write `adjust_framing` errors propagate to roll back cleanly so `piMission.ts` settles via `operations.settleLocalRollback` (handling `request.status === "pending"`).
- `search_available_material`, `read_in_context`, and external/scheduled operations remain on `operations.dispatch`.

Add tests covering: `adjust_framing` queued observation acknowledgement (no `native_input_changed` loop), analyst steering during `afterTools`, blocking compaction resetting `afterToolsPrepared`, `root.configure` skip on unchanged `AgentDoc.modelTools`, `executeLocal` read refusal/error settlement, `adjust_framing` pre-write refusal vs. post-write rollback via `settleLocalRollback`, and reduced RPC call count in `pi-mission.test.ts`.

### Validation

#### Automated Verification

- [ ] `pnpm convex:check` — verifies Convex types.
- [ ] `node --experimental-strip-types scripts/check-execution-boundaries.ts` — verifies `settleLocalRollback` ownership and Tier 1/Tier 2 boundaries.
- [ ] `pnpm exec vitest run src/__tests__/convex/execution/pi-mission.test.ts src/__tests__/convex/execution/dispatch.test.ts src/__tests__/convex/execution/operation-conformance.test.ts src/__tests__/convex/execution/native-operations.test.ts` — verifies turn-loop deduplication, compaction/queued-input invariants, and `executeLocal` parity.

#### Manual Verification

None required for this phase; all state-machine and rollback invariants are covered deterministically.

## Phase 5: Add `piResultWakeVersion` + `adoptedWakeCount` bounded in-slice wait for fast background operations

This phase eliminates the 3.90 MB Node worker teardown and cold restart on fast background operations (`readSkillOperation`, median 3.10 s) while keeping the durable `pi_slice_complete` fallback intact for long operations (`acquire_document`, `discover_sources_for_need`, `examiner`) and guaranteeing zero lost wakeups or 30 s `unchangedScheduledWait` stalls.

### Change Outline

Add canonical policy constants and schema fields:

```diff
 // convex/resourcePolicy.ts (+ pnpm resource-policy:sync)
+export const PI_IN_SLICE_WAIT_MS = 8_000;
+export const PI_IN_SLICE_POLL_INTERVAL_MS = 300;

 // convex/execution/tableValidators.ts & convex/schema.ts (agentMissions)
+piResultWakeVersion: v.optional(v.number()),
+piPreparedWakeVersion: v.optional(v.number()),
```

Update `operations.recordResult`, `piControl.prepare`, `piControl.closeWorker`, `piControl.operationWakeStatus`, and `piMission.ts`:

```diff
 // convex/execution/operations.ts (recordResult)
 if (mission?.executionRuntime === "pi-durable" && request.status === "waiting" && !request.outcome) {
-    await ctx.db.patch(mission._id, { piResultWakePending: true });
-    await schedulePiMission(ctx, mission._id, args.expectedGeneration);
+    const nextWakeVersion = (mission.piResultWakeVersion ?? 0) + 1;
+    const activeSession = mission.piActiveWriter ? await sessionForMission(ctx, mission) : null;
+    const workerLeaseActive =
+        activeSession?.writer === mission.piActiveWriter && activeSession.leaseUntil > Date.now();
+    await ctx.db.patch(mission._id, {
+        piResultWakeVersion: nextWakeVersion,
+        ...(!workerLeaseActive ? { piResultWakePending: true } : {}),
+    });
+    if (!workerLeaseActive) await schedulePiMission(ctx, mission._id, args.expectedGeneration);
 }

 // convex/execution/piControl.ts
 // prepare: keeps returns: v.boolean(), persists piPreparedWakeVersion: mission.piResultWakeVersion ?? 0
 // operationWakeStatus (Tier 1 warm query): returns { status, outcome }
 // closeWorker(adoptedWakeCount?: number):
-const nextAt = mission.piResultWakePending ? Date.now() : args.at;
+const expectedVersion = (mission.piPreparedWakeVersion ?? 0) + (args.adoptedWakeCount ?? 0);
+const hasUnobservedWake =
+    mission.piResultWakePending === true ||
+    (mission.piResultWakeVersion ?? 0) > expectedVersion;
+if (hasUnobservedWake) await ctx.db.patch(mission._id, { piResultWakePending: true });
+const nextAt = hasUnobservedWake ? Date.now() : args.at;
```

In `convex/integrations/piMission.ts`, `waitBrieflyInSlice(requestId, abortSignal)` runs *before* `api.createTask(waitOperation)` (and in `drainRetainedOperations`), polling `piControl.operationWakeStatus` every `PI_IN_SLICE_POLL_INTERVAL_MS` up to `min(PI_IN_SLICE_WAIT_MS, sliceDeadlineAt - Date.now() - SLICE_YIELD_SAFETY_MS)`. `adoptedWakeCount` increments by `+1` *only after* Pi receives/adopts a terminal outcome for an operation that transitioned from `waiting` in this slice (including an immediate hit inside `waitOperation`), and is passed to `closeWorker`.

Add tests in `src/__tests__/convex/execution/pi-deferred-wake.test.ts` covering: in-slice completion without concurrent `piWorker.run` scheduling; two parallel `sched=True` operations where one finishes during the other's wait (no lost wakeup); `abortSignal` firing before adoption (wake preserved); `closeWorker` setting `piResultWakePending: true` so `unchangedScheduledWait` does not defer by 30 s; `waitOperation` immediate hit advancing `adoptedWakeCount`; and hard worker crash while `workerLeaseActive === true` recovering within `<= PI_SESSION_LEASE_MS`.

### Validation

#### Automated Verification

- [ ] `pnpm resource-policy:check` — verifies synced policy constants across Convex and documentation/checks.
- [ ] `pnpm convex:check` — verifies schema and function types.
- [ ] `pnpm exec vitest run src/__tests__/convex/execution/pi-deferred-wake.test.ts src/__tests__/convex/execution/deferred-operations.test.ts src/__tests__/convex/execution/pi-mission.test.ts` — verifies all wake, concurrency, and crash-recovery invariants.

#### Manual Verification

None required for this phase; timing validation against `convex-local-backend` runs in Phase 6.

## Phase 6: Share cross-campaign preflight cache with sanitized child environment and atomic publication

This phase eliminates duplicate ~2m 52s Vitest `domain-tests` preflight reruns across consecutive lots on the same commit while enforcing strict environment equivalence, symlink/corruption resistance, and atomic concurrent publication, followed by end-to-end local-backend verification of all six phases.

### Change Outline

Update `scripts/evaluations/workbench-browser/protocol.ts` and `campaign.ts`:

```ts
export const PREFLIGHT_ENV_ALLOWLIST = [
    "PATH", "HOME", "TMPDIR", "TMP", "TEMP", "USER", "SHELL",
    "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CONFIG_HOME",
    "NODE_ENV", "NODE_OPTIONS", "TZ", "LC_ALL", "LANG", "CI",
    "SOURCES_PREPARATION_WINDOW_MINUTES", "SOURCES_MISSION_ENABLED",
    "SOURCES_REPLAY_INPUT", "SOURCES_REPLAY_METRICS",
    "WORKBENCH_REVIEW_REASONING", "PI_CODING_AGENT_DIR",
] as const; // plus prefixes "VITEST_", "PNPM_", and "npm_config_"

export function buildPreflightChildEnv(source?: NodeJS.ProcessEnv): Record<string, string>;
export function defaultPreflightCacheRoot(env?: NodeJS.ProcessEnv): string;
export type CheckExecutor = (
    binary: string,
    args: readonly string[],
    signal: AbortSignal,
    env?: Record<string, string>, // 4th optional arg preserves existing 3-arg test stubs
) => Promise<CheckResult>;
```

In `verifyQualificationCandidate(root, fingerprints, execute, { sharedCacheRoot })`:
1. Run `verify()` live SHA-256 on all fingerprinted files.
2. Build `childEnv = buildPreflightChildEnv(process.env)`, read `fingerprintsSha256`, and compute `validationIdentity` including `candidateHash`, `fingerprintsSha256`, `checks`, `node`, `executable`, `tools`, and `childEnv`.
3. Check hardened local cache hit in `root/validation.json` first (preserving lot-copy and local-only callers).
4. If `sharedCacheRoot` is set, check `readVerifiedCacheHit(cacheDir, expected)` (asserting `lstatSync` non-symlink directories on `candidateDir`, `cacheDir`, `checks/`, non-symlink regular files on `validation.json` + all 6 `checks/<id>.log`, `try/catch` JSON parse, matching `candidateHash`/`fingerprintsSha256`/`validationIdentity`, and exact 6 passed `check.id`s); on hit, copy artifacts into `root` (`0o600`).
5. On miss, `mkdirSync(candidateDir, { recursive: true, mode: 0o700 })`, stage checks in `join(candidateDir, ".tmp-" + process.pid + "-" + randomUUID())` (`0o700`) executing `pnpm` with `{ env: childEnv }`; on failure write diagnostics only to campaign `root` and remove staging dir; on success + final `verify()`, write `status: "passed"` (`0o600`) and atomically `renameSync(stagingDir, cacheDir)` (on `EEXIST`/`ENOTEMPTY`/`ENOTDIR`, verify winner with `readVerifiedCacheHit` *before* removing `stagingDir`, falling back to `stagingDir` if winner is invalid), then copy to `root`.
6. Pass `{ sharedCacheRoot: defaultPreflightCacheRoot() }` in `scripts/evaluations/workbench-browser/campaign.ts:2127`.

Add tests in `src/__tests__/config/workbench-protocol.test.mjs` covering: cross-campaign cache hit with differing unrelated ambient env vars, sanitized `env` passed to `execute`, corrupt JSON treated as miss, symlink rejection on both parent dir and log files, `fingerprintsSha256` serialization mismatch isolation, and concurrent `EEXIST`/`ENOTEMPTY` atomic publish (both valid and corrupt winner cases).

### Validation

#### Automated Verification

- [ ] `pnpm test:protocol` — verifies `workbench-protocol.test.mjs`, `qualification-campaign.test.mjs`, and `qualification-v2.test.mjs`.
- [ ] `pnpm typecheck` — verifies full TypeScript type safety across frontend, scripts, and Convex.
- [ ] `pnpm lint` — verifies Biome lint, import checks, execution boundaries (Tier 1 + Tier 2), and resource policy checks.
- [ ] `pnpm format:check` — verifies formatting.
- [ ] Run all 6 real preflight checks once under `buildPreflightChildEnv(process.env)` via a local `verifyQualificationCandidate` smoke check to confirm `pnpm@12.16.0` and Vitest succeed under the sanitized environment.

#### Manual Verification

- Run an isolated `convex-local-backend` timing probe (zero paid calls) and compare compiled V8 bundle sizes and per-mutation / per-turn latencies against the baseline recorded in [03-research-qualification-latency-optimization.md](03-research-qualification-latency-optimization.md).
- Verify two back-to-back preflight runs on the same commit in separate campaign directories hit the shared cache on the second run (0 s Vitest rerun) while leaving both campaign archives self-contained.

## Open Questions

None.
