import { internal } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import {
    internalMutation,
    internalQuery,
    type MutationCtx,
    type QueryCtx,
} from "@convex/_generated/server";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import {
    assertPreparationComparisonFence,
    assertPreparationExecutionFence,
} from "@convex/domain/sourcePreparationAuthority";
import {
    agentToolSetKey,
    piInstructionSection,
} from "@convex/integrations/modelInput";
import { NATIVE_MODEL_SERIALIZER } from "@convex/integrations/modelRouting";
import { pinMissionModel } from "@convex/modelConfiguration";
import {
    providerAttemptValidator,
    requireQualificationResultDeadline,
    requireQualifiedBrowserMission,
} from "@convex/providerCalls";
import {
    MAX_CONTEXT_BYTES,
    MAX_OBSERVABLE_OUTPUT_BYTES,
    MAX_OPERATION_RESULT_BYTES,
    MAX_WORKING_NOTES_BYTES,
    SOURCE_COMPARISON_MAX_OUTPUT_BYTES,
} from "@convex/resourcePolicy";
import { readWorkbenchQualificationDeadline } from "@convex/runWorkspace";
import schema from "@convex/schema";
import { type Infer, v } from "convex/values";
import { ValidationError, validate } from "convex-helpers/validators";
import { getAgentDefinition } from "./agentCatalog";
import {
    type AgentCompletion,
    agentToolSchemas,
    renderCompletionToolRefusal,
    SUBMIT_COMPLETION_TOOL,
} from "./agentDefinition";
import {
    canAdoptRetainedResponse,
    executionError,
    executionFailureCode,
    recordInvocationEvent,
    recordMissionEvent,
    requireMissionAuthority,
    requireMissionObservationAuthority,
} from "./authority";
import { normalizeNativeHistoryInput } from "./commonOperations";
import { buildMissionContext } from "./context";
import {
    conversationInstructions,
    publishTurn,
    requireInstructionVersion,
} from "./conversations";
import { executionFailureValidation } from "./errors";
import {
    AI_SDK_BACKEND,
    invocationReplyValidator,
    invocationResponseValidator,
    invocationStructureError,
    operationInputValidator,
    requireSupportedMissionBackend,
} from "./executionProtocol";
import {
    admittedInputHash,
    admittedInputJson,
    contextObservationSequence,
    hasKnownNonDispatch,
    invocationEventObservation,
    latestNativeControl,
    retainInvocationPayload,
    retainInvocationRawOutput,
} from "./journal";
import {
    domainDataPatch,
    invocationScopeFields,
    missionScope,
    operationProgressKeys,
} from "./missionData";
import {
    completionFeedbackValidator,
    operationInputFeedback,
} from "./operationContracts";
import { persistOperationRequest } from "./operations";
import { pauseResearchAtBoundary } from "./researchControl";
import {
    appendRetainedText,
    retainedTextParts,
    sealRetainedText,
    stageRetainedText,
    textFragmentValidator,
} from "./retainedText";

/** Late diagnostic bytes may be retained, but never grant permission for more external work. */
function resolveWorkingNotes(
    existing: string,
    addition?: string,
): { ok: true; notes: string } | { ok: false } {
    const notes = [existing, addition].filter(Boolean).join("\n\n");
    return new TextEncoder().encode(notes).length > MAX_WORKING_NOTES_BYTES
        ? { ok: false }
        : { ok: true, notes };
}

export const appendVisibleOutput = internalMutation({
    args: {
        invocationId: v.id("agentInvocations"),
        sequence: v.number(),
        text: v.string(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const invocation = await ctx.db.get(args.invocationId);
        const receipt = invocation?.providerCallId
            ? await ctx.db.get(invocation.providerCallId)
            : null;
        if (
            !invocation ||
            invocation.missionId ||
            receipt?.invocationId !== invocation._id ||
            invocation.status !== "started"
        )
            throw executionError("invocation_unavailable");
        const textId = await appendRetainedText(
            ctx,
            `${invocation._id}:visible`,
            args.sequence,
            args.text,
        );
        if (!invocation.visibleOutput)
            await ctx.db.patch(invocation._id, {
                visibleOutput: { textId, complete: false },
            });
        return null;
    },
});

export const sealVisibleOutput = internalMutation({
    args: {
        invocationId: v.id("agentInvocations"),
        complete: v.boolean(),
        terminalReason: v.optional(v.string()),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const invocation = await ctx.db.get(args.invocationId);
        if (!invocation || invocation.missionId)
            throw executionError("invocation_unavailable");
        if (!invocation.visibleOutput) return null;
        const text = await sealRetainedText(
            ctx,
            invocation.visibleOutput.textId,
        );
        if (
            invocation.visibleOutput.contentHash !== undefined &&
            (invocation.visibleOutput.complete !== args.complete ||
                invocation.visibleOutput.terminalReason !== args.terminalReason)
        )
            throw executionError("invocation_result_conflict");
        await ctx.db.patch(invocation._id, {
            visibleOutput: {
                ...invocation.visibleOutput,
                complete: args.complete,
                terminalReason: args.terminalReason,
                contentHash: text.contentHash,
                sizeBytes: text.sizeBytes,
            },
        });
        return null;
    },
});

async function hasOutstandingOperations(
    ctx: QueryCtx,
    missionId: Id<"agentMissions">,
) {
    for (const status of [
        "pending",
        "running",
        "waiting",
        "observed",
        "unknown",
    ] as const) {
        if (
            await ctx.db
                .query("agentOperationRequests")
                .withIndex("by_mission_and_status", (q) =>
                    q.eq("missionId", missionId).eq("status", status),
                )
                .first()
        )
            return true;
    }
    return false;
}

async function settleReceiptObservation(
    ctx: MutationCtx,
    invocation: Doc<"agentInvocations">,
    attempt: Infer<typeof providerAttemptValidator>,
    observableReplyJson?: string,
) {
    if (
        attempt.status === "started" ||
        attempt.runId !== invocation.runId ||
        attempt.executionGeneration !== invocation.generation
    )
        throw executionError("invocation_receipt_invalid");
    const settled = await ctx.runMutation(
        internal.providerCalls.recordAttempt,
        attempt,
    );
    if (settled.providerCallId !== invocation.providerCallId)
        throw executionError("invocation_receipt_invalid");
    if (attempt.dispatchOutcome === "not_dispatched") {
        const request = await ctx.db
            .query("agentInvocationPayloads")
            .withIndex("by_invocation_and_part", (q) =>
                q.eq("invocationId", invocation._id).eq("part", "request"),
            )
            .unique();
        if (!request)
            await retainInvocationPayload(
                ctx,
                invocation,
                "request",
                undefined,
                "not_dispatched",
            );
    }
    await retainInvocationPayload(
        ctx,
        invocation,
        "reply",
        observableReplyJson,
        attempt.dispatchOutcome === "unknown"
            ? "attempt_outcome_unknown"
            : attempt.dispatchOutcome === "not_dispatched"
              ? "not_dispatched"
              : "observable_reply_unavailable",
    );
}

async function requireDispatchAuthority(
    ctx: QueryCtx,
    invocationId: Doc<"agentInvocations">["_id"],
    expectedGeneration: number,
) {
    const invocation = await ctx.db.get(invocationId);
    if (
        !invocation ||
        invocation.generation !== expectedGeneration ||
        invocation.status !== "started"
    )
        throw executionError("invocation_unavailable");
    if (invocation.missionId) {
        const { mission, run } = await requireMissionAuthority(
            ctx,
            invocation.missionId,
            expectedGeneration,
        );
        if (invocation.provenance === "live")
            await requireQualifiedBrowserMission(ctx, run, mission);
        await requireInstructionVersion(
            ctx,
            mission,
            invocation.instructionVersion,
        );
    } else {
        const receipt = invocation.providerCallId
            ? await ctx.db.get(invocation.providerCallId)
            : null;
        if (
            !receipt?.preparationId ||
            receipt.invocationId !== invocation._id ||
            receipt.status !== "started"
        )
            throw executionError("provider_receipt_required");
        const run = receipt.runId ? await ctx.db.get(receipt.runId) : null;
        if (run?.purpose === "browser_test")
            await requireQualifiedBrowserMission(
                ctx,
                run,
                null,
                receipt.preparationId,
            );
        if (receipt.operation === "source_comparison") {
            if (!receipt.sourceId)
                throw executionError("provider_receipt_required");
            await assertPreparationComparisonFence(ctx.db, {
                preparationId: receipt.preparationId,
                sourceId: receipt.sourceId,
                now: Date.now(),
            });
        } else {
            await assertPreparationExecutionFence(ctx.db, {
                preparationId: receipt.preparationId,
                sourceId: receipt.sourceId,
                now: Date.now(),
            });
        }
    }
    return invocation;
}

/** Rechecks current authority after the request transaction has been acknowledged. */
export const authorizeDispatch = internalQuery({
    args: {
        invocationId: v.id("agentInvocations"),
        expectedGeneration: v.number(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const invocation = await requireDispatchAuthority(
            ctx,
            args.invocationId,
            args.expectedGeneration,
        );
        const request = await ctx.db
            .query("agentInvocationPayloads")
            .withIndex("by_invocation_and_part", (q) =>
                q.eq("invocationId", invocation._id).eq("part", "request"),
            )
            .unique();
        if (request?.state !== "complete")
            throw executionError("journal_request_unavailable");
        if (!invocation.missionId && invocation.providerCallId) {
            const receipt = await ctx.db.get(invocation.providerCallId);
            if (
                receipt?.reservedMaxOutputTokens !== undefined &&
                (!Number.isSafeInteger(request.effectiveMaxOutputTokens) ||
                    (request.effectiveMaxOutputTokens ?? 0) < 1 ||
                    (request.effectiveMaxOutputTokens ?? Infinity) >
                        receipt.reservedMaxOutputTokens)
            )
                throw executionError("invalid_model_output_limit");
        }
        const preparation = invocation.nativePreparation;
        if (
            !invocation.purpose &&
            invocation.generationBackend?.id === "pi-durable" &&
            (invocation.provenance === "live" || preparation)
        ) {
            if (!preparation || !invocation.missionId)
                throw executionError("native_input_unprepared");
            const mission = await ctx.db.get(invocation.missionId);
            if (!mission) throw executionError("mission_unavailable");
            const definition = getAgentDefinition(
                mission.definitionId,
                mission.definitionVersion,
            );
            if (
                (preparation.observationSequence ?? 0) !==
                    (await contextObservationSequence(ctx, mission.runId)) ||
                (definition.nativeConversation &&
                    (preparation.controlSequence ?? 0) !==
                        ((await latestNativeControl(ctx, mission.runId))
                            ?.nativeInputSequence ?? 0)) ||
                preparation.inputHash !== admittedInputHash(invocation) ||
                preparation.serializer !== NATIVE_MODEL_SERIALIZER ||
                preparation.instructionsHash !==
                    sha256Hex(piInstructionSection(definition.instructions)) ||
                preparation.toolSetKey !==
                    (await agentToolSetKey(
                        agentToolSchemas(
                            definition,
                            JSON.parse(
                                await admittedInputJson(ctx, invocation),
                            ),
                        ),
                    ))
            )
                throw executionError("native_input_changed");
        }
        return null;
    },
});

export const stageRequest = internalMutation({
    args: {
        invocationId: v.id("agentInvocations"),
        expectedGeneration: v.number(),
        fragment: textFragmentValidator,
    },
    returns: v.id("retainedTexts"),
    handler: async (ctx, args) => {
        const invocation = await requireDispatchAuthority(
            ctx,
            args.invocationId,
            args.expectedGeneration,
        );
        return stageRetainedText(
            ctx,
            `${invocation._id}:request`,
            args.fragment,
        );
    },
});

export const retainRequest = internalMutation({
    args: {
        invocationId: v.id("agentInvocations"),
        expectedGeneration: v.number(),
        requestJson: v.optional(v.string()),
        textId: v.optional(v.id("retainedTexts")),
        effectiveMaxOutputTokens: v.optional(v.number()),
    },
    returns: v.union(
        v.object({ kind: v.literal("ready") }),
        v.object({ kind: v.literal("blocked"), code: v.string() }),
    ),
    handler: async (ctx, args) => {
        const invocation = await requireDispatchAuthority(
            ctx,
            args.invocationId,
            args.expectedGeneration,
        );
        const payload = await retainInvocationPayload(
            ctx,
            invocation,
            "request",
            args.requestJson,
            "observable_request_unavailable",
            {
                textId: args.textId,
                effectiveMaxOutputTokens: args.effectiveMaxOutputTokens,
            },
        );
        return payload.state === "complete"
            ? { kind: "ready" as const }
            : {
                  kind: "blocked" as const,
                  code: payload.code ?? "journal_request_unavailable",
              };
    },
});

export const begin = internalMutation({
    args: {
        missionId: v.id("agentMissions"),
        expectedGeneration: v.number(),
        taskKey: v.string(),
        piSessionId: v.optional(v.id("piSessions")),
        preparedInputHash: v.optional(v.string()),
        preparedObservationSequence: v.optional(v.number()),
        preparedToolSetKey: v.optional(v.string()),
        preparedInstructionsHash: v.optional(v.string()),
        preparedSerializer: v.optional(v.string()),
        nativeInput: v.optional(
            v.object({
                messageIds: v.array(v.id("agentMessageDeliveries")),
                controlSequence: v.optional(v.number()),
                toolSetKey: v.string(),
            }),
        ),
        purpose: v.optional(v.literal("compaction")),
        provenance: v.union(v.literal("live"), v.literal("simulation")),
    },
    returns: v.union(
        v.object({
            kind: v.literal("ready"),
            invocationId: v.id("agentInvocations"),
            inputJson: v.string(),
        }),
        v.object({ kind: v.literal("blocked"), code: v.string() }),
    ),
    handler: async (ctx, args) => {
        const { mission } = await requireMissionAuthority(
            ctx,
            args.missionId,
            args.expectedGeneration,
        );
        const generationBackend = requireSupportedMissionBackend(mission);
        if (mission.provenance && mission.provenance !== args.provenance)
            throw executionError("invocation_identity_conflict");
        if (!/^[a-zA-Z0-9._:-]{1,160}$/.test(args.taskKey))
            throw executionError("invalid_task_key");
        if (args.piSessionId) {
            const session = await ctx.db.get(args.piSessionId);
            if (
                session?.missionId !== mission._id ||
                session.generation !== args.expectedGeneration
            )
                throw executionError("pi_writer_fenced");
        }
        const taskKey = `${args.piSessionId ?? mission._id}:${args.taskKey}`;
        const existing = await ctx.db
            .query("agentInvocations")
            .withIndex("by_run_and_task_key", (q) =>
                q.eq("runId", mission.runId).eq("taskKey", taskKey),
            )
            .unique();
        if (existing) {
            if (
                existing.provenance !== args.provenance ||
                existing.missionId !== mission._id
            )
                throw executionError("invocation_identity_conflict");
            if (
                (existing.adoptionGeneration ?? existing.generation) !==
                args.expectedGeneration
            ) {
                if (
                    mission.executionRuntime !== "pi-durable" ||
                    !existing.receivedOutputJson ||
                    !canAdoptRetainedResponse(mission, existing)
                )
                    throw executionError("invocation_identity_conflict");
                await ctx.db.patch(existing._id, {
                    adoptionGeneration: args.expectedGeneration,
                });
            }
            return {
                kind: "ready" as const,
                invocationId: existing._id,
                inputJson: await admittedInputJson(ctx, existing),
            };
        }
        if (await pauseResearchAtBoundary(ctx, mission.runId, mission))
            return { kind: "blocked" as const, code: "research_paused" };
        if (!args.purpose && (await hasOutstandingOperations(ctx, mission._id)))
            return { kind: "blocked" as const, code: "pending_operations" };
        const previousInvocation = mission.lastInvocationId
            ? await ctx.db.get(mission.lastInvocationId)
            : null;
        if (!args.purpose && previousInvocation?.status === "started")
            return { kind: "blocked" as const, code: "invocation_pending" };
        if (args.provenance === "live") await pinMissionModel(ctx, mission);
        const context = await buildMissionContext(
            ctx,
            mission._id,
            args.expectedGeneration,
        );
        if (context.kind === "blocked") {
            await ctx.db.patch(mission._id, {
                status: "blocked",
                blockCode: context.code,
            });
            await recordMissionEvent(ctx, mission, {
                kind: "invocation_blocked",
                cause: args.taskKey,
                code: context.code,
            });
            return context;
        }
        const preparedDefinition = getAgentDefinition(
            mission.definitionId,
            mission.definitionVersion,
        );
        if (
            args.preparedInputHash &&
            (args.preparedInputHash !== sha256Hex(context.inputJson) ||
                args.preparedToolSetKey !==
                    (await agentToolSetKey(
                        agentToolSchemas(
                            preparedDefinition,
                            JSON.parse(context.inputJson),
                        ),
                    )) ||
                args.preparedInstructionsHash !==
                    sha256Hex(
                        piInstructionSection(preparedDefinition.instructions),
                    ) ||
                args.preparedSerializer !== NATIVE_MODEL_SERIALIZER)
        )
            return { kind: "blocked" as const, code: "native_input_changed" };
        const turn = mission.conversationTurnId
            ? await ctx.db.get(mission.conversationTurnId)
            : null;
        const definition = getAgentDefinition(
            mission.definitionId,
            mission.definitionVersion,
        );
        if (
            args.preparedInputHash &&
            !args.purpose &&
            (args.preparedObservationSequence ?? 0) !==
                (JSON.parse(context.inputJson).nativeObservations
                    ?.throughSequence ?? 0)
        )
            return { kind: "blocked" as const, code: "native_input_changed" };
        if (definition.nativeConversation && !args.purpose) {
            // Delivery proves native messages and tools; the fresh context returned
            // by begin supplies business state, fenced by the invocation's version.
            const instructions = await conversationInstructions(ctx, mission);
            const native = args.nativeInput;
            if (
                !native ||
                (native.controlSequence ?? 0) !==
                    (JSON.parse(context.inputJson).nativeObservations
                        ?.controlSequence ?? 0) ||
                !instructions ||
                stableStringify([...native.messageIds].sort()) !==
                    stableStringify(
                        instructions.messages
                            .map((message) => message.messageId)
                            .sort(),
                    ) ||
                native.toolSetKey !==
                    (await agentToolSetKey(
                        agentToolSchemas(
                            definition,
                            JSON.parse(context.inputJson),
                        ),
                    ))
            )
                return {
                    kind: "blocked" as const,
                    code: "native_input_changed",
                };
        }
        const fragmentInput =
            new TextEncoder().encode(context.inputJson).length >
            MAX_OBSERVABLE_OUTPUT_BYTES;
        const invocationId = await ctx.db.insert("agentInvocations", {
            purpose: args.purpose,
            conversationTurnId: mission.conversationTurnId,
            instructionVersion: turn?.instructionVersion,
            generationBackend,
            journalVersion: 1,
            missionId: mission._id,
            runId: mission.runId,
            scopeKey: sha256Hex(stableStringify(missionScope(mission))),
            ...invocationScopeFields(mission),
            generation: mission.generation,
            definitionVersion: mission.definitionVersion,
            taskKey,
            provenance: args.provenance,
            status: "started",
            inputJson: fragmentInput ? "" : context.inputJson,
            inputContentHash: sha256Hex(context.inputJson),
            ...(args.preparedInputHash &&
            args.preparedToolSetKey &&
            args.preparedInstructionsHash &&
            args.preparedSerializer
                ? {
                      nativePreparation: {
                          ...(args.preparedObservationSequence !== undefined
                              ? {
                                    observationSequence:
                                        args.preparedObservationSequence,
                                }
                              : {}),
                          ...(args.nativeInput?.controlSequence !== undefined
                              ? {
                                    controlSequence:
                                        args.nativeInput.controlSequence,
                                }
                              : {}),
                          inputHash: args.preparedInputHash,
                          toolSetKey: args.preparedToolSetKey,
                          instructionsHash: args.preparedInstructionsHash,
                          serializer: args.preparedSerializer,
                      },
                  }
                : {}),
            progressCount: mission.progressKeys.length,
            createdAt: Date.now(),
        });
        if (fragmentInput) {
            const { manifest, parts } = retainedTextParts(context.inputJson);
            let inputTextId: Id<"retainedTexts"> | undefined;
            for (const [index, content] of parts.entries())
                inputTextId = await stageRetainedText(
                    ctx,
                    `${invocationId}:input`,
                    { ...manifest, index, content },
                );
            await ctx.db.patch(invocationId, { inputTextId });
        }
        if (!args.purpose)
            await ctx.db.patch(mission._id, {
                lastInvocationId: invocationId,
                status: "running",
                provenance: args.provenance,
            });
        await recordMissionEvent(ctx, mission, {
            kind: "invocation_started",
            cause: args.taskKey,
            invocationId,
        });
        return {
            kind: "ready" as const,
            invocationId,
            inputJson: context.inputJson,
        };
    },
});

export const forExecution = internalQuery({
    args: {
        invocationId: v.id("agentInvocations"),
        expectedGeneration: v.number(),
    },
    returns: v.object({
        invocation: schema.doc("agentInvocations"),
        mission: schema.doc("agentMissions"),
        authority: v.object({
            resourcePolicy: v.optional(v.string()),
            deadlineAt: v.number(),
        }),
    }),
    handler: async (ctx, args) => {
        const invocation = await ctx.db.get(args.invocationId);
        if (
            !invocation?.missionId ||
            invocation.generation !== args.expectedGeneration ||
            invocation.status !== "started"
        )
            throw executionError("invocation_unavailable");
        const { mission, run } = await requireMissionAuthority(
            ctx,
            invocation.missionId,
            args.expectedGeneration,
        );
        const qualificationDeadline =
            invocation.provenance === "live"
                ? await readWorkbenchQualificationDeadline(ctx, run)
                : undefined;
        return {
            invocation: {
                ...invocation,
                inputJson: await admittedInputJson(ctx, invocation),
            },
            mission,
            authority: {
                resourcePolicy: mission.resourcePolicy,
                deadlineAt: Math.min(
                    mission.deadlineAt,
                    qualificationDeadline ?? Infinity,
                ),
            },
        };
    },
});

export const noteBackendInterruption = internalMutation({
    args: {
        invocationId: v.id("agentInvocations"),
        expectedGeneration: v.number(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const invocation = await ctx.db.get(args.invocationId);
        if (!invocation || invocation.generation !== args.expectedGeneration)
            throw executionError("invocation_unavailable");
        await recordInvocationEvent(ctx, invocation, {
            kind: "generation_backend_interrupted",
            code: "generation_backend_interrupted",
        });
        return null;
    },
});

export const retainOutput = internalMutation({
    args: {
        invocationId: v.id("agentInvocations"),
        expectedGeneration: v.number(),
        responseJson: v.string(),
        rawOutputJson: v.optional(v.string()),
        observableReplyJson: v.optional(v.string()),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const invocation = await ctx.db.get(args.invocationId);
        if (!invocation || invocation.generation !== args.expectedGeneration)
            throw executionError("invocation_unavailable");
        if (
            new TextEncoder().encode(args.responseJson).length >
                MAX_OPERATION_RESULT_BYTES ||
            (invocation.generationBackend?.id !== "pi-durable" &&
                new TextEncoder().encode(args.rawOutputJson ?? "").length >
                    MAX_OBSERVABLE_OUTPUT_BYTES)
        )
            throw executionError("response_capacity");
        const receivedOutputJson = stableStringify(
            JSON.parse(args.responseJson),
        );
        if (
            invocation.receivedOutputJson &&
            invocation.receivedOutputJson !== receivedOutputJson
        )
            throw executionError("invocation_result_conflict");
        const receipt = invocation.providerCallId
            ? await ctx.db.get(invocation.providerCallId)
            : null;
        if (
            invocation.providerCallId &&
            (receipt?.invocationId !== invocation._id ||
                receipt.status === "started")
        )
            throw executionError("provider_receipt_required");
        if (invocation.provenance === "simulation")
            await retainInvocationPayload(
                ctx,
                invocation,
                "reply",
                args.observableReplyJson ??
                    JSON.stringify({
                        version: 1,
                        provenance: "simulation",
                        response: JSON.parse(args.responseJson),
                    }),
            );
        else if (hasKnownNonDispatch({ ...invocation, receivedOutputJson })) {
            for (const part of ["request", "reply"] as const) {
                const existing = await ctx.db
                    .query("agentInvocationPayloads")
                    .withIndex("by_invocation_and_part", (q) =>
                        q.eq("invocationId", invocation._id).eq("part", part),
                    )
                    .unique();
                if (existing) continue;
                await retainInvocationPayload(
                    ctx,
                    invocation,
                    part,
                    undefined,
                    "not_dispatched",
                );
            }
        }
        let receivedWhileAuthorized = invocation.receivedWhileAuthorized;
        if (!invocation.receivedOutputJson && invocation.missionId) {
            try {
                await requireMissionObservationAuthority(
                    ctx,
                    invocation.missionId,
                    args.expectedGeneration,
                );
                if (receipt)
                    await requireQualificationResultDeadline(ctx, receipt);
                receivedWhileAuthorized = true;
            } catch (error) {
                if (!executionFailureCode(error)) throw error;
                receivedWhileAuthorized = false;
            }
        }
        await ctx.db.patch(invocation._id, {
            receivedOutputJson,
            ...(receivedWhileAuthorized !== undefined
                ? { receivedWhileAuthorized }
                : {}),
            ...(await retainInvocationRawOutput(
                ctx,
                invocation,
                args.rawOutputJson,
            )),
        });
        if (invocation.missionId) {
            const mission = await ctx.db.get(invocation.missionId);
            if (mission && !invocation.receivedOutputJson)
                await recordMissionEvent(ctx, mission, {
                    kind: "invocation_output_observed",
                    cause: invocation.taskKey,
                    invocationId: invocation._id,
                });
        }
        return null;
    },
});

/** Receipt settlement and its observation commit together; business adoption remains a separate authority check. */
export const recordModelReply = internalMutation({
    args: {
        attempt: providerAttemptValidator,
        reply: invocationReplyValidator,
        observableReplyJson: v.optional(v.string()),
    },
    returns: v.null(),
    handler: async (
        ctx,
        { attempt, reply, observableReplyJson },
    ): Promise<null> => {
        if (
            !attempt.missionId ||
            !attempt.invocationId ||
            attempt.executionGeneration === undefined ||
            attempt.status === "started"
        )
            throw executionError("invocation_receipt_invalid");
        const invocation = await ctx.db.get(attempt.invocationId);
        if (!invocation) throw executionError("invocation_unavailable");
        await settleReceiptObservation(
            ctx,
            invocation,
            attempt,
            observableReplyJson,
        );
        await ctx.runMutation(
            internal.execution.invocationLifecycle.retainOutput,
            {
                invocationId: attempt.invocationId,
                expectedGeneration: attempt.executionGeneration,
                responseJson: JSON.stringify(reply.response),
                ...(reply.rawOutputJson !== undefined
                    ? { rawOutputJson: reply.rawOutputJson }
                    : {}),
            },
        );
        return null;
    },
});

export const beginOneShot = internalMutation({
    args: { providerCallId: v.id("providerCalls"), inputJson: v.string() },
    returns: v.id("agentInvocations"),
    handler: async (ctx, args) => {
        const receipt = await ctx.db.get(args.providerCallId);
        if (
            receipt?.service !== "model" ||
            !receipt.preparationId ||
            !receipt.runId ||
            !receipt.corpusRevisionId ||
            receipt.executionGeneration === undefined ||
            receipt.status !== "started" ||
            ![
                "source_qualification",
                "source_comparison",
                "source_documentary_control",
            ].includes(receipt.operation)
        )
            throw executionError("one_shot_not_authorized");
        if (receipt.operation === "source_comparison" && receipt.sourceId)
            await assertPreparationComparisonFence(ctx.db, {
                preparationId: receipt.preparationId,
                sourceId: receipt.sourceId,
                now: Date.now(),
            });
        else
            await assertPreparationExecutionFence(ctx.db, {
                preparationId: receipt.preparationId,
                sourceId: receipt.sourceId,
                now: Date.now(),
            });
        if (new TextEncoder().encode(args.inputJson).length > MAX_CONTEXT_BYTES)
            throw executionError("context_capacity");
        const runId = receipt.runId;
        const existing = await ctx.db
            .query("agentInvocations")
            .withIndex("by_run_and_task_key", (q) =>
                q.eq("runId", runId).eq("taskKey", receipt.operationKey),
            )
            .unique();
        if (existing) {
            if (
                existing.inputJson !== args.inputJson ||
                existing.providerCallId !== receipt._id
            )
                throw executionError("invocation_identity_conflict");
            return existing._id;
        }
        const id = await ctx.db.insert("agentInvocations", {
            generationBackend: AI_SDK_BACKEND,
            journalVersion: 1,
            runId: receipt.runId,
            corpusRevisionId: receipt.corpusRevisionId,
            generation: receipt.executionGeneration,
            definitionVersion: receipt.workflowVersion ?? 1,
            taskKey: receipt.operationKey,
            provenance: "live",
            status: "started",
            inputJson: args.inputJson,
            inputContentHash: sha256Hex(args.inputJson),
            preparationInputHash: receipt.inputHash,
            providerCallId: receipt._id,
            createdAt: Date.now(),
        });
        await ctx.db.patch(receipt._id, { invocationId: id });
        const invocation = await ctx.db.get(id);
        if (!invocation) throw executionError("invocation_unavailable");
        await recordInvocationEvent(ctx, invocation, {
            kind: "invocation_started",
        });
        return id;
    },
});

export const finishOneShot = internalMutation({
    args: {
        invocationId: v.id("agentInvocations"),
        outputJson: v.string(),
        attempt: v.optional(providerAttemptValidator),
        observableReplyJson: v.optional(v.string()),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const invocation = await ctx.db.get(args.invocationId);
        if (!invocation || invocation.missionId)
            throw executionError("invocation_unavailable");
        if (args.attempt)
            await settleReceiptObservation(
                ctx,
                invocation,
                args.attempt,
                args.observableReplyJson,
            );
        const receipt = invocation?.providerCallId
            ? await ctx.db.get(invocation.providerCallId)
            : null;
        if (
            !invocation ||
            invocation.missionId ||
            receipt?.invocationId !== invocation._id ||
            receipt.status === "started"
        )
            throw executionError("provider_receipt_required");
        if (
            new TextEncoder().encode(args.outputJson).length >
            SOURCE_COMPARISON_MAX_OUTPUT_BYTES + 1024
        )
            throw executionError("response_capacity");
        if (
            invocation.outputJson !== undefined &&
            invocation.outputJson !== args.outputJson
        )
            throw executionError("invocation_result_conflict");
        await ctx.db.patch(invocation._id, {
            outputJson: args.outputJson,
            status: "returned",
            completedAt: Date.now(),
        });
        await ctx.runMutation(internal.providerCalls.requestBilling, {
            invocationId: invocation._id,
        });
        return null;
    },
});

export const settle = internalMutation({
    args: {
        invocationId: v.id("agentInvocations"),
        expectedGeneration: v.number(),
    },
    returns: v.object({
        kind: v.union(v.literal("ready"), v.literal("waiting")),
    }),
    handler: async (ctx, args) => {
        const invocation = await ctx.db.get(args.invocationId);
        if (!invocation?.missionId || invocation.status !== "returned")
            throw executionError("invocation_pending");
        const { mission } = await requireMissionAuthority(
            ctx,
            invocation.missionId,
            args.expectedGeneration,
        );
        if (mission.lastInvocationId !== invocation._id)
            throw executionError("stale_invocation");
        if (mission.lastSettledInvocationId === invocation._id)
            return { kind: "ready" as const };
        const requests: Doc<"agentOperationRequests">[] = [];
        for (const id of invocation.requestIds ?? []) {
            const request = await ctx.db.get(id);
            if (
                !request ||
                request.missionId !== mission._id ||
                request.status !== "completed"
            )
                return { kind: "waiting" as const };
            requests.push(request);
        }
        const { noProgressTurns, recoveryRead } = invocationProgressSettlement(
            mission,
            invocation,
            requests,
        );
        await ctx.db.patch(mission._id, {
            lastSettledInvocationId: invocation._id,
            noProgressTurns,
            recoveryRead,
            status: "ready",
            blockCode: undefined,
        });
        await recordMissionEvent(ctx, mission, {
            kind: "continuation_ready",
            cause: invocation.taskKey,
            invocationId: invocation._id,
            ...(recoveryRead?.restorationInvocationId === invocation._id
                ? { observation: { recoveryRead, noProgressTurns } }
                : {}),
        });
        return { kind: "ready" as const };
    },
});

const invocationFinishOutcomeValidator = v.object({
    kind: v.union(
        v.literal("waiting"),
        v.literal("completed"),
        v.literal("blocked"),
    ),
    requestIds: v.array(v.id("agentOperationRequests")),
    code: v.optional(v.string()),
    correction: v.optional(completionFeedbackValidator),
});

export const finish = internalMutation({
    args: {
        invocationId: v.id("agentInvocations"),
        expectedGeneration: v.number(),
        response: invocationResponseValidator,
        rawOutputJson: v.optional(v.string()),
    },
    returns: invocationFinishOutcomeValidator,
    handler: async (
        ctx,
        args,
    ): Promise<Infer<typeof invocationFinishOutcomeValidator>> => {
        const invocation = await ctx.db.get(args.invocationId);
        if (
            !invocation?.missionId ||
            (invocation.adoptionGeneration ?? invocation.generation) !==
                args.expectedGeneration
        )
            throw executionError("invocation_unavailable");
        const outputJson = stableStringify(args.response);
        if (
            invocation.receivedOutputJson &&
            invocation.receivedOutputJson !== outputJson
        )
            throw executionError("invocation_result_conflict");
        if (
            new TextEncoder().encode(outputJson).length >
                MAX_OPERATION_RESULT_BYTES ||
            (invocation.generationBackend?.id !== "pi-durable" &&
                new TextEncoder().encode(args.rawOutputJson ?? "").length >
                    MAX_OBSERVABLE_OUTPUT_BYTES)
        )
            throw executionError("response_capacity");
        const mission = await ctx.db.get(invocation.missionId);
        if (!mission) throw executionError("mission_unavailable");
        if (
            invocation.status === "returned" &&
            !(
                mission.executionRuntime === "pi-durable" &&
                invocation.blockCode === "pending_operations"
            )
        ) {
            if (invocation.outputJson !== outputJson)
                throw executionError("invocation_result_conflict");
            return {
                kind: invocation.blockCode
                    ? ("blocked" as const)
                    : args.response.kind === "complete" ||
                        args.response.kind === "completion_submission"
                      ? ("completed" as const)
                      : ("waiting" as const),
                requestIds: invocation.requestIds ?? [],
                ...(invocation.blockCode ? { code: invocation.blockCode } : {}),
                ...(invocation.correction
                    ? { correction: invocation.correction }
                    : {}),
            };
        }
        const returned = {
            status: "returned" as const,
            outputJson,
            blockCode: undefined,
            ...(await retainInvocationRawOutput(
                ctx,
                invocation,
                args.rawOutputJson,
            )),
            completedAt: Date.now(),
        };
        const block = async (
            code: string,
            terminal = false,
            correction?: import("convex/values").Infer<
                typeof completionFeedbackValidator
            >,
        ) => {
            await ctx.db.patch(invocation._id, { blockCode: code });
            // Domain completion can discover pending work after the generic notes preparation.
            if (
                code === "pending_operations" &&
                mission.executionRuntime === "pi-durable"
            )
                await ctx.db.patch(mission._id, {
                    workingNotes: mission.workingNotes,
                });
            if (terminal)
                await ctx.db.patch(mission._id, {
                    status: "blocked",
                    blockCode: code,
                });
            const observed = await invocationEventObservation(
                ctx,
                invocation,
                args.response,
                args.rawOutputJson,
            );
            await recordMissionEvent(ctx, mission, {
                ...observed,
                observation: {
                    ...observed.observation,
                    ...(correction ? { correction } : {}),
                },
                kind: "invocation_refused",
                cause: invocation.taskKey,
                invocationId: invocation._id,
                code,
            });
            return { kind: "blocked" as const, requestIds: [], code };
        };
        const definition = getAgentDefinition(
            mission.definitionId,
            mission.definitionVersion,
        );
        const rejectCompletionCorrection = async (code: string) => {
            await ctx.db.patch(mission._id, {
                workingNotes: mission.workingNotes,
            });
            return block(code, true);
        };
        const correctCompletion = async (
            feedback: Infer<typeof completionFeedbackValidator>,
        ) => {
            if (
                new TextEncoder().encode(JSON.stringify(feedback)).length >
                MAX_OPERATION_RESULT_BYTES
            )
                return rejectCompletionCorrection("operation_result_capacity");
            if (
                !validate(completionFeedbackValidator, feedback, { db: ctx.db })
            )
                return rejectCompletionCorrection("operation_contract_invalid");
            if (definition.completionTransport === "native_tool") {
                try {
                    renderCompletionToolRefusal(
                        "completion_correction_required",
                        feedback,
                    );
                } catch (error) {
                    if (
                        executionFailureCode(error) !==
                        "operation_result_capacity"
                    )
                        throw error;
                    return rejectCompletionCorrection(
                        "operation_result_capacity",
                    );
                }
            }
            const { noProgressTurns, recoveryRead } =
                invocationProgressSettlement(mission, invocation, [], true);
            await ctx.db.patch(invocation._id, {
                correction: feedback,
            });
            await ctx.db.patch(mission._id, {
                workingNotes: mission.workingNotes,
                lastSettledInvocationId: invocation._id,
                noProgressTurns,
                recoveryRead,
                status: "ready",
                blockCode: undefined,
            });
            const refused = await block(
                "completion_correction_required",
                false,
                feedback,
            );
            return { ...refused, correction: feedback };
        };
        const receipt = invocation.providerCallId
            ? await ctx.db.get(invocation.providerCallId)
            : null;
        try {
            await requireMissionAuthority(
                ctx,
                mission._id,
                args.expectedGeneration,
            );
            if (receipt) await requireQualificationResultDeadline(ctx, receipt);
        } catch (error) {
            const code = executionFailureCode(error);
            if (!code) throw error;
            try {
                await requireMissionObservationAuthority(
                    ctx,
                    mission._id,
                    args.expectedGeneration,
                );
            } catch (observationError) {
                if (!executionFailureCode(observationError))
                    throw observationError;
                await ctx.db.patch(invocation._id, returned);
            }
            return block(code);
        }
        await ctx.db.patch(invocation._id, returned);
        try {
            await requireInstructionVersion(
                ctx,
                mission,
                invocation.instructionVersion,
            );
        } catch (error) {
            const code = executionFailureCode(error);
            if (!code) throw error;
            return block(code);
        }
        if (
            invocation.receivedOutputJson &&
            !canAdoptRetainedResponse(mission, invocation)
        )
            return block("retained_response_not_reusable", true);
        if (args.response.kind === "blocked") {
            if (
                args.response.code === "invalid_output" &&
                receipt?.invocationId === invocation._id &&
                receipt.status === "failed" &&
                receipt.dispatchOutcome === "response_received" &&
                receipt.errorCode === "invalid_output" &&
                receipt.diagnostic?.reason === "invalid_output"
            )
                return correctCompletion({
                    code: "invalid_output",
                    issues: [
                        {
                            path: "",
                            expected:
                                "A single JSON completion object matching the declared schema, without surrounding prose or Markdown fences.",
                        },
                    ],
                });
            return block(args.response.code, true);
        }
        if (invocation.provenance === "live") {
            if (
                receipt?.status !== "succeeded" ||
                receipt.invocationId !== invocation._id ||
                receipt.dispatchOutcome !== "response_received"
            )
                return block("provider_receipt_required", true);
        }
        const isCompletion =
            args.response.kind === "complete" ||
            args.response.kind === "completion_submission";
        if (args.response.kind === "completion_submission") {
            if (definition.completionTransport !== "native_tool")
                return block("invalid_output", true);
            const structureError = invocationStructureError(
                args.response,
                mission.executionRuntime === "pi-durable",
            );
            if (structureError) return block(structureError, true);
        }
        const awaitingOperations =
            isCompletion && (await hasOutstandingOperations(ctx, mission._id));
        const snapshot: unknown = JSON.parse(
            await admittedInputJson(ctx, invocation),
        );
        if (
            args.response.kind === "complete" ||
            args.response.kind === "completion_submission"
        ) {
            if (args.response.kind === "complete") {
                const resolvedNotes = resolveWorkingNotes(
                    mission.workingNotes,
                    args.response.workingNotes,
                );
                if (!resolvedNotes.ok)
                    return block("working_memory_capacity", true);
                const notes = resolvedNotes.notes;
                if (
                    !awaitingOperations ||
                    mission.executionRuntime !== "pi-durable"
                )
                    await ctx.db.patch(mission._id, { workingNotes: notes });
            }
            if (awaitingOperations) return block("pending_operations");
            let proposalValue: unknown;
            if (args.response.kind === "completion_submission") {
                if (args.response.call === null)
                    return correctCompletion({
                        code: "invalid_completion",
                        issues: [
                            {
                                path: "",
                                expected:
                                    "Call submit_completion alone to submit the mission completion proposal.",
                            },
                        ],
                    });
                try {
                    proposalValue = JSON.parse(args.response.call.inputJson);
                } catch {
                    return correctCompletion({
                        code: "invalid_completion",
                        issues: [
                            {
                                path: "",
                                expected:
                                    "A single valid JSON object matching the submit_completion schema.",
                            },
                        ],
                    });
                }
            } else proposalValue = args.response;
            try {
                validate(definition.completionValidator, proposalValue, {
                    db: ctx.db,
                    throw: true,
                });
            } catch (error) {
                if (!(error instanceof ValidationError)) throw error;
                return correctCompletion({
                    code: "invalid_completion",
                    issues: [
                        operationInputFeedback(
                            definition.completionValidator,
                            error,
                            proposalValue,
                            ctx.db,
                        ),
                    ],
                });
            }
            const proposal = proposalValue as AgentCompletion;
            if (args.response.kind === "completion_submission") {
                const resolvedNotes = resolveWorkingNotes(
                    mission.workingNotes,
                    proposal.workingNotes,
                );
                if (!resolvedNotes.ok)
                    return block("working_memory_capacity", true);
                const notes = resolvedNotes.notes;
                await ctx.db.patch(mission._id, { workingNotes: notes });
            }
            const completion = await definition.complete(
                ctx,
                mission,
                proposal,
                snapshot,
                invocation,
            );
            if (completion.kind === "correct")
                return correctCompletion(completion.feedback);
            if (completion.kind === "continue")
                return block("mission_context_changed");
            if (completion.kind === "blocked") return block(completion.code);
            if (
                !validate(definition.resultValidator, completion.result, {
                    db: ctx.db,
                })
            )
                return block("invalid_completion", true);
            if (mission.conversationTurnId) {
                if (!definition.conversationReply)
                    return block("conversation_reply_missing", true);
                await publishTurn(
                    ctx,
                    mission,
                    definition.conversationReply(completion.result),
                    invocation.instructionVersion,
                );
            }
            await ctx.db.patch(mission._id, {
                status: "completed",
                ...domainDataPatch(mission, { result: completion.result }),
            });
            await recordMissionEvent(ctx, mission, {
                ...(await invocationEventObservation(
                    ctx,
                    invocation,
                    args.response,
                    args.rawOutputJson,
                )),
                historySource: "material",
                kind: "mission_completed",
                cause: invocation.taskKey,
                invocationId: invocation._id,
            });
            return { kind: "completed" as const, requestIds: [] };
        }
        const resolvedNotes = resolveWorkingNotes(
            mission.workingNotes,
            args.response.workingNotes,
        );
        if (!resolvedNotes.ok) return block("working_memory_capacity", true);
        const notes = resolvedNotes.notes;
        await ctx.db.patch(mission._id, { workingNotes: notes });
        const structureError = invocationStructureError(
            args.response,
            mission.executionRuntime === "pi-durable",
        );
        if (structureError) return block(structureError, true);
        const requestIds = [];
        const modelOperations = agentToolSchemas(definition, snapshot);
        if (Object.keys(modelOperations).length === 0)
            return block("operation_not_allowed", true);
        for (const request of args.response.requests) {
            if (
                definition.completionTransport === "native_tool" &&
                request.name === SUBMIT_COMPLETION_TOOL
            ) {
                requestIds.push(
                    await persistOperationRequest(ctx, mission, {
                        invocationId: invocation._id,
                        actor: "agent",
                        cause: request.callId,
                        input: {
                            kind: "invalid" as const,
                            name: request.name,
                            inputJson: request.inputJson,
                            refusalCode: "completion_must_be_sole_call",
                        },
                    }),
                );
                continue;
            }
            let decoded: unknown;
            try {
                decoded = JSON.parse(request.inputJson);
            } catch {
                decoded = null;
            }
            let canonical = definition.nativeConversation
                ? normalizeNativeHistoryInput(request.name, decoded)
                : decoded;
            let normalizationRefusal: string | undefined;
            let normalizationValidation:
                | { path: string; expected: string }
                | undefined;
            if (definition.normalizeOperationInput) {
                const operation = modelOperations[request.name];
                if (
                    !operation ||
                    !validate(operation.inputValidator, decoded, { db: ctx.db })
                )
                    canonical = null;
                else {
                    try {
                        canonical = definition.normalizeOperationInput(
                            request.name,
                            canonical as Record<string, unknown>,
                            snapshot,
                        );
                    } catch (error) {
                        const code = executionFailureCode(error);
                        if (!code) throw error;
                        normalizationRefusal = code;
                        normalizationValidation =
                            executionFailureValidation(error);
                        canonical = null;
                    }
                }
            }
            const input =
                canonical &&
                typeof canonical === "object" &&
                !Array.isArray(canonical) &&
                !("kind" in canonical)
                    ? { ...canonical, kind: request.name }
                    : null;
            let validation: { path: string; expected: string } | undefined =
                normalizationValidation;
            const operation = modelOperations[request.name];
            let fieldsValid = !!operation;
            if (operation) {
                try {
                    validate(operation.inputValidator, decoded, {
                        db: ctx.db,
                        throw: true,
                    });
                } catch (error) {
                    if (!(error instanceof ValidationError)) throw error;
                    fieldsValid = false;
                    validation = operationInputFeedback(
                        operation.inputValidator,
                        error,
                        decoded,
                        ctx.db,
                    );
                }
            }
            const valid =
                fieldsValid &&
                validate(operationInputValidator, input, { db: ctx.db });
            requestIds.push(
                await persistOperationRequest(ctx, mission, {
                    invocationId: invocation._id,
                    actor: "agent",
                    cause: request.callId,
                    input: valid
                        ? input
                        : {
                              kind: "invalid" as const,
                              name: request.name,
                              inputJson: request.inputJson,
                              ...(normalizationRefusal
                                  ? { refusalCode: normalizationRefusal }
                                  : {}),
                              ...(validation ? { validation } : {}),
                          },
                }),
            );
        }
        await ctx.db.patch(invocation._id, { requestIds });
        await ctx.db.patch(mission._id, { status: "waiting" });
        await recordMissionEvent(ctx, mission, {
            ...(await invocationEventObservation(
                ctx,
                invocation,
                args.response,
                args.rawOutputJson,
            )),
            kind: "invocation_returned",
            cause: invocation.taskKey,
            invocationId: invocation._id,
        });
        return { kind: "waiting" as const, requestIds };
    },
});

/** Record each invocation's progress and restoration once; admission owns execution limits. */
function invocationProgressSettlement(
    mission: Doc<"agentMissions">,
    invocation: Doc<"agentInvocations">,
    requests: Doc<"agentOperationRequests">[],
    rejectedCompletion = false,
) {
    if (mission.lastSettledInvocationId === invocation._id)
        return {
            noProgressTurns: mission.noProgressTurns,
            recoveryRead: mission.recoveryRead,
        };
    if (mission.progressKeys.length > (invocation.progressCount ?? 0))
        return { noProgressTurns: 0, recoveryRead: undefined };
    const definition = getAgentDefinition(
        mission.definitionId,
        mission.definitionVersion,
    );
    const consultedContext =
        requests.length > 0 &&
        requests.every(
            (request) =>
                request.outcome?.kind === "success" &&
                !request.adoptionRefusalCode &&
                request.invocationId === invocation._id &&
                definition.operations[request.input.kind]?.contextRead,
        );
    const restored =
        !!mission.recoveryRead &&
        !mission.recoveryRead.restorationInvocationId &&
        requests.length > 0 &&
        requests.every(
            (request) =>
                request.outcome?.kind === "success" &&
                !request.adoptionRefusalCode &&
                ((request.historyRead &&
                    request.historyRead.restorable !== false &&
                    request.historyRead.fragmentIds.length > 0) ||
                    (definition.operations[request.input.kind]?.materialRead &&
                        operationProgressKeys(request.outcome).length > 0)),
        );
    const refusal =
        rejectedCompletion ||
        requests.some(
            (request) =>
                request.outcome?.kind === "refused" ||
                request.outcome?.kind === "unavailable",
        );
    const recoveryRead =
        restored && mission.recoveryRead
            ? {
                  ...mission.recoveryRead,
                  restorationInvocationId: invocation._id,
              }
            : (mission.recoveryRead ??
              (refusal ? { refusalInvocationId: invocation._id } : undefined));
    const noProgressTurns =
        mission.noProgressTurns + (restored || consultedContext ? 0 : 1);
    return {
        noProgressTurns,
        recoveryRead,
    };
}
