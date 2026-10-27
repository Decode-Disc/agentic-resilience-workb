import { api, internal } from "@convex/_generated/api";
import { afterEach, expect, test, vi } from "vitest";
import { seedInspectedEvidence } from "@/__tests__/setup/source-preparation";

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

test("overlapping search results count each inspected passage only once", async () => {
    const text = [
        "# Recurring fees",
        "Subscription pricing includes recurring fees.",
        "# Annual cycles",
        "Subscription pricing follows annual cycles.",
    ].join("\n\n");
    const { t, args, sourceId } = await seedInspectedEvidence({ text });
    vi.stubGlobal(
        "fetch",
        vi.fn(() => {
            throw new Error("Unexpected external I/O");
        }),
    );
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "overlapping-search-progress",
        expectedGeneration: 4,
    });

    const searchResults: string[][] = [];
    for (const [index, query] of [
        "subscription",
        "recurring",
        "annual",
    ].entries()) {
        const requestId = await t.mutation(
            internal.execution.operations.enqueue,
            {
                missionId,
                expectedGeneration: 4,
                cause: `search-${index}`,
                input: { kind: "search_available_material", sourceId, query },
            },
        );
        const outcome = await t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 4,
        });
        expect(outcome.kind).toBe("success");
        if (outcome.kind === "success") {
            searchResults.push(
                JSON.parse(outcome.valueJson).passages.map(
                    (passage: { exactQuote: string }) => passage.exactQuote,
                ),
            );
        }
    }

    expect(searchResults.map((quotes) => quotes.length)).toEqual([2, 1, 1]);
    const mission = await t.run((ctx) => ctx.db.get(missionId));
    expect(mission?.progressKeys).toHaveLength(2);
});

test.each([
    "cold",
    "warm",
] as const)("a %s saved-material context read verifies and loads its capture once", async (indexState) => {
    const { t, args, userId, sourceId, text } = await seedInspectedEvidence();
    if (indexState === "warm")
        await t
            .withIdentity({ subject: userId })
            .action(api.sourceRetrievalActions.ensureApprovedSourceIndex, {
                runId: args.runId,
                corpusRevisionId: args.corpusRevisionId,
                sourceId,
            });
    const quotation =
        "ServiceNow provides workflow software through its platform.";
    const startOffset = text.indexOf(quotation);
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: `single-capture-context-read-${indexState}`,
        expectedGeneration: args.executionGeneration,
    });
    const readCapture = vi.spyOn(Blob.prototype, "text");
    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        missionId,
        expectedGeneration: args.executionGeneration,
        cause: "read-context",
        input: { kind: "read_in_context", sourceId, passageOrder: 0 },
    });

    const outcome = await t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: args.executionGeneration,
    });

    expect(outcome.kind).toBe("success");
    if (outcome.kind === "success")
        expect(JSON.parse(outcome.valueJson)).toMatchObject({
            kind: "read_in_context",
            captureId: expect.any(String),
            contentHash: expect.any(String),
            passage: {
                passageOrder: 0,
                startOffset,
                endOffset: startOffset + quotation.length,
                exactQuote: quotation,
                surroundingText: text,
            },
        });
    expect(readCapture).toHaveBeenCalledTimes(1);
});

test.each([
    ["missing", "refused", "capture_unavailable"],
    ["corrupt", "unavailable", "capture_corrupt"],
    ["revoked", "refused", "not_authorized"],
] as const)("saved-material context reads preserve the %s capture refusal", async (condition, kind, code) => {
    const { t, args, sourceId, captureId, visitorId } =
        await seedInspectedEvidence();
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: `context-refusal-${condition}`,
        expectedGeneration: args.executionGeneration,
    });
    if (condition === "corrupt")
        await t.run((ctx) =>
            ctx.db.patch(captureId, { contentHash: "corrupt" }),
        );
    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        missionId,
        expectedGeneration: args.executionGeneration,
        cause: `context-refusal-${condition}`,
        input: { kind: "read_in_context", sourceId, passageOrder: 0 },
    });
    if (condition === "missing")
        await t.run(async (ctx) => {
            const capture = await ctx.db.get(captureId);
            if (!capture?.storageId) throw new Error("Missing fixture capture");
            await ctx.storage.delete(capture.storageId);
        });
    if (condition === "revoked")
        await t.run((ctx) => ctx.db.patch(visitorId, { status: "revoked" }));

    expect(
        await t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: args.executionGeneration,
        }),
    ).toMatchObject({ kind, code });
});
