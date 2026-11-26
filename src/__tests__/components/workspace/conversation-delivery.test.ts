import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { OptimisticLocalStore } from "convex/browser";
import { getFunctionName } from "convex/server";
import { expect, test, vi } from "vitest";
import { insertOptimisticConversationMessage } from "@/lib/workspace/conversation-delivery";

const runId = "optimistic-run" as Id<"researchRuns">;
const args = {
    runId,
    requestKey: "instruction-one",
    text: "Inspect the saved material",
    delivery: "queue" as const,
};

function cache(
    state:
        | {
              queuedCount: number;
              queuePaused: boolean;
              activeTurn: object | null;
          }
        | undefined,
) {
    const getQuery = vi.fn(() => state);
    const getAllQueries = vi
        .fn<OptimisticLocalStore["getAllQueries"]>()
        .mockReturnValue([
            {
                args: {
                    runId: "other-run",
                    paginationOpts: { cursor: null, numItems: 20 },
                },
                value: {
                    page: [
                        {
                            requestKey: args.requestKey,
                            text: "Another dossier's message",
                        },
                    ],
                    isDone: true,
                    continueCursor: "",
                },
            },
            {
                args: { runId, paginationOpts: { cursor: null, numItems: 20 } },
                value: { page: [], isDone: true, continueCursor: "" },
            },
            {
                args: {
                    runId,
                    bodyAccess: "separate",
                    paginationOpts: { cursor: null, numItems: 20 },
                },
                value: { page: [], isDone: true, continueCursor: "" },
            },
        ]);
    const setQuery = vi.fn<OptimisticLocalStore["setQuery"]>();
    return { getQuery, getAllQueries, setQuery };
}

test("an idle submission enters the real SDK paginated cache under its stable request identity", () => {
    const store = cache({
        queuedCount: 0,
        queuePaused: false,
        activeTurn: null,
    });
    const before = structuredClone(store.getAllQueries(api.workbench.history));
    insertOptimisticConversationMessage(store, args);
    expect(store.getQuery).toHaveBeenCalledWith(
        api.execution.conversations.get,
        { runId },
    );
    expect(store.setQuery).toHaveBeenCalledTimes(1);
    expect(store.getAllQueries(api.workbench.history)).toEqual(before);
    const write = store.setQuery.mock.calls[0];
    expect(write && getFunctionName(write[0])).toBe(
        getFunctionName(api.workbench.history),
    );
    expect(write?.[1]).toMatchObject({ runId, bodyAccess: "separate" });
    expect(store.setQuery.mock.calls[0]?.[2]).toMatchObject({
        page: [
            {
                runId,
                requestKey: "instruction-one",
                text: "Inspect the saved material",
                role: "user",
                status: "queued",
                work: null,
            },
        ],
    });
});

test("an existing request on a later page is not inserted a second time", () => {
    const store = cache({
        queuedCount: 0,
        queuePaused: false,
        activeTurn: null,
    });
    const pages = store.getAllQueries(api.workbench.history);
    store.getAllQueries.mockReturnValue([
        ...pages,
        {
            args: {
                runId,
                bodyAccess: "separate",
                paginationOpts: { cursor: "next-page", numItems: 20 },
            },
            value: {
                page: [{ requestKey: args.requestKey, text: args.text }],
                isDone: true,
                continueCursor: "",
            },
        },
    ]);
    insertOptimisticConversationMessage(store, args);
    expect(store.setQuery).not.toHaveBeenCalled();
});

test.each([
    undefined,
    { queuedCount: 0, queuePaused: false, activeTurn: { _id: "active-turn" } },
    { queuedCount: 1, queuePaused: false, activeTurn: null },
    { queuedCount: 0, queuePaused: true, activeTurn: null },
])("queue actions never receive a temporary message identity while the conversation is unavailable (%j)", (state) => {
    const store = cache(state);
    insertOptimisticConversationMessage(store, args);
    expect(store.setQuery.mock.calls.length).toBe(0);
});
