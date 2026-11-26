import { internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { MutationCtx } from "@convex/_generated/server";
import { stableStringify } from "@convex/domain/sourcePassages";
import { sourceCaptureScopeKey } from "@convex/domain/sourceRetrievalPolicy";
import { initializeSources } from "@convex/domain/sources";
import { sourcesV5Definition as retainedSourcesDefinition } from "@convex/domain/sourcesAgent";
import type { sourcesCompletionProposalValidator } from "@convex/domain/sourcesContracts";
import { getAgentDefinition } from "@convex/execution/agentCatalog";
import type { AgentDefinition } from "@convex/execution/agentDefinition";
import { stageObservedBody } from "@convex/execution/observedReply";
import { preparePiResult } from "@convex/integrations/piInvocation";
import type { Infer } from "convex/values";
import { vi } from "vitest";
import { seedInspectedEvidence } from "./source-preparation";

/** Declares an already-adopted read for capacity/history fixtures; reading behavior tests dispatch the real operation. */
export async function recordDocumentaryRead(
    ctx: MutationCtx,
    args: {
        runId: Id<"researchRuns">;
        missionId?: Id<"agentMissions">;
        captureId: Id<"sourceCaptures">;
        evidence: readonly { passageOrder: number; quotation: string }[];
    },
) {
    const capture = await ctx.db.get(args.captureId);
    const run = await ctx.db.get(args.runId);
    if (!capture?.contentHash || !run)
        throw new Error("Recorded read requires a captured source");
    const source = await ctx.db.get(capture.sourceId);
    if (!source) throw new Error("Recorded read requires source metadata");
    const passages = [
        ...new Map(args.evidence.map((e) => [e.passageOrder, e])).values(),
    ];
    return ctx.db.insert("agentOperationRequests", {
        runId: args.runId,
        missionId: args.missionId,
        actor: args.missionId ? "agent" : "system",
        cause: "recorded-documentary-read",
        logicalKey: `recorded-read:${args.captureId}:${args.missionId ?? "native"}:${passages.length}`,
        expectedGeneration: run.executionGeneration,
        operationVersion: 1,
        status: "completed",
        createdAt: 1,
        completedAt: 1,
        adoptedAt: 1,
        input: {
            kind: "search_available_material",
            sourceId: capture.sourceId,
            query: "recorded passage selection",
        },
        pin: {
            kind: "saved_material_inspection_v1",
            expectedCaptureId: capture._id,
            expectedContentHash: capture.contentHash,
        },
        outcome: {
            kind: "success",
            captureId: capture._id,
            valueJson: JSON.stringify({
                kind: "search_available_material",
                sourceId: capture.sourceId,
                captureId: capture._id,
                contentHash: capture.contentHash,
                canonicalUrl: source.canonicalUrl,
                retrievedAt: capture.retrievedAt,
                passages: passages.map((e) => ({
                    passageOrder: e.passageOrder,
                    exactQuote: e.quotation,
                    headingPath: [],
                })),
                omittedPassageCount: 0,
                limitReached: false,
            }),
        },
    });
}

export const sourcesTestEnvelope = {
    version: 1 as const,
    maxNeeds: 12,
    initialSearches: 4,
    complementSearches: 3,
    acquisitions: 10,
    controls: 20,
};

export const SOURCES_TEST_WINDOW_MINUTES = 15;

/** Drives the real scheduled action explicitly, leaving unrelated fixture timers untouched. */
export async function dispatchSourcesOperation(
    t: Awaited<ReturnType<typeof seedCapturedSources>>["t"],
    args: {
        requestId: Id<"agentOperationRequests">;
        expectedGeneration: number;
    },
) {
    const result = await t.action(internal.execution.operations.dispatch, args);
    if (result.kind !== "waiting") return result;
    const request = await t.run((ctx) => ctx.db.get(args.requestId));
    if (!request?.scheduledJobId)
        throw new Error("Expected a scheduled Sources operation");
    const action =
        request.input.kind === "acquire_document"
            ? internal.sourceCaptureActions.acquireDocument
            : internal.sourcesMissionActions.execute;
    return (
        (await t.action(action, args)) ??
        t.action(internal.execution.operations.dispatch, args)
    );
}

/** Enters the worker's start boundary for tests that exercise reservation/settlement separately. */
export async function startSourcesOperation(
    t: Awaited<ReturnType<typeof seedCapturedSources>>["t"],
    args: {
        requestId: Id<"agentOperationRequests">;
        expectedGeneration: number;
    },
) {
    const claimed = await t.mutation(internal.execution.operations.claim, args);
    if (claimed.kind === "outcome" && claimed.outcome.kind === "waiting")
        await t.mutation(
            internal.execution.operations.beginScheduledExecution,
            args,
        );
    return claimed;
}

/** Ordinary starts require explicit Sources activation; tests that start research opt in here. Pair with `vi.unstubAllEnvs()`. */
export function activateSourcesMission(envelope = sourcesTestEnvelope) {
    vi.stubEnv("SOURCES_MISSION_ENABLED", "true");
    vi.stubEnv("SOURCES_MISSION_ENVELOPE", JSON.stringify(envelope));
    vi.stubEnv(
        "SOURCES_PREPARATION_WINDOW_MINUTES",
        String(SOURCES_TEST_WINDOW_MINUTES),
    );
}

/** Retained-receipt fixtures share the real operation path; optional model output replaces only simulation and requires vi.restoreAllMocks() at teardown. */
export async function seedCapturedSources(
    options: {
        text?: string;
        modelResponse?: NonNullable<AgentDefinition["simulate"]>;
    } = {},
) {
    vi.stubEnv(
        "SOURCES_PREPARATION_WINDOW_MINUTES",
        String(SOURCES_TEST_WINDOW_MINUTES),
    );
    const f = await seedInspectedEvidence({ text: options.text });
    if (options.modelResponse) {
        vi.spyOn(retainedSourcesDefinition, "simulate").mockImplementation(
            options.modelResponse,
        );
    }
    const preparationId = await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        if (!run?.sourcePreparationId)
            throw new Error("Missing preparation fixture");
        await ctx.db.patch(f.runId, {
            sourcesProtocol: "sources_mission_v1",
            lifecycleState: "discovering_sources",
        });
        await ctx.db.patch(f.corpusRevisionId, { status: "draft" });
        await ctx.db.patch(run.sourcePreparationId, {
            executionPlanVersion: "source_actions_v3",
            status: "started",
            executionGeneration: 4,
            deadlineAt: Date.now() + 60_000,
            leaseExpiresAt: Date.now() + 60_000,
        });
        const data = await initializeSources(
            ctx,
            run.sourcePreparationId,
            sourcesTestEnvelope,
        );
        await ctx.db.patch(run.sourcePreparationId, {
            sourcesMission: { ...data, captureIds: [f.captureId] },
        });
        return run.sourcePreparationId;
    });
    const missionId = await f.t.mutation(internal.execution.missions.start, {
        runId: f.runId,
        expectedGeneration: 4,
        definitionId: retainedSourcesDefinition.id,
        scope: { kind: "sources_v1", preparationId },
        requestKey: "sources-fixture",
    });
    // These fixtures supply retained sourceId/passageOrder receipts to existing callers.
    await f.t.run((ctx) =>
        ctx.db.patch(missionId, {
            definitionVersion: retainedSourcesDefinition.version,
        }),
    );
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId,
            expectedGeneration: 4,
            cause: "fixture-read",
            input: {
                kind: "search_available_material",
                sourceId: f.sourceId,
                query: "workflow",
            },
        },
    );
    const outcome = await f.t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 4,
    });
    if (outcome.kind !== "success")
        throw new Error(`Fixture read failed: ${JSON.stringify(outcome)}`);
    const passage = await f.t.run((ctx) =>
        ctx.db
            .query("sourceSearchPassages")
            .withIndex("by_scope_capture_order", (q) =>
                q
                    .eq("scopeKey", sourceCaptureScopeKey(f.runId))
                    .eq("captureId", f.captureId),
            )
            .first(),
    );
    if (!passage) throw new Error("Fixture capture was not indexed");
    return {
        ...f,
        preparationId,
        missionId,
        passage,
        readRequestId: requestId,
    };
}

/** Adds an adopted native reading only for scenarios exercising native documentary controls. */
export async function seedObservedSources(
    options: Parameters<typeof seedCapturedSources>[0] = {},
) {
    const f = await seedCapturedSources(options);
    const nativeReadRequestId = await f.t.mutation(
        internal.execution.operations.enqueueNative,
        {
            runId: f.runId,
            expectedGeneration: 4,
            cause: "fixture-native-read",
            input: {
                kind: "read_in_context",
                sourceId: f.sourceId,
                passageOrder: f.passage.order,
            },
        },
    );
    const nativeOutcome = await f.t.action(
        internal.execution.operations.dispatch,
        { requestId: nativeReadRequestId, expectedGeneration: 4 },
    );
    if (nativeOutcome.kind !== "success")
        throw new Error("Native fixture read failed");
    return { ...f, nativeReadRequestId };
}

/** Retains exact Sources proposals through native observation before testing adoption or refusal. */
export async function retainSourcesProposal(
    t: Awaited<ReturnType<typeof seedCapturedSources>>["t"],
    authority: {
        invocationId: Id<"agentInvocations">;
        expectedGeneration: number;
    },
    response: Infer<typeof sourcesCompletionProposalValidator>,
) {
    const responseJson = stableStringify(response);
    const responseTextId = await t.action((ctx) =>
        stageObservedBody(ctx, authority, "response", responseJson),
    );
    const envelope = stableStringify({
        version: 1,
        provenance: "simulation",
        response,
    });
    const observableReplyTextId = await t.action((ctx) =>
        stageObservedBody(ctx, authority, "reply", envelope),
    );
    await t.mutation(internal.execution.invocations.retainOutput, {
        ...authority,
        ...(responseTextId ? { responseTextId } : { responseJson }),
        ...(observableReplyTextId
            ? { observableReplyTextId }
            : { observableReplyJson: envelope }),
    });
    return responseJson;
}

/** Prepares a native structured result before fixtures invoke its owning settlement mutation. */
export async function prepareSourcesResult(
    t: Awaited<ReturnType<typeof seedCapturedSources>>["t"],
    authority: Parameters<typeof stageObservedBody>[1],
    response: Infer<typeof sourcesCompletionProposalValidator>,
) {
    const responseJson = await retainSourcesProposal(t, authority, response);
    const { mission } = await t.query(
        internal.execution.invocationLifecycle.forExecution,
        authority,
    );
    const preparation = await t.action((ctx) =>
        preparePiResult(
            ctx,
            authority,
            response,
            responseJson,
            getAgentDefinition(mission.definitionId, mission.definitionVersion),
        ),
    );
    if (!preparation?.preparedResult)
        throw new Error("Sources fixture completion was not prepared");
    return preparation.preparedResult;
}
