import { api, internal } from "@convex/_generated/api";
import type { QueryCtx } from "@convex/_generated/server";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
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

test("Workbench records the unit progress key of a successful contextual reading", async () => {
    const { t, args, sourceId, userId } = await seedInspectedEvidence();
    await t.run(async (ctx) => {
        const framingId = await ctx.db.insert("framingRevisions", {
            runId: args.runId,
            revision: 1,
            content: { scope: "Workflow platform", questions: [] },
            contentHash: "fixture",
            requestKey: "fixed",
            origin: "analyst",
            createdAt: Date.now(),
        });
        await ctx.db.patch(args.runId, {
            startMode: "framed",
            fixedFramingRevisionId: framingId,
            currentFramingRevisionId: framingId,
        });
    });
    const client = t.withIdentity({ subject: userId });
    await client.mutation(api.execution.conversations.submit, {
        runId: args.runId,
        requestKey: "reading",
        text: "Inspect the retained passage",
        delivery: "queue",
    });
    const turn = await t.mutation(internal.execution.conversations.startTurn, {
        runId: args.runId,
        definitionId: "workbench_v1",
        scope: { kind: "workbench_v1" },
        simulation: false,
    });
    if (!turn) throw new Error("Expected Workbench turn");
    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        missionId: turn.missionId,
        expectedGeneration: 1,
        cause: "context-reading",
        input: { kind: "read_in_context", sourceId, passageOrder: 0 },
    });
    const outcome = await t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 1,
    });
    expect(outcome).toMatchObject({
        kind: "success",
        progressKey: expect.any(String),
    });
    if (
        outcome.kind !== "success" ||
        !("progressKey" in outcome) ||
        !outcome.progressKey
    )
        throw new Error("Expected successful reading");
    expect(await t.run((ctx) => ctx.db.get(turn.missionId))).toMatchObject({
        progressKeys: [outcome.progressKey],
    });
});

test("documentary search pages reach passages beyond the first response and refuse a changed search scope", async () => {
    const text = Array.from(
        { length: 90 },
        (_, index) =>
            `# Section ${index}\n\nSubscription revenue relates to section ${index}. ${"Subscription conditions remain specific. ".repeat(50)}`,
    ).join("\n\n");
    const { t, args, sourceId } = await seedInspectedEvidence({ text });
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "paged-search",
        expectedGeneration: 4,
    });
    let readCount = 0;
    const read = async (query: string, continuation?: string) => {
        const requestId = await t.mutation(
            internal.execution.operations.enqueue,
            {
                missionId,
                expectedGeneration: 4,
                cause: `search:${++readCount}`,
                input: {
                    kind: "search_available_material",
                    sourceId,
                    query,
                    ...(continuation ? { continuation } : {}),
                },
            },
        );
        return t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 4,
        });
    };
    const first = await read("Subscription");
    expect(first.kind).toBe("success");
    if (first.kind !== "success") throw new Error("Expected material");
    const page = JSON.parse(first.valueJson);
    expect(page.continuation).toEqual(expect.any(String));
    const seen = new Set<number>(
        page.passages.map(
            (passage: { passageOrder: number }) => passage.passageOrder,
        ),
    );
    let continuation: string | null = page.continuation;
    while (continuation) {
        const result = await read("Subscription", continuation);
        if (result.kind !== "success") throw new Error(JSON.stringify(result));
        const next = JSON.parse(result.valueJson);
        for (const passage of next.passages) {
            expect(seen.has(passage.passageOrder)).toBe(false);
            seen.add(passage.passageOrder);
        }
        continuation = next.continuation;
    }
    expect(seen.size).toBeGreaterThan(64);
    expect(await read("Annual", page.continuation)).toMatchObject({
        kind: "refused",
        code: "material_continuation_invalid",
    });
});

test("requested context ranges continue with exact Unicode offsets without manufacturing new passage progress", async () => {
    const text = `# Documentary context\n\n${"Reported qualification 🧭 with a specific limitation. ".repeat(1000)}`;
    const { t, args, sourceId } = await seedInspectedEvidence({ text });
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "context-pages",
        expectedGeneration: 4,
    });
    let count = 0;
    const read = async (
        continuation?: string,
        range?: { startOffset: number; endOffset: number },
    ) => {
        const requestId = await t.mutation(
            internal.execution.operations.enqueue,
            {
                missionId,
                expectedGeneration: 4,
                cause: `context-page-${++count}`,
                input: {
                    kind: "read_in_context",
                    sourceId,
                    passageOrder: 0,
                    ...(continuation ? { continuation } : {}),
                    ...(range ? { range } : {}),
                },
            },
        );
        const result = await t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 4,
        });
        if (result.kind !== "success") throw new Error(JSON.stringify(result));
        return JSON.parse(result.valueJson);
    };
    const focal = await read();
    const before = await t.run((ctx) => ctx.db.get(missionId));
    let page = await read(undefined, {
        startOffset: 0,
        endOffset: focal.passage.captureCharacters,
    });
    let recovered = page.passage.surroundingText;
    let end = page.passage.contextEndOffset;
    expect(page.continuation).toEqual(expect.any(String));
    while (page.continuation) {
        page = await read(page.continuation);
        expect(page.passage.contextStartOffset).toBe(end);
        recovered += page.passage.surroundingText;
        end = page.passage.contextEndOffset;
    }
    expect(recovered).toBe(text);
    expect((await t.run((ctx) => ctx.db.get(missionId)))?.progressKeys).toEqual(
        before?.progressKeys,
    );
});

test.each([
    "native-message",
    "native-data",
    "unexpected",
    "range",
] as const)("documentary continuation normalizes only cursor and range validation failures (%s)", async (failure) => {
    const f = await seedInspectedEvidence({
        text: Array.from(
            { length: 70 },
            (_, index) =>
                `# Section ${index}\n\nSubscription revenue depends on section ${index}.`,
        ).join("\n\n"),
    });
    const missionId = await f.t.mutation(internal.execution.missions.start, {
        runId: f.args.runId,
        corpusRevisionId: f.args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "invalid-documentary-continuation",
        expectedGeneration: 4,
    });
    let sequence = 0;
    const read = async (
        input: import("@convex/domain/savedMaterialOperations").SavedMaterialOperation,
    ) => {
        const requestId = await f.t.mutation(
            internal.execution.operations.enqueue,
            {
                missionId,
                expectedGeneration: 4,
                cause: `continuation-${++sequence}`,
                input,
            },
        );
        return f.t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 4,
        });
    };
    const initial = await read({
        kind: "search_available_material",
        sourceId: f.sourceId,
        query: "Subscription",
    });
    if (initial.kind !== "success") throw new Error("Expected initial search");
    const continuation: string = JSON.parse(initial.valueJson).continuation;
    expect(continuation).toEqual(expect.any(String));
    const before = await f.t.run((ctx) => ctx.db.get(missionId));
    const { searchApprovedSourceForMission } = await import(
        "@convex/sourceRetrieval"
    );
    const registered =
        searchApprovedSourceForMission as typeof searchApprovedSourceForMission & {
            _handler(
                ctx: QueryCtx,
                args: FunctionArgs<
                    typeof internal.sourceRetrieval.searchApprovedSourceForMission
                >,
            ): Promise<
                FunctionReturnType<
                    typeof internal.sourceRetrieval.searchApprovedSourceForMission
                >
            >;
        };
    const original = registered._handler;
    const nativeError =
        failure === "native-data"
            ? new ConvexError({
                  isConvexSystemError: true,
                  paginationError: "InvalidCursor",
              })
            : new Error(
                  failure === "unexpected"
                      ? "database_unavailable"
                      : "InvalidCursor: malformed pagination cursor",
              );
    // convex-test uses JSON cursors; emulate only the native database error at paginate.
    const observeDatabase = (target: object): object =>
        new Proxy(target, {
            get(object, key, receiver) {
                const value: unknown = Reflect.get(object, key, receiver);
                if (typeof value !== "function") return value;
                return (...params: unknown[]) => {
                    if (key === "paginate") throw nativeError;
                    const result: unknown = Reflect.apply(
                        value,
                        object,
                        params,
                    );
                    return ["query", "withSearchIndex"].includes(String(key)) &&
                        result &&
                        typeof result === "object"
                        ? observeDatabase(result)
                        : result;
                };
            },
        });
    const spy = vi
        .spyOn(registered, "_handler")
        .mockImplementation((ctx, args) =>
            original(
                { ...ctx, db: observeDatabase(ctx.db) as QueryCtx["db"] },
                args,
            ),
        );
    try {
        const outcome = await read(
            failure === "range"
                ? {
                      kind: "read_in_context",
                      sourceId: f.sourceId,
                      passageOrder: 0,
                      range: { startOffset: 0, endOffset: 1000000 },
                  }
                : {
                      kind: "search_available_material",
                      sourceId: f.sourceId,
                      query: "Subscription",
                      continuation: JSON.stringify({
                          ...JSON.parse(continuation),
                          cursor: "malformed-native",
                      }),
                  },
        );
        expect(outcome).toMatchObject(
            failure === "unexpected"
                ? { kind: "unavailable", code: "operation_outcome_unknown" }
                : { kind: "refused", code: "material_continuation_invalid" },
        );
        expect(
            (await f.t.run((ctx) => ctx.db.get(missionId)))?.progressKeys,
        ).toEqual(before?.progressKeys);
        if (failure === "unexpected") {
            const events = await f.t.run((ctx) =>
                ctx.db
                    .query("agentExecutionEvents")
                    .withIndex("by_mission_and_kind", (q) =>
                        q.eq("missionId", missionId),
                    )
                    .collect(),
            );
            expect(
                events.some(
                    (event) =>
                        event.protectedDiagnostic?.message ===
                        "database_unavailable",
                ),
            ).toBe(true);
        }
    } finally {
        spy.mockRestore();
    }
});
