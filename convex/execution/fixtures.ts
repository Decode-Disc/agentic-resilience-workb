import { internal } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import {
    type ActionCtx,
    internalAction,
    internalMutation,
    internalQuery,
    type MutationCtx,
    type QueryCtx,
} from "@convex/_generated/server";
import { REQUEST_APPROVAL_FIXTURE_CAUSE } from "@convex/domain/conversationValidationContracts";
import {
    claimCorpusApprovedRunExecution,
    claimPausedRunExecution,
} from "@convex/domain/executionClaim";
import { readInContextResult } from "@convex/domain/savedMaterialOperations";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import { upsertSourceReviewItem } from "@convex/domain/sourceReviewProjection";
import {
    activatedSourcesEnvelope,
    initializeSources,
    readSourcesMission,
} from "@convex/domain/sources";
import { INITIAL_FRAMING_MESSAGE_KEY } from "@convex/domain/workbenchContracts";
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
import {
    retainedMethodVersion,
    taskMethodDefinitionVersion,
} from "@convex/qualificationAgentMethods";
import { campaignConfiguration } from "@convex/qualificationCampaignPolicy";
import {
    campaignConfigurationHash,
    checkPrerequisiteReservations,
    requireCampaignLot,
} from "@convex/qualificationCampaigns";
import {
    initializeQualificationUsage,
    qualificationAllowanceScopes,
    qualificationUsageResolved,
    readQualificationUsage,
} from "@convex/qualificationUsage";
import {
    BROWSER_QUALIFICATION_MAX_COST_USD,
    BROWSER_QUALIFICATION_MAX_REQUESTS,
    MAX_SOURCES_QUALIFICATION_RECEIPTS,
    QUALIFICATION_TOOLING_POLICY,
    RESOURCE_POLICY_VERSION,
} from "@convex/resourcePolicy";
import {
    BROWSER_TEST_SLOT,
    readWorkbenchQualification,
    requireBrowserFixtureContext,
    requireBrowserTestOwner,
    requireBrowserTestRunOwner,
} from "@convex/runWorkspace";
import schema from "@convex/schema";
import { workflow } from "@convex/workflow";
import type { WorkflowId } from "@convex-dev/workflow";
import {
    paginationOptsValidator,
    paginationResultValidator,
} from "convex/server";
import { type Infer, v } from "convex/values";
import { validate } from "convex-helpers/validators";
import { getAgentDefinition } from "./agentCatalog";
import { agentToolSchemas } from "./agentDefinition";
import { agentResultValidator } from "./agentSchemas";
import { requireMissionAuthority } from "./authority";
import { publishTurn, submitAuthorizedMessage } from "./conversations";
import {
    agentBackendValidator,
    DEFAULT_AGENT_BACKEND,
} from "./executionProtocol";
import { admittedInputHash, hasReceivedResponse } from "./journal";
import { generationInterruption, retainedMissionResult } from "./missionData";
import {
    completeRetainedText,
    retainedDiagnosticText,
    retainedTextFragment,
    retainedTextPage,
    verifyRetainedText,
} from "./retainedText";

/** Validates retained fixture provenance without granting or renewing execution authority. */
async function readLocalFixtureRun(
    ctx: MutationCtx | QueryCtx,
    args: { runId: Id<"researchRuns">; fixtureKey: string },
) {
    const run = await ctx.db.get(args.runId);
    if (run?.purpose !== "browser_test")
        throw new Error("Local simulation scope required");
    const visitor = await requireBrowserTestRunOwner(ctx, run);
    const context = run.browserTestContextId
        ? await ctx.db.get(run.browserTestContextId)
        : null;
    if (
        !/^[a-z0-9-]{1,80}$/.test(args.fixtureKey) ||
        run.ownerVisitorId !== visitor._id ||
        context?.ownerVisitorId !== visitor._id ||
        !run.reservationKey?.endsWith(`:${args.fixtureKey}`)
    )
        throw new Error("Local simulation scope required");
    return { run, visitor, context };
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
    const first = dossiers[0] ? await ctx.db.get(dossiers[0].runId) : null;
    const visitor = first
        ? await requireBrowserTestRunOwner(ctx, first)
        : await requireBrowserTestOwner(ctx, BROWSER_TEST_SLOT);
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
            (scenario.coveragePreset !== undefined &&
                run.coveragePreset !== scenario.coveragePreset) ||
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

/** Match exact decoded input strings, including nested JSON retained as message text. */
function inputContainsQuotation(input: string, quotation: string) {
    let pending: unknown[];
    try {
        pending = [JSON.parse(input)];
    } catch {
        throw new Error("Invalid retained simulation input");
    }
    const escaped = JSON.stringify(quotation).slice(1, -1);
    while (pending.length) {
        const value = pending.pop();
        if (typeof value === "string") {
            if (value.includes(quotation) || value.includes(escaped))
                return true;
        } else if (Array.isArray(value)) pending.push(...value);
        else if (value && typeof value === "object")
            pending.push(...Object.values(value));
    }
    return false;
}

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
        slotKey: v.optional(v.string()),
        generationBackend: v.optional(agentBackendValidator),
        largeJournal: v.optional(v.boolean()),
    },
    returns: v.id("agentMissions"),
    handler: async (ctx, args): Promise<Id<"agentMissions">> => {
        const slotKey = args.slotKey?.trim() || BROWSER_TEST_SLOT;
        await ctx.runQuery(internal.execution.fixtures.authorize, { slotKey });
        const base = await ctx.runAction(
            internal.e2eFixtures.seedInspectedSourceReviewScenario,
            { slotKey, fixtureKey: args.fixtureKey },
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
        slotKey: v.optional(v.string()),
        generationBackend: v.optional(agentBackendValidator),
    },
    returns: v.id("agentMissions"),
    handler: async (ctx, args): Promise<Id<"agentMissions">> => {
        const slotKey = args.slotKey?.trim() || BROWSER_TEST_SLOT;
        await ctx.runQuery(internal.execution.fixtures.authorize, { slotKey });
        const base = await ctx.runAction(
            internal.e2eFixtures.seedInspectedSourceReviewScenario,
            { slotKey, fixtureKey: args.fixtureKey },
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
    args: { slotKey: v.optional(v.string()) },
    returns: v.null(),
    handler: async (ctx, args) => {
        const visitor = await requireBrowserTestOwner(
            ctx,
            args.slotKey?.trim() || BROWSER_TEST_SLOT,
        );
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

const simulationInspection = v.object({
    runId: v.id("researchRuns"),
    status: v.string(),
    blockCode: v.union(v.string(), v.null()),
    provenance: v.optional(v.union(v.literal("live"), v.literal("simulation"))),
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
});

async function requireSimulationInspection(
    ctx: QueryCtx,
    missionId: Id<"agentMissions">,
) {
    const mission = await ctx.db.get(missionId);
    const run = mission ? await ctx.db.get(mission.runId) : null;
    if (!mission || !run || run.purpose !== "browser_test")
        throw new Error("Local simulation scope required");
    const visitor = await requireBrowserTestRunOwner(ctx, run);
    const contextId = await requireBrowserFixtureContext(ctx, visitor);
    if (
        run.ownerVisitorId !== visitor._id ||
        run.browserTestContextId !== contextId ||
        ![
            "local-simulation",
            "local-validation",
            "local-conversation",
        ].includes(mission.requestKey)
    )
        throw new Error("Local simulation scope required");
    return { mission, run };
}

export const simulationInspectionSnapshot = internalQuery({
    args: { missionId: v.id("agentMissions") },
    returns: v.object({
        snapshot: simulationInspection,
        invocationIds: v.array(v.id("agentInvocations")),
        quotation: v.optional(v.string()),
        resultHash: v.optional(v.string()),
    }),
    handler: async (ctx, args) => {
        const { mission, run } = await requireSimulationInspection(
            ctx,
            args.missionId,
        );
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
                const parsed = readInContextResult.parse(
                    JSON.parse(quoted.outcome.valueJson),
                );
                quotation =
                    "passage" in parsed
                        ? parsed.passage.exactQuote
                        : parsed.text;
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
        const inspection =
            mission.definitionId === "saved_material_inspection_v1" &&
            "protocolVersion" in mission
                ? mission
                : undefined;
        const retainedResult = inspection?.resultTextId
            ? await retainedMissionResult(
                  ctx,
                  inspection,
                  inspection.resultTextId,
              )
            : undefined;
        return {
            resultHash: retainedResult?.contentHash,
            invocationIds: invocations.map((invocation) => invocation._id),
            quotation,
            snapshot: {
                runExecutionStatus: run.executionStatus,
                conversationTurnStatus: turn?.status ?? null,
                conversationQueuedCount: conversation?.queuedCount ?? 0,
                runId: run._id,
                status: mission.status,
                blockCode: mission.blockCode ?? null,
                provenance: mission.provenance,
                operations: requests.map((request) => request.input.kind),
                outcomes: requests.map(
                    (request) => request.outcome?.kind ?? null,
                ),
                generationBackends: invocations.map(
                    (invocation) => invocation.generationBackend ?? null,
                ),
                backendStorageCount: invocations.filter(
                    (invocation) =>
                        invocation.generationStorageRef !== undefined,
                ).length,
                invocationCount: invocations.length,
                observedInvocationCount: invocations.filter((invocation) =>
                    hasReceivedResponse(invocation),
                ).length,
                contextIncludesReturnedQuotation: false,
                providerCallCount: calls.length,
                completionCount:
                    "protocolVersion" in mission
                        ? inspection?.result?.kind ===
                          "saved_material_inspection_v1"
                            ? inspection.result.captureIds.length
                            : 0
                        : mission.completionRefs.length,
            },
        };
    },
});

export const simulationInputFragment = internalQuery({
    args: {
        missionId: v.id("agentMissions"),
        invocationId: v.id("agentInvocations"),
        part: v.union(v.literal("admitted"), v.literal("request")),
        index: v.number(),
        contentHash: v.optional(v.string()),
    },
    returns: v.union(
        v.null(),
        v.object({
            content: v.string(),
            contentHash: v.string(),
            sizeBytes: v.number(),
            characters: v.number(),
            fragmentCount: v.number(),
        }),
    ),
    handler: async (ctx, args) => {
        const { mission, run } = await requireSimulationInspection(
            ctx,
            args.missionId,
        );
        const invocation = await ctx.db.get(args.invocationId);
        if (
            !invocation ||
            invocation.missionId !== mission._id ||
            invocation.runId !== run._id
        )
            throw new Error("Local simulation scope required");
        let textId = invocation.inputTextId;
        let inline = invocation.inputJson;
        let hash: string | undefined = admittedInputHash(invocation);
        let sizeBytes: number | undefined;
        let key = `${invocation._id}:input`;
        if (args.part === "request") {
            const request = await ctx.db
                .query("agentInvocationPayloads")
                .withIndex("by_invocation_and_part", (q) =>
                    q.eq("invocationId", invocation._id).eq("part", "request"),
                )
                .unique();
            if (request?.state !== "complete") return null;
            if (request.runId !== run._id)
                throw new Error("Local simulation scope required");
            textId = request.textId;
            inline = request.json ?? "";
            hash = request.contentHash;
            sizeBytes = request.sizeBytes;
            key = `${invocation._id}:request`;
        }
        if (
            !hash ||
            (args.contentHash !== undefined && args.contentHash !== hash)
        )
            throw new Error("Invalid retained simulation input");
        if (textId) {
            const text = await completeRetainedText(ctx, textId);
            if (
                text.key !== key ||
                text.contentHash !== hash ||
                (sizeBytes !== undefined && text.sizeBytes !== sizeBytes)
            )
                throw new Error("Invalid retained simulation input");
            return {
                content: await retainedTextFragment(ctx, text, args.index),
                contentHash: hash,
                sizeBytes: text.sizeBytes,
                characters: text.characters,
                fragmentCount: text.fragmentHashes.length,
            };
        }
        if (args.index !== 0 || sha256Hex(inline) !== hash)
            throw new Error("Invalid retained simulation input");
        return {
            content: inline,
            contentHash: hash,
            sizeBytes: new TextEncoder().encode(inline).length,
            characters: inline.length,
            fragmentCount: 1,
        };
    },
});

async function simulationInput(
    ctx: ActionCtx,
    args: {
        missionId: Id<"agentMissions">;
        invocationId: Id<"agentInvocations">;
        part: "admitted" | "request";
    },
) {
    const reader = internal.execution.fixtures.simulationInputFragment;
    const first = await ctx.runQuery(reader, { ...args, index: 0 });
    if (!first) return null;
    const fragments = [first.content];
    for (let index = 1; index < first.fragmentCount; index++) {
        const next = await ctx.runQuery(reader, {
            ...args,
            index,
            contentHash: first.contentHash,
        });
        if (!next) throw new Error("Invalid retained simulation input");
        fragments.push(next.content);
    }
    return verifyRetainedText(first, fragments.join(""));
}

export const simulationInspectionResultFragment = internalQuery({
    args: {
        missionId: v.id("agentMissions"),
        contentHash: v.string(),
        index: v.number(),
    },
    handler: async (ctx, args) => {
        const { mission } = await requireSimulationInspection(
            ctx,
            args.missionId,
        );
        if (
            mission.definitionId !== "saved_material_inspection_v1" ||
            !("protocolVersion" in mission) ||
            !mission.resultTextId
        )
            throw new Error("Invalid retained simulation result");
        const text = await retainedMissionResult(
            ctx,
            mission,
            mission.resultTextId,
        );
        if (text.contentHash !== args.contentHash)
            throw new Error("Invalid retained simulation result");
        return {
            content: await retainedTextFragment(ctx, text, args.index),
            contentHash: text.contentHash,
            sizeBytes: text.sizeBytes,
            characters: text.characters,
            fragmentCount: text.fragmentHashes.length,
        };
    },
});

export const inspect = internalAction({
    args: { missionId: v.id("agentMissions") },
    returns: simulationInspection,
    handler: async (ctx, args): Promise<Infer<typeof simulationInspection>> => {
        const { snapshot, invocationIds, quotation, resultHash } =
            await ctx.runQuery(
                internal.execution.fixtures.simulationInspectionSnapshot,
                args,
            );
        if (resultHash) {
            const read =
                internal.execution.fixtures.simulationInspectionResultFragment;
            const scope = { ...args, contentHash: resultHash };
            const first = await ctx.runQuery(read, { ...scope, index: 0 });
            const fragments = [first.content];
            for (let index = 1; index < first.fragmentCount; index++)
                fragments.push(
                    (await ctx.runQuery(read, { ...scope, index })).content,
                );
            const result: unknown = JSON.parse(
                verifyRetainedText(first, fragments.join("")),
            );
            if (!validate(agentResultValidator, result))
                throw new Error("Invalid retained simulation result");
            snapshot.completionCount =
                result.kind === "saved_material_inspection_v1"
                    ? result.captureIds.length
                    : 0;
        }
        if (!quotation) return snapshot;
        let contextIncludesReturnedQuotation = false;
        for (const invocationId of invocationIds) {
            for (const part of ["admitted", "request"] as const) {
                const input = await simulationInput(ctx, {
                    ...args,
                    invocationId,
                    part,
                });
                if (input !== null && inputContainsQuotation(input, quotation))
                    contextIncludesReturnedQuotation = true;
            }
        }
        return { ...snapshot, contextIncludesReturnedQuotation };
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
        slotKey: v.optional(v.string()),
        generationBackend: v.optional(agentBackendValidator),
    },
    returns: v.id("agentMissions"),
    handler: async (ctx, args): Promise<Id<"agentMissions">> => {
        const slotKey = args.slotKey?.trim() || BROWSER_TEST_SLOT;
        await ctx.runQuery(internal.execution.fixtures.authorize, { slotKey });
        const base = await ctx.runAction(
            internal.e2eFixtures.seedInspectedSourceReviewScenario,
            { slotKey, fixtureKey: args.fixtureKey },
        );
        const created = await ctx.runMutation(
            internal.execution.fixtures.activateConversation,
            {
                fixtureKey: args.fixtureKey,
                ...(args.generationBackend
                    ? { generationBackend: args.generationBackend }
                    : {}),
                runId: base.runId,
            },
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
        if (
            configurable &&
            configurable.costAccountingPolicy !== "known_final_v1"
        )
            throw new Error("resource_policy_unsupported");
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
        const requestCeiling = configurable
            ? configurable.perLot.model
            : args.sourcesLot
              ? 40
              : BROWSER_QUALIFICATION_MAX_REQUESTS;
        const costCeiling =
            configurable?.perLot.costUsd ??
            (args.sourcesLot ? 2 : BROWSER_QUALIFICATION_MAX_COST_USD);
        const maximumRequests = args.maximumRequests ?? requestCeiling;
        const maximumCostUsd = args.maximumCostUsd ?? costCeiling;
        if (
            (maximumRequests !== undefined &&
                (!Number.isSafeInteger(maximumRequests) ||
                    maximumRequests < 1 ||
                    (requestCeiling !== undefined &&
                        maximumRequests > requestCeiling))) ||
            (!configurable && maximumRequests === undefined) ||
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
            const definition = getAgentDefinition(
                "sources_v1",
                configurable &&
                    scope &&
                    campaignConfiguration(
                        configurable,
                        scope.lot.configurationId,
                    ).taskMethods === "retained_control"
                    ? retainedMethodVersion("sources_v1")
                    : undefined,
            );
            const variants = definition.nativeToolSets?.(definition.operations);
            for (const variant of variants ?? [undefined]) {
                const operations = agentToolSchemas(
                    definition,
                    undefined,
                    variant,
                );
                await agentInputByteLength(
                    {
                        instructions: definition.instructions,
                        prompt: "",
                        operations,
                        definitionVersion: definition.version,
                        nativeConversation: definition.nativeConversation,
                        contextRendering: definition.contextRendering,
                        completionTransport: definition.completionTransport,
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
                        (scenario.coveragePreset !== undefined &&
                            owned.run.coveragePreset !==
                                scenario.coveragePreset) ||
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
                (lot.allocation.model !== undefined &&
                    (maximumRequests === undefined ||
                        maximumRequests > lot.allocation.model)) ||
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
            const binding = configurations.map(({ role, configuration }) => ({
                role,
                model: configuration.model,
                provider: configuration.provider,
                descriptor: configuration.descriptor,
                effort: configuration.reasoningEffort,
            }));
            const configurationHash = campaignConfigurationHash(
                binding,
                policy.enabled ? policy.model : undefined,
                policy,
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
            if (m.version !== 1 && !context.paidQualification)
                await checkPrerequisiteReservations(ctx, m, profile, binding, {
                    model: maximumRequests,
                    costUsd: maximumCostUsd,
                });
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
                context.paidQualification.resourcePolicy !==
                RESOURCE_POLICY_VERSION
            )
                throw new Error("resource_policy_unsupported");
            if (
                context.paidQualification.runId !== run._id ||
                context.paidQualification.modelRevisionId !== model._id ||
                (sourcesModel !== undefined &&
                    (context.paidQualification.sourcesModelRevisionId ??
                        context.paidQualification.modelRevisionId) !==
                        sourcesModel._id) ||
                context.paidQualification.costAccountingPolicy !==
                    "known_final_v1" ||
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
                resourcePolicy: RESOURCE_POLICY_VERSION,
                runId: run._id,
                modelRevisionId: model._id,
                sourcesModelRevisionId: sourcesModel?._id,
                relayOrigin: args.relayOrigin,
                maximumRequests,
                maximumCostUsd,
                costAccountingPolicy: "known_final_v1",
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
    args: {
        fixtureKey: v.string(),
        slotKey: v.optional(v.string()),
    },
    returns: v.id("researchRuns"),
    handler: async (ctx, args): Promise<Id<"researchRuns">> => {
        const slotKey = args.slotKey?.trim() || BROWSER_TEST_SLOT;
        await ctx.runQuery(internal.execution.fixtures.authorize, { slotKey });
        const base = await ctx.runMutation(
            internal.e2eFixtures.seedSourceReviewScenario,
            { slotKey, fixtureKey: args.fixtureKey },
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

async function pinCampaignWorkbench(
    ctx: MutationCtx,
    run: Doc<"researchRuns">,
) {
    const version = await taskMethodDefinitionVersion(ctx, run, "workbench_v1");
    if (version === undefined) return;
    const conversation = await ctx.db
        .query("agentConversations")
        .withIndex("by_run", (q) => q.eq("runId", run._id))
        .unique();
    if (!conversation || conversation.definitionVersion === version) return;
    const started = await ctx.db
        .query("agentMissions")
        .withIndex("by_run_and_status", (q) => q.eq("runId", run._id))
        .first();
    if (started || conversation.activeTurnId)
        throw new Error("Fresh comparison conversation required");
    await ctx.db.patch(conversation._id, { definitionVersion: version });
}

export const activateWorkbench = internalMutation({
    args: {
        runId: v.id("researchRuns"),
        fixtureKey: v.string(),
        researchAngle: v.optional(v.string()),
    },
    returns: v.id("researchRuns"),
    handler: async (ctx, args): Promise<Id<"researchRuns">> => {
        const { run, context } = await requireLocalFixtureRun(ctx, args);
        const bindings =
            context.paidQualification?.scenarios ?? context.simulatedScenarios;
        const binding = bindings?.find((entry) => entry.runId === run._id);
        let framingRequest: { text: string; receivedAt: string } | undefined;
        if (context.campaignLotId && binding) {
            const { campaign } = await requireCampaignLot(
                ctx,
                context.campaignLotId,
            );
            if (campaign.manifest.version !== 1)
                framingRequest = campaign.manifest.scenarios.find(
                    (entry) => entry.id === binding.id,
                )?.framingRequest;
        }
        if (
            framingRequest &&
            args.researchAngle !== undefined &&
            args.researchAngle !== framingRequest.text
        )
            throw new Error("Campaign framing request mismatch");
        if (run.startMode === "framed") {
            await pinCampaignWorkbench(ctx, run);
            return run._id;
        }
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
                framingRequest?.text ??
                args.researchAngle?.trim().slice(0, 2000) ??
                "Simulation: propose a claims workflow research program.",
        });
        const initialModel = await initialCampaignWorkbenchModel(ctx, run);
        await initializeFraming(ctx, run._id, initialModel);
        await pinCampaignWorkbench(ctx, run);
        if (framingRequest) {
            const delivery = await ctx.db
                .query("agentMessageDeliveries")
                .withIndex("by_run_and_key", (q) =>
                    q
                        .eq("runId", run._id)
                        .eq("requestKey", INITIAL_FRAMING_MESSAGE_KEY),
                )
                .unique();
            if (delivery?.status !== "queued" || delivery.turnId)
                throw new Error("Fresh initial delivery required");
            // This fixture-only historical date is bound by the immutable campaign, before the scheduled pump can run.
            await ctx.db.patch(delivery._id, {
                createdAt: Date.parse(framingRequest.receivedAt),
            });
        }
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

/** Frees the browser-test visitor's analysis quota so a fixture can exercise the real Start transaction. */
export const resetBrowserTestUsage = internalMutation({
    args: { runId: v.id("researchRuns"), fixtureKey: v.string() },
    returns: v.null(),
    handler: async (ctx, args): Promise<null> => {
        const { run, visitor } = await requireLocalFixtureRun(ctx, args);
        if (run.researchStartedAt !== undefined)
            throw new Error("An unlaunched dossier is required");
        if (visitor.analysesReserved !== 0)
            await ctx.db.patch(visitor._id, { analysesReserved: 0 });
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
        invocationId: v.optional(v.id("agentInvocations")),
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
        const selected = args.invocationId
            ? await ctx.db.get(args.invocationId)
            : null;
        if (args.invocationId && (!selected || selected.runId !== run._id))
            throw new Error("Transcript correlation mismatch");
        const page = selected
            ? { page: [selected], isDone: true, continueCursor: "" }
            : await ctx.db
                  .query("agentInvocations")
                  .withIndex("by_run_and_task_key", (q) =>
                      q.eq("runId", run._id),
                  )
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
        const invocations = await Promise.all(
            page.page.map(async (invocation) => {
                if (!invocation.visibleOutput) return invocation;
                const text = await retainedDiagnosticText(
                    ctx,
                    invocation.visibleOutput.textId,
                    `${invocation._id}:visible`,
                );
                return {
                    ...invocation,
                    visibleOutput: {
                        ...invocation.visibleOutput,
                        contentHash: text.contentHash,
                        sizeBytes: text.sizeBytes,
                    },
                };
            }),
        );
        return { ...page, page: invocations, payloads };
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
            v.literal("visible"),
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
            args.part === "input" || args.part === "visible"
                ? null
                : await ctx.db
                      .query("agentInvocationPayloads")
                      .withIndex("by_invocation_and_part", (q) =>
                          q
                              .eq("invocationId", invocation._id)
                              .eq(
                                  "part",
                                  args.part === "reply" ? "reply" : "request",
                              ),
                      )
                      .unique();
        const textId =
            args.part === "visible"
                ? invocation.visibleOutput?.textId
                : args.part === "input"
                  ? invocation.inputTextId
                  : payload?.textId;
        const contentHash =
            args.part === "visible"
                ? invocation.visibleOutput?.contentHash
                : args.part === "input"
                  ? invocation.inputContentHash
                  : payload?.contentHash;
        if (
            !textId ||
            (args.part !== "input" &&
                args.part !== "visible" &&
                (payload?.state !== "complete" || payload.runId !== args.runId))
        )
            throw new Error("Complete fragmented transcript not found");
        const text =
            args.part === "visible"
                ? await retainedDiagnosticText(
                      ctx,
                      textId,
                      `${invocation._id}:visible`,
                  )
                : await completeRetainedText(ctx, textId);
        if (
            text.key !== `${invocation._id}:${args.part}` ||
            (args.part !== "visible" && text.contentHash !== contentHash) ||
            (payload && text.sizeBytes !== payload.sizeBytes)
        )
            throw new Error("Transcript correlation mismatch");
        return retainedTextPage(ctx, text, args.paginationOpts);
    },
});

/** Small polling snapshot: no transcript scan or sample-dependent ceiling. */
async function readScenarioExecution(ctx: QueryCtx, run: Doc<"researchRuns">) {
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
    const mission = turn?.missionId ? await ctx.db.get(turn.missionId) : null;
    const sourcesMission = run.sourcePreparationId
        ? await ctx.db
              .query("agentMissions")
              .withIndex("by_run_and_request_key", (q) =>
                  q
                      .eq("runId", run._id)
                      .eq("requestKey", `sources:${run.sourcePreparationId}`),
              )
              .unique()
        : null;
    return { conversation, session, mission, sourcesMission };
}

const continuationConversationValidator = v.union(
    v.object({ kind: v.literal("settled") }),
    v.object({ kind: v.literal("quiet_blocked"), code: v.string() }),
    v.object({
        kind: v.literal("unsettled"),
        code: v.optional(v.string()),
    }),
);

export const qualificationSnapshot = internalQuery({
    returns: v.object({
        firstSourcesInput: v.union(
            v.null(),
            v.object({
                runId: v.id("researchRuns"),
                framingRevisionId: v.optional(v.id("framingRevisions")),
                preset: schema.tables.researchRuns.validator.fields
                    .coveragePreset,
                preparationId: v.id("sourceSelectionProposalRebuilds"),
                missionId: v.id("agentMissions"),
                invocationId: v.id("agentInvocations"),
                providerCallId: v.optional(v.id("providerCalls")),
                contentHash: v.optional(v.string()),
                dispatch: v.union(
                    v.literal("observed"),
                    v.literal("not_dispatched"),
                    v.literal("unknown"),
                ),
            }),
        ),
        contextExpiresAt: v.number(),
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
        const { run, context } = await readLocalFixtureRun(ctx, args);
        const { conversation, session, mission, sourcesMission } =
            await readScenarioExecution(ctx, run);
        const first = sourcesMission?.firstProviderInput;
        const firstReceipt = first
            ? await ctx.db.get(first.providerCallId)
            : null;
        return {
            firstSourcesInput:
                first && sourcesMission && run.sourcePreparationId
                    ? {
                          runId: run._id,
                          framingRevisionId: run.fixedFramingRevisionId,
                          preset: run.coveragePreset,
                          preparationId: run.sourcePreparationId,
                          missionId: sourcesMission._id,
                          invocationId: first.invocationId,
                          providerCallId: firstReceipt?._id,
                          contentHash: first.contentHash,
                          dispatch:
                              firstReceipt?.dispatchOutcome === "not_dispatched"
                                  ? ("not_dispatched" as const)
                                  : firstReceipt?.dispatchOutcome ===
                                          "response_received" ||
                                      firstReceipt?.providerObservation
                                          ?.httpStatus !== undefined
                                    ? ("observed" as const)
                                    : ("unknown" as const),
                      }
                    : null,
            contextExpiresAt: context.expiresAt,
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
/** A retained response can outlive its writer and still need adoption. */
async function sourcesCanStillSettle(
    ctx: QueryCtx,
    sources: Doc<"agentMissions">,
) {
    if (
        sources.piActiveWriter ||
        sources.piWakeId ||
        sources.piResultWakePending ||
        sources.piRebinding
    )
        return true;
    if (
        sources.lastInvocationId &&
        sources.lastInvocationId !== sources.lastSettledInvocationId
    ) {
        const last = await ctx.db.get(sources.lastInvocationId);
        if (!last || last.status === "started") return true;
        const exhausted = stableStringify({
            kind: "blocked",
            code: "qualification_budget_exhausted",
        });
        if (
            hasReceivedResponse(last) &&
            (last.receivedOutputTextId || last.receivedOutputJson !== exhausted)
        )
            return true;
        if (
            last.status === "returned" &&
            (last.blockCode !== "qualification_budget_exhausted" ||
                last.outputTextId ||
                last.outputJson !== exhausted)
        )
            return true;
    }
    for (const status of ["pending", "observed"] as const) {
        if (
            await ctx.db
                .query("agentOperationRequests")
                .withIndex("by_run_and_status", (q) =>
                    q.eq("runId", sources.runId).eq("status", status),
                )
                .first()
        )
            return true;
    }
    return false;
}

export const qualificationContinuation = internalQuery({
    args: { runId: v.id("researchRuns"), fixtureKey: v.string() },
    returns: v.object({
        accounting: v.union(schema.doc("qualificationUsage"), v.null()),
        hasEngagedEffects: v.boolean(),
        authorized: v.boolean(),
        accountingSettled: v.boolean(),
        scenarioQuiet: v.boolean(),
        terminalModelBudgetStop: v.boolean(),
        executionStatus: v.string(),
        sourcesStatus: v.union(v.string(), v.null()),
        conversation: continuationConversationValidator,
    }),
    handler: async (ctx, args) => {
        const { run, context } = await readLocalFixtureRun(ctx, args);
        const execution = await readScenarioExecution(ctx, run);
        const nativeSettled = await fixtureConversationSettled(
            ctx,
            execution.conversation,
            execution.session,
        );
        const quietConversation =
            nativeSettled &&
            !execution.conversation?.activeTurnId &&
            !execution.conversation?.queuedCount;
        const quietBlocked =
            !quietConversation &&
            execution.mission?.status === "blocked" &&
            execution.mission.blockCode !== undefined &&
            generationInterruption(execution.mission.blockCode) !== undefined &&
            !execution.mission.piActiveWriter &&
            !execution.mission.piWakeId &&
            !execution.conversation?.queuedCount &&
            execution.session !== null &&
            execution.session.leaseUntil <= Date.now() &&
            !execution.session.settlementFailureCode;
        const conversation = quietConversation
            ? { kind: "settled" as const }
            : quietBlocked && execution.mission?.blockCode
              ? {
                    kind: "quiet_blocked" as const,
                    code: execution.mission.blockCode,
                }
              : {
                    kind: "unsettled" as const,
                    ...(execution.mission?.blockCode
                        ? { code: execution.mission.blockCode }
                        : {}),
                };
        const sourcesQuiet =
            !execution.sourcesMission ||
            ["completed", "blocked", "failed", "cancelled"].includes(
                execution.sourcesMission.status,
            );
        const scenarioQuiet =
            run.executionStatus === "idle" &&
            sourcesQuiet &&
            conversation.kind !== "unsettled";
        let hasEngagedEffects = false;
        const lotRuns = context.paidQualification?.scenarios?.map(
            (s) => s.runId,
        ) ??
            context.simulatedScenarios?.map((s) => s.runId) ?? [run._id];
        for (const runId of lotRuns) {
            for (const status of ["running", "waiting", "unknown"] as const) {
                if (
                    await ctx.db
                        .query("agentOperationRequests")
                        .withIndex("by_run_and_status", (q) =>
                            q.eq("runId", runId).eq("status", status),
                        )
                        .first()
                ) {
                    hasEngagedEffects = true;
                    break;
                }
            }
            if (hasEngagedEffects) break;
        }
        const lot = context.campaignLotId
            ? await ctx.db.get(context.campaignLotId)
            : null;
        const campaign = lot ? await ctx.db.get(lot.campaignId) : null;
        const authorized =
            context.status === "active" &&
            context.expiresAt > Date.now() &&
            lot?.status === "running" &&
            campaign?.status === "active" &&
            campaign.activeLotId === lot._id &&
            campaign.manifest.expiresAt > Date.now() &&
            (campaign.manifest.mode === "deterministic" ||
                context.paidQualification?.costAccountingPolicy ===
                    "known_final_v1");
        const accounting = await readQualificationUsage(ctx, context._id);
        const accountingSettled =
            qualificationUsageResolved(accounting) &&
            accounting?.pending === 0 &&
            accounting.overruns === 0;
        const sources = execution.sourcesMission;
        let terminalModelBudgetStop = false;
        if (
            authorized &&
            accountingSettled &&
            !hasEngagedEffects &&
            (!execution.conversation || quietConversation) &&
            run.executionStatus === "paused" &&
            run.lifecycleState !== "sources_prepared" &&
            sources?.status === "blocked" &&
            sources.blockCode === "qualification_budget_exhausted"
        ) {
            const scopes = qualificationAllowanceScopes(
                context,
                lot,
                campaign,
                run._id,
            );
            if (scopes) {
                const local = await readQualificationUsage(
                    ctx,
                    context._id,
                    run._id,
                );
                const [[, lotLimits], [, caseLimits]] = scopes;
                if (
                    local &&
                    (accounting.usage.model >= (lotLimits.model ?? Infinity) ||
                        local.usage.model >= (caseLimits.model ?? Infinity))
                ) {
                    terminalModelBudgetStop = !(await sourcesCanStillSettle(
                        ctx,
                        sources,
                    ));
                }
            }
        }
        return {
            accounting,
            hasEngagedEffects,
            authorized,
            accountingSettled,
            terminalModelBudgetStop,
            scenarioQuiet,
            executionStatus: run.executionStatus,
            sourcesStatus: execution.sourcesMission?.status ?? null,
            conversation,
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
    returns: effectiveModelConfiguration.extend({
        resourcePolicy: v.string(),
        deadlineAt: v.number(),
        costAccountingPolicy: v.literal("known_final_v1"),
    }),
    handler: async (ctx, args) => {
        const { run } = await requireLocalFixtureRun(ctx, args);
        const context = run.browserTestContextId
            ? await ctx.db.get(run.browserTestContextId)
            : null;
        const qualification = await readWorkbenchQualification(ctx, run);
        if (
            !context ||
            !qualification ||
            context.paidQualification?.costAccountingPolicy !== "known_final_v1"
        )
            throw new Error("Admitted qualification route required");
        const scope = context.campaignLotId
            ? await requireCampaignLot(ctx, context.campaignLotId)
            : null;
        const revision = await ctx.db.get(qualification.modelRevisionId);
        if (!revision) throw new Error("Missing route");
        const profile = scope
            ? campaignConfiguration(
                  scope.campaign.manifest,
                  scope.lot.configurationId,
              )
            : null;
        return {
            resourcePolicy: RESOURCE_POLICY_VERSION,
            deadlineAt: qualification.deadlineAt,
            costAccountingPolicy:
                context.paidQualification.costAccountingPolicy,
            model: revision.model,
            provider: revision.provider,
            descriptor: revision.descriptor,
            reasoningEffort: profile
                ? resolveReasoningPreference(
                      revision.descriptor,
                      profile.models.workbench.reasoning,
                  )
                : revision.reasoningEffort,
        };
    },
});

/** Reaches a Sources time limit with remaining capacity through the production claim, mission and handoff owners. No provider is called; the browser decides as an analyst would. */
export const reachSourcesTimeLimit = internalMutation({
    args: { runId: v.id("researchRuns"), fixtureKey: v.string() },
    returns: v.null(),
    handler: async (ctx, args): Promise<null> => {
        const { run } = await requireLocalFixtureRun(ctx, args);
        if (run.sourcePreparationId) {
            if (run.executionStatus !== "running") return null;
            const mission = await readSourcesMission(ctx, run);
            if (!mission) throw new Error("Sources mission required");
            if (mission.workflowId)
                await workflow.cancel(ctx, mission.workflowId as WorkflowId);
            const expired = Date.now() - 1;
            await ctx.db.patch(run.sourcePreparationId, {
                deadlineAt: expired,
                leaseExpiresAt: expired,
            });
            await ctx.db.patch(run._id, {
                executionHarnessDeadlineAt: expired,
            });
            await ctx.db.patch(mission._id, {
                deadlineAt: expired,
                generation: run.executionGeneration,
                status: "blocked",
                blockCode: "operation_outcome_unknown",
                workflowId: undefined,
            });
            await ctx.runMutation(internal.execution.handoffs.finishChild, {
                missionId: mission._id,
            });
            return null;
        }
        const envelope = activatedSourcesEnvelope();
        if (
            run.startMode !== "framed" ||
            !run.currentFramingRevisionId ||
            !run.activeCorpusRevisionId ||
            !envelope
        )
            throw new Error(
                "An unlaunched START fixture with active Sources configuration is required",
            );
        await ctx.db.patch(run._id, {
            fixedFramingRevisionId: run.currentFramingRevisionId,
            agentExecutionVersion: 3,
            sourcesProtocol: "sources_mission_v1",
            sourcesEnvelope: envelope,
            researchStartedAt: Date.now(),
            lifecycleState: "discovering_sources",
            executionStatus: "running",
            pauseReason: undefined,
        });
        await ctx.runMutation(internal.researchPlanning.createForRun, {
            runId: run._id,
            expectedExecutionGeneration: run.executionGeneration,
        });
        const preparationId = await ctx.runMutation(
            internal.sourcesMission.claim,
            {
                runId: run._id,
                corpusRevisionId: run.activeCorpusRevisionId,
                expectedGeneration: run.executionGeneration,
                envelope,
            },
        );
        const missionId = await ctx.runMutation(
            internal.execution.missions.start,
            {
                runId: run._id,
                expectedGeneration: run.executionGeneration,
                definitionId: "sources_v1",
                scope: { kind: "sources_v1", preparationId },
                requestKey: `${args.fixtureKey}:sources`,
            },
        );
        // The window closes with an operation in flight, as observed on 2026-11-15.
        const expired = Date.now() - 1;
        await ctx.db.patch(preparationId, {
            deadlineAt: expired,
            leaseExpiresAt: expired,
        });
        await ctx.db.patch(run._id, { executionHarnessDeadlineAt: expired });
        await ctx.db.patch(missionId, {
            deadlineAt: expired,
            status: "blocked",
            blockCode: "operation_outcome_unknown",
        });
        await ctx.runMutation(internal.execution.handoffs.finishChild, {
            missionId,
        });
        return null;
    },
});

/** Performs the research workflow's own checkpoint-then-handoff step after the analyst settles; the fixture has no durable workflow. */
export const settleSourcesFixture = internalMutation({
    args: { runId: v.id("researchRuns"), fixtureKey: v.string() },
    returns: v.null(),
    handler: async (ctx, args): Promise<null> => {
        const { run } = await requireLocalFixtureRun(ctx, args);
        const mission = await readSourcesMission(ctx, run);
        if (!run.sourcePreparationId || !mission)
            throw new Error("A Sources time-limit fixture is required");
        const state = await ctx.runMutation(
            internal.execution.researchControl.checkpoint,
            { runId: run._id },
        );
        if (state.waiting) throw new Error("No settlement was requested");
        await ctx.runMutation(internal.sourcesMission.finish, {
            preparationId: run.sourcePreparationId,
            missionId: mission._id,
            expectedGeneration: state.generation,
        });
        return null;
    },
});

type PreparedRequestApprovalFixture =
    | { kind: "done" }
    | {
          kind: "ready";
          missionId: Id<"agentMissions">;
          expectedGeneration: number;
          operationId: Id<"agentOperationRequests">;
          writer: string;
          instructionVersion: number;
      };

export const prepareRequestApprovalFixture = internalMutation({
    args: { runId: v.id("researchRuns"), fixtureKey: v.string() },
    returns: v.union(
        v.object({ kind: v.literal("done") }),
        v.object({
            kind: v.literal("ready"),
            missionId: v.id("agentMissions"),
            expectedGeneration: v.number(),
            operationId: v.id("agentOperationRequests"),
            writer: v.string(),
            instructionVersion: v.number(),
        }),
    ),
    handler: async (ctx, args): Promise<PreparedRequestApprovalFixture> => {
        const { run } = await requireLocalFixtureRun(ctx, args);
        const requestKey = `${args.fixtureKey}:request-approval`;
        const previous = await ctx.db
            .query("agentMessageDeliveries")
            .withIndex("by_run_and_key", (q) =>
                q.eq("runId", run._id).eq("requestKey", requestKey),
            )
            .unique();
        if (previous?.status === "processed") return { kind: "done" };
        if (
            run.startMode !== "framed" ||
            !run.fixedFramingRevisionId ||
            run.executionStatus !== "running"
        )
            throw new Error("A running framed fixture dossier is required");
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
        const messageId = await submitAuthorizedMessage(ctx, {
            runId: run._id,
            requestKey,
            delivery: "queue",
            text: "Simulation: ask whether to pause research.",
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
        if (
            !turn ||
            !mission?.piWakeToken ||
            mission.provenance !== "simulation"
        )
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
        const operationId: Id<"agentOperationRequests"> = await ctx.runMutation(
            internal.execution.operations.enqueue,
            {
                missionId: mission._id,
                expectedGeneration: mission.generation,
                cause: REQUEST_APPROVAL_FIXTURE_CAUSE,
                input: {
                    kind: "request_approval",
                    action: "pause_research",
                    messageId,
                },
                sourceMessageId: messageId,
                interpretedNeed: "Ask the analyst whether to pause research.",
            },
        );
        return {
            kind: "ready",
            missionId: mission._id,
            expectedGeneration: mission.generation,
            operationId,
            writer,
            instructionVersion: turn.instructionVersion,
        };
    },
});

export const finishRequestApprovalFixture = internalMutation({
    args: {
        runId: v.id("researchRuns"),
        fixtureKey: v.string(),
        missionId: v.id("agentMissions"),
        expectedGeneration: v.number(),
        writer: v.string(),
        instructionVersion: v.number(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await requireLocalFixtureRun(ctx, args);
        const mission = await ctx.db.get(args.missionId);
        if (!mission || mission.generation !== args.expectedGeneration)
            throw new Error("Simulated Workbench mission unavailable");
        await publishTurn(
            ctx,
            mission,
            "Simulation: please confirm whether to pause research.",
            args.instructionVersion,
        );
        await ctx.db.patch(mission._id, { status: "completed" });
        await ctx.runMutation(internal.execution.piControl.closeWorker, {
            missionId: mission._id,
            expectedGeneration: args.expectedGeneration,
            writer: args.writer,
            nativeSettled: true,
        });
        return null;
    },
});

/** Enqueues and dispatches request_approval on a simulated Workbench mission so the browser tests the conversation approval card without calling a model. */
export const requestApprovalFixture = internalAction({
    args: { runId: v.id("researchRuns"), fixtureKey: v.string() },
    returns: v.null(),
    handler: async (ctx, args): Promise<null> => {
        let prepared: PreparedRequestApprovalFixture | undefined;
        for (let attempt = 1; ; attempt++) {
            try {
                prepared = await ctx.runMutation(
                    internal.execution.fixtures.prepareRequestApprovalFixture,
                    args,
                );
                break;
            } catch (error) {
                const message =
                    error instanceof Error ? error.message : String(error);
                if (
                    attempt >=
                        QUALIFICATION_TOOLING_POLICY.fixtureConflictMaxAttempts ||
                    !message.includes(
                        "changed while this mutation was being run",
                    )
                )
                    throw error;
                await new Promise((resolve) =>
                    // resource-policy-exception: Canonical fixture backoff multiplied by the one-based attempt counter, not a caller-local duration.
                    setTimeout(
                        resolve,
                        QUALIFICATION_TOOLING_POLICY.fixtureConflictRetryBaseMs *
                            attempt,
                    ),
                );
            }
        }
        if (prepared.kind === "done") return null;
        const outcome = await ctx.runAction(
            internal.execution.operations.dispatch,
            {
                requestId: prepared.operationId,
                expectedGeneration: prepared.expectedGeneration,
            },
        );
        if (outcome.kind !== "success")
            throw new Error(`request_approval failed: ${outcome.kind}`);
        await ctx.runMutation(
            internal.execution.fixtures.finishRequestApprovalFixture,
            {
                ...args,
                missionId: prepared.missionId,
                expectedGeneration: prepared.expectedGeneration,
                writer: prepared.writer,
                instructionVersion: prepared.instructionVersion,
            },
        );
        return null;
    },
});

/** Model-free local proof of the deployed native reader through the admitted operation lifecycle. */
export const prepareSkillReadFixture = internalMutation({
    args: {
        fixtureKey: v.string(),
        slotKey: v.optional(v.string()),
        agent: v.optional(
            v.union(v.literal("workbench"), v.literal("sources")),
        ),
        path: v.optional(v.string()),
    },
    returns: v.object({
        runId: v.id("researchRuns"),
        requestId: v.id("agentOperationRequests"),
        expectedGeneration: v.number(),
        snapshotHash: v.string(),
    }),
    handler: async (
        ctx,
        args,
    ): Promise<{
        runId: Id<"researchRuns">;
        requestId: Id<"agentOperationRequests">;
        expectedGeneration: number;
        snapshotHash: string;
    }> => {
        const slotKey = args.slotKey ?? BROWSER_TEST_SLOT;
        await requireBrowserTestOwner(ctx, slotKey);
        const base = await ctx.runMutation(
            internal.e2eFixtures.seedSourceReviewScenario,
            { slotKey, fixtureKey: args.fixtureKey },
        );
        if (args.agent === "sources") {
            const owned = await requireLocalFixtureRun(ctx, {
                runId: base.runId,
                fixtureKey: args.fixtureKey,
            });
            const envelope = activatedSourcesEnvelope();
            if (!envelope)
                throw new Error("Sources fixture envelope unavailable");
            await ctx.db.patch(base.runId, {
                lifecycleState: "corpus_approved",
                executionStatus: "idle",
                pauseReason: undefined,
            });
            const run = await ctx.db.get(base.runId);
            if (!run) throw new Error("Fixture run required");
            const generation = await claimCorpusApprovedRunExecution(ctx, {
                visitor: owned.visitor,
                run,
                now: Date.now(),
            });
            await ctx.db.patch(base.runId, {
                lifecycleState: "discovering_sources",
                sourcesProtocol: "sources_mission_v1",
                sourcesEnvelope: envelope,
            });
            const preparationId = await ctx.runMutation(
                internal.sourcePreparation.claimForDiscovery,
                {
                    runId: base.runId,
                    corpusRevisionId: base.corpusRevisionId,
                    expectedExecutionGeneration: generation,
                },
            );
            const data = await initializeSources(ctx, preparationId, envelope);
            await ctx.db.patch(preparationId, { sourcesMission: data });
            const missionId = await ctx.runMutation(
                internal.execution.missions.start,
                {
                    runId: base.runId,
                    expectedGeneration: generation,
                    definitionId: "sources_v1",
                    scope: { kind: "sources_v1", preparationId },
                    requestKey: "native-skill-fixture",
                },
            );
            const requestId = await ctx.runMutation(
                internal.execution.operations.enqueue,
                {
                    missionId,
                    expectedGeneration: generation,
                    cause: "native-skill-fixture",
                    input: {
                        kind: "read",
                        path:
                            args.path ??
                            `/agent-skills/${getAgentDefinition("sources_v1").skills?.packageId}/source-preparation/SKILL.md`,
                    },
                },
            );
            return {
                runId: base.runId,
                requestId,
                expectedGeneration: generation,
                snapshotHash: await skillFixtureSnapshot(ctx, base.runId),
            };
        }
        await ctx.runMutation(internal.execution.fixtures.activateWorkbench, {
            runId: base.runId,
            fixtureKey: args.fixtureKey,
        });
        const turn = await ctx.runMutation(
            internal.execution.conversations.startTurn,
            {
                runId: base.runId,
                definitionId: "workbench_v1",
                scope: { kind: "workbench_v1" },
                simulation: true,
            },
        );
        if (!turn) throw new Error("Fixture turn required");
        const mission = await ctx.db.get(turn.missionId);
        if (!mission) throw new Error("Fixture mission required");
        const requestId = await ctx.runMutation(
            internal.execution.operations.enqueue,
            {
                missionId: mission._id,
                expectedGeneration: mission.generation,
                cause: "native-skill-fixture",
                input: {
                    kind: "read",
                    path:
                        args.path ??
                        `/agent-skills/${getAgentDefinition(mission.definitionId, mission.definitionVersion).skills?.packageId}/workbench-framing/SKILL.md`,
                },
            },
        );
        return {
            runId: base.runId,
            requestId,
            expectedGeneration: mission.generation,
            snapshotHash: await skillFixtureSnapshot(ctx, base.runId),
        };
    },
});

async function skillFixtureSnapshot(
    ctx: QueryCtx,
    runId: Id<"researchRuns">,
): Promise<string> {
    const run = await ctx.db.get(runId);
    if (!run) throw new Error("Fixture run required");
    return sha256Hex(
        stableStringify({
            corpus: run.activeCorpusRevisionId
                ? await ctx.db.get(run.activeCorpusRevisionId)
                : null,
            preparation: run.sourcePreparationId
                ? await ctx.db.get(run.sourcePreparationId)
                : null,
            sources: await ctx.db
                .query("sources")
                .withIndex("by_run_and_url", (q) => q.eq("runId", runId))
                .take(9),
        }),
    );
}

export const inspectSkillReadFixture = internalQuery({
    args: {
        runId: v.id("researchRuns"),
        fixtureKey: v.string(),
        requestId: v.id("agentOperationRequests"),
    },
    returns: v.object({ snapshotHash: v.string(), requestJson: v.string() }),
    handler: async (
        ctx,
        args,
    ): Promise<{ snapshotHash: string; requestJson: string }> => {
        await requireLocalFixtureRun(ctx, args);
        const request = await ctx.db.get(args.requestId);
        const mission = request?.missionId
            ? await ctx.db.get(request.missionId)
            : null;
        if (mission?.runId !== args.runId)
            throw new Error("Fixture request required");
        return {
            snapshotHash: await skillFixtureSnapshot(ctx, args.runId),
            requestJson: JSON.stringify(request),
        };
    },
});
