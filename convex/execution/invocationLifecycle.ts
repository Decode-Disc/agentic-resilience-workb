import { internal } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import {
    internalMutation,
    internalQuery,
    type MutationCtx,
    type QueryCtx,
} from "@convex/_generated/server";
import {
    type AnalystTurnWording,
    preparedAnalystWording,
} from "@convex/domain/preparedAnalystWording";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import {
    assertPreparationComparisonFence,
    assertPreparationExecutionFence,
} from "@convex/domain/sourcePreparationAuthority";
import {
    projectSourcesCompletionAdmission,
    projectSourcesOperationAdmission,
} from "@convex/domain/sourcesAgent";
import { projectWorkbenchOperationAdmission } from "@convex/domain/workbenchAgent";
import { workbenchInstructionMessageIds } from "@convex/domain/workbenchInstructions";
import { preparedResponseReviewDraft } from "@convex/domain/workbenchResponseControlContracts";
import {
    deliveryBodyHash,
    retainedDeliveryBody,
} from "@convex/integrations/agentStorage";
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
    HISTORY_PAGE_SIZE,
    MAX_CONTEXT_BYTES,
    MAX_OBSERVABLE_OUTPUT_BYTES,
    MAX_OPERATION_RESULT_BYTES,
    MAX_WORKING_NOTES_BYTES,
    SOURCE_COMPARISON_MAX_OUTPUT_BYTES,
} from "@convex/resourcePolicy";
import { projectWorkbenchCompletionAdmission } from "@convex/responseControl";
import { readWorkbenchQualificationDeadline } from "@convex/runWorkspace";
import schema from "@convex/schema";
import {
    paginationOptsValidator,
    paginationResultValidator,
} from "convex/server";
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
    analystTurnDeliveries,
    publishTurn,
    readPreparedTurnWording,
    requireInstructionVersion,
} from "./conversations";
import { executionFailureValidation } from "./errors";
import {
    AI_SDK_BACKEND,
    invocationReplyValidator,
    invocationResponseValidator,
    invocationStructureError,
    isOneShotPreparationOperation,
    operationInputValidator,
    preparedCompletionValidator,
    preparedSubmissionValidator,
    requireSupportedMissionBackend,
} from "./executionProtocol";
import {
    admittedInputFragment,
    admittedInputHash,
    admittedInputJson,
    admittedInputManifest,
    contextObservationSequence,
    hasKnownNonDispatch,
    hasReceivedResponse,
    invocationEventObservation,
    invocationResponseManifest,
    latestNativeControl,
    matchInvocationResponse,
    preparedReplyBasisHash,
    preparedReplyPrefix,
    receivedResponseDigest,
    retainInvocationPayload,
    retainInvocationRawOutput,
    retainInvocationResponse,
} from "./journal";
import {
    invocationScopeFields,
    missionResultPatch,
    missionScope,
    operationProgressKeys,
    textualMissionOutcomePatch,
} from "./missionData";
import {
    completionFeedbackValidator,
    operationInputFeedback,
} from "./operationContracts";
import { persistOperationRequest } from "./operations";
import { pauseResearchAtBoundary } from "./researchControl";
import {
    appendRetainedText,
    completeRetainedText,
    requireRetainedStreamDispatch,
    retainedTextFragment,
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

/** Cancellation can retain engaged diagnostics. Withdrawal starts permanent ownership removal. */
async function dossierAcceptsDiagnostics(
    ctx: QueryCtx,
    runId: Doc<"researchRuns">["_id"],
) {
    const run = await ctx.db.get(runId);
    return !!run && run.withdrawnAt === undefined;
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
        if (!(await dossierAcceptsDiagnostics(ctx, invocation.runId)))
            throw executionError("not_authorized");
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
        if (!(await dossierAcceptsDiagnostics(ctx, invocation.runId)))
            throw executionError("not_authorized");
        if (!invocation.visibleOutput) return null;
        if (
            invocation.visibleOutput.contentHash === undefined &&
            invocation.status !== "started"
        )
            throw executionError("invocation_unavailable");
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
    observableReplyTextId?: Id<"retainedTexts">,
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
    if (!(await dossierAcceptsDiagnostics(ctx, invocation.runId))) return;
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
        { textId: observableReplyTextId },
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
        await requireRetainedStreamDispatch(ctx);
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
                (!invocation.inputTextId &&
                    sha256Hex(invocation.inputJson) !== preparation.inputHash)
            )
                throw executionError("native_input_changed");
            // Admission already verified the tool schemas against this exact input digest.
            if (invocation.inputTextId)
                await admittedInputManifest(ctx, invocation);
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
        returnInputReference: v.optional(v.literal(true)),
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
        v.object({
            kind: v.literal("ready_reference"),
            invocationId: v.id("agentInvocations"),
            inputHash: v.string(),
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
                    !hasReceivedResponse(existing) ||
                    !canAdoptRetainedResponse(mission, existing)
                )
                    throw executionError("invocation_identity_conflict");
                await ctx.db.patch(existing._id, {
                    adoptionGeneration: args.expectedGeneration,
                });
            }
            if (args.returnInputReference)
                return {
                    kind: "ready_reference" as const,
                    invocationId: existing._id,
                    inputHash: admittedInputHash(existing),
                };
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
            args.returnInputReference,
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
        const snapshot = JSON.parse(context.inputJson);
        const inputHash = sha256Hex(context.inputJson);
        const preparedDefinition = getAgentDefinition(
            mission.definitionId,
            mission.definitionVersion,
        );
        if (
            args.preparedInputHash &&
            (args.preparedInputHash !== inputHash ||
                args.preparedToolSetKey !==
                    (await agentToolSetKey(
                        agentToolSchemas(preparedDefinition, snapshot),
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
                (snapshot.nativeObservations?.throughSequence ?? 0)
        )
            return { kind: "blocked" as const, code: "native_input_changed" };
        if (definition.nativeConversation && !args.purpose) {
            // Delivery proves native messages and tools; the fresh context returned
            // by begin supplies business state, fenced by the invocation's version.
            const messageIds = context.nativeMessageIds;
            const native = args.nativeInput;
            if (
                !native ||
                (native.controlSequence ?? 0) !==
                    (snapshot.nativeObservations?.controlSequence ?? 0) ||
                !messageIds ||
                stableStringify([...native.messageIds].sort()) !==
                    stableStringify([...messageIds].sort()) ||
                native.toolSetKey !==
                    (await agentToolSetKey(
                        agentToolSchemas(definition, snapshot),
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
            inputContentHash: inputHash,
            ...(definition.id === "workbench_v1" && !args.purpose
                ? {
                      workbenchOperationAdmission:
                          projectWorkbenchOperationAdmission(
                              snapshot,
                              definition.version,
                          ),
                      workbenchCompletionAdmission:
                          projectWorkbenchCompletionAdmission(snapshot),
                  }
                : {}),
            ...(definition.id === "sources_v1" && !args.purpose
                ? {
                      sourcesCompletionAdmission:
                          projectSourcesCompletionAdmission(snapshot),
                      sourcesOperationAdmission:
                          projectSourcesOperationAdmission(snapshot),
                  }
                : {}),
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
        if (args.returnInputReference)
            return {
                kind: "ready_reference" as const,
                invocationId,
                inputHash,
            };
        return {
            kind: "ready" as const,
            invocationId,
            inputJson: context.inputJson,
        };
    },
});

async function executionInvocation(
    ctx: QueryCtx,
    args: { invocationId: Id<"agentInvocations">; expectedGeneration: number },
) {
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
    return { invocation, mission, run };
}

export const forExecution = internalQuery({
    args: {
        invocationId: v.id("agentInvocations"),
        expectedGeneration: v.number(),
        inputHash: v.optional(v.string()),
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
        const { invocation, mission, run } = await executionInvocation(
            ctx,
            args,
        );
        if (
            args.inputHash !== undefined &&
            args.inputHash !== admittedInputHash(invocation)
        )
            throw executionError("invocation_input_invalid");
        const qualificationDeadline =
            invocation.provenance === "live"
                ? await readWorkbenchQualificationDeadline(ctx, run)
                : undefined;
        return {
            invocation,
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

export const executionInputFragment = internalQuery({
    args: {
        invocationId: v.id("agentInvocations"),
        expectedGeneration: v.number(),
        index: v.number(),
        inputHash: v.string(),
    },
    returns: v.object({
        content: v.string(),
        contentHash: v.string(),
        sizeBytes: v.number(),
        characters: v.number(),
        fragmentCount: v.number(),
    }),
    handler: async (ctx, args) => {
        const { invocation } = await executionInvocation(ctx, args);
        return admittedInputFragment(
            ctx,
            invocation,
            args.index,
            args.inputHash,
        );
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

const observedReplyPart = v.union(
    v.literal("response"),
    v.literal("raw"),
    v.literal("reply"),
);

export const stageObservedReply = internalMutation({
    args: {
        invocationId: v.id("agentInvocations"),
        expectedGeneration: v.number(),
        part: observedReplyPart,
        fragment: textFragmentValidator,
    },
    returns: v.id("retainedTexts"),
    handler: async (ctx, args) => {
        const invocation = await ctx.db.get(args.invocationId);
        if (
            !invocation ||
            invocation.generation !== args.expectedGeneration ||
            (invocation.generationBackend?.id !== "pi-durable" &&
                (invocation.missionId !== undefined || args.part === "raw"))
        )
            throw executionError("invocation_unavailable");
        if (!(await dossierAcceptsDiagnostics(ctx, invocation.runId)))
            throw executionError("not_authorized");
        if (invocation.providerCallId) {
            const receipt = await ctx.db.get(invocation.providerCallId);
            if (
                receipt?.invocationId !== invocation._id ||
                receipt.executionGeneration !== invocation.generation ||
                (!invocation.missionId && !receipt.preparationId)
            )
                throw executionError("invocation_receipt_invalid");
        } else if (
            invocation.provenance !== "simulation" ||
            !invocation.missionId
        ) {
            throw executionError("invocation_unavailable");
        }
        const key =
            args.part === "response"
                ? `${invocation._id}:response:${args.fragment.contentHash}`
                : `${invocation._id}:${args.part === "raw" ? "raw_output" : "reply"}`;
        return stageRetainedText(ctx, key, args.fragment);
    },
});

const receivedOutputArgs = {
    responseJson: v.optional(v.string()),
    responseTextId: v.optional(v.id("retainedTexts")),
    rawOutputJson: v.optional(v.string()),
    rawOutputTextId: v.optional(v.id("retainedTexts")),
};

export const retainOutput = internalMutation({
    args: {
        invocationId: v.id("agentInvocations"),
        expectedGeneration: v.number(),
        ...receivedOutputArgs,
        observableReplyJson: v.optional(v.string()),
        observableReplyTextId: v.optional(v.id("retainedTexts")),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const invocation = await ctx.db.get(args.invocationId);
        if (!invocation || invocation.generation !== args.expectedGeneration)
            throw executionError("invocation_unavailable");
        if (!(await dossierAcceptsDiagnostics(ctx, invocation.runId)))
            throw executionError("not_authorized");
        if (
            invocation.generationBackend?.id !== "pi-durable" &&
            new TextEncoder().encode(args.rawOutputJson ?? "").length >
                MAX_OBSERVABLE_OUTPUT_BYTES
        )
            throw executionError("response_capacity");
        if (
            (args.responseJson === undefined) ===
                (args.responseTextId === undefined) ||
            (args.rawOutputJson !== undefined &&
                args.rawOutputTextId !== undefined)
        )
            throw executionError("invocation_result_invalid");
        const receivedOutputJson =
            args.responseJson !== undefined
                ? stableStringify(JSON.parse(args.responseJson))
                : undefined;
        const responseText = args.responseTextId
            ? await invocationResponseManifest(
                  ctx,
                  invocation,
                  args.responseTextId,
                  "response",
              )
            : undefined;
        const expected = responseText
            ? { responseHash: responseText.contentHash }
            : receivedOutputJson;
        if (expected === undefined)
            throw executionError("invocation_result_invalid");
        const previous = await matchInvocationResponse(
            ctx,
            invocation,
            "received",
            expected,
        );
        const rawText = args.rawOutputTextId
            ? await invocationResponseManifest(
                  ctx,
                  invocation,
                  args.rawOutputTextId,
                  "raw",
              )
            : undefined;
        if (
            rawText &&
            (invocation.generationBackend?.id !== "pi-durable" ||
                (invocation.rawOutputTextId &&
                    invocation.rawOutputTextId !== rawText._id) ||
                (invocation.rawOutputJson !== undefined &&
                    sha256Hex(invocation.rawOutputJson) !==
                        rawText.contentHash))
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
        if (invocation.provenance === "simulation") {
            if (
                args.observableReplyTextId &&
                args.observableReplyJson !== undefined
            )
                throw executionError("journal_payload_conflict");
            const envelope =
                args.observableReplyJson ??
                (args.observableReplyTextId
                    ? undefined
                    : receivedOutputJson !== undefined
                      ? JSON.stringify({
                            version: 1,
                            provenance: "simulation",
                            response: JSON.parse(receivedOutputJson),
                        })
                      : undefined);
            if (envelope === undefined && !args.observableReplyTextId)
                throw executionError("journal_payload_unavailable");
            await retainInvocationPayload(
                ctx,
                invocation,
                "reply",
                envelope,
                "observable_reply_unavailable",
                { textId: args.observableReplyTextId },
            );
        } else if (
            hasKnownNonDispatch({
                ...invocation,
                receivedOutputJson,
                receivedOutputTextId: responseText?._id,
            })
        ) {
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
        if (!hasReceivedResponse(invocation) && invocation.missionId) {
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
        const retainedResponse =
            previous ??
            (responseText
                ? { json: undefined, textId: responseText._id }
                : receivedOutputJson !== undefined
                  ? await retainInvocationResponse(
                        ctx,
                        invocation,
                        receivedOutputJson,
                    )
                  : null);
        if (!retainedResponse)
            throw executionError("invocation_result_invalid");
        await ctx.db.patch(invocation._id, {
            receivedOutputJson: retainedResponse.json,
            receivedOutputTextId: retainedResponse.textId,
            ...(receivedWhileAuthorized !== undefined
                ? { receivedWhileAuthorized }
                : {}),
            ...(rawText
                ? { rawOutputTextId: rawText._id, rawOutputJson: undefined }
                : await retainInvocationRawOutput(
                      ctx,
                      invocation,
                      args.rawOutputJson,
                  )),
        });
        if (invocation.missionId) {
            const mission = await ctx.db.get(invocation.missionId);
            if (mission && !hasReceivedResponse(invocation))
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
        reply: v.optional(invocationReplyValidator),
        prepared: v.optional(v.object(receivedOutputArgs)),
        observableReplyTextId: v.optional(v.id("retainedTexts")),
        observableReplyJson: v.optional(v.string()),
    },
    returns: v.null(),
    handler: async (
        ctx,
        {
            attempt,
            reply,
            prepared,
            observableReplyJson,
            observableReplyTextId,
        },
    ): Promise<null> => {
        if (
            !attempt.missionId ||
            !attempt.invocationId ||
            attempt.executionGeneration === undefined ||
            attempt.status === "started" ||
            Boolean(reply) === Boolean(prepared) ||
            (observableReplyJson !== undefined &&
                observableReplyTextId !== undefined)
        )
            throw executionError("invocation_receipt_invalid");
        const invocation = await ctx.db.get(attempt.invocationId);
        if (!invocation) throw executionError("invocation_unavailable");
        await settleReceiptObservation(
            ctx,
            invocation,
            attempt,
            observableReplyJson,
            observableReplyTextId,
        );
        await ctx.runMutation(
            internal.execution.invocationLifecycle.retainOutput,
            {
                invocationId: attempt.invocationId,
                expectedGeneration: attempt.executionGeneration,
                ...(prepared ??
                    (reply
                        ? {
                              responseJson: JSON.stringify(reply.response),
                              rawOutputJson: reply.rawOutputJson,
                          }
                        : {})),
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
            !isOneShotPreparationOperation(receipt.operation)
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
        captureFailure: v.optional(v.string()),
        outputJson: v.optional(v.string()),
        outputTextId: v.optional(v.id("retainedTexts")),
        attempt: v.optional(providerAttemptValidator),
        observableReplyJson: v.optional(v.string()),
        observableReplyTextId: v.optional(v.id("retainedTexts")),
    },
    returns: v.union(v.null(), v.string()),
    handler: async (ctx, args) => {
        const invocation = await ctx.db.get(args.invocationId);
        if (!invocation || invocation.missionId)
            throw executionError("invocation_unavailable");
        const withdrawn = !(await dossierAcceptsDiagnostics(
            ctx,
            invocation.runId,
        ));
        const captureFailure = withdrawn
            ? "not_authorized"
            : args.captureFailure;
        if (captureFailure !== undefined) {
            if (withdrawn && invocation.status === "returned")
                return captureFailure;
            if (
                !args.attempt ||
                (args.captureFailure !== undefined &&
                    (args.outputJson !== undefined ||
                        args.outputTextId !== undefined ||
                        args.observableReplyJson !== undefined ||
                        args.observableReplyTextId !== undefined)) ||
                (invocation.status !== "started" &&
                    invocation.status !== "blocked")
            )
                throw executionError("invocation_result_invalid");
            await settleReceiptObservation(ctx, invocation, args.attempt);
            if (invocation.status === "started")
                await ctx.db.patch(invocation._id, {
                    status: "blocked",
                    blockCode: captureFailure,
                    completedAt: Date.now(),
                });
            await ctx.runMutation(internal.providerCalls.requestBilling, {
                invocationId: invocation._id,
            });
            return invocation.blockCode ?? captureFailure;
        }
        if (invocation.status === "blocked")
            throw executionError("invocation_result_invalid");
        if (
            (args.outputJson === undefined) ===
                (args.outputTextId === undefined) ||
            (args.observableReplyJson !== undefined &&
                args.observableReplyTextId !== undefined)
        )
            throw executionError("invocation_result_invalid");
        const output = args.outputTextId
            ? await invocationResponseManifest(
                  ctx,
                  invocation,
                  args.outputTextId,
                  "response",
              )
            : undefined;
        const outputBytes =
            output?.sizeBytes ??
            new TextEncoder().encode(args.outputJson ?? "").length;
        if (outputBytes > SOURCE_COMPARISON_MAX_OUTPUT_BYTES + 1024)
            throw executionError("response_capacity");
        const expected = output
            ? { responseHash: output.contentHash }
            : args.outputJson;
        if (expected === undefined)
            throw executionError("invocation_result_invalid");
        const previous = await matchInvocationResponse(
            ctx,
            invocation,
            "adopted",
            expected,
        );
        if (args.attempt)
            await settleReceiptObservation(
                ctx,
                invocation,
                args.attempt,
                args.observableReplyJson,
                args.observableReplyTextId,
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
        if (!previous)
            await ctx.db.patch(invocation._id, {
                outputJson: args.outputJson,
                outputTextId: output?._id,
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

const replyPreparationArgs = {
    invocationId: v.id("agentInvocations"),
    expectedGeneration: v.number(),
    responseHash: v.string(),
};

function preparedReplyKey(
    invocationId: Id<"agentInvocations">,
    basisHash: string,
    contentHash: string,
) {
    return `${preparedReplyPrefix(invocationId)}:${basisHash}:${contentHash}`;
}

async function replyPreparationBasis(
    ctx: QueryCtx,
    invocation: Doc<"agentInvocations">,
    mission: Doc<"agentMissions">,
    responseHash: string,
    instructionTexts = new Map<Id<"agentMessageDeliveries">, string>(),
    wording?: AnalystTurnWording,
) {
    const definition = getAgentDefinition(
        mission.definitionId,
        mission.definitionVersion,
    );
    if (!mission.conversationTurnId || !definition.preparedCompletion)
        return null;
    for (const message of wording
        ? [...wording.messages, ...wording.transmitted]
        : []) {
        if (message.text !== undefined)
            instructionTexts.set(message.messageId, message.text);
    }
    const rendering = await definition.preparedCompletion.basis(
        ctx,
        mission,
        instructionTexts,
        wording,
    );
    if (!rendering) return null;
    return {
        confirmationOnly: rendering.confirmationOnly,
        factsRevisionTemplate: rendering.factsRevisionTemplate,
        confirmations: [...rendering.confirmations],
        adopt: rendering.adopt,
        basisHash: sha256Hex(
            stableStringify({
                invocation: invocation._id,
                generation: mission.generation,
                mission: mission._id,
                definition: mission.definitionId,
                version: mission.definitionVersion,
                instructions: invocation.instructionVersion,
                inputHash: admittedInputHash(invocation),
                responseHash,
                factsHash: rendering.factsHash,
            }),
        ),
    };
}

async function currentReplyPreparation(
    ctx: QueryCtx,
    args: {
        invocationId: Id<"agentInvocations">;
        expectedGeneration: number;
        responseHash: string;
    },
) {
    const invocation = await ctx.db.get(args.invocationId);
    if (
        !invocation?.missionId ||
        (invocation.adoptionGeneration ?? invocation.generation) !==
            args.expectedGeneration
    )
        return null;
    const mission = await ctx.db.get(invocation.missionId);
    if (
        !mission ||
        mission.generation !== args.expectedGeneration ||
        !(await dossierAcceptsDiagnostics(ctx, mission.runId))
    )
        return null;
    if (
        invocation.status === "returned" &&
        invocation.blockCode !== "pending_operations"
    )
        return null;
    try {
        await requireInstructionVersion(
            ctx,
            mission,
            invocation.instructionVersion,
        );
    } catch (error) {
        if (executionFailureCode(error) === "stale_instructions") return null;
        throw error;
    }
    const receivedHash = await receivedResponseDigest(ctx, invocation);
    if (receivedHash !== args.responseHash) return null;
    return { invocation, mission };
}

const replyInstructionReference = v.object({
    messageId: v.id("agentMessageDeliveries"),
    contentHash: v.string(),
    legacy: v.optional(v.literal(true)),
});

function replyInstructionIdentity(delivery: Doc<"agentMessageDeliveries">) {
    return {
        messageId: delivery._id,
        contentHash: deliveryBodyHash(delivery),
        ...(delivery.bodyTextId ? {} : { legacy: true as const }),
    };
}

/** Cheaper metadata lookup for active wording and the retained originals used in review facts. */
export const replyInstructionPage = internalQuery({
    args: { ...replyPreparationArgs, paginationOpts: paginationOptsValidator },
    returns: v.union(
        v.null(),
        paginationResultValidator(replyInstructionReference).extend({
            transmitted: v.optional(v.array(replyInstructionReference)),
        }),
    ),
    handler: async (ctx, args) => {
        const scope = await currentReplyPreparation(ctx, args);
        if (!scope?.mission.conversationTurnId) return null;
        const turn = await ctx.db.get(scope.mission.conversationTurnId);
        if (!turn) return null;
        const page = await analystTurnDeliveries(ctx, turn._id).paginate({
            ...args.paginationOpts,
            numItems: Math.min(args.paginationOpts.numItems, HISTORY_PAGE_SIZE),
            maximumRowsRead: HISTORY_PAGE_SIZE,
        });
        const transmitted =
            args.paginationOpts.cursor === null
                ? await Promise.all(
                      (
                          await workbenchInstructionMessageIds(
                              ctx,
                              scope.mission.runId,
                          )
                      ).map(async (id) => {
                          const delivery = await ctx.db.get(id);
                          if (
                              delivery?.role !== "user" ||
                              delivery.runId !== scope.mission.runId ||
                              delivery.conversationId !== turn.conversationId
                          )
                              throw executionError(
                                  "conversation_message_unavailable",
                              );
                          return replyInstructionIdentity(delivery);
                      }),
                  )
                : undefined;
        return {
            ...page,
            page: page.page.map(replyInstructionIdentity),
            transmitted,
        };
    },
});

/** Rechecks invocation, active turn and retained identity on every fragment read. */
export const replyInstructionFragment = internalQuery({
    args: {
        ...replyPreparationArgs,
        messageId: v.id("agentMessageDeliveries"),
        contentHash: v.string(),
        index: v.number(),
    },
    returns: v.object({
        content: v.string(),
        characters: v.number(),
        sizeBytes: v.number(),
        fragmentCount: v.number(),
    }),
    handler: async (ctx, args) => {
        const scope = await currentReplyPreparation(ctx, args);
        const turn = scope?.mission.conversationTurnId
            ? await ctx.db.get(scope.mission.conversationTurnId)
            : null;
        const delivery = await ctx.db.get(args.messageId);
        if (
            !scope ||
            !turn ||
            !delivery ||
            delivery.runId !== scope.mission.runId ||
            delivery.conversationId !== turn.conversationId ||
            delivery.role !== "user" ||
            deliveryBodyHash(delivery) !== args.contentHash
        )
            throw executionError("conversation_message_unavailable");
        if (
            delivery.turnId !== turn._id &&
            !(
                await workbenchInstructionMessageIds(ctx, scope.mission.runId)
            ).includes(delivery._id)
        )
            throw executionError("conversation_message_unavailable");
        const text = await retainedDeliveryBody(ctx, delivery);
        return {
            content: await retainedTextFragment(ctx, text, args.index),
            characters: text.characters,
            sizeBytes: text.sizeBytes,
            fragmentCount: text.fragmentHashes.length,
        };
    },
});

export const replyPreparation = internalQuery({
    args: {
        ...replyPreparationArgs,
        wording: v.optional(preparedAnalystWording),
    },
    returns: v.union(
        v.null(),
        v.object({
            confirmationOnly: v.boolean(),
            confirmations: v.array(v.string()),
            basisHash: v.string(),
            factsRevisionTemplate: v.optional(v.string()),
        }),
    ),
    handler: async (ctx, args) => {
        const scope = await currentReplyPreparation(ctx, args);
        if (!scope) return null;
        const { invocation, mission } = scope;
        const wording = args.wording
            ? await readPreparedTurnWording(ctx, mission, args.wording)
            : undefined;
        if (wording === null) return null;
        const basis = await replyPreparationBasis(
            ctx,
            invocation,
            mission,
            args.responseHash,
            undefined,
            wording,
        );
        if (!basis) return null;
        const { adopt, ...prepared } = basis;
        return prepared;
    },
});

export const stagePreparedReply = internalMutation({
    args: {
        invocationId: v.id("agentInvocations"),
        expectedGeneration: v.number(),
        basisHash: v.string(),
        fragment: textFragmentValidator,
    },
    returns: v.id("retainedTexts"),
    handler: async (ctx, args) => {
        const invocation = await ctx.db.get(args.invocationId);
        if (
            !invocation?.missionId ||
            (invocation.adoptionGeneration ?? invocation.generation) !==
                args.expectedGeneration
        )
            throw executionError("invocation_unavailable");
        await requireMissionObservationAuthority(
            ctx,
            invocation.missionId,
            args.expectedGeneration,
        );
        if (!(await dossierAcceptsDiagnostics(ctx, invocation.runId)))
            throw executionError("not_authorized");
        if (!/^[0-9a-f]{64}$/.test(args.basisHash))
            throw executionError("invocation_result_invalid");
        return stageRetainedText(
            ctx,
            preparedReplyKey(
                invocation._id,
                args.basisHash,
                args.fragment.contentHash,
            ),
            args.fragment,
        );
    },
});

const preparedReplyValidator = v.object({
    basisHash: v.string(),
    textId: v.id("retainedTexts"),
    reviewDraft: v.optional(preparedResponseReviewDraft),
    completion: preparedCompletionValidator,
    wording: v.optional(preparedAnalystWording),
    exactFactsRevision: v.optional(v.string()),
});

async function resolvePreparedReply(
    ctx: QueryCtx,
    invocation: Doc<"agentInvocations">,
    mission: Doc<"agentMissions">,
    prepared: Infer<typeof preparedReplyValidator>,
    responseHash: string,
    instructionTexts?: Map<Id<"agentMessageDeliveries">, string>,
) {
    const text = await completeRetainedText(ctx, prepared.textId);
    const wording = prepared.wording
        ? await readPreparedTurnWording(ctx, mission, prepared.wording)
        : undefined;
    if (wording === null) return null;
    const basis = await replyPreparationBasis(
        ctx,
        invocation,
        mission,
        responseHash,
        instructionTexts,
        wording,
    );
    if (basis?.basisHash !== prepared.basisHash) return null;
    if (
        (basis.factsRevisionTemplate !== undefined) !==
            (prepared.exactFactsRevision !== undefined) ||
        (prepared.exactFactsRevision !== undefined &&
            !/^[0-9a-f]{64}$/.test(prepared.exactFactsRevision))
    )
        throw executionError("invocation_result_invalid");
    if (
        text.key !==
        preparedReplyKey(
            invocation._id,
            preparedReplyBasisHash(
                prepared.basisHash,
                prepared.reviewDraft,
                prepared.completion,
                prepared.wording,
                prepared.exactFactsRevision,
            ),
            text.contentHash,
        )
    )
        throw executionError("invocation_result_invalid");
    return { text, adopt: basis.adopt };
}

export const finish = internalMutation({
    args: {
        invocationId: v.id("agentInvocations"),
        expectedGeneration: v.number(),
        response: v.optional(invocationResponseValidator),
        preparedSubmission: v.optional(preparedSubmissionValidator),
        preparedReply: v.optional(preparedReplyValidator),
        correctionWording: v.optional(preparedAnalystWording),
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
        if (!(await dossierAcceptsDiagnostics(ctx, invocation.runId)))
            throw executionError("not_authorized");
        if (args.response && args.preparedSubmission)
            throw executionError("invocation_result_invalid");
        const response = args.response ?? args.preparedSubmission?.response;
        const prepared = args.preparedReply;
        const compact = response ? undefined : prepared?.completion;
        if (
            (!response && !compact) ||
            (args.correctionWording && (!response || prepared))
        )
            throw executionError("invocation_result_invalid");
        const outputJson = args.response
            ? stableStringify(args.response)
            : undefined;
        const responseHash =
            outputJson === undefined
                ? (args.preparedSubmission?.responseHash ??
                  compact?.responseHash)
                : sha256Hex(outputJson);
        if (
            !responseHash ||
            (prepared && responseHash !== prepared.completion.responseHash)
        )
            throw executionError("invocation_result_conflict");
        const match = (part: "received" | "adopted") =>
            matchInvocationResponse(
                ctx,
                invocation,
                part,
                outputJson ?? { responseHash },
            );
        const received = await match("received");
        if (
            (compact || args.preparedSubmission || args.correctionWording) &&
            !received
        )
            throw executionError("invocation_result_conflict");
        const observation = args.response ?? {
            responseHash,
            ...(response?.kind === "operations"
                ? {
                      operationNames: response.requests.map(
                          (request) => request.name,
                      ),
                  }
                : {}),
        };
        if (
            invocation.generationBackend?.id !== "pi-durable" &&
            new TextEncoder().encode(args.rawOutputJson ?? "").length >
                MAX_OBSERVABLE_OUTPUT_BYTES
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
            if (!(await match("adopted")))
                throw executionError("invocation_result_conflict");
            return {
                kind: invocation.blockCode
                    ? ("blocked" as const)
                    : !response ||
                        response.kind === "complete" ||
                        response?.kind === "completion_submission" ||
                        response?.kind === "completion_correction" ||
                        response?.kind === "completion_refusal"
                      ? ("completed" as const)
                      : ("waiting" as const),
                requestIds: invocation.requestIds ?? [],
                ...(invocation.blockCode ? { code: invocation.blockCode } : {}),
                ...(invocation.correction
                    ? { correction: invocation.correction }
                    : {}),
            };
        }
        const retainedResponse =
            received ??
            (outputJson === undefined
                ? null
                : await retainInvocationResponse(ctx, invocation, outputJson));
        if (!retainedResponse)
            throw executionError("invocation_result_conflict");
        const completionStructureError =
            response?.kind === "completion_submission" ||
            response?.kind === "completion_correction" ||
            response?.kind === "completion_refusal"
                ? invocationStructureError(
                      response,
                      mission.executionRuntime === "pi-durable",
                  )
                : undefined;
        const callId =
            compact?.callId ??
            (response?.kind === "completion_correction" ||
            response?.kind === "completion_refusal"
                ? response.completion.callId
                : undefined) ??
            (response?.kind === "completion_submission"
                ? response.call?.callId
                : undefined);
        const returned = {
            status: "returned" as const,
            outputJson: retainedResponse.json,
            outputTextId: retainedResponse.textId,
            ...(callId && !completionStructureError
                ? { nativeCompletion: { callId, responseHash } }
                : {}),
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
                observation,
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
            hasReceivedResponse(invocation) &&
            !canAdoptRetainedResponse(mission, invocation)
        )
            return block("retained_response_not_reusable", true);
        if (response?.kind === "blocked") {
            if (
                response.code === "invalid_output" &&
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
            return block(response.code, true);
        }
        if (invocation.provenance === "live") {
            if (
                receipt?.status !== "succeeded" ||
                receipt.invocationId !== invocation._id ||
                receipt.dispatchOutcome !== "response_received"
            )
                return block("provider_receipt_required", true);
        }
        const recordCompleted = async (completed: typeof observation) => {
            await recordMissionEvent(ctx, mission, {
                ...(await invocationEventObservation(
                    ctx,
                    invocation,
                    completed,
                    args.rawOutputJson,
                )),
                historySource: "material",
                kind: "mission_completed",
                cause: invocation.taskKey,
                invocationId: invocation._id,
            });
        };
        const correctPreparedWording = async () => {
            if (
                !args.correctionWording ||
                !definition.preparedCompletion?.correction
            )
                throw executionError("invocation_result_invalid");
            const wording = await readPreparedTurnWording(
                ctx,
                mission,
                args.correctionWording,
            );
            if (!wording) return block("mission_context_changed");
            const correction = await definition.preparedCompletion.correction(
                ctx,
                mission,
                wording,
            );
            return correction.kind === "correct"
                ? correctCompletion(correction.feedback)
                : block(correction.code);
        };
        if (
            response?.kind === "completion_correction" ||
            response?.kind === "completion_refusal"
        ) {
            if (response.completion.responseHash !== responseHash)
                throw executionError("invocation_result_conflict");
            if (
                callId !== undefined &&
                (definition.completionTransport !== "native_tool" ||
                    callId.length < 1 ||
                    callId.length > 160)
            )
                return block("invalid_tool_correlation", true);
            const notes = resolveWorkingNotes(
                mission.workingNotes,
                response.completion.workingNotes,
            );
            if (
                !callId &&
                (response.completion.workingNotesOversized || !notes.ok)
            )
                return block("working_memory_capacity", true);
            if (await hasOutstandingOperations(ctx, mission._id))
                return block("pending_operations");
            if (response.completion.workingNotesOversized || !notes.ok)
                return block("working_memory_capacity", true);
            await ctx.db.patch(mission._id, { workingNotes: notes.notes });
            if (response.kind === "completion_refusal")
                return block(response.code);
            return correctPreparedWording();
        }
        if (!response) {
            if (
                !compact ||
                !prepared ||
                !mission.conversationTurnId ||
                !("protocolVersion" in mission) ||
                !definition.preparedCompletion
            )
                throw executionError("invocation_result_invalid");
            if (
                callId !== undefined &&
                (definition.completionTransport !== "native_tool" ||
                    callId.length < 1 ||
                    callId.length > 160)
            )
                return block("invalid_tool_correlation", true);
            const notes = resolveWorkingNotes(
                mission.workingNotes,
                compact.workingNotes,
            );
            const notesFit = !compact.workingNotesOversized && notes.ok;
            if (!callId && !notesFit)
                return block("working_memory_capacity", true);
            if (await hasOutstandingOperations(ctx, mission._id))
                return block("pending_operations");
            if (!notesFit) return block("working_memory_capacity", true);
            const instructionTexts = new Map<
                Id<"agentMessageDeliveries">,
                string
            >();
            const candidate = await resolvePreparedReply(
                ctx,
                invocation,
                mission,
                prepared,
                responseHash,
                instructionTexts,
            );
            if (!candidate) return block("mission_context_changed");
            await ctx.db.patch(mission._id, { workingNotes: notes.notes });
            const result = await candidate.adopt(
                ctx,
                invocation,
                prepared.reviewDraft,
                prepared.exactFactsRevision,
            );
            if (result.kind === "correct")
                return correctCompletion(result.feedback);
            if (result.kind === "continue")
                return block("mission_context_changed");
            if (result.kind === "blocked") return block(result.code);
            const publication = await publishTurn(
                ctx,
                mission,
                candidate.text,
                invocation.instructionVersion,
            );
            if (!publication.bodyTextId)
                throw executionError("publication_conflict");
            await ctx.db.patch(mission._id, {
                status: "completed",
                ...textualMissionOutcomePatch(
                    definition.preparedCompletion.outcomeKind,
                    publication.bodyTextId,
                    publication.contentHash,
                ),
            });
            await recordCompleted(observation);
            return { kind: "completed", requestIds: [] };
        }
        const isCompletion =
            response.kind === "complete" ||
            response.kind === "completion_submission";
        if (response.kind === "completion_submission") {
            if (definition.completionTransport !== "native_tool")
                return block("invalid_output", true);
            if (completionStructureError)
                return block(completionStructureError, true);
        }
        const awaitingOperations =
            isCompletion && (await hasOutstandingOperations(ctx, mission._id));
        const admission = isCompletion
            ? (invocation.workbenchCompletionAdmission ??
              invocation.sourcesCompletionAdmission)
            : (invocation.workbenchOperationAdmission ??
              invocation.sourcesOperationAdmission);
        const snapshot: unknown =
            isCompletion && definition.id === "conversation_validation_v1"
                ? undefined
                : (admission ??
                  JSON.parse(await admittedInputJson(ctx, invocation)));
        if (
            response.kind === "complete" ||
            response.kind === "completion_submission"
        ) {
            if (response.kind === "complete") {
                const resolvedNotes = resolveWorkingNotes(
                    mission.workingNotes,
                    response.workingNotes,
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
            if (response.kind === "completion_submission") {
                if (response.call === null)
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
                if ("feedback" in response.call && response.call.feedback)
                    return correctCompletion(response.call.feedback);
                if ("blockCode" in response.call && response.call.blockCode)
                    return block(response.call.blockCode, true);
                try {
                    proposalValue = JSON.parse(response.call.inputJson ?? "");
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
            } else proposalValue = response;
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
            const preparedText = prepared
                ? await resolvePreparedReply(
                      ctx,
                      invocation,
                      mission,
                      prepared,
                      responseHash,
                  )
                : undefined;
            if (prepared && !preparedText)
                return block("mission_context_changed");
            const proposal = proposalValue as AgentCompletion;
            if (response.kind === "completion_submission") {
                const resolvedNotes = resolveWorkingNotes(
                    mission.workingNotes,
                    proposal.workingNotes,
                );
                if (!resolvedNotes.ok)
                    return block("working_memory_capacity", true);
                const notes = resolvedNotes.notes;
                await ctx.db.patch(mission._id, { workingNotes: notes });
            }
            if (args.correctionWording) {
                return correctPreparedWording();
            }
            const completion = await definition.complete(
                ctx,
                mission,
                proposal,
                snapshot,
                invocation,
                prepared?.reviewDraft,
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
            let publication:
                | Awaited<ReturnType<typeof publishTurn>>
                | undefined;
            if (mission.conversationTurnId) {
                if (!definition.conversationReply)
                    return block("conversation_reply_missing", true);
                publication = await publishTurn(
                    ctx,
                    mission,
                    definition.conversationReply(completion.result),
                    invocation.instructionVersion,
                    preparedText?.text,
                );
            }
            await ctx.db.patch(mission._id, {
                status: "completed",
                ...(await missionResultPatch(
                    ctx,
                    mission,
                    completion.result,
                    publication,
                )),
            });
            await recordCompleted(observation);
            return { kind: "completed" as const, requestIds: [] };
        }
        const resolvedNotes = resolveWorkingNotes(
            mission.workingNotes,
            response.workingNotes,
        );
        if (!resolvedNotes.ok) return block("working_memory_capacity", true);
        const notes = resolvedNotes.notes;
        await ctx.db.patch(mission._id, { workingNotes: notes });
        const structureError = invocationStructureError(
            response,
            mission.executionRuntime === "pi-durable",
        );
        if (structureError) return block(structureError, true);
        const requestIds = [];
        const modelOperations = agentToolSchemas(definition, snapshot);
        if (Object.keys(modelOperations).length === 0)
            return block("operation_not_allowed", true);
        for (const request of response.requests) {
            const originalInput = args.preparedSubmission
                ? {
                      inputReference: {
                          invocationId: invocation._id,
                          responseHash,
                          callId: request.callId,
                      },
                  }
                : { inputJson: request.inputJson ?? "" };
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
                            ...originalInput,
                            refusalCode: "completion_must_be_sole_call",
                        },
                    }),
                );
                continue;
            }
            let decoded: unknown;
            try {
                decoded =
                    request.inputJson === undefined
                        ? null
                        : JSON.parse(request.inputJson);
            } catch {
                decoded = null;
            }
            let canonical = definition.nativeConversation
                ? normalizeNativeHistoryInput(request.name, decoded)
                : decoded;
            let normalizationRefusal: string | undefined =
                "refusalCode" in request ? request.refusalCode : undefined;
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
                normalizationValidation ??
                ("validation" in request ? request.validation : undefined);
            const operation = modelOperations[request.name];
            let fieldsValid = !!operation;
            if (operation && request.inputJson !== undefined) {
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
                request.inputJson !== undefined &&
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
                              ...originalInput,
                              ...(normalizationRefusal
                                  ? { refusalCode: normalizationRefusal }
                                  : {}),
                              ...(validation ? { validation } : {}),
                          },
                }),
            );
        }
        await ctx.db.patch(invocation._id, {
            requestIds,
            ...(mission.executionRuntime === "pi-durable"
                ? {
                      nativeOperations: {
                          responseHash,
                          calls: response.requests.map((request) => ({
                              callId: request.callId,
                              ...(request.name === SUBMIT_COMPLETION_TOOL
                                  ? { completion: true as const }
                                  : {}),
                          })),
                      },
                  }
                : {}),
        });
        await ctx.db.patch(mission._id, { status: "waiting" });
        await recordMissionEvent(ctx, mission, {
            ...(await invocationEventObservation(
                ctx,
                invocation,
                observation,
                retainedResponse.textId ? undefined : args.rawOutputJson,
                retainedResponse.textId ? responseHash : undefined,
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
