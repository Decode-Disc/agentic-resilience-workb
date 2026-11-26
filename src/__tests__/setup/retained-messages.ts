import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { retainedDeliveryKey } from "@convex/execution/conversationBodies";
import {
    retainedTextParts,
    stageRetainedText,
} from "@convex/execution/retainedText";
import type schema from "@convex/schema";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import type { TestConvex } from "convex-test";

/** Exercises the authenticated body reader when a workflow assertion needs the complete visible prose. */
export async function readMessageBodies<
    T extends {
        _id: Id<"agentMessageDeliveries">;
        runId: Id<"researchRuns">;
        text: string;
        body?: { contentHash: string };
    },
>(
    client: Pick<TestConvex<typeof schema>, "query">,
    messages: T[],
): Promise<T[]> {
    return Promise.all(
        messages.map(async (message) => {
            if (!message.body) return message;
            let index: number | null = 0;
            let text = "";
            while (index !== null) {
                const part: FunctionReturnType<
                    typeof api.execution.conversations.readMessageBody
                > = await client.query(
                    api.execution.conversations.readMessageBody,
                    {
                        runId: message.runId,
                        messageId: message._id,
                        contentHash: message.body.contentHash,
                        index,
                    },
                );
                text += part.content;
                index = part.nextIndex;
            }
            return { ...message, text };
        }),
    );
}

/** Reads a visible conversation page through the same separate metadata/body APIs as the UI. */
export async function readConversationPageWithBodies(
    client: Pick<TestConvex<typeof schema>, "query">,
    args: FunctionArgs<typeof api.execution.conversations.listMessages>,
) {
    const result = await client.query(
        api.execution.conversations.listMessages,
        args,
    );
    return { ...result, page: await readMessageBodies(client, result.page) };
}

/** Includes Workbench approvals and response-control metadata while resolving the published bodies. */
export async function readWorkbenchPageWithBodies(
    client: Pick<TestConvex<typeof schema>, "query">,
    args: FunctionArgs<typeof api.workbench.history>,
) {
    const result = await client.query(api.workbench.history, args);
    return { ...result, page: await readMessageBodies(client, result.page) };
}

/** Seeds canonical fixture bytes using the real fragment owner, one transaction per fragment. */
export async function retainFixtureDelivery(
    t: TestConvex<typeof schema>,
    deliveryId: Id<"agentMessageDeliveries">,
    content: string,
) {
    const delivery = await t.run((ctx) => ctx.db.get(deliveryId));
    if (!delivery) throw new Error("Missing fixture delivery");
    const { parts, manifest } = retainedTextParts(content);
    let textId: Id<"retainedTexts"> | undefined;
    for (const [index, part] of parts.entries()) {
        textId = await t.run((ctx) =>
            stageRetainedText(ctx, retainedDeliveryKey(delivery), {
                ...manifest,
                index,
                content: part,
            }),
        );
    }
    if (!textId) throw new Error("Missing fixture body");
    await t.run((ctx) =>
        ctx.db.patch(deliveryId, {
            bodyTextId: textId,
            bodyContentHash: manifest.contentHash,
        }),
    );
    return deliveryId;
}
