import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { OptimisticLocalStore } from "convex/browser";
import { insertAtTop } from "convex/react";
import type { FunctionArgs } from "convex/server";

export const WORKBENCH_HISTORY_BODY_ACCESS = "separate";

/** Shows the submitted instruction in Convex's cache; native reconciliation and rollback remain SDK-owned. */
export function insertOptimisticConversationMessage(
    localStore: OptimisticLocalStore,
    args: FunctionArgs<typeof api.execution.conversations.submit>,
) {
    const conversation = localStore.getQuery(api.execution.conversations.get, {
        runId: args.runId,
    });
    // Queued controls need the server identity; only an idle conversation gets a provisional transcript entry.
    if (
        !conversation ||
        conversation.activeTurn ||
        conversation.queuedCount > 0 ||
        conversation.queuePaused
    )
        return;
    const pages = localStore.getAllQueries(api.workbench.history);
    if (
        pages.some(
            (page) =>
                page.args.runId === args.runId &&
                page.args.bodyAccess === WORKBENCH_HISTORY_BODY_ACCESS &&
                page.value?.page.some(
                    (message) => message.requestKey === args.requestKey,
                ),
        )
    )
        return;
    insertAtTop({
        paginatedQuery: api.workbench.history,
        argsToMatch: {
            runId: args.runId,
            bodyAccess: WORKBENCH_HISTORY_BODY_ACCESS,
        },
        localQueryStore: localStore,
        item: {
            _id: `optimistic:${args.requestKey}` as Id<"agentMessageDeliveries">,
            runId: args.runId,
            requestKey: args.requestKey,
            role: "user",
            delivery: args.delivery,
            status: args.delivery === "steer" ? "active" : "queued",
            turnId: args.turnId,
            text: args.text,
            createdAt: Date.now(),
            work: null,
        },
    });
}
