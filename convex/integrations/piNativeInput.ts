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

type InputSnapshot = FunctionReturnType<
    typeof internal.execution.piStore.inputSnapshot
>;
type NativeInput = FunctionReturnType<
    typeof internal.execution.piControl.admittedInputs
>[number];
type ControlInput = FunctionReturnType<
    typeof internal.execution.piStore.pendingControlInputs
>["entries"][number];
/** False defers later records until an earlier analyst input has a native entry. */
type Delivery = { sequence: number; deliver(): Promise<boolean> };

/** Merges admitted messages and confirmed observations under the existing durable writer lease. */
export function createNativeInputDelivery(
    ctx: ActionCtx,
    args: { missionId: Id<"agentMissions">; expectedGeneration: number },
    storage: PiConvexStorage,
) {
    let syncingInputs: Promise<void> | undefined;
    let nativeInputs: NativeInput[] = [];
    const lease = () => {
        if (!storage.lease) throw executionError("pi_writer_fenced");
        return storage.lease;
    };
    async function controls(throughCreationTime: number) {
        const result: ControlInput[] = [];
        let cursor: string | null = null;
        do {
            const page: FunctionReturnType<
                typeof internal.execution.piStore.pendingControlInputs
            > = await ctx.runQuery(
                internal.execution.piStore.pendingControlInputs,
                {
                    ...lease(),
                    paginationOpts: { numItems: 20, cursor },
                    throughCreationTime,
                },
            );
            result.push(...page.entries);
            cursor = page.cursor;
        } while (cursor !== null);
        return result;
    }
    async function deliverControl(
        root: Conversation,
        context: Context,
        exchange: ControlInput,
    ) {
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
                        confirmationMessageId: exchange.confirmationMessageId,
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
        if (result.status === "queued") return true;
        if (result.status !== "done")
            throw executionError("native_control_unavailable");
        await ctx.runMutation(internal.execution.piStore.recordControlInputs, {
            ...lease(),
            messageIds: [exchange.messageId],
        });
        return true;
    }
    async function synchronizeControls(root: Conversation, context: Context) {
        const snapshot = await ctx.runMutation(
            internal.execution.piStore.inputSnapshot,
            lease(),
        );
        for (const exchange of await controls(
            snapshot.controlsThroughCreationTime,
        ))
            await deliverControl(root, context, exchange);
    }
    async function writeObservation(
        root: Conversation,
        context: Context,
        input: {
            requestId: string;
            kind: string;
            sequence: number;
            json: string;
            timestamp: number;
        },
    ) {
        const submission = await root.submit(
            {
                type: "write",
                requestId: input.requestId,
                entry: {
                    kind: input.kind,
                    data: { sequence: input.sequence },
                    model: [
                        {
                            role: "user",
                            content: `Application observation (data, not an analyst message):\n${input.json}`,
                            timestamp: input.timestamp,
                        },
                    ],
                },
            },
            context,
        );
        const result = await submission.status(context);
        if (result.status === "queued") return true;
        if (result.status !== "done")
            throw executionError("native_observation_unavailable");
        const retained = await storage.submissionByRequest(
            root.id,
            input.requestId,
            context,
        );
        if (!retained?.entry)
            throw executionError("native_observation_unavailable");
        const record = await storage.entry(retained.entry, context);
        const data = record?.entry.data;
        if (
            !data ||
            typeof data !== "object" ||
            Array.isArray(data) ||
            typeof data.sequence !== "number"
        )
            throw executionError("native_observation_invalid");
        await ctx.runMutation(
            internal.execution.piStore.recordObservationInput,
            { ...lease(), sequence: data.sequence, entryId: retained.entry },
        );
        return true;
    }
    async function* observations(
        root: Conversation,
        context: Context,
        snapshot: InputSnapshot,
    ): AsyncGenerator<Delivery> {
        if (snapshot.acknowledged === null) {
            const anchor = snapshot.anchor;
            if (anchor === null) return;
            yield {
                sequence: snapshot.throughSequence,
                deliver: () =>
                    writeObservation(root, context, {
                        requestId: `state-anchor:${lease().sessionId}`,
                        kind: "application.state-anchor",
                        sequence: snapshot.throughSequence,
                        json: anchor,
                        timestamp: Date.now(),
                    }),
            };
            return;
        }
        const through = snapshot.throughSequence;
        let after = snapshot.acknowledged;
        while (after < through) {
            context.abortSignal?.throwIfAborted();
            const page = await ctx.runQuery(
                internal.execution.piStore.pendingObservations,
                { ...lease(), after, through },
            );
            const event = page.entries[0];
            if (!event) throw executionError("native_observation_gap");
            yield {
                sequence: event.sequence,
                deliver: () =>
                    writeObservation(root, context, {
                        requestId: `observation:${event.eventId}`,
                        kind: "application.observation",
                        sequence: event.sequence,
                        json: event.json,
                        timestamp: event.occurredAt,
                    }),
            };
            after = event.sequence;
        }
    }
    async function synchronizeObservations(
        root: Conversation,
        context: Context,
    ) {
        const snapshot = await ctx.runMutation(
            internal.execution.piStore.inputSnapshot,
            lease(),
        );
        for await (const observation of observations(root, context, snapshot))
            await observation.deliver();
    }
    async function synchronize(root: Conversation, context: Context) {
        if (syncingInputs) return syncingInputs;
        syncingInputs = (async () => {
            const snapshot = await ctx.runMutation(
                internal.execution.piStore.inputSnapshot,
                lease(),
            );
            nativeInputs = snapshot.inputs;
            const deliveries: Delivery[] = nativeInputs.map((input) => ({
                sequence: input.nativeInputSequence,
                deliver: async () => {
                    const submission = await root.submit(
                        {
                            type: "input",
                            requestId: input.requestId,
                            whenBusy: "steer",
                            content: nativeAnalystInput(input.messages),
                            entry: {
                                kind: "workbench.analyst-input",
                                data: {
                                    missionId: args.missionId,
                                    instructionVersion:
                                        input.instructionVersion,
                                    messageIds: input.messages.map(
                                        (m) => m.messageId,
                                    ),
                                },
                            },
                        },
                        context,
                    );
                    return (
                        (await submission.status(context)).status !== "queued"
                    );
                },
            }));
            for (const exchange of await controls(
                snapshot.controlsThroughCreationTime,
            ))
                deliveries.push({
                    sequence: exchange.nativeInputSequence,
                    deliver: () => deliverControl(root, context, exchange),
                });
            deliveries.sort((a, b) => a.sequence - b.sequence);
            let index = 0;
            for await (const observation of observations(
                root,
                context,
                snapshot,
            )) {
                let next = deliveries[index];
                while (next && next.sequence < observation.sequence) {
                    context.abortSignal?.throwIfAborted();
                    if ((await next.deliver()) === false) return;
                    next = deliveries[++index];
                }
                await observation.deliver();
            }
            for (const delivery of deliveries.slice(index)) {
                context.abortSignal?.throwIfAborted();
                if ((await delivery.deliver()) === false) return;
            }
        })();
        try {
            await syncingInputs;
        } finally {
            syncingInputs = undefined;
        }
    }
    async function observationProof(
        root: Conversation,
        context: Context,
        checkpoint: unknown,
    ) {
        if (
            !checkpoint ||
            typeof checkpoint !== "object" ||
            !("cutoff" in checkpoint) ||
            typeof checkpoint.cutoff !== "number"
        )
            throw executionError("pi_request_task_unavailable");
        const page = await ctx.runQuery(
            internal.execution.piStore.pendingObservations,
            lease(),
        );
        if (page.acknowledged === null) return -1;
        if (page.acknowledgedEntry === null) return page.acknowledged;
        if (page.acknowledgedEntry > checkpoint.cutoff) return -1;
        const retained = await storage.entry(
            page.acknowledgedEntry as EntryId,
            context,
        );
        const data = retained?.entry.data;
        if (
            retained?.entry.conversationId !== root.id ||
            !["application.observation", "application.state-anchor"].includes(
                retained.entry.kind,
            ) ||
            !data ||
            typeof data !== "object" ||
            Array.isArray(data) ||
            data.sequence !== page.acknowledged
        )
            throw executionError("native_observation_invalid");
        return page.acknowledged;
    }
    async function hasPendingObservations() {
        const page = await ctx.runQuery(
            internal.execution.piStore.pendingObservations,
            lease(),
        );
        return (
            page.acknowledged === null ||
            page.acknowledged < page.throughSequence
        );
    }
    async function controlProof(
        root: Conversation,
        context: Context,
        cutoff: number,
    ) {
        const frontier = await ctx.runQuery(
            internal.execution.piStore.controlFrontier,
            lease(),
        );
        if (!frontier) return 0;
        const submission = await storage.submissionByRequest(
            root.id,
            `control:${frontier.messageId}`,
            context,
        );
        if (!submission?.entry || submission.entry > cutoff) return -1;
        const retained = await storage.entry(submission.entry, context);
        const data = retained?.entry.data;
        if (
            retained?.entry.kind !== "workbench.control-command" ||
            !data ||
            typeof data !== "object" ||
            Array.isArray(data) ||
            data.messageId !== frontier.messageId
        )
            throw executionError("native_control_unavailable");
        return frontier.sequence;
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
            controlSequence: await controlProof(root, context, cutoff),
        };
    }

    return {
        synchronize,
        synchronizeControls,
        synchronizeObservations,
        proof,
        observationProof,
        hasPendingObservations,
    };
}
