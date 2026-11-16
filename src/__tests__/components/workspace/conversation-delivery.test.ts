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

function cache(state: {
    queuedCount: number;
    queuePaused: boolean;
    activeTurn: object | null;
}) {
    const getQuery = vi.fn(() => state);
    const getAllQueries = vi
        .fn<OptimisticLocalStore["getAllQueries"]>()
        .mockReturnValue([
            {
                args: {
                    runId: "other-run",
                    paginationOpts: { cursor: null, numItems: 20 },
                },
                value: { page: [], isDone: true, continueCursor: "" },
            },
            {
                args: { runId, paginationOpts: { cursor: null, numItems: 20 } },
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
    insertOptimisticConversationMessage(store, args);
    const write = store.setQuery.mock.calls[0];
    expect(write && getFunctionName(write[0])).toBe(
        getFunctionName(api.workbench.history),
    );
    expect(write?.[1]).toMatchObject({ runId });
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

test.each([
    { queuedCount: 0, queuePaused: false, activeTurn: { _id: "active-turn" } },
    { queuedCount: 1, queuePaused: false, activeTurn: null },
    { queuedCount: 0, queuePaused: true, activeTurn: null },
])("queue actions never receive a temporary message identity while the conversation is unavailable (%j)", (state) => {
    const store = cache(state);
    insertOptimisticConversationMessage(store, args);
    expect(store.setQuery.mock.calls.length).toBe(0);
});
