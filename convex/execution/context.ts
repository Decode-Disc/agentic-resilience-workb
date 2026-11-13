import type { Doc, Id } from "@convex/_generated/dataModel";
import { internalQuery, type QueryCtx } from "@convex/_generated/server";
import { stableStringify } from "@convex/domain/sourcePassages";
import { readConversationMessages } from "@convex/integrations/agentStorage";
import { agentInputByteLength } from "@convex/integrations/modelInput";
import { SIMULATION_MODEL_ROUTE } from "@convex/integrations/modelRouting";
import { missionModel, revisionRoute } from "@convex/modelConfiguration";
import { MAX_CONTEXT_BYTES } from "@convex/resourcePolicy";
import { v } from "convex/values";
import { validate } from "convex-helpers/validators";
import { getAgentDefinition } from "./agentCatalog";
import { agentToolSchemas } from "./agentDefinition";
import {
    executionError,
    executionFailureCode,
    readOperationCause,
    requireMissionAuthority,
} from "./authority";
import { conversationInstructions } from "./conversations";
import {
    invocationResponseValidator,
    MAX_BATCH_REQUESTS,
} from "./executionProtocol";
import {
    contextObservationSequence,
    invocationHistoryReference,
    latestNativeControl,
    operationContextObservation,
    operationHistoryReference,
} from "./journal";
import { missionScope } from "./missionData";
import {
    operationResultSchema,
    operationResultValidator,
} from "./operationResults";

async function requestContext(
    ctx: QueryCtx,
    request: Doc<"agentOperationRequests">,
    callId?: string,
    causeId?: Id<"agentExecutionEvents">,
) {
    const cause = await readOperationCause(ctx, request, causeId);
    const sourceMessageId = cause ? cause.messageId : request.sourceMessageId;
    const interpretedNeed = cause
        ? (cause.interpretedNeed ??
          (cause.kind === "operation_requested"
              ? request.interpretedNeed
              : undefined))
        : request.interpretedNeed;
    let analystInstruction:
        | {
              messageId: Id<"agentMessageDeliveries">;
              originalText: string;
              interpretedNeed: string | null;
          }
        | undefined;
    if (sourceMessageId) {
        const message = await ctx.db.get(sourceMessageId);
        const conversation = message
            ? await ctx.db.get(message.conversationId)
            : null;
        const mission = request.missionId
            ? await ctx.db.get(request.missionId)
            : null;
        if (
            !message ||
            !conversation ||
            message.role !== "user" ||
            message.runId !== mission?.runId ||
            conversation.runId !== message.runId
        )
            throw executionError("conversation_message_unavailable");
        const [originalText] = await readConversationMessages(
            ctx,
            conversation.storageRef,
            [message.storageMessageRef],
        );
        if (originalText === undefined)
            throw executionError("conversation_message_unavailable");
        analystInstruction = {
            messageId: message._id,
            originalText,
            interpretedNeed: interpretedNeed ?? null,
        };
    }
    return {
        ...(callId ? { callId } : {}),
        ...operationContextObservation(request),
        historyReference:
            (await operationHistoryReference(ctx, request._id)) ??
            causeId ??
            null,
        ...(analystInstruction ? { analystInstruction } : {}),
    };
}

/** Required context is assembled from retained authority and work, never from an optional memory-saving tool. */
export async function buildMissionContext(
    ctx: QueryCtx,
    missionId: Id<"agentMissions">,
    expectedGeneration: number,
) {
    const { mission, run } = await requireMissionAuthority(
        ctx,
        missionId,
        expectedGeneration,
    );
    const definition = getAgentDefinition(
        mission.definitionId,
        mission.definitionVersion,
    );
    const domainContext = await definition.context(ctx, mission, run);
    if (domainContext.kind === "blocked") return domainContext;
    const previousInvocation = mission.lastInvocationId
        ? await ctx.db.get(mission.lastInvocationId)
        : null;
    const previousResponse: unknown = previousInvocation?.outputJson
        ? JSON.parse(previousInvocation.outputJson)
        : null;
    const previousRequests =
        validate(invocationResponseValidator, previousResponse) &&
        previousResponse.kind === "operations"
            ? previousResponse.requests
            : [];
    const causeKinds = [
        "operation_requested",
        "operation_reused",
        "operation_refused",
    ] as const;
    const invocationCauses = new Map<string, Id<"agentExecutionEvents">>();
    if (previousInvocation?.requestIds) {
        for (const kind of causeKinds) {
            const causes = await ctx.db
                .query("agentExecutionEvents")
                .withIndex("by_invocation_and_kind", (q) =>
                    q
                        .eq("invocationId", previousInvocation._id)
                        .eq("kind", kind),
                )
                .take(
                    mission.executionRuntime === "pi-durable"
                        ? 8192
                        : MAX_BATCH_REQUESTS + 1,
                );
            if (
                mission.executionRuntime !== "pi-durable" &&
                causes.length > MAX_BATCH_REQUESTS
            )
                throw executionError("continuation_capacity");
            for (const cause of causes)
                invocationCauses.set(cause.cause, cause._id);
        }
        if (
            mission.executionRuntime !== "pi-durable" &&
            invocationCauses.size > MAX_BATCH_REQUESTS
        )
            throw executionError("continuation_capacity");
    }
    const triggeringRequests = [];
    if (previousInvocation?.requestIds) {
        if (
            mission.executionRuntime !== "pi-durable" &&
            previousInvocation.requestIds.length > MAX_BATCH_REQUESTS
        )
            throw executionError("continuation_capacity");
        for (const [
            index,
            requestId,
        ] of previousInvocation.requestIds.entries()) {
            const request = await ctx.db.get(requestId);
            if (!request || request.missionId !== missionId)
                throw executionError("continuation_request_unavailable");
            triggeringRequests.push({
                request,
                callId: previousRequests[index]?.callId,
                causeId: invocationCauses.get(
                    previousRequests[index]?.callId ?? "",
                ),
            });
        }
    } else {
        const latest = await ctx.db
            .query("agentOperationRequests")
            .withIndex("by_mission", (q) => q.eq("missionId", missionId))
            .order("desc")
            .take(MAX_BATCH_REQUESTS);
        for (const request of latest.reverse())
            triggeringRequests.push({
                request,
                callId: undefined,
                causeId: undefined,
            });
    }
    const triggeringRequestsAndResults: Awaited<
        ReturnType<typeof requestContext>
    >[] = [];
    const includedUses = new Set<string>();
    let resultBytes = 0;
    const append = async (
        request: Doc<"agentOperationRequests">,
        callId?: string,
        causeId?: Id<"agentExecutionEvents">,
    ) => {
        const view = await requestContext(ctx, request, callId, causeId);
        const useKey = stableStringify(view);
        if (includedUses.has(useKey)) return true;
        resultBytes += new TextEncoder().encode(JSON.stringify(view)).length;
        if (
            mission.executionRuntime !== "pi-durable" &&
            resultBytes > MAX_CONTEXT_BYTES
        )
            return false;
        includedUses.add(useKey);
        triggeringRequestsAndResults.push(view);
        return true;
    };
    for (const { request, callId, causeId } of triggeringRequests)
        if (!(await append(request, callId, causeId)))
            return { kind: "blocked" as const, code: "context_capacity" };
    for (const kind of causeKinds) {
        const nativeCauses = ctx.db
            .query("agentExecutionEvents")
            .withIndex("by_mission_and_kind", (q) => {
                const query = q.eq("missionId", missionId).eq("kind", kind);
                return previousInvocation
                    ? query.gt(
                          "_creationTime",
                          previousInvocation._creationTime,
                      )
                    : query;
            });
        for await (const cause of nativeCauses) {
            if (cause.invocationId) continue;
            const request = cause.requestId
                ? await ctx.db.get(cause.requestId)
                : null;
            if (!request || request.missionId !== missionId)
                throw executionError("continuation_request_unavailable");
            if (!(await append(request, undefined, cause._id)))
                return { kind: "blocked" as const, code: "context_capacity" };
        }
    }
    const nativeRequests = ctx.db
        .query("agentOperationRequests")
        .withIndex("by_mission_and_actor", (q) => {
            const query = q.eq("missionId", missionId).eq("actor", "system");
            return previousInvocation
                ? query.gt("_creationTime", previousInvocation._creationTime)
                : query;
        });
    for await (const request of nativeRequests)
        if (!(await append(request)))
            return { kind: "blocked" as const, code: "context_capacity" };
    const pending = await ctx.db
        .query("agentOperationRequests")
        .withIndex("by_mission_and_status", (q) =>
            q.eq("missionId", missionId).eq("status", "pending"),
        )
        .take(5);
    let activeInstructions: Awaited<
        ReturnType<typeof conversationInstructions>
    >;
    try {
        activeInstructions = await conversationInstructions(ctx, mission);
    } catch (error) {
        const code = executionFailureCode(error);
        if (!code) throw error;
        return { kind: "blocked" as const, code };
    }
    const assembled = {
        nativeObservations: {
            throughSequence: await contextObservationSequence(
                ctx,
                mission.runId,
            ),
            controlSequence: definition.nativeConversation
                ? ((await latestNativeControl(ctx, mission.runId))
                      ?.nativeInputSequence ?? 0)
                : 0,
        },
        version: mission.definitionVersion,
        definition: {
            id: definition.id,
            version: definition.version,

            operationNames: Object.keys(definition.operations),
        },
        mission: {
            id: mission._id,
            status: mission.status,
            definition: mission.definitionId,
            objective: mission.objectiveKey,
            runId: run._id,
            scope: missionScope(mission),
        },
        ...(definition.contextRendering
            ? {
                  contextRendering: definition.contextRendering,
                  domain: Object.fromEntries(
                      Object.entries(domainContext.context).filter(
                          ([key]) => key !== "activeWork",
                      ),
                  ),
              }
            : domainContext.context),
        constraints: {
            resourcePolicy: mission.resourcePolicy,
            generation: mission.generation,
            deadlineAt: mission.deadlineAt,
            operations: Object.keys(definition.operations),
            authority: definition.authority,
            completion: definition.textCompletion
                ? { format: "text" }
                : {
                      format: "json",
                      schema: Object.fromEntries(
                          Object.entries(
                              operationResultSchema(
                                  operationResultValidator(
                                      definition.completionValidator,
                                  ),
                              ),
                          ).filter(([key]) => key !== "convexValidator"),
                      ),
                  },
        },
        conversationInstructions:
            definition.nativeConversation && activeInstructions
                ? {
                      ...activeInstructions,
                      messages: activeInstructions.messages.map(
                          ({ messageId, text }) => ({ messageId, text }),
                      ),
                  }
                : (activeInstructions ?? null),
        workingNotes: {
            status: "working_notes_not_established_facts",
            text: mission.workingNotes,
        },
        lastObservableInvocation:
            previousInvocation?.status === "returned"
                ? {
                      invocationId: previousInvocation._id,
                      ...(previousInvocation.correction
                          ? { correction: previousInvocation.correction }
                          : {}),
                      status: "observable_reply_not_established_facts",
                      ...(mission.executionRuntime === "pi-durable"
                          ? {
                                historyOperation: "consult_mission_state",
                                historyReference:
                                    await invocationHistoryReference(
                                        ctx,
                                        previousInvocation._id,
                                    ),
                            }
                          : {
                                outputJson:
                                    previousInvocation.outputJson ?? null,
                                rawOutputJson:
                                    previousInvocation.rawOutputJson ?? null,
                            }),
                  }
                : null,
        activeWork: {
            ...domainContext.context.activeWork,
            unfinishedObligations: mission.obligations,
            noProgressTurns: mission.noProgressTurns,
        },
        triggeringRequestsAndResults,
        pendingRequests: pending.map((request) => ({
            requestId: request._id,
            input: request.input,
        })),
        history: {
            operation: "consult_mission_state",
            cursor: null,
            description:
                "Exact prior observable inputs, outputs, requests and results are retained and can be read in pages.",
        },
    };
    const operations = agentToolSchemas(definition, assembled);
    assembled.definition.operationNames = Object.keys(operations);
    assembled.constraints.operations = Object.keys(operations);
    const inputJson = JSON.stringify(assembled);
    const effectiveModel = await missionModel(ctx, mission);
    const inputBytes = await agentInputByteLength(
        {
            instructions: definition.instructions,
            prompt: inputJson,
            operations,
            nativeConversation: definition.nativeConversation,
            contextRendering: definition.contextRendering,
            definitionVersion: definition.version,
            nativeRoute:
                mission.executionRuntime === "pi-durable"
                    ? mission.provenance === "simulation"
                        ? SIMULATION_MODEL_ROUTE
                        : effectiveModel
                          ? revisionRoute(effectiveModel)
                          : SIMULATION_MODEL_ROUTE
                    : undefined,
        },
        async (key) =>
            (
                await ctx.db
                    .query("nativeInputProfiles")
                    .withIndex("by_key", (q) => q.eq("key", key))
                    .unique()
            )?.bytes,
    );
    if (
        mission.executionRuntime !== "pi-durable" &&
        inputBytes > MAX_CONTEXT_BYTES
    )
        return { kind: "blocked" as const, code: "context_capacity" };
    return { kind: "ready" as const, inputJson };
}

export const build = internalQuery({
    args: { missionId: v.id("agentMissions"), expectedGeneration: v.number() },
    returns: v.union(
        v.object({ kind: v.literal("ready"), inputJson: v.string() }),
        v.object({ kind: v.literal("blocked"), code: v.string() }),
    ),
    handler: (ctx, args) =>
        buildMissionContext(ctx, args.missionId, args.expectedGeneration),
});
