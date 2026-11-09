import { internal } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import {
    internalAction,
    internalMutation,
    internalQuery,
    type MutationCtx,
    type QueryCtx,
} from "@convex/_generated/server";
import {
    claimCorpusApprovedRunExecution,
    claimPausedRunExecution,
} from "@convex/domain/executionClaim";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import { upsertSourceReviewItem } from "@convex/domain/sourceReviewProjection";
import { initializeFraming } from "@convex/framing";
import {
    agentInputByteLength,
    preparePiSimulationRequest,
} from "@convex/integrations/modelInput";
import { resolveReasoningPreference } from "@convex/integrations/modelRouting";
import {
    readResponseControlPolicy,
    requireReasoningEffort,
    resolveAgentModel,
    revisionRoute,
} from "@convex/modelConfiguration";
import {
    effectiveModelConfiguration,
    qualificationReasoningSelection,
} from "@convex/modelConfigurationSchema";
import { requireQualifiedBrowserMission } from "@convex/providerCalls";
import { campaignConfiguration } from "@convex/qualificationCampaignPolicy";
import { requireCampaignLot } from "@convex/qualificationCampaigns";
import {
    initializeQualificationUsage,
    readQualificationUsage,
} from "@convex/qualificationUsage";
import {
    BROWSER_QUALIFICATION_MAX_COST_USD,
    BROWSER_QUALIFICATION_MAX_REQUESTS,
    MAX_SOURCES_QUALIFICATION_RECEIPTS,
} from "@convex/resourceLimits";
import {
    BROWSER_TEST_SLOT,
    requireBrowserFixtureContext,
    requireBrowserTestOwner,
} from "@convex/runWorkspace";
import schema from "@convex/schema";
import { workflow } from "@convex/workflow";
import type { WorkflowId } from "@convex-dev/workflow";
import {
    paginationOptsValidator,
    paginationResultValidator,
} from "convex/server";
import { type Infer, v } from "convex/values";
import { getAgentDefinition } from "./agentCatalog";
import { agentToolSchemas } from "./agentDefinition";
import { requireMissionAuthority } from "./authority";
import { submitAuthorizedMessage } from "./conversations";
import {
    agentBackendValidator,
    DEFAULT_AGENT_BACKEND,
} from "./executionProtocol";
import { admittedInputJson } from "./journal";
import { completeRetainedText, retainedTextPage } from "./retainedText";

/** Validates retained fixture provenance without granting or renewing execution authority. */
async function readLocalFixtureRun(
    ctx: MutationCtx | QueryCtx,
    args: { runId: Id<"researchRuns">; fixtureKey: string },
) {
    const visitor = await requireBrowserTestOwner(ctx, BROWSER_TEST_SLOT);
    const run = await ctx.db.get(args.runId);
    const context = run?.browserTestContextId
        ? await ctx.db.get(run.browserTestContextId)
        : null;
    if (
        !/^[a-z0-9-]{1,80}$/.test(args.fixtureKey) ||
        run?.purpose !== "browser_test" ||
        run.ownerVisitorId !== visitor._id ||
        context?.ownerVisitorId !== visitor._id ||
        !run.reservationKey?.endsWith(`:${args.fixtureKey}`)
    )
        throw new Error("Local simulation scope required");
    return { run, visitor };
}

export async function requireLocalFixtureRun(
    ctx: MutationCtx | QueryCtx,
    args: { runId: Id<"researchRuns">; fixtureKey: string },
) {
    const scope = await readLocalFixtureRun(ctx, args);
    const contextId = await requireBrowserFixtureContext(ctx, scope.visitor);
    if (scope.run.browserTestContextId !== contextId)
        throw new Error("Local simulation scope required");
    return scope;
}

const campaignDossier = v.object({
    runId: v.id("researchRuns"),
    fixtureKey: v.string(),
    scenarioId: v.string(),
});
async function requireCampaignScenarios(
    ctx: QueryCtx,
    dossiers: {
        runId: Id<"researchRuns">;
        fixtureKey: string;
        scenarioId: string;
    }[],
) {
    const visitor = await requireBrowserTestOwner(ctx, BROWSER_TEST_SLOT);
    const contextId = await requireBrowserFixtureContext(ctx, visitor);
    const context = await ctx.db.get(contextId);
    if (!context?.campaignLotId)
        throw new Error("Active campaign scenario scope required");
    const { campaign } = await requireCampaignLot(ctx, context.campaignLotId);
    const m = campaign.manifest;
    if (
        m.version === 1 ||
        dossiers.length !== m.scenarios.length ||
        new Set(dossiers.map((d) => d.runId)).size !== dossiers.length ||
        new Set(dossiers.map((d) => d.scenarioId)).size !== dossiers.length
    )
        throw new Error("Campaign scenario binding mismatch");
    for (const entry of dossiers) {
        const { run } = await requireLocalFixtureRun(ctx, entry);
        const scenario = m.scenarios.find((s) => s.id === entry.scenarioId);
        if (
            !scenario ||
            run.companySnapshot?.cik.replace(/^0+/, "") !==
                scenario.company.cik.replace(/^0+/, "") ||
            run.researchStartedAt !== undefined ||
            run.lifecycleState !== "framing"
        )
            throw new Error("Campaign scenario binding mismatch");
    }
    return {
        context,
        manifest: m,
        bindings: dossiers.map((d) => ({ id: d.scenarioId, runId: d.runId })),
    };
}
/** Binds unpaid simulation dossiers before the first turn; the immutable mandate owns their identity. */
export const bindCampaignScenarios = internalMutation({
    args: { dossiers: v.array(campaignDossier) },
    returns: v.null(),
    handler: async (ctx, args) => {
        const { context, manifest, bindings } = await requireCampaignScenarios(
            ctx,
            args.dossiers,
        );
        if (manifest.mode !== "deterministic" || context.paidQualification)
            throw new Error("Unpaid campaign scenarios required");
        if (
            context.simulatedScenarios &&
            stableStringify(context.simulatedScenarios) !==
                stableStringify(bindings)
        )
            throw new Error("Campaign scenario bindings are immutable");
        await ctx.db.patch(context._id, { simulatedScenarios: bindings });
        await initializeQualificationUsage(
            ctx,
            context._id,
            bindings.map((binding) => binding.runId),
        );
        return null;
    },
});

/** Uses the admitted local test workspace; an approved corpus is deliberately unnecessary. */
export const startValidation = internalAction({
    args: {
        fixtureKey: v.string(),
        generationBackend: v.optional(agentBackendValidator),
        largeJournal: v.optional(v.boolean()),
    },
    returns: v.id("agentMissions"),
    handler: async (ctx, args): Promise<Id<"agentMissions">> => {
        await ctx.runQuery(internal.execution.fixtures.authorize, {});
        const base = await ctx.runAction(
            internal.e2eFixtures.seedInspectedSourceReviewScenario,
            { slotKey: BROWSER_TEST_SLOT, fixtureKey: args.fixtureKey },
        );
        return ctx.runMutation(internal.execution.fixtures.activateValidation, {
            runId: base.runId,
            fixtureKey: args.fixtureKey,
            largeJournal: args.largeJournal,
            ...(args.generationBackend
                ? { generationBackend: args.generationBackend }
                : {}),
        });
    },
});

export const activateValidation = internalMutation({
    args: {
        runId: v.id("researchRuns"),
        fixtureKey: v.string(),
        generationBackend: v.optional(agentBackendValidator),
        largeJournal: v.optional(v.boolean()),
    },
    returns: v.id("agentMissions"),
    handler: async (ctx, args): Promise<Id<"agentMissions">> => {
        const { run, visitor } = await requireLocalFixtureRun(ctx, args);
        if (args.largeJournal && args.generationBackend?.id !== "pi-durable")
            throw new Error(
                "Large journal fixture requires the native backend",
            );
        const existing = await ctx.db
            .query("agentMissions")
            .withIndex("by_run_and_request_key", (q) =>
                q.eq("runId", run._id).eq("requestKey", "local-validation"),
            )
            .unique();
        if (existing) {
            const previous =
                existing.generationBackend ?? DEFAULT_AGENT_BACKEND;
            const selected = args.generationBackend ?? DEFAULT_AGENT_BACKEND;
            if (
                previous.id !== selected.id ||
                previous.version !== selected.version
            )
                throw new Error("Fixture backend configuration conflict");
            if (
                Boolean(args.largeJournal) !==
                (existing.blockCode === "fixture_inspection_only")
            )
                throw new Error("Fixture journal configuration conflict");
            return existing._id;
        }
        const generation = await claimPausedRunExecution(ctx, {
            visitor,
            run,
            checkpoint: {
                lifecycleState: "awaiting_source_review",
                pauseReason: "source_review",
            },
            now: Date.now(),
        });
        if (run.workflowId)
            await workflow.cancel(ctx, run.workflowId as WorkflowId);
        await ctx.db.patch(run._id, {
            workflowId: undefined,
            lifecycleState: "extracting_evidence",
            companySnapshot: run.companySnapshot
                ? {
                      ...run.companySnapshot,
                      legalName:
                          "Agent contract validation · Simulation · Not live",
                  }
                : undefined,
            nextEventSequence: run.nextEventSequence + 1,
        });
        await ctx.db.insert("runEvents", {
            runId: run._id,
            sequence: run.nextEventSequence + 1,
            type: "run_transitioned",
            lifecycleState: "extracting_evidence",
            executionStatus: "running",
            occurredAt: Date.now(),
        });
        const missionId: Id<"agentMissions"> = await ctx.runMutation(
            internal.execution.missions.start,
            {
                runId: run._id,
                definitionId: "execution_validation_v1",
                scope: { kind: "execution_validation_v1", values: [3, 7] },
                requestKey: "local-validation",
                expectedGeneration: generation,
                ...(args.generationBackend
                    ? { generationBackend: args.generationBackend }
                    : {}),
            },
        );
        await ctx.runMutation(internal.execution.missions.resume, {
            missionId,
            expectedGeneration: generation,
            simulation: true,
        });
        if (args.largeJournal) {
            const begun = await ctx.runMutation(
                internal.execution.invocations.begin,
                {
                    missionId,
                    expectedGeneration: generation,
                    taskKey: "fragmented-journal-fixture",
                    provenance: "simulation",
                },
            );
            if (begun.kind !== "ready")
                throw new Error("Local journal fixture could not be admitted");
            const observation = {
                kind: "blocked" as const,
                code: "fixture_inspection_only",
            };
            await ctx.runMutation(
                internal.execution.invocations.retainRequest,
                {
                    invocationId: begun.invocationId,
                    expectedGeneration: generation,
                    requestJson: preparePiSimulationRequest([
                        {
                            role: "user",
                            content:
                                "Retained local verification text. ".repeat(
                                    23000,
                                ),
                            timestamp: 0,
                        },
                    ]).json,
                },
            );
            await ctx.runMutation(internal.execution.invocations.retainOutput, {
                invocationId: begun.invocationId,
                expectedGeneration: generation,
                responseJson: JSON.stringify(observation),
                observableReplyJson: JSON.stringify({
                    version: 1,
                    provenance: "simulation",
                    response: observation,
                }),
            });
            await ctx.runMutation(internal.execution.invocations.finish, {
                invocationId: begun.invocationId,
                expectedGeneration: generation,
                response: observation,
            });
        }
        return missionId;
    },
});

/** Seeds the approved-corpus precondition for a labelled simulation; the separate review gate verifies human approval. */
export const start = internalAction({
    args: {
        fixtureKey: v.string(),
        generationBackend: v.optional(agentBackendValidator),
    },
    returns: v.id("agentMissions"),
    handler: async (ctx, args): Promise<Id<"agentMissions">> => {
        await ctx.runQuery(internal.execution.fixtures.authorize, {});
        const base = await ctx.runAction(
            internal.e2eFixtures.seedInspectedSourceReviewScenario,
            { slotKey: BROWSER_TEST_SLOT, fixtureKey: args.fixtureKey },
        );
        return ctx.runMutation(internal.execution.fixtures.activate, {
            runId: base.runId,
            fixtureKey: args.fixtureKey,
            ...(args.generationBackend
                ? { generationBackend: args.generationBackend }
                : {}),
        });
    },
});

export const authorize = internalQuery({
    args: {},
    returns: v.null(),
    handler: async (ctx) => {
        const visitor = await requireBrowserTestOwner(ctx, BROWSER_TEST_SLOT);
        await requireBrowserFixtureContext(ctx, visitor);
        return null;
    },
});

export const activate = internalMutation({
    args: {
        runId: v.id("researchRuns"),
        fixtureKey: v.string(),
        generationBackend: v.optional(agentBackendValidator),
    },
    returns: v.id("agentMissions"),
    handler: async (ctx, args): Promise<Id<"agentMissions">> => {
        const { run, visitor } = await requireLocalFixtureRun(ctx, args);
        if (!run.activeCorpusRevisionId)
            throw new Error("Local simulation scope required");
        const existing = await ctx.db
            .query("agentMissions")
            .withIndex("by_run_and_request_key", (q) =>
                q.eq("runId", run._id).eq("requestKey", "local-simulation"),
            )
            .unique();
        if (existing) {
            const previous =
                existing.generationBackend ?? DEFAULT_AGENT_BACKEND;
            const selected = args.generationBackend ?? DEFAULT_AGENT_BACKEND;
            if (
                previous.id !== selected.id ||
                previous.version !== selected.version
            )
                throw new Error("Fixture backend configuration conflict");
            return existing._id;
        }
        const revision = await ctx.db.get(run.activeCorpusRevisionId);
        if (
            run.lifecycleState !== "awaiting_source_review" ||
            run.executionStatus !== "paused" ||
            revision?.status !== "draft" ||
            !revision.sourceSelectionProposalId
        )
            throw new Error("Fresh simulation fixture required");
        const proposalId = revision.sourceSelectionProposalId;
        const items = await ctx.db
            .query("sourceSelectionProposalItems")
            .withIndex("by_proposal_and_source", (q) =>
                q.eq("proposalId", proposalId),
            )
            .take(9);
        if (items.length > 8 || !items.some((item) => item.sourceCaptureId))
            throw new Error("Bounded captured fixture required");
        const now = Date.now();
        for (const item of items) {
            if (!item.sourceCaptureId) continue;
            const source = await ctx.db.get(item.sourceId);
            if (!source || source.runId !== run._id)
                throw new Error("Fixture source unavailable");
            const decisionId = await ctx.db.insert("sourceDecisions", {
                runId: run._id,
                corpusRevisionId: revision._id,
                sourceId: source._id,
                decisionKey: `simulation:${source._id}`,
                decision: "accepted",
                reason: "Simulation precondition; no analyst judgment is asserted.",
                occurredAt: now,
            });
            await upsertSourceReviewItem(ctx, {
                runId: run._id,
                corpusRevisionId: revision._id,
                sourceId: source._id,
                decision: "accepted",
                sourceCreatedAt: source.createdAt,
                latestDecisionId: decisionId,
                decisionOccurredAt: now,
            });
        }
        if (run.workflowId) {
            await ctx.db.patch(run._id, { workflowId: undefined });
            await workflow.cancel(ctx, run.workflowId as WorkflowId);
        }
        await ctx.db.patch(revision._id, {
            status: "approved",
            approvedAt: now,
        });
        await ctx.db.patch(run._id, {
            lifecycleState: "corpus_approved",
            executionStatus: "idle",
            pauseReason: undefined,
            companySnapshot: run.companySnapshot
                ? {
                      ...run.companySnapshot,
                      legalName: "Agent harness simulation · Not live",
                  }
                : undefined,
        });
        const prepared = await ctx.db.get(run._id);
        if (!prepared) throw new Error("Fixture unavailable");
        const generation = await claimCorpusApprovedRunExecution(ctx, {
            visitor,
            run: prepared,
            now,
        });
        await ctx.db.patch(run._id, {
            nextEventSequence: run.nextEventSequence + 1,
        });
        await ctx.db.insert("runEvents", {
            runId: run._id,
            sequence: run.nextEventSequence + 1,
            type: "run_transitioned",
            lifecycleState: "extracting_evidence",
            executionStatus: "running",
            occurredAt: now,
        });
        const missionId: Id<"agentMissions"> = await ctx.runMutation(
            internal.execution.missions.start,
            {
                runId: run._id,
                corpusRevisionId: revision._id,
                definitionId: "saved_material_inspection_v1",
                requestKey: "local-simulation",
                expectedGeneration: generation,
                ...(args.generationBackend
                    ? { generationBackend: args.generationBackend }
                    : {}),
            },
        );
        await ctx.runMutation(internal.execution.missions.resume, {
            missionId,
            expectedGeneration: generation,
            simulation: true,
        });
        return missionId;
    },
});

export const inspect = internalQuery({
    args: { missionId: v.id("agentMissions") },
    returns: v.object({
        runId: v.id("researchRuns"),
        status: v.string(),
        blockCode: v.union(v.string(), v.null()),
        provenance: v.optional(
            v.union(v.literal("live"), v.literal("simulation")),
        ),
        operations: v.array(v.string()),
        outcomes: v.array(v.union(v.string(), v.null())),
        generationBackends: v.array(v.union(agentBackendValidator, v.null())),
        backendStorageCount: v.number(),
        invocationCount: v.number(),
        observedInvocationCount: v.number(),
        contextIncludesReturnedQuotation: v.boolean(),
        providerCallCount: v.number(),
        completionCount: v.number(),
        runExecutionStatus: v.string(),
        conversationTurnStatus: v.union(v.string(), v.null()),
        conversationQueuedCount: v.number(),
    }),
    handler: async (ctx, args) => {
        const visitor = await requireBrowserTestOwner(ctx, BROWSER_TEST_SLOT);
        const contextId = await requireBrowserFixtureContext(ctx, visitor);
        const mission = await ctx.db.get(args.missionId);
        const run = mission ? await ctx.db.get(mission.runId) : null;
        if (
            !mission ||
            run?.purpose !== "browser_test" ||
            run.ownerVisitorId !== visitor._id ||
            run.browserTestContextId !== contextId ||
            ![
                "local-simulation",
                "local-validation",
                "local-conversation",
            ].includes(mission.requestKey)
        )
            throw new Error("Local simulation scope required");
        const invocations = await ctx.db
            .query("agentInvocations")
            .withIndex("by_mission", (q) => q.eq("missionId", mission._id))
            .take(21);
        const requests = await ctx.db
            .query("agentOperationRequests")
            .withIndex("by_mission", (q) => q.eq("missionId", mission._id))
            .take(21);
        const calls = await ctx.db
            .query("providerCalls")
            .withIndex("by_run", (q) => q.eq("runId", run._id))
            .take(2);
        if (invocations.length > 20 || requests.length > 20)
            throw new Error("Simulation inspection capacity exceeded");
        const quoted = requests.find(
            (request) => request.input.kind === "read_in_context",
        );
        let quotation: string | undefined;
        if (quoted?.outcome?.kind === "success") {
            try {
                const parsed = JSON.parse(quoted.outcome.valueJson) as {
                    passage?: { exactQuote?: string };
                };
                quotation = parsed.passage?.exactQuote;
            } catch {
                throw new Error("Invalid retained simulation result");
            }
        }
        const turn = mission.conversationTurnId
            ? await ctx.db.get(mission.conversationTurnId)
            : null;
        const conversation = turn
            ? await ctx.db.get(turn.conversationId)
            : null;
        return {
            runExecutionStatus: run.executionStatus,
            conversationTurnStatus: turn?.status ?? null,
            conversationQueuedCount: conversation?.queuedCount ?? 0,
            runId: run._id,
            status: mission.status,
            blockCode: mission.blockCode ?? null,
            provenance: mission.provenance,
            operations: requests.map((request) => request.input.kind),
            outcomes: requests.map((request) => request.outcome?.kind ?? null),
            generationBackends: invocations.map(
                (invocation) => invocation.generationBackend ?? null,
            ),
            backendStorageCount: invocations.filter(
                (invocation) => invocation.generationStorageRef !== undefined,
            ).length,
            invocationCount: invocations.length,
            observedInvocationCount: invocations.filter(
                (invocation) => invocation.receivedOutputJson,
            ).length,
            contextIncludesReturnedQuotation:
                !!quotation &&
                (
                    await Promise.all(
                        invocations.map((invocation) =>
                            admittedInputJson(ctx, invocation),
                        ),
                    )
                ).some((input) =>
                    input.includes(JSON.stringify(quotation).slice(1, -1)),
                ),
            providerCallCount: calls.length,
            completionCount:
                "protocolVersion" in mission
                    ? mission.result?.kind === "saved_material_inspection_v1"
                        ? mission.result.captureIds.length
                        : 0
                    : mission.completionRefs.length,
        };
    },
});

const conversationFixtureResult = v.object({
    missionId: v.id("agentMissions"),
    requestId: v.id("agentOperationRequests"),
    kind: v.union(v.literal("created"), v.literal("retained")),
});

export const activateConversation = internalMutation({
    args: {
        runId: v.id("researchRuns"),
        fixtureKey: v.string(),
        generationBackend: v.optional(agentBackendValidator),
    },
    returns: conversationFixtureResult,
    handler: async (
        ctx,
        args,
    ): Promise<Infer<typeof conversationFixtureResult>> => {
        const { run } = await requireLocalFixtureRun(ctx, args);
        const existing = await ctx.db
            .query("agentMissions")
            .withIndex("by_run_and_request_key", (q) =>
                q.eq("runId", run._id).eq("requestKey", "local-conversation"),
            )
            .unique();
        if (existing) {
            const selected = args.generationBackend ?? DEFAULT_AGENT_BACKEND;
            const previous =
                existing.generationBackend ?? DEFAULT_AGENT_BACKEND;
            if (
                selected.id !== previous.id ||
                selected.version !== previous.version
            )
                throw new Error("Fixture backend configuration conflict");
            const requests = await ctx.db
                .query("agentOperationRequests")
                .withIndex("by_mission", (q) => q.eq("missionId", existing._id))
                .take(5);
            const request = requests.find(
                (item) => item.input.kind === "wait_fixture_result",
            );
            if (!request) throw new Error("Fixture continuation missing");
            return {
                missionId: existing._id,
                requestId: request._id,
                kind: "retained",
            };
        }
        await submitAuthorizedMessage(
            ctx,
            {
                runId: run._id,
                requestKey: "fixture-initial",
                text: "Simulation only: explain retained work.",
                delivery: "queue",
            },
            { type: "system" },
        );
        const turnId = await ctx.runMutation(
            internal.execution.conversations.claimTurn,
            { runId: run._id },
        );
        if (!turnId) throw new Error("Conversation turn required");
        const missionId: Id<"agentMissions"> = await ctx.runMutation(
            internal.execution.missions.start,
            {
                runId: run._id,
                definitionId: "conversation_validation_v1",
                scope: { kind: "conversation_validation_v1" },
                conversationTurnId: turnId,
                requestKey: "local-conversation",
                expectedGeneration: 1,
                generationBackend: args.generationBackend,
            },
        );
        await submitAuthorizedMessage(
            ctx,
            {
                runId: run._id,
                requestKey: "fixture-queued",
                text: "queued-follow-up-fixture",
                delivery: "queue",
            },
            { type: "system" },
        );
        await submitAuthorizedMessage(
            ctx,
            {
                runId: run._id,
                requestKey: "fixture-steer",
                text: "Simulation only: keep the scope narrow.",
                delivery: "steer",
                turnId,
            },
            { type: "system" },
        );
        const requestId = await ctx.runMutation(
            internal.execution.operations.enqueue,
            {
                missionId,
                expectedGeneration: 1,
                cause: "local-deterministic-service",
                input: { kind: "wait_fixture_result", value: 7 },
            },
        );
        return { missionId, requestId, kind: "created" };
    },
});
export const startConversation = internalAction({
    args: {
        fixtureKey: v.string(),
        generationBackend: v.optional(agentBackendValidator),
    },
    returns: v.id("agentMissions"),
    handler: async (ctx, args): Promise<Id<"agentMissions">> => {
        await ctx.runQuery(internal.execution.fixtures.authorize, {});
        const base = await ctx.runAction(
            internal.e2eFixtures.seedInspectedSourceReviewScenario,
            { slotKey: BROWSER_TEST_SLOT, fixtureKey: args.fixtureKey },
        );
        const created = await ctx.runMutation(
            internal.execution.fixtures.activateConversation,
            { ...args, runId: base.runId },
        );
        if (created.kind === "retained") return created.missionId;
        await ctx.runAction(internal.execution.operations.dispatch, {
            requestId: created.requestId,
            expectedGeneration: 1,
        });
        await ctx.runMutation(internal.execution.missions.resume, {
            missionId: created.missionId,
            expectedGeneration: 1,
            simulation: true,
        });
        await ctx.scheduler.runAfter(
            500,
            internal.domain.conversationValidation.completeDeferred,
            { requestId: created.requestId, expectedGeneration: 1 },
        );
        return created.missionId;
    },
});

/** Authorizes one bounded local inference lot, without enabling research or changing a human workspace. */
export const authorizeWorkbenchQualification = internalMutation({
    args: {
        runId: v.id("researchRuns"),
        fixtureKey: v.string(),
        dossiers: v.optional(v.array(campaignDossier)),
        relayOrigin: v.optional(v.string()),
        maximumRequests: v.optional(v.number()),
        maximumCostUsd: v.optional(v.number()),
        responseControllerModel: v.optional(v.string()),
        reasoningSelection: v.optional(qualificationReasoningSelection),
        expectedModels: v.optional(
            v.object({ workbench: v.string(), sources: v.string() }),
        ),
        sourcesLot: v.optional(
            v.array(
                v.object({
                    runId: v.id("researchRuns"),
                    fixtureKey: v.string(),
                    scenarioId: v.optional(v.string()),
                }),
            ),
        ),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const { run, visitor } = await requireLocalFixtureRun(ctx, args);
        const contextId = await requireBrowserFixtureContext(ctx, visitor);
        const context = await ctx.db.get(contextId);
        if (!context) throw new Error("Active browser context required");
        const scope = context.campaignLotId
            ? await requireCampaignLot(ctx, context.campaignLotId)
            : null;
        const configurable =
            scope && scope.campaign.manifest.version !== 1
                ? scope.campaign.manifest
                : null;
        const dossierEntries =
            args.dossiers ??
            args.sourcesLot?.map((e) => ({
                ...e,
                scenarioId: e.scenarioId ?? "",
            }));
        const scenarioScope =
            configurable && dossierEntries
                ? await requireCampaignScenarios(ctx, dossierEntries)
                : null;
        if (configurable && !scenarioScope)
            throw new Error("Declared campaign scenarios required");
        const requestCeiling =
            configurable?.perLot.model ??
            (args.sourcesLot ? 40 : BROWSER_QUALIFICATION_MAX_REQUESTS);
        const costCeiling =
            configurable?.perLot.costUsd ??
            (args.sourcesLot ? 2 : BROWSER_QUALIFICATION_MAX_COST_USD);
        const maximumRequests = args.maximumRequests ?? requestCeiling;
        const maximumCostUsd = args.maximumCostUsd ?? costCeiling;
        if (
            !Number.isSafeInteger(maximumRequests) ||
            maximumRequests < 1 ||
            maximumRequests > requestCeiling ||
            !Number.isFinite(maximumCostUsd) ||
            maximumCostUsd <= 0 ||
            maximumCostUsd > costCeiling
        )
            throw new Error("Invalid qualification limits");
        if (
            args.relayOrigin !== undefined &&
            !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(args.relayOrigin)
        )
            throw new Error("Invalid qualification relay origin");
        if (args.relayOrigin) {
            try {
                if (new URL(args.relayOrigin).port === "")
                    throw new Error("Invalid qualification relay origin");
            } catch {
                throw new Error("Invalid qualification relay origin");
            }
        }
        if (
            run.researchStartedAt !== undefined ||
            !["framing", "awaiting_source_review"].includes(run.lifecycleState)
        )
            throw new Error("Unlaunched Workbench fixture required");

        const conversation = await ctx.db
            .query("agentConversations")
            .withIndex("by_run", (q) => q.eq("runId", run._id))
            .unique();
        const configuredModel = await resolveAgentModel(
            ctx,
            "workbench",
            conversation?.modelCatalogId,
        );
        const selectedProfile =
            configurable && scope
                ? campaignConfiguration(configurable, scope.lot.configurationId)
                : null;
        const model = selectedProfile
            ? {
                  ...configuredModel,
                  reasoningEffort: resolveReasoningPreference(
                      configuredModel.descriptor,
                      selectedProfile.models.workbench.reasoning,
                  ),
              }
            : configuredModel;
        requireReasoningEffort(model, model.reasoningEffort);
        const sourcesLot = args.sourcesLot?.map((entry) => entry.runId);
        const sourcesModel = args.sourcesLot
            ? await resolveAgentModel(ctx, "sources")
            : undefined;
        if (
            args.expectedModels &&
            (args.expectedModels.workbench !== model.model ||
                args.expectedModels.sources !== sourcesModel?.model)
        )
            throw new Error("Qualification model configuration mismatch");
        if (args.reasoningSelection) {
            if (!sourcesModel)
                throw new Error("Sources qualification models required");
            for (const [role, configuration] of [
                ["workbench", model],
                ["sources", sourcesModel],
            ] as const) {
                const preference = args.reasoningSelection[role];
                const effective = resolveReasoningPreference(
                    configuration.descriptor,
                    preference,
                );
                requireReasoningEffort(configuration, effective);
                const configuredEffort =
                    role === "workbench"
                        ? (conversation?.reasoningEffort ??
                          configuration.reasoningEffort)
                        : configuration.reasoningEffort;
                if (configuredEffort !== effective)
                    throw new Error(
                        `Prepare the ${role} reasoning preference before authorizing this lot`,
                    );
            }
        }
        if (args.sourcesLot) {
            if (
                args.relayOrigin ||
                sourcesLot?.length !== (configurable?.scenarios.length ?? 2) ||
                new Set(sourcesLot).size !==
                    (configurable?.scenarios.length ?? 2) ||
                !sourcesLot.includes(run._id) ||
                !sourcesModel
            )
                throw new Error("Invalid Sources qualification lot");
            const definition = getAgentDefinition("sources_v1");
            for (const operations of definition.nativeToolSets?.(
                definition.operations,
            ) ?? [agentToolSchemas(definition)]) {
                await agentInputByteLength(
                    {
                        instructions: definition.instructions,
                        prompt: "",
                        operations,
                        definitionVersion: definition.version,
                        nativeConversation: definition.nativeConversation,
                        contextRendering: definition.contextRendering,
                        nativeRoute: revisionRoute(sourcesModel),
                    },
                    async (key) =>
                        (
                            await ctx.db
                                .query("nativeInputProfiles")
                                .withIndex("by_key", (q) => q.eq("key", key))
                                .unique()
                        )?.bytes,
                );
            }
            for (const entry of args.sourcesLot) {
                const owned = await requireLocalFixtureRun(ctx, entry);
                if (configurable) {
                    const scenario = configurable.scenarios.find(
                        (s) => s.id === entry.scenarioId,
                    );
                    if (
                        !scenario ||
                        args.sourcesLot.filter(
                            (e) => e.scenarioId === scenario.id,
                        ).length !== 1 ||
                        owned.run.companySnapshot?.cik.replace(/^0+/, "") !==
                            scenario.company.cik.replace(/^0+/, "")
                    )
                        throw new Error("Campaign scenario binding mismatch");
                }

                if (
                    owned.run.researchStartedAt !== undefined ||
                    owned.run.lifecycleState !== "framing"
                )
                    throw new Error("Unlaunched Sources fixture required");
            }
        }
        const responseControl =
            args.responseControllerModel !== undefined
                ? await readResponseControlPolicy(ctx)
                : undefined;
        if (
            responseControl &&
            (!args.sourcesLot ||
                !responseControl.enabled ||
                responseControl.model !== args.responseControllerModel)
        )
            throw new Error("Qualification controller configuration mismatch");
        let campaignLimits: { search: number; acquisition: number } | undefined;
        if (context.campaignLotId) {
            const { lot, campaign } = await requireCampaignLot(
                ctx,
                context.campaignLotId,
            );
            const m = campaign.manifest;
            if (
                lot.contextId !== context._id ||
                m.mode !== "live" ||
                (m.capability === "sources") !== !!sourcesLot ||
                maximumRequests > lot.allocation.model ||
                maximumCostUsd > lot.allocation.costUsd
            )
                throw new Error("Campaign grant exceeds its reservation");
            const profile = campaignConfiguration(m, lot.configurationId);
            const configurations = [
                { role: "workbench" as const, configuration: model },
                ...(sourcesModel
                    ? [
                          {
                              role: "sources" as const,
                              configuration: sourcesModel,
                          },
                      ]
                    : []),
            ];
            for (const { role, configuration } of configurations) {
                const expected = profile.models[role];
                if (
                    !expected ||
                    expected.model !== configuration.model ||
                    expected.provider !== configuration.provider ||
                    resolveReasoningPreference(
                        configuration.descriptor,
                        expected.reasoning,
                    ) !== configuration.reasoningEffort
                )
                    throw new Error("Campaign model configuration mismatch");
            }
            const policy = await readResponseControlPolicy(ctx);
            if (
                (profile.controllerModel !== undefined) !== policy.enabled ||
                (profile.controllerModel &&
                    profile.controllerModel !== policy.model)
            )
                throw new Error("Campaign controller configuration mismatch");
            const configurationHash = sha256Hex(
                stableStringify({
                    configurations: configurations.map(
                        ({ role, configuration: c }) => ({
                            role,
                            model: c.model,
                            provider: c.provider,
                            descriptor: c.descriptor,
                            effort: c.reasoningEffort,
                        }),
                    ),
                    controller: policy.enabled
                        ? {
                              enabled: true,
                              model: policy.model,
                              contradictionThreshold:
                                  policy.contradictionThreshold,
                              supportThreshold: policy.supportThreshold,
                          }
                        : { enabled: false },
                }),
            );
            const expectedHash =
                m.version !== 1
                    ? campaign.configurationHashes?.find(
                          (c) => c.id === lot.configurationId,
                      )?.hash
                    : campaign.configurationHash;
            if (
                (m.version !== 1 && !expectedHash) ||
                (expectedHash && expectedHash !== configurationHash)
            )
                throw new Error("Campaign route or price drift");
            if (m.version === 1)
                await ctx.db.patch(campaign._id, { configurationHash });
            await ctx.db.patch(lot._id, { configurationHash });
            campaignLimits = {
                search: lot.allocation.search,
                acquisition: lot.allocation.acquisition,
            };
        }
        if (context.paidQualification) {
            if (
                context.paidQualification.runId !== run._id ||
                context.paidQualification.modelRevisionId !== model._id ||
                (sourcesModel !== undefined &&
                    (context.paidQualification.sourcesModelRevisionId ??
                        context.paidQualification.modelRevisionId) !==
                        sourcesModel._id) ||
                context.paidQualification.costAccountingPolicy !==
                    configurable?.costAccountingPolicy ||
                context.paidQualification.maximumRequests !== maximumRequests ||
                context.paidQualification.maximumCostUsd !== maximumCostUsd ||
                context.paidQualification.relayOrigin !== args.relayOrigin ||
                stableStringify(context.paidQualification.scenarios ?? null) !==
                    stableStringify(scenarioScope?.bindings ?? null) ||
                JSON.stringify(context.paidQualification.sourcesLot) !==
                    JSON.stringify(sourcesLot) ||
                stableStringify(
                    context.paidQualification.reasoningSelection ?? null,
                ) !== stableStringify(args.reasoningSelection ?? null) ||
                stableStringify(context.paidQualification.responseControl) !==
                    stableStringify(responseControl)
            )
                throw new Error(
                    "Qualification authorization conflicts with the retained lot",
                );
            return null;
        }
        await ctx.db.patch(contextId, {
            paidQualification: {
                runId: run._id,
                modelRevisionId: model._id,
                sourcesModelRevisionId: sourcesModel?._id,
                relayOrigin: args.relayOrigin,
                maximumRequests,
                maximumCostUsd,
                costAccountingPolicy: configurable?.costAccountingPolicy,
                authorizedAt: Date.now(),
                maximumSearchAttempts: campaignLimits?.search,
                maximumAcquisitions: campaignLimits?.acquisition,
                sourcesLot,
                scenarios: scenarioScope?.bindings,
                reasoningSelection: args.reasoningSelection,
                responseControl,
            },
        });
        if (configurable)
            await initializeQualificationUsage(
                ctx,
                contextId,
                scenarioScope?.bindings.map((e) => e.runId) ?? [run._id],
            );
        return null;
    },
});

/** Prepares a labelled START scenario in the already-admitted local browser workspace. */
export const startWorkbench = internalAction({
    args: { fixtureKey: v.string() },
    returns: v.id("researchRuns"),
    handler: async (ctx, args): Promise<Id<"researchRuns">> => {
        await ctx.runQuery(internal.execution.fixtures.authorize, {});
        const base = await ctx.runMutation(
            internal.e2eFixtures.seedSourceReviewScenario,
            { slotKey: BROWSER_TEST_SLOT, fixtureKey: args.fixtureKey },
        );
        return ctx.runMutation(internal.execution.fixtures.activateWorkbench, {
            runId: base.runId,
            fixtureKey: args.fixtureKey,
        });
    },
});
/** Preserves the campaign's per-conversation Workbench choice when both roles share a catalogue. */
export async function initialCampaignWorkbenchModel(
    ctx: QueryCtx,
    run: Doc<"researchRuns">,
) {
    const context = run.browserTestContextId
        ? await ctx.db.get(run.browserTestContextId)
        : null;
    let initialModel:
        | Infer<
              typeof import("@convex/modelConfigurationSchema").initialModelSelection
          >
        | undefined;
    if (context?.campaignLotId && context.paidQualification?.scenarios) {
        const { campaign, lot } = await requireCampaignLot(
            ctx,
            context.campaignLotId,
        );
        const profile = campaignConfiguration(
            campaign.manifest,
            lot.configurationId,
        );
        const model = await ctx.db.get(
            context.paidQualification.modelRevisionId,
        );
        if (!model) throw new Error("Campaign model required");
        initialModel = {
            catalogId: model.catalogId,
            reasoningEffort: resolveReasoningPreference(
                model.descriptor,
                profile.models.workbench.reasoning,
            ),
        };
    }
    return initialModel;
}

export const activateWorkbench = internalMutation({
    args: {
        runId: v.id("researchRuns"),
        fixtureKey: v.string(),
        researchAngle: v.optional(v.string()),
    },
    returns: v.id("researchRuns"),
    handler: async (ctx, args): Promise<Id<"researchRuns">> => {
        const { run } = await requireLocalFixtureRun(ctx, args);
        if (run.startMode === "framed") return run._id;
        if (run.workflowId)
            await workflow.cancel(ctx, run.workflowId as WorkflowId);
        await ctx.db.patch(run._id, {
            startMode: "framed",
            lifecycleState: "framing",
            executionStatus: "idle",
            reservationStatus: undefined,
            workflowId: undefined,
            pauseReason: undefined,
            researchAngle:
                args.researchAngle?.trim().slice(0, 2000) ??
                "Simulation: propose a claims workflow research program.",
        });
        const initialModel = await initialCampaignWorkbenchModel(ctx, run);
        await initializeFraming(ctx, run._id, initialModel);
        return run._id;
    },
});

/** Reveals the existing labelled documentary fixture after framing; no acquisition or provider is simulated as live. */
export const revealWorkbenchSources = internalMutation({
    args: { runId: v.id("researchRuns"), fixtureKey: v.string() },
    returns: v.null(),
    handler: async (ctx, args): Promise<null> => {
        const { run } = await requireLocalFixtureRun(ctx, args);
        const framing = run.currentFramingRevisionId
            ? await ctx.db.get(run.currentFramingRevisionId)
            : null;
        if (
            run.startMode !== "framed" ||
            !framing?.content.questions.length ||
            run.researchStartRequestKey
        )
            throw new Error("Unlaunched START fixture required");
        if (run.fixedFramingRevisionId) return null;
        const workflowId = await workflow.start(
            ctx,
            internal.e2eFixtures.sourceReviewWorkflow,
            { runId: run._id },
        );
        await ctx.db.patch(run._id, {
            fixedFramingRevisionId: framing._id,
            agentExecutionVersion: 3,
            researchStartedAt: Date.now(),
            lifecycleState: "awaiting_source_review",
            executionStatus: "paused",
            pauseReason: "source_review",
            workflowId,
        });
        return null;
    },
});

/** Exercises the real failure projection without dispatching a model or fabricating a provider receipt. */
export const interruptWorkbench = internalMutation({
    args: { runId: v.id("researchRuns"), fixtureKey: v.string() },
    returns: v.null(),
    handler: async (ctx, args) => {
        const { run } = await requireLocalFixtureRun(ctx, args);
        const requestKey = `${args.fixtureKey}:interrupted-response`;
        const previous = await ctx.db
            .query("agentMessageDeliveries")
            .withIndex("by_run_and_key", (q) =>
                q.eq("runId", run._id).eq("requestKey", requestKey),
            )
            .unique();
        if (previous) return null;
        const conversation = await ctx.db
            .query("agentConversations")
            .withIndex("by_run", (q) => q.eq("runId", run._id))
            .unique();
        if (
            !conversation ||
            conversation.activeTurnId ||
            conversation.queuedCount
        )
            throw new Error("An idle simulated conversation is required");
        await submitAuthorizedMessage(ctx, {
            runId: run._id,
            requestKey,
            delivery: "queue",
            text: "Simulation: exercise an interrupted response while preserving the research program.",
        });
        await ctx.runMutation(internal.execution.conversations.pumpWorkbench, {
            runId: run._id,
        });
        const current = await ctx.db.get(conversation._id);
        const turn = current?.activeTurnId
            ? await ctx.db.get(current.activeTurnId)
            : null;
        const mission = turn?.missionId
            ? await ctx.db.get(turn.missionId)
            : null;
        if (!mission?.piWakeToken || mission.provenance !== "simulation")
            throw new Error("A simulated native mission is required");
        const writer = `fixture:${requestKey}`;
        const claimed = await ctx.runMutation(
            internal.execution.piControl.prepare,
            {
                missionId: mission._id,
                expectedGeneration: mission.generation,
                token: mission.piWakeToken,
                writer,
            },
        );
        if (!claimed)
            throw new Error("The simulated worker could not be claimed");
        await ctx.runMutation(internal.execution.piControl.closeWorker, {
            missionId: mission._id,
            expectedGeneration: mission.generation,
            writer,
            error: "attempt_outcome_unknown",
            nativeSettled: true,
        });
        return null;
    },
});

/** No native session is expected before the first turn; a missing session after a turn is unresolved. */
async function fixtureConversationSettled(
    ctx: QueryCtx,
    conversation: Doc<"agentConversations"> | null,
    session: Doc<"piSessions"> | null,
) {
    if (session)
        return (
            session.settledSequence === session.sequence &&
            session.leaseUntil <= Date.now()
        );
    if (!conversation || conversation.activeTurnId || conversation.queuedCount)
        return false;
    return !(await ctx.db
        .query("agentConversationTurns")
        .withIndex("by_run", (q) => q.eq("runId", conversation.runId))
        .first());
}

export const inspectWorkbench = internalQuery({
    args: { runId: v.id("researchRuns"), fixtureKey: v.string() },
    returns: v.object({
        providerCallCount: v.number(),
        missionCount: v.number(),
        invocationCount: v.number(),
        allMissionsSimulated: v.boolean(),
        queuedCount: v.number(),
        phase: v.string(),
        definitionVersion: v.number(),
        nativeSessionId: v.union(v.id("piSessions"), v.null()),
        nativeSettled: v.boolean(),
        framing: v.union(schema.doc("framingRevisions"), v.null()),
        missions: v.array(schema.doc("agentMissions")),
        receipts: v.array(schema.doc("providerCalls")),
        operationReceipts: v.array(
            v.object({
                id: v.id("agentOperationRequests"),
                missionId: v.optional(v.id("agentMissions")),
                invalid: v.boolean(),
                refused: v.boolean(),
                applied: v.boolean(),
            }),
        ),
        researchStarted: v.boolean(),
        executionStatus: v.string(),
    }),
    handler: async (ctx, args) => {
        const { run } = await readLocalFixtureRun(ctx, args);
        const missions = await ctx.db
            .query("agentMissions")
            .withIndex("by_run_and_request_key", (q) => q.eq("runId", run._id))
            .take(21);
        if (missions.length > 20)
            throw new Error("Fixture inspection capacity exceeded");
        const calls = await ctx.db
            .query("providerCalls")
            .withIndex("by_run", (q) => q.eq("runId", run._id))
            .take(MAX_SOURCES_QUALIFICATION_RECEIPTS + 1);
        if (calls.length > MAX_SOURCES_QUALIFICATION_RECEIPTS)
            throw new Error("Fixture receipt capacity exceeded");
        const invocations = await ctx.db
            .query("agentInvocations")
            .withIndex("by_run_and_task_key", (q) => q.eq("runId", run._id))
            .take(101);
        if (invocations.length > 100)
            throw new Error("Fixture inspection capacity exceeded");
        const conversation = await ctx.db
            .query("agentConversations")
            .withIndex("by_run", (q) => q.eq("runId", run._id))
            .unique();
        const session = conversation
            ? await ctx.db
                  .query("piSessions")
                  .withIndex("by_conversation", (q) =>
                      q.eq("conversationId", conversation._id),
                  )
                  .unique()
            : null;
        const operations = await ctx.db
            .query("agentOperationRequests")
            .withIndex("by_run_and_logical_key", (q) => q.eq("runId", run._id))
            .take(101);
        if (operations.length > 100)
            throw new Error("Fixture operation capacity exceeded");
        return {
            operationReceipts: operations.map((r) => ({
                id: r._id,
                missionId: r.missionId,
                invalid: r.input.kind === "invalid",
                refused: r.outcome?.kind === "refused",
                applied:
                    r.effect?.outcome.kind === "success" ||
                    r.adoptedAt !== undefined,
            })),
            framing: run.currentFramingRevisionId
                ? await ctx.db.get(run.currentFramingRevisionId)
                : null,
            missions,
            receipts: calls,
            researchStarted: run.researchStartedAt !== undefined,
            executionStatus: run.executionStatus,
            definitionVersion: conversation?.definitionVersion ?? 1,
            nativeSessionId: session?._id ?? null,
            nativeSettled: await fixtureConversationSettled(
                ctx,
                conversation,
                session,
            ),
            providerCallCount: calls.length,
            missionCount: missions.length,
            invocationCount: invocations.length,
            allMissionsSimulated:
                missions.length > 0 &&
                missions.every((m) => m.provenance === "simulation"),
            queuedCount: conversation?.queuedCount ?? 0,
            phase: run.lifecycleState,
        };
    },
});

/** Rechecks the active local grant at the actual transport boundary. */
export const workbenchRelay = internalQuery({
    args: { missionId: v.id("agentMissions"), expectedGeneration: v.number() },
    returns: v.union(v.string(), v.null()),
    handler: async (ctx, args) => {
        const mission = await ctx.db.get(args.missionId);
        if (!mission?.runId) return null;
        const run = await ctx.db.get(mission.runId);
        if (run?.purpose !== "browser_test") return null;
        await requireMissionAuthority(
            ctx,
            mission._id,
            args.expectedGeneration,
        );
        const grant = await requireQualifiedBrowserMission(ctx, run, mission);
        if (!grant) throw new Error("evaluation_dossier_not_authorized");
        return grant.relayOrigin ?? null;
    },
});

/** Bounded evidence export for an owned local Sources qualification; never grants execution. */
export const inspectSourcesQualification = internalQuery({
    args: { runId: v.id("researchRuns"), fixtureKey: v.string() },
    returns: v.object({
        run: schema.doc("researchRuns"),
        preparation: v.union(
            schema.doc("sourceSelectionProposalRebuilds"),
            v.null(),
        ),
        sources: v.array(schema.doc("sources")),
        captures: v.array(schema.doc("sourceCaptures")),
        tasks: v.array(schema.doc("aiTaskResults")),
        requests: v.array(schema.doc("agentOperationRequests")),
        captureDownloads: v.array(
            v.object({ captureId: v.id("sourceCaptures"), url: v.string() }),
        ),
    }),
    handler: async (ctx, args) => {
        const { run } = await readLocalFixtureRun(ctx, args);
        const preparation = run.sourcePreparationId
            ? await ctx.db.get(run.sourcePreparationId)
            : null;
        const [sources, tasks, requests, captures] = await Promise.all([
            ctx.db
                .query("sources")
                .withIndex("by_run_and_url", (q) => q.eq("runId", run._id))
                .take(61),
            ctx.db
                .query("aiTaskResults")
                .withIndex("by_run", (q) => q.eq("runId", run._id))
                .take(33),
            ctx.db
                .query("agentOperationRequests")
                .withIndex("by_run_and_logical_key", (q) =>
                    q.eq("runId", run._id),
                )
                .take(101),
            preparation
                ? ctx.db
                      .query("sourceCaptures")
                      .withIndex("by_preparation_and_source", (q) =>
                          q.eq("preparationId", preparation._id),
                      )
                      .take(13)
                : [],
        ]);
        if (
            sources.length > 60 ||
            tasks.length > 32 ||
            requests.length > 100 ||
            captures.length > 12
        )
            throw new Error(
                "Sources qualification inspection capacity exceeded",
            );
        const captureDownloads = [];
        for (const capture of captures) {
            if (!capture.storageId) continue;
            const url = await ctx.storage.getUrl(capture.storageId);
            if (url) captureDownloads.push({ captureId: capture._id, url });
        }
        return {
            run,
            preparation,
            sources,
            tasks,
            requests,
            captures,
            captureDownloads,
        };
    },
});

/** Keep transcript hydration in a separate, bounded transaction from documentary inventory. */
export const inspectSourcesInvocations = internalQuery({
    args: {
        runId: v.id("researchRuns"),
        fixtureKey: v.string(),
        paginationOpts: paginationOptsValidator,
    },
    returns: v.object({
        ...paginationResultValidator(schema.doc("agentInvocations")).fields,
        payloads: v.array(schema.doc("agentInvocationPayloads")),
    }),
    handler: async (ctx, args) => {
        const { run } = await readLocalFixtureRun(ctx, args);
        if (args.paginationOpts.numItems !== 1)
            throw new Error(
                "Sources transcript inspection requires one invocation per page",
            );
        const page = await ctx.db
            .query("agentInvocations")
            .withIndex("by_run_and_task_key", (q) => q.eq("runId", run._id))
            .paginate(args.paginationOpts);
        const payloads = (
            await Promise.all(
                page.page.map((invocation) =>
                    ctx.db
                        .query("agentInvocationPayloads")
                        .withIndex("by_invocation_and_part", (q) =>
                            q.eq("invocationId", invocation._id),
                        )
                        .take(2),
                ),
            )
        ).flat();
        return { ...page, payloads };
    },
});

/** Exports immutable bytes under the same local dossier/fixture provenance as transcript metadata. */
export const inspectSourcesTextFragments = internalQuery({
    args: {
        runId: v.id("researchRuns"),
        fixtureKey: v.string(),
        invocationId: v.id("agentInvocations"),
        part: v.union(
            v.literal("input"),
            v.literal("request"),
            v.literal("reply"),
        ),
        paginationOpts: paginationOptsValidator,
    },
    returns: paginationResultValidator(
        v.object({ index: v.number(), content: v.string() }),
    ),
    handler: async (ctx, args) => {
        await readLocalFixtureRun(ctx, args);
        const invocation = await ctx.db.get(args.invocationId);
        if (!invocation || invocation.runId !== args.runId)
            throw new Error("Transcript correlation mismatch");
        const payload =
            args.part === "input"
                ? null
                : await ctx.db
                      .query("agentInvocationPayloads")
                      .withIndex("by_invocation_and_part", (q) =>
                          q
                              .eq("invocationId", invocation._id)
                              .eq(
                                  "part",
                                  args.part === "input" ? "request" : args.part,
                              ),
                      )
                      .unique();
        const textId =
            args.part === "input" ? invocation.inputTextId : payload?.textId;
        const contentHash =
            args.part === "input"
                ? invocation.inputContentHash
                : payload?.contentHash;
        if (
            !textId ||
            (args.part !== "input" &&
                (payload?.state !== "complete" || payload.runId !== args.runId))
        )
            throw new Error("Complete fragmented transcript not found");
        const text = await completeRetainedText(ctx, textId);
        if (
            text.key !== `${invocation._id}:${args.part}` ||
            text.contentHash !== contentHash ||
            (payload && text.sizeBytes !== payload.sizeBytes)
        )
            throw new Error("Transcript correlation mismatch");
        return retainedTextPage(ctx, text, args.paginationOpts);
    },
});

/** Small polling snapshot: no transcript scan or sample-dependent ceiling. */
export const qualificationSnapshot = internalQuery({
    returns: v.object({
        accounting: v.union(schema.doc("qualificationUsage"), v.null()),
        run: schema.doc("researchRuns"),
        conversation: v.union(schema.doc("agentConversations"), v.null()),
        mission: v.union(schema.doc("agentMissions"), v.null()),
        sourcesMission: v.union(schema.doc("agentMissions"), v.null()),
        lastMessage: v.union(schema.doc("agentMessageDeliveries"), v.null()),
        preparation: v.union(
            schema.doc("sourceSelectionProposalRebuilds"),
            v.null(),
        ),
        framing: v.union(schema.doc("framingRevisions"), v.null()),
        nativeSettled: v.boolean(),
    }),
    args: { runId: v.id("researchRuns"), fixtureKey: v.string() },
    handler: async (ctx, args) => {
        const { run } = await readLocalFixtureRun(ctx, args);
        const conversation = await ctx.db
            .query("agentConversations")
            .withIndex("by_run", (q) => q.eq("runId", run._id))
            .unique();
        const session = conversation
            ? await ctx.db
                  .query("piSessions")
                  .withIndex("by_conversation", (q) =>
                      q.eq("conversationId", conversation._id),
                  )
                  .unique()
            : null;
        const turn = conversation?.activeTurnId
            ? await ctx.db.get(conversation.activeTurnId)
            : null;
        const mission = turn?.missionId
            ? await ctx.db.get(turn.missionId)
            : null;
        const sourcesMission = run.sourcePreparationId
            ? await ctx.db
                  .query("agentMissions")
                  .withIndex("by_run_and_request_key", (q) =>
                      q
                          .eq("runId", run._id)
                          .eq(
                              "requestKey",
                              `sources:${run.sourcePreparationId}`,
                          ),
                  )
                  .unique()
            : null;
        return {
            accounting: run.browserTestContextId
                ? await readQualificationUsage(
                      ctx,
                      run.browserTestContextId,
                      run._id,
                  )
                : null,
            run,
            conversation,
            mission,
            sourcesMission,
            lastMessage: await ctx.db
                .query("agentMessageDeliveries")
                .withIndex("by_run", (q) => q.eq("runId", run._id))
                .order("desc")
                .first(),
            preparation: run.sourcePreparationId
                ? await ctx.db.get(run.sourcePreparationId)
                : null,
            framing: run.currentFramingRevisionId
                ? await ctx.db.get(run.currentFramingRevisionId)
                : null,
            nativeSettled: await fixtureConversationSettled(
                ctx,
                conversation,
                session,
            ),
        };
    },
});
/** Audit pages are bounded per transaction; the host follows the cursor until completion. */
export const inspectQualificationPage = internalQuery({
    returns: v.union(
        paginationResultValidator(schema.doc("providerCalls")),
        paginationResultValidator(schema.doc("agentMissions")),
        paginationResultValidator(schema.doc("agentOperationRequests")),
        paginationResultValidator(schema.doc("sources")),
        paginationResultValidator(schema.doc("aiTaskResults")),
        paginationResultValidator(schema.doc("agentMessageDeliveries")),
        v.object({
            ...paginationResultValidator(schema.doc("sourceCaptures")).fields,
            downloads: v.array(
                v.object({
                    captureId: v.id("sourceCaptures"),
                    url: v.string(),
                }),
            ),
        }),
    ),
    args: {
        runId: v.id("researchRuns"),
        fixtureKey: v.string(),
        kind: v.union(
            v.literal("receipts"),
            v.literal("missions"),
            v.literal("requests"),
            v.literal("sources"),
            v.literal("tasks"),
            v.literal("captures"),
            v.literal("messages"),
        ),
        paginationOpts: paginationOptsValidator,
    },
    handler: async (ctx, args) => {
        const { run } = await readLocalFixtureRun(ctx, args);
        if (
            args.paginationOpts.numItems < 1 ||
            args.paginationOpts.numItems > 32
        )
            throw new Error("Audit page size must be 1..32");
        const o = args.paginationOpts;
        switch (args.kind) {
            case "receipts":
                return ctx.db
                    .query("providerCalls")
                    .withIndex("by_run", (q) => q.eq("runId", run._id))
                    .paginate(o);
            case "missions":
                return ctx.db
                    .query("agentMissions")
                    .withIndex("by_run_and_request_key", (q) =>
                        q.eq("runId", run._id),
                    )
                    .paginate(o);
            case "requests":
                return ctx.db
                    .query("agentOperationRequests")
                    .withIndex("by_run_and_logical_key", (q) =>
                        q.eq("runId", run._id),
                    )
                    .paginate(o);
            case "sources":
                return ctx.db
                    .query("sources")
                    .withIndex("by_run_and_url", (q) => q.eq("runId", run._id))
                    .paginate(o);
            case "tasks":
                return ctx.db
                    .query("aiTaskResults")
                    .withIndex("by_run", (q) => q.eq("runId", run._id))
                    .paginate(o);
            case "messages":
                return ctx.db
                    .query("agentMessageDeliveries")
                    .withIndex("by_run", (q) => q.eq("runId", run._id))
                    .paginate(o);
            case "captures": {
                const preparationId = run.sourcePreparationId;
                if (!preparationId)
                    return {
                        page: [],
                        isDone: true,
                        continueCursor: "",
                        downloads: [],
                    };
                const page = await ctx.db
                    .query("sourceCaptures")
                    .withIndex("by_preparation_and_source", (q) =>
                        q.eq("preparationId", preparationId),
                    )
                    .paginate(o);
                const downloads = [];
                for (const capture of page.page) {
                    if (capture.storageId) {
                        const url = await ctx.storage.getUrl(capture.storageId);
                        if (url)
                            downloads.push({ captureId: capture._id, url });
                    }
                }
                return { ...page, downloads };
            }
        }
    },
});

/** Exports the immutable admitted route for the local diagnostic relay, never credentials. */
export const qualificationRoute = internalQuery({
    args: { runId: v.id("researchRuns"), fixtureKey: v.string() },
    returns: effectiveModelConfiguration,
    handler: async (ctx, args) => {
        const { run } = await requireLocalFixtureRun(ctx, args);
        const context = run.browserTestContextId
            ? await ctx.db.get(run.browserTestContextId)
            : null;
        if (
            !context?.paidQualification?.scenarios?.some(
                (s) => s.runId === run._id,
            )
        )
            throw new Error("Admitted campaign route required");
        if (!context.campaignLotId) throw new Error("Campaign route required");
        const { campaign, lot } = await requireCampaignLot(
            ctx,
            context.campaignLotId,
        );
        const revision = await ctx.db.get(
            context.paidQualification.modelRevisionId,
        );
        if (!revision) throw new Error("Missing route");
        const profile = campaignConfiguration(
            campaign.manifest,
            lot.configurationId,
        );
        return {
            model: revision.model,
            provider: revision.provider,
            descriptor: revision.descriptor,
            reasoningEffort: resolveReasoningPreference(
                revision.descriptor,
                profile.models.workbench.reasoning,
            ),
        };
    },
});
