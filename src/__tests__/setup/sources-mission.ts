import { internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { MutationCtx } from "@convex/_generated/server";
import { SOURCE_RETRIEVAL_VERSION } from "@convex/domain/sourceRetrievalPolicy";
import { initializeSources } from "@convex/domain/sources";
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

/** Ordinary starts require explicit Sources activation; tests that start research opt in here. Pair with `vi.unstubAllEnvs()`. */
export function activateSourcesMission(envelope = sourcesTestEnvelope) {
    vi.stubEnv("SOURCES_MISSION_ENABLED", "true");
    vi.stubEnv("SOURCES_MISSION_ENVELOPE", JSON.stringify(envelope));
    vi.stubEnv(
        "SOURCES_PREPARATION_WINDOW_MINUTES",
        String(SOURCES_TEST_WINDOW_MINUTES),
    );
}

/** Real mission/capture fixtures share the public operation path; no provider is called. */
export async function seedCapturedSources(options: { text?: string } = {}) {
    vi.stubEnv(
        "SOURCES_PREPARATION_WINDOW_MINUTES",
        String(SOURCES_TEST_WINDOW_MINUTES),
    );
    const f = await seedInspectedEvidence(options);
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
        definitionId: "sources_v1",
        scope: { kind: "sources_v1", preparationId },
        requestKey: "sources-fixture",
    });
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
                    .eq(
                        "scopeKey",
                        `${f.runId}:${f.corpusRevisionId}:${SOURCE_RETRIEVAL_VERSION}`,
                    )
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
export async function seedObservedSources() {
    const f = await seedCapturedSources();
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
