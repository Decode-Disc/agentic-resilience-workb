import { api, internal } from "@convex/_generated/api";
import { afterEach, expect, test, vi } from "vitest";
import { seedInspectedEvidence } from "@/__tests__/setup/source-preparation";

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

test("a new draft does not revoke access to the previous approved capture", async () => {
    const { t, args, userId } = await seedInspectedEvidence();
    const scope = {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        sourceId: args.sourceId,
    };
    const owned = t.withIdentity({ subject: userId });
    await owned.action(
        api.sourceRetrievalActions.ensureApprovedSourceIndex,
        scope,
    );
    await t.run(async (ctx) => {
        const draft = await ctx.db.insert("corpusRevisions", {
            runId: args.runId,
            revision: 2,
            status: "draft",
            createdAt: Date.now(),
        });
        await ctx.db.patch(args.runId, {
            activeCorpusRevisionId: draft,
            executionGeneration: 5,
            executionStatus: "paused",
        });
    });
    expect(
        await owned.query(api.sourceRetrieval.searchApprovedSource, {
            ...scope,
            query: "workflow",
        }),
    ).toMatchObject({ status: "ready" });
    await t.run(async (ctx) => {
        const head = await ctx.db
            .query("sourceReviewItems")
            .withIndex("by_revision_and_source", (q) =>
                q
                    .eq("corpusRevisionId", args.corpusRevisionId)
                    .eq("sourceId", args.sourceId),
            )
            .unique();
        if (!head) throw new Error("Missing fixture decision");
        const latestDecisionId = await ctx.db.insert("sourceDecisions", {
            ...scope,
            decision: "rejected",
            decisionKey: "rejection-fixture",
            occurredAt: Date.now(),
        });
        await ctx.db.patch(head._id, {
            decision: "rejected",
            latestDecisionId,
        });
    });
    await expect(
        owned.query(api.sourceRetrieval.searchApprovedSource, {
            ...scope,
            query: "workflow",
        }),
    ).rejects.toThrow("source_not_approved");
});

test("persisted mission capture access derives authority from the active approved run", async () => {
    const { t, args, visitorId } = await seedInspectedEvidence();
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "saved-material-inspection",
        expectedGeneration: args.executionGeneration,
    });
    const missionCaptureQuery =
        internal.sourceRetrieval.approvedCaptureForMission;

    expect(
        await t.query(missionCaptureQuery, {
            missionId,
            expectedGeneration: args.executionGeneration,
            sourceId: args.sourceId,
        }),
    ).toMatchObject({
        status: "available",
        capture: { sourceId: args.sourceId },
    });
    await expect(
        t.query(missionCaptureQuery, {
            missionId,
            expectedGeneration: args.executionGeneration - 1,
            sourceId: args.sourceId,
        }),
    ).rejects.toThrow("stale_execution");

    await t.run((ctx) => ctx.db.patch(visitorId, { status: "revoked" }));
    await expect(
        t.query(missionCaptureQuery, {
            missionId,
            expectedGeneration: args.executionGeneration,
            sourceId: args.sourceId,
        }),
    ).rejects.toThrow("not_authorized");
});

test("an admitted analyst can search an approved capture beyond materialized passages without provider I/O", async () => {
    const quotation = "Quasar architecture separates storage from compute.";
    const text = [
        ...Array.from(
            { length: 550 },
            (_, i) => `# Section ${i}\n\nRoutine disclosure ${i}.`,
        ),
        "# Architecture",
        quotation,
    ].join("\n\n");
    const { t, args, userId } = await seedInspectedEvidence({ text });
    const owned = t.withIdentity({ subject: userId });
    const scope = {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        sourceId: args.sourceId,
    };
    vi.stubGlobal(
        "fetch",
        vi.fn(() => {
            throw new Error("Unexpected provider call");
        }),
    );
    expect(
        await owned.action(
            api.sourceRetrievalActions.ensureApprovedSourceIndex,
            scope,
        ),
    ).toMatchObject({ status: "ready" });
    const result = await owned.query(api.sourceRetrieval.searchApprovedSource, {
        ...scope,
        query: "Quasar",
    });
    expect(result).toMatchObject({
        status: "ready",
        passages: [
            expect.objectContaining({
                quotation,
                startOffset: text.indexOf(quotation),
                endOffset: text.length,
            }),
        ],
    });
    expect(
        await owned.action(
            api.sourceRetrievalActions.ensureApprovedSourceIndex,
            scope,
        ),
    ).toMatchObject({ status: "ready" });
    expect(
        await t.run(async (ctx) => ({
            passages: (await ctx.db.query("sourceSearchPassages").collect())
                .length,
            versions: (await ctx.db.query("sourceVersions").collect()).length,
            calls: (await ctx.db.query("providerCalls").collect()).length,
        })),
    ).toEqual({ passages: 551, versions: 0, calls: 0 });
});

test("public and mission approved searches return the same indexed passages", async () => {
    const { t, args, userId } = await seedInspectedEvidence();
    const owned = t.withIdentity({ subject: userId });
    const scope = {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        sourceId: args.sourceId,
    };
    await owned.action(
        api.sourceRetrievalActions.ensureApprovedSourceIndex,
        scope,
    );
    const publicResult = await owned.query(
        api.sourceRetrieval.searchApprovedSource,
        { ...scope, query: "workflow" },
    );
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "approved-search-parity",
        expectedGeneration: args.executionGeneration,
    });

    const missionResult = await t.query(
        internal.sourceRetrieval.searchApprovedSourceForMission,
        {
            missionId,
            expectedGeneration: args.executionGeneration,
            sourceId: args.sourceId,
            query: "workflow",
        },
    );

    expect(missionResult).toEqual(publicResult);
});

test("a warm approved public index returns ready without loading the capture again", async () => {
    const { t, args, userId } = await seedInspectedEvidence();
    const owned = t.withIdentity({ subject: userId });
    const scope = {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        sourceId: args.sourceId,
    };
    await owned.action(
        api.sourceRetrievalActions.ensureApprovedSourceIndex,
        scope,
    );
    const readCapture = vi.spyOn(Blob.prototype, "text");

    expect(
        await owned.action(
            api.sourceRetrievalActions.ensureApprovedSourceIndex,
            scope,
        ),
    ).toEqual({ status: "ready" });

    expect(readCapture).not.toHaveBeenCalled();
});

test("approved search refuses unauthenticated, foreign, unapproved and revoked access", async () => {
    const { t, args, userId, visitorId } = await seedInspectedEvidence();
    const scope = {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        sourceId: args.sourceId,
    };
    await expect(
        t.query(api.sourceRetrieval.searchApprovedSource, {
            ...scope,
            query: "workflow",
        }),
    ).rejects.toThrow("not_authenticated");
    const foreign = await seedInspectedEvidence({}, t);
    const other = t.withIdentity({ subject: foreign.userId });
    const foreignScope = {
        runId: foreign.args.runId,
        corpusRevisionId: foreign.args.corpusRevisionId,
        sourceId: foreign.args.sourceId,
    };
    await expect(
        other.action(
            api.sourceRetrievalActions.ensureApprovedSourceIndex,
            foreignScope,
        ),
    ).resolves.toEqual({ status: "ready" });
    expect(
        await other.query(api.sourceRetrieval.searchApprovedSource, {
            ...foreignScope,
            query: "workflow",
        }),
    ).toMatchObject({
        status: "ready",
        passages: [
            expect.objectContaining({
                quotation: expect.stringContaining("workflow"),
            }),
        ],
    });
    const indexesBefore = await t.run((ctx) =>
        ctx.db.query("sourceSearchPassages").collect(),
    );
    await expect(
        other.action(
            api.sourceRetrievalActions.ensureApprovedSourceIndex,
            scope,
        ),
    ).rejects.toThrow("not_authorized");
    await expect(
        other.query(api.sourceRetrieval.searchApprovedSource, {
            ...scope,
            query: "workflow",
        }),
    ).rejects.toThrow("not_authorized");
    expect(
        await t.run((ctx) => ctx.db.query("sourceSearchPassages").collect()),
    ).toEqual(indexesBefore);
    const owned = t.withIdentity({ subject: userId });
    await t.run((ctx) =>
        ctx.db.patch(args.corpusRevisionId, { status: "draft" }),
    );
    await expect(
        owned.action(
            api.sourceRetrievalActions.ensureApprovedSourceIndex,
            scope,
        ),
    ).rejects.toThrow("source_not_approved");
    await t.run((ctx) =>
        ctx.db.patch(args.corpusRevisionId, { status: "approved" }),
    );
    await owned.action(
        api.sourceRetrievalActions.ensureApprovedSourceIndex,
        scope,
    );
    await t.run((ctx) => ctx.db.patch(visitorId, { status: "revoked" }));
    await expect(
        owned.query(api.sourceRetrieval.searchApprovedSource, {
            ...scope,
            query: "workflow",
        }),
    ).rejects.toThrow("not_authorized");
});

test.each([
    "missing",
    "corrupt",
    "legacy",
] as const)("approved search reports %s capture availability without substitute retrieval", async (condition) => {
    const { t, args, userId, captureId } = await seedInspectedEvidence();
    await t.run(async (ctx) => {
        const capture = await ctx.db.get(captureId);
        if (!capture?.storageId) throw new Error("Missing fixture capture");
        if (condition === "missing")
            await ctx.storage.delete(capture.storageId);
        if (condition === "corrupt")
            await ctx.db.patch(captureId, { contentHash: "corrupt" });
        if (condition === "legacy")
            await ctx.db.patch(args.corpusRevisionId, {
                sourceSelectionProposalId: undefined,
            });
    });
    vi.stubGlobal(
        "fetch",
        vi.fn(() => {
            throw new Error("Unexpected provider call");
        }),
    );
    expect(
        await t
            .withIdentity({ subject: userId })
            .action(api.sourceRetrievalActions.ensureApprovedSourceIndex, {
                runId: args.runId,
                corpusRevisionId: args.corpusRevisionId,
                sourceId: args.sourceId,
            }),
    ).toEqual({
        status: "unavailable",
        reason:
            condition === "legacy"
                ? "no_prepared_capture"
                : condition === "corrupt"
                  ? "capture_corrupt"
                  : "capture_unavailable",
    });
});

test("incomplete search batches stay invisible and cannot finish after access revocation", async () => {
    const { t, args, userId, visitorId, captureId, text } =
        await seedInspectedEvidence();
    const owned = t.withIdentity({ subject: userId });
    const scope = {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        sourceId: args.sourceId,
    };
    const prepared = await owned.query(
        internal.sourceRetrieval.getApprovedCapture,
        scope,
    );
    if (prepared.status !== "available") throw new Error("Missing capture");
    const identity = {
        ...scope,
        captureId,
        contentHash: prepared.capture.contentHash,
    };
    await owned.mutation(internal.sourceRetrieval.putApprovedBatch, {
        ...identity,
        passages: [
            {
                order: 0,
                startOffset: 0,
                endOffset: text.length,
                quotation: text,
                headingPath: [],
            },
        ],
    });
    expect(
        await owned.query(api.sourceRetrieval.searchApprovedSource, {
            ...scope,
            query: "workflow",
        }),
    ).toEqual({ status: "not_indexed" });
    await t.run((ctx) => ctx.db.patch(visitorId, { status: "revoked" }));
    await expect(
        owned.mutation(internal.sourceRetrieval.finishApprovedIndex, {
            ...identity,
            candidateCount: 1,
        }),
    ).rejects.toThrow("not_authorized");
});
