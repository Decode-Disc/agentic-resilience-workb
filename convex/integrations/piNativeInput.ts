import { internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { ActionCtx } from "@convex/_generated/server";
import { executionError } from "@convex/execution/errors";
import type { Context } from "@earendil-works/chord/context";
import type {
    AssistantMessage,
    TranscriptContext,
} from "@earendil-works/pi-ai";
import { getCurrentTools } from "@earendil-works/pi-ai/utils/transcript";
import type { Conversation, EntryId } from "@earendil-works/pi-durable";
import type { FunctionReturnType } from "convex/server";
import { modelToolSetKey, nativeAnalystInput } from "./modelInput";
import type { PiConvexStorage } from "./piStorage";

/** Retains code-owned exchanges and immutable analyst inputs under the native writer lease. */
export function createNativeInputDelivery(
    ctx: ActionCtx,
    args: { missionId: Id<"agentMissions">; expectedGeneration: number },
    storage: PiConvexStorage,
) {
    let syncingInputs: Promise<void> | undefined;
    let nativeInputs: FunctionReturnType<
        typeof internal.execution.piControl.admittedInputs
    > = [];
    async function synchronizeControls(root: Conversation, context: Context) {
        const lease = storage.lease;
        if (!lease) throw executionError("pi_writer_fenced");
        let more = true;
        let cursor: string | null = null;
        while (more) {
            context.abortSignal?.throwIfAborted();
            const page: FunctionReturnType<
                typeof internal.execution.piStore.pendingControlInputs
            > = await ctx.runQuery(
                internal.execution.piStore.pendingControlInputs,
                { ...lease, paginationOpts: { numItems: 20, cursor } },
            );
            cursor = page.cursor;
            more = cursor !== null;
            const recorded: Id<"agentMessageDeliveries">[] = [];
            for (const exchange of page.entries) {
                const confirmation: AssistantMessage = {
                    role: "assistant",
                    content: [{ type: "text", text: exchange.text }],
                    api: "application-control",
                    provider: "application",
                    model: "deterministic-control",
                    usage: {
                        input: 0,
                        output: 0,
                        cacheRead: 0,
                        cacheWrite: 0,
                        totalTokens: 0,
                        cost: {
                            input: 0,
                            output: 0,
                            cacheRead: 0,
                            cacheWrite: 0,
                            total: 0,
                        },
                    },
                    stopReason: "stop",
                    timestamp: exchange.confirmedAt,
                };
                const submission = await root.submit(
                    {
                        type: "write",
                        requestId: `control:${exchange.messageId}`,
                        entry: {
                            kind: "workbench.control-command",
                            data: {
                                messageId: exchange.messageId,
                                confirmationMessageId:
                                    exchange.confirmationMessageId,
                            },
                            model: [
                                {
                                    role: "user",
                                    content: exchange.command,
                                    timestamp: exchange.createdAt,
                                },
                                confirmation,
                            ],
                        },
                    },
                    context,
                );
                const result = await submission.status(context);
                if (result.status === "queued") continue;
                if (result.status !== "done")
                    throw executionError("native_control_unavailable");
                recorded.push(exchange.messageId);
            }
            if (recorded.length)
                await ctx.runMutation(
                    internal.execution.piStore.recordControlInputs,
                    { ...lease, messageIds: recorded },
                );
        }
    }

    async function synchronize(root: Conversation, context: Context) {
        if (syncingInputs) return syncingInputs;
        syncingInputs = (async () => {
            await synchronizeControls(root, context);
            const inputs = await ctx.runMutation(
                internal.execution.piControl.admittedInputs,
                args,
            );
            nativeInputs = inputs;
            for (const input of inputs)
                await root.submit(
                    {
                        type: "input",
                        requestId: input.requestId,
                        whenBusy: "steer",
                        content: nativeAnalystInput(input.messages),
                        entry: {
                            kind: "workbench.analyst-input",
                            data: {
                                missionId: args.missionId,
                                instructionVersion: input.instructionVersion,
                                messageIds: input.messages.map(
                                    (m) => m.messageId,
                                ),
                            },
                        },
                    },
                    context,
                );
        })();
        try {
            await syncingInputs;
        } finally {
            syncingInputs = undefined;
        }
    }

    async function proof(
        root: Conversation,
        context: Context,
        transcript: TranscriptContext,
        checkpoint: unknown,
    ) {
        if (
            !checkpoint ||
            typeof checkpoint !== "object" ||
            !("cutoff" in checkpoint) ||
            typeof checkpoint.cutoff !== "number"
        )
            throw executionError("pi_request_task_unavailable");
        const cutoff = checkpoint.cutoff as EntryId;
        const messageIds: Id<"agentMessageDeliveries">[] = [];
        for (const input of nativeInputs) {
            const submission = await storage.submissionByRequest(
                root.id,
                input.requestId,
                context,
            );
            if (!submission?.entry || submission.entry > cutoff) continue;
            const retained = await storage.entry(submission.entry, context);
            const data = retained?.entry.data;
            if (
                retained?.entry.kind !== "workbench.analyst-input" ||
                !data ||
                typeof data !== "object" ||
                Array.isArray(data) ||
                data.missionId !== args.missionId ||
                typeof data.instructionVersion !== "number" ||
                !Array.isArray(data.messageIds) ||
                !data.messageIds.every((id) => typeof id === "string")
            )
                throw executionError("native_input_unavailable");
            messageIds.push(
                ...(data.messageIds as Id<"agentMessageDeliveries">[]),
            );
        }
        return {
            messageIds,
            toolSetKey: modelToolSetKey(getCurrentTools(transcript.messages)),
        };
    }

    return { synchronize, synchronizeControls, proof };
}
