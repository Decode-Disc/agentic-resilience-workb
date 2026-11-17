import { api, internal } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import {
    internalMutation,
    mutation,
    type QueryCtx,
    query,
} from "@convex/_generated/server";
import { mergeRunCompanyMetadata } from "@convex/domain/companyMetadata";
import {
    researchQuestionCapacity,
    researchStartBlock,
} from "@convex/domain/framingEditAuthority";
import { sourceCaptureState } from "@convex/domain/sourceCaptureState";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import {
    readSourcesMission,
    sourcesPhaseValidator,
    sourcesPreparationPhase,
} from "@convex/domain/sources";
import {
    isResumableResearchPause,
    supportsResearchControl,
} from "@convex/domain/transitions";
import { companySnapshotValidator } from "@convex/domain/validators";
import {
    approvalRequestIdFromOperation,
    explicitResearchControl,
    workbenchCommand,
    workbenchCommandOutcome,
} from "@convex/domain/workbenchContracts";
import {
    processWorkbenchInstructions,
    readWorkbenchInstructions,
} from "@convex/domain/workbenchInstructions";
import { getAgentDefinition } from "@convex/execution/agentCatalog";
import { approvalCatalog } from "@convex/execution/approvalCatalog";
import {
    raiseApproval,
    readApprovalFacts,
    readSourcesDecisionRequestId,
    recordCommandApproval,
} from "@convex/execution/approvals";
import {
    requireDossierAuthority,
    requireMissionAuthority,
} from "@convex/execution/authority";
import {
    analystConversationTurn,
    conversationTurnForAnalyst,
    isApprovalReceiptMessage,
    recordControlExchange,
    requireConversationRequestKey,
    requireInstructionVersion,
} from "@convex/execution/conversations";
import { executionError, executionFailureCode } from "@convex/execution/errors";
import { missionStatusValidator } from "@convex/execution/executionProtocol";
import { nextNativeInputSequence } from "@convex/execution/journal";
import { retainOperationEffect } from "@convex/execution/operations";
import { sessionForMission } from "@convex/execution/piStore";
import {
    pauseResearch,
    readResearchControlReadiness,
    researchControlConfirmation,
    researchInterruptionDetail,
    researchStateSummary,
    resumeResearch,
} from "@convex/execution/researchControl";
import { readConversationMessages } from "@convex/integrations/agentStorage";
import { reasoningChoices } from "@convex/integrations/modelRouting";
import {
    modelPrepared,
    requireReasoningEffort,
    resolveAgentModel,
} from "@convex/modelConfiguration";
import { reasoningEffort } from "@convex/modelConfigurationSchema";
import { sourceDossierCandidateLimit } from "@convex/resourceLimits";
import {
    MAX_WORKBENCH_TURN_OPERATIONS,
    WORKBENCH_OPERATION_PREVIEW_SIZE,
} from "@convex/resourcePolicy";
import { requireWorkspaceRun } from "@convex/runWorkspace";
import schema from "@convex/schema";
import { startReviewPreparation } from "@convex/sourcePreparation";
import { sourcesSettlementBlock } from "@convex/sourcesMission";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
    paginationOptsValidator,
    paginationResultValidator,
} from "convex/server";
import { type Infer, v } from "convex/values";

const commandResult = v.object({
    messageId: v.id("agentMessageDeliveries"),
    confirmationMessageId: v.id("agentMessageDeliveries"),
    outcome: workbenchCommandOutcome,
    text: v.string(),
});

function workbenchCommandsSupported(
    conversation: Doc<"agentConversations"> | null,
) {
    const definition = getAgentDefinition("workbench_v1");
    return (
        conversation?.definitionId === definition.id &&
        conversation.definitionVersion === definition.version &&
        !!definition.nativeConversation
    );
}

/** Exposes only analyst-relevant catalogue choices, independently of provider credentials. */
export const models = query({
    args: { runId: v.optional(v.id("researchRuns")) },
    returns: v.object({
        selectedId: v.union(v.id("modelCatalog"), v.null()),
        label: v.string(),
        available: v.boolean(),
        effort: v.union(reasoningEffort, v.null()),
        effortChoices: v.array(reasoningEffort),
        revision: v.number(),
        choices: v.array(
            v.object({
                id: v.id("modelCatalog"),
                label: v.string(),
                effortChoices: v.array(reasoningEffort),
                effort: v.union(reasoningEffort, v.null()),
            }),
        ),
    }),
    handler: async (ctx, args) => {
        if (!(await getAuthUserId(ctx))) throw executionError("unauthorized");
        const runId = args.runId;
        if (runId) await requireWorkspaceRun(ctx, runId);
        const conversation = runId
            ? await ctx.db
                  .query("agentConversations")
                  .withIndex("by_run", (q) => q.eq("runId", runId))
                  .unique()
            : null;
        const setting = await ctx.db
            .query("agentModelSettings")
            .withIndex("by_agent", (q) => q.eq("agent", "workbench"))
            .unique();
        const selectedId =
            conversation?.modelCatalogId ?? setting?.catalogId ?? null;
        const selected = selectedId ? await ctx.db.get(selectedId) : null;
        const configuration = selected?.currentRevisionId
            ? await ctx.db.get(selected.currentRevisionId)
            : null;
        const choices = await ctx.db
            .query("modelCatalog")
            .withIndex("by_enabled_and_workbench_selectable", (q) =>
                q.eq("enabled", true).eq("workbenchSelectable", true),
            )
            .take(100);
        return {
            selectedId,
            label: selected?.label ?? "Choose model",
            available:
                !!selected?.enabled &&
                modelPrepared(selected) &&
                selected.workbenchSelectable,
            effort:
                conversation?.reasoningEffort ??
                configuration?.reasoningEffort ??
                null,
            effortChoices: configuration
                ? reasoningChoices(configuration.descriptor)
                : [],
            revision: conversation?.modelSelectionRevision ?? 0,
            choices: await Promise.all(
                choices.filter(modelPrepared).map(async (m) => {
                    const revision = m.currentRevisionId
                        ? await ctx.db.get(m.currentRevisionId)
                        : null;
                    return {
                        id: m._id,
                        label: m.label,
                        effortChoices: revision
                            ? reasoningChoices(revision.descriptor)
                            : [],
                        effort: revision?.reasoningEffort ?? null,
                    };
                }),
            ),
        };
    },
});

export const setModel = mutation({
    args: {
        runId: v.id("researchRuns"),
        catalogId: v.id("modelCatalog"),
        reasoningEffort: v.optional(reasoningEffort),
        expectedRevision: v.number(),
        requestKey: v.string(),
    },
    returns: v.object({ revision: v.number() }),
    handler: async (ctx, args) => {
        await requireWorkspaceRun(ctx, args.runId);
        await requireDossierAuthority(ctx, args.runId);
        requireConversationRequestKey(args.requestKey);
        const conversation = await ctx.db
            .query("agentConversations")
            .withIndex("by_run", (q) => q.eq("runId", args.runId))
            .unique();
        if (!conversation) throw executionError("conversation_unavailable");
        const hash = sha256Hex(
            stableStringify({
                catalogId: args.catalogId,
                expectedRevision: args.expectedRevision,
                ...(args.reasoningEffort
                    ? { reasoningEffort: args.reasoningEffort }
                    : {}),
            }),
        );
        if (conversation.modelSelectionKey === args.requestKey) {
            if (conversation.modelSelectionHash !== hash)
                throw executionError("message_identity_conflict");
            return { revision: conversation.modelSelectionRevision ?? 0 };
        }
        if (
            (conversation.modelSelectionRevision ?? 0) !== args.expectedRevision
        )
            throw executionError("model_configuration_conflict");
        const model = await resolveAgentModel(ctx, "workbench", args.catalogId);
        const effort =
            args.reasoningEffort ??
            (conversation.modelCatalogId === args.catalogId
                ? conversation.reasoningEffort
                : undefined) ??
            model.reasoningEffort;
        requireReasoningEffort(model, effort);
        const revision = args.expectedRevision + 1;
        await ctx.db.patch(conversation._id, {
            modelCatalogId: args.catalogId,
            reasoningEffort: effort,
            modelSelectionRevision: revision,
            modelSelectionKey: args.requestKey,
            modelSelectionHash: hash,
        });
        return { revision };
    },
});

/** Explicit controls share button authorization/effects; free-text submission is unchanged. */
export const command = mutation({
    args: {
        runId: v.id("researchRuns"),
        requestKey: v.string(),
        command: workbenchCommand,
        expectedGeneration: v.number(),
    },
    returns: commandResult,
    handler: async (ctx, args): Promise<Infer<typeof commandResult>> => {
        const { run } = await requireWorkspaceRun(ctx, args.runId);
        await requireDossierAuthority(ctx, run._id);
        requireConversationRequestKey(args.requestKey);
        if (
            !Number.isSafeInteger(args.expectedGeneration) ||
            args.expectedGeneration < 1
        )
            throw executionError("stale_execution");
        const conversation = await ctx.db
            .query("agentConversations")
            .withIndex("by_run", (q) => q.eq("runId", run._id))
            .unique();
        if (!conversation || !workbenchCommandsSupported(conversation))
            throw executionError("native_conversation_required");
        const contentHash = sha256Hex(
            stableStringify({
                command: args.command,
                expectedGeneration: args.expectedGeneration,
            }),
        );
        const previous = await ctx.db
            .query("agentMessageDeliveries")
            .withIndex("by_run_and_key", (q) =>
                q.eq("runId", run._id).eq("requestKey", args.requestKey),
            )
            .unique();
        if (previous) {
            if (
                !previous.controlCommand ||
                previous.contentHash !== contentHash
            )
                throw executionError("message_identity_conflict");
            const confirmation = await ctx.db.get(
                previous.controlCommand.confirmationMessageId,
            );
            if (
                !confirmation ||
                confirmation.conversationId !== conversation._id
            )
                throw executionError("conversation_message_unavailable");
            const [text] = await readConversationMessages(
                ctx,
                conversation.storageRef,
                [confirmation.storageMessageRef],
            );
            if (text === undefined)
                throw executionError("conversation_message_unavailable");
            return {
                messageId: previous._id,
                confirmationMessageId: confirmation._id,
                outcome: previous.controlCommand.outcome,
                text,
            };
        }
        const nativeInputSequence = await nextNativeInputSequence(ctx, run._id);
        const action = args.command === "/pause" ? "pause" : "resume";
        let outcome: Infer<typeof workbenchCommandOutcome> = "refused";
        let refusal: string | undefined;
        if (run.executionGeneration !== args.expectedGeneration)
            refusal = "stale_execution";
        else if (run.lifecycleState !== "framing") {
            if (
                (action === "pause" &&
                    (run.researchPauseRequested ||
                        isResumableResearchPause(run))) ||
                (action === "resume" &&
                    run.executionStatus === "running" &&
                    !run.researchPauseRequested)
            )
                outcome = "unchanged";
            else
                try {
                    await ctx.runMutation(
                        action === "pause"
                            ? api.execution.researchControl.pause
                            : api.execution.researchControl.resume,
                        {
                            runId: run._id,
                            expectedGeneration: args.expectedGeneration,
                        },
                    );
                    outcome = "applied";
                } catch (error) {
                    const code = executionFailureCode(error);
                    if (
                        !code ||
                        ![
                            "research_control_not_supported",
                            "stale_execution",
                            "human_prerequisite_required",
                            "execution_slot_unavailable",
                        ].includes(code)
                    )
                        throw error;
                    refusal = code;
                }
        }
        const current = await ctx.db.get(run._id);
        if (!current) throw executionError("run_unavailable");
        const text =
            refusal === "stale_execution"
                ? "Research changed while this command was submitted. Check the current state and try again."
                : refusal === "execution_slot_unavailable"
                  ? "Another research dossier is running. Pause it before resuming this one."
                  : outcome === "unchanged" && action === "resume"
                    ? "Research is already running."
                    : researchControlConfirmation(
                          action,
                          outcome !== "refused",
                          current,
                      );
        const exchange = await recordControlExchange(ctx, conversation, {
            nativeInputSequence,
            requestKey: args.requestKey,
            contentHash,
            exchange: {
                kind: "command",
                name: args.command,
                expectedGeneration: args.expectedGeneration,
                outcome,
            },
            text,
        });
        return { ...exchange, outcome };
    },
});

const operationView = v.object({
    id: v.id("agentOperationRequests"),
    title: v.string(),
    status: schema.tables.agentOperationRequests.validator.fields.status,
    succeeded: v.boolean(),
    summary: v.string(),
    sourceId: v.optional(v.id("sources")),
    subject: v.optional(v.string()),
    approvalRequestId: v.optional(v.id("approvalRequests")),
    createdAt: v.number(),
});
const turnView = v.object({
    turn: analystConversationTurn,
    missionStatus: v.optional(v.string()),
    operations: v.array(operationView),
    operationsLimited: v.boolean(),
    deferred: v.optional(v.boolean()),
});
const operationTitles: Partial<
    Record<Doc<"agentOperationRequests">["input"]["kind"], string>
> = {
    adjust_framing: "Adjust the research program",
    consult_run_state: "Inspect dossier progress",
    consult_mission_state: "Inspect recorded work",
    consult_prepared_material: "Inspect documentary preparation",
    check_response_coherence: "Check response consistency",
    consult_conversation: "Read earlier conversation",
    search_available_material: "Search retained documentary material",
    read_in_context: "Read a passage in context",
    control_research: "Adjust research progression",
    request_approval: "Request research approval",
    transmit_source_request: "Transmit an analyst instruction",
    discover_sources_for_need: "Find material for a research need",
    make_source_consultable: "Save a source for reading",
    submit_documentary_qualification: "Prepare documentary contributions",
    request_documentary_check: "Check a documentary statement",
};
const operationResults: Partial<
    Record<Doc<"agentOperationRequests">["input"]["kind"], string>
> = {
    adjust_framing: "Research program updated.",
    consult_run_state: "Current dossier state inspected.",
    consult_mission_state: "Recorded work inspected.",
    consult_prepared_material:
        "Documentary needs and available material inspected.",
    consult_conversation: "Earlier analyst exchanges inspected.",
    search_available_material:
        "Search completed. Inspect the matching material.",
    read_in_context: "A saved passage was read in context.",
    control_research:
        "Research control request processed. Check the current research state.",
    request_approval:
        "Approval request processed. Check the current research state.",
    transmit_source_request:
        "Instruction transmitted. Treatment is tracked separately.",
    discover_sources_for_need:
        "Discovery returned its recorded outcome; candidates are not yet supporting evidence.",
    make_source_consultable:
        "Source acquisition returned its recorded outcome. Reading availability remains separate from support.",
    submit_documentary_qualification:
        "Documentary contributions recorded with their permitted uses and restrictions.",
    request_documentary_check:
        "A documentary check returned its findings and limits.",
    check_response_coherence: "Response consistency assessment returned.",
};

async function readMissionOperations(
    ctx: QueryCtx,
    missionId: Id<"agentMissions"> | undefined,
) {
    const requests = missionId
        ? await ctx.db
              .query("agentOperationRequests")
              .withIndex("by_mission", (q) => q.eq("missionId", missionId))
              .order("desc")
              .take(WORKBENCH_OPERATION_PREVIEW_SIZE + 1)
        : [];
    const operations = await Promise.all(
        requests
            .slice(0, WORKBENCH_OPERATION_PREVIEW_SIZE)
            .reverse()
            .map(async (r) => {
                const sourceId =
                    "sourceId" in r.input ? r.input.sourceId : undefined;
                const source = sourceId ? await ctx.db.get(sourceId) : null;
                const approvalRequestId = approvalRequestIdFromOperation(r);
                const succeeded =
                    r.outcome?.kind === "success" && !r.adoptionRefusalCode;
                const summary = r.adoptionRefusalCode
                    ? "This result needs review because the dossier changed."
                    : r.outcome?.kind === "refused"
                      ? "This request could not be applied. Review the current dossier before trying again."
                      : r.outcome?.kind === "unavailable"
                        ? "This work cannot continue yet. Available material remains inspectable."
                        : succeeded
                          ? (operationResults[r.input.kind] ??
                            "The operation returned a result. Inspect the related dossier material.")
                          : r.status === "unknown"
                            ? "The outcome is not confirmed. The request has not been repeated."
                            : r.status === "waiting"
                              ? "Waiting for the engaged work to return."
                              : "Work in progress.";
                return {
                    id: r._id,
                    title:
                        operationTitles[r.input.kind] ??
                        "Inspect dossier material",
                    status: r.status,
                    succeeded,
                    summary,
                    createdAt: r.createdAt,
                    ...(sourceId ? { sourceId, subject: source?.title } : {}),
                    ...(approvalRequestId ? { approvalRequestId } : {}),
                };
            }),
    );
    return {
        operations,
        operationsLimited: requests.length > WORKBENCH_OPERATION_PREVIEW_SIZE,
    };
}

async function readTurn(ctx: QueryCtx, turn: Doc<"agentConversationTurns">) {
    const mission = turn.missionId ? await ctx.db.get(turn.missionId) : null;
    return {
        turn: conversationTurnForAnalyst(turn),
        missionStatus: mission?.status,
        ...(await readMissionOperations(ctx, mission?._id)),
    };
}

/** Native progress has its own small subscription so each partial does not rehydrate dossier sources. */
export const responsePreview = query({
    args: { runId: v.id("researchRuns") },
    returns: v.union(
        v.null(),
        v.object(
            schema.tables.piSessions.validator.fields.publicPreview.fields,
        ),
    ),
    handler: async (ctx, { runId }) => {
        await requireWorkspaceRun(ctx, runId);
        const conversation = await ctx.db
            .query("agentConversations")
            .withIndex("by_run", (q) => q.eq("runId", runId))
            .unique();
        const turn = conversation?.activeTurnId
            ? await ctx.db.get(conversation.activeTurnId)
            : null;
        const mission = turn?.missionId
            ? await ctx.db.get(turn.missionId)
            : null;
        if (turn?.status !== "active" || !mission) return null;
        const preview = (await sessionForMission(ctx, mission))?.publicPreview;
        return preview?.turnId === turn._id &&
            preview.instructionVersion === turn.instructionVersion &&
            preview.invocationId === mission.lastInvocationId
            ? preview
            : null;
    },
});

export const turnWork = query({
    args: {
        runId: v.id("researchRuns"),
        turnId: v.id("agentConversationTurns"),
    },
    returns: turnView,
    handler: async (ctx, { runId, turnId }) => {
        await requireWorkspaceRun(ctx, runId);
        const turn = await ctx.db.get(turnId);
        if (!turn || turn.runId !== runId)
            throw new Error("Conversation turn unavailable");
        return readTurn(ctx, turn);
    },
});

export const snapshot = query({
    args: { runId: v.id("researchRuns") },
    returns: v.object({
        run: schema.doc("researchRuns"),
        researchControlAvailable: v.boolean(),
        researchResumeAvailable: v.boolean(),
        sourcesSettlementAvailable: v.boolean(),
        sourcesPhase: sourcesPhaseValidator,
        sourcesDecisionRequestId: v.union(v.id("approvalRequests"), v.null()),
        availableCommands: v.array(workbenchCommand),
        company: v.union(companySnapshotValidator, v.null()),
        framing: v.union(schema.doc("framingRevisions"), v.null()),
        /** The Start admission's current verdict, so Start is never offered only to be refused. */
        researchStart: v.object({
            block: v.union(v.string(), v.null()),
            questionCapacity: v.union(v.number(), v.null()),
        }),
        instructions: v.array(
            v.object({
                id: v.id("workbenchInstructions"),
                need: v.string(),
                status: v.string(),
                outcome: v.string(),
            }),
        ),
        activeWork: v.union(turnView, v.null()),
        sourcesWork: v.union(
            v.null(),
            v.object({
                missionId: v.id("agentMissions"),
                interruptionDetail: v.optional(v.string()),
                startedAt: v.number(),
                finishedAt: v.optional(v.number()),
                operations: v.array(operationView),
                operationsLimited: v.boolean(),
            }),
        ),
        preparation: v.union(
            schema
                .doc("sourceSelectionProposalRebuilds")
                .extend({ missionStatus: v.optional(missionStatusValidator) }),
            v.null(),
        ),
        sources: v.array(
            v.object({
                id: v.id("sources"),
                title: v.string(),
                url: v.string(),
                format: v.string(),
                state: v.union(
                    v.literal("found"),
                    v.literal("capturing"),
                    v.literal("captured"),
                ),
                unavailable: v.boolean(),
            }),
        ),
    }),
    handler: async (ctx, { runId }) => {
        const { run, visitor } = await requireWorkspaceRun(ctx, runId);
        const framing = run.currentFramingRevisionId
            ? await ctx.db.get(run.currentFramingRevisionId)
            : null;
        const company = mergeRunCompanyMetadata(
            run.companySnapshot,
            run.companyId ? await ctx.db.get(run.companyId) : null,
        );
        const conversation = await ctx.db
            .query("agentConversations")
            .withIndex("by_run", (q) => q.eq("runId", runId))
            .unique();
        const turn = conversation?.activeTurnId
            ? await ctx.db.get(conversation.activeTurnId)
            : null;
        const limit = sourceDossierCandidateLimit(run.sourcePreparationId);
        const records = await ctx.db
            .query("sources")
            .withIndex("by_run_and_url", (q) => q.eq("runId", runId))
            .take(limit + 1);
        if (records.length > limit)
            throw new Error("Source projection exceeds dossier capacity");
        const sources = await Promise.all(
            records.map(async (source) => {
                const capture = await sourceCaptureState(ctx, source._id);
                const mediaType = capture.committed?.mediaType
                    ?.split(";")[0]
                    ?.trim()
                    .toLowerCase();
                const format =
                    mediaType === "application/pdf"
                        ? "PDF"
                        : mediaType === "text/html"
                          ? "HTML"
                          : mediaType === "text/plain"
                            ? "Text"
                            : "URL";
                return {
                    id: source._id,
                    title: source.title,
                    url: source.canonicalUrl,
                    format,
                    state: capture.committed
                        ? ("captured" as const)
                        : capture.capturing
                          ? ("capturing" as const)
                          : ("found" as const),
                    unavailable: !capture.committed && capture.unavailable,
                };
            }),
        );
        const instructions = (
            await readWorkbenchInstructions(ctx, run._id)
        ).map((request) => ({
            id: request._id,
            need: request.interpretedNeed,
            status: request.status,
            outcome: request.outcome,
        }));
        const preparation = run.sourcePreparationId
            ? await ctx.db.get(run.sourcePreparationId)
            : null;
        const sourcesMission = preparation
            ? await readSourcesMission(ctx, run)
            : null;
        const sourcesPhase = sourcesPreparationPhase(
            run,
            preparation,
            sourcesMission,
        );
        const sourcesCompletion = sourcesMission
            ? await ctx.db
                  .query("agentExecutionEvents")
                  .withIndex("by_mission_and_kind", (q) =>
                      q
                          .eq("missionId", sourcesMission._id)
                          .eq("kind", "mission_completed"),
                  )
                  .order("desc")
                  .first()
            : null;
        const resumeReadiness = await readResearchControlReadiness(
            ctx,
            run,
            "resume",
        );
        return {
            run,
            researchControlAvailable: supportsResearchControl(run),
            researchResumeAvailable: resumeReadiness.block === null,
            sourcesSettlementAvailable:
                (await sourcesSettlementBlock(ctx, run)) === null,
            sourcesPhase,
            sourcesDecisionRequestId: await readSourcesDecisionRequestId(
                ctx,
                run,
            ),
            availableCommands:
                workbenchCommandsSupported(conversation) &&
                run.fixedFramingRevisionId &&
                supportsResearchControl(run)
                    ? run.researchPauseRequested ||
                      isResumableResearchPause(run)
                        ? resumeReadiness.block === null
                            ? ["/resume" as const]
                            : []
                        : run.executionStatus === "running"
                          ? ["/pause" as const]
                          : []
                    : [],
            company: company ?? null,
            framing,
            researchStart: {
                block: await researchStartBlock(ctx, run, framing, visitor),
                questionCapacity: await researchQuestionCapacity(ctx, run),
            },
            instructions,
            activeWork: turn ? await readTurn(ctx, turn) : null,
            sourcesWork: sourcesMission
                ? {
                      missionId: sourcesMission._id,
                      interruptionDetail:
                          sourcesPhase === "interrupted"
                              ? run.pauseReason === "execution_interrupted"
                                  ? researchStateSummary(
                                        run,
                                        sourcesMission.blockCode,
                                        resumeReadiness.block,
                                    )
                                  : researchInterruptionDetail(
                                        sourcesMission.blockCode,
                                    )
                              : undefined,
                      startedAt: sourcesMission.createdAt,
                      ...(sourcesCompletion
                          ? { finishedAt: sourcesCompletion.occurredAt }
                          : {}),
                      ...(await readMissionOperations(ctx, sourcesMission._id)),
                  }
                : null,
            preparation: preparation
                ? {
                      ...preparation,
                      ...(sourcesMission
                          ? { missionStatus: sourcesMission.status }
                          : {}),
                  }
                : null,
            sources,
        };
    },
});

const messageFields = schema.tables.agentMessageDeliveries.validator.pick(
    "runId",
    "requestKey",
    "turnId",
    "role",
    "delivery",
    "status",
    "createdAt",
    "responseControl",
    "approvalRequestId",
).fields;
export const history = query({
    args: {
        runId: v.id("researchRuns"),
        paginationOpts: paginationOptsValidator,
    },
    returns: paginationResultValidator(
        v.object({
            ...messageFields,
            _id: v.id("agentMessageDeliveries"),
            approvalRequestIds: v.optional(v.array(v.id("approvalRequests"))),
            text: v.string(),
            work: v.union(turnView, v.null()),
        }),
    ),
    handler: async (ctx, args) => {
        await requireWorkspaceRun(ctx, args.runId);
        if (args.paginationOpts.numItems > 20)
            throw new Error("Conversation page exceeds capacity");
        const page = await ctx.db
            .query("agentMessageDeliveries")
            .withIndex("by_run", (q) => q.eq("runId", args.runId))
            .order("desc")
            .paginate(args.paginationOpts);
        const conversation = await ctx.db
            .query("agentConversations")
            .withIndex("by_run", (q) => q.eq("runId", args.runId))
            .unique();
        if (!conversation) return { ...page, page: [] };
        const visible = page.page.filter(
            (message) => !isApprovalReceiptMessage(message),
        );
        if (visible.length === 0) return { ...page, page: [] };
        const texts = await readConversationMessages(
            ctx,
            conversation.storageRef,
            visible.map((m) => m.storageMessageRef),
        );
        const turns = new Map<
            string,
            Awaited<ReturnType<typeof readTurn>> & { deferred?: boolean }
        >();
        const turnApprovals = new Map<string, Id<"approvalRequests">[]>();
        for (const message of visible)
            if (message.turnId) {
                const existingTurn = turns.get(message.turnId);
                const turn = existingTurn
                    ? null
                    : await ctx.db.get(message.turnId);
                if (turn) {
                    const hasOperations =
                        turn.hasOperations ??
                        (turn.missionId
                            ? !!(await ctx.db
                                  .query("agentOperationRequests")
                                  .withIndex("by_mission", (q) =>
                                      q.eq("missionId", turn.missionId),
                                  )
                                  .first())
                            : false);
                    turns.set(turn._id, {
                        turn: conversationTurnForAnalyst(turn),
                        missionStatus: undefined,
                        operations: [],
                        operationsLimited: false,
                        deferred: hasOperations,
                    });
                    if (turn.missionId) {
                        const ops = await ctx.db
                            .query("agentOperationRequests")
                            .withIndex("by_mission", (q) =>
                                q.eq("missionId", turn.missionId),
                            )
                            .take(MAX_WORKBENCH_TURN_OPERATIONS);
                        const ids: Id<"approvalRequests">[] = [];
                        for (const op of ops) {
                            const id = approvalRequestIdFromOperation(op);
                            if (id && !ids.includes(id)) ids.push(id);
                        }
                        if (ids.length) turnApprovals.set(turn._id, ids);
                    }
                }
            }
        return {
            ...page,
            page: visible.map((m, index) => {
                const text = texts[index];
                if (text === undefined)
                    throw new Error("Conversation message unavailable");
                const approvalRequestIds =
                    m.role === "assistant" && m.delivery === "reply" && m.turnId
                        ? turnApprovals.get(m.turnId)
                        : undefined;
                return {
                    _id: m._id,
                    runId: m.runId,
                    requestKey: m.requestKey,
                    turnId: m.turnId,
                    role: m.role,
                    delivery: m.delivery,
                    status: m.status,
                    createdAt: m.createdAt,
                    ...(m.responseControl
                        ? { responseControl: m.responseControl }
                        : {}),
                    ...(m.approvalRequestId
                        ? { approvalRequestId: m.approvalRequestId }
                        : {}),
                    ...(approvalRequestIds ? { approvalRequestIds } : {}),
                    text,
                    work: m.turnId ? (turns.get(m.turnId) ?? null) : null,
                };
            }),
        };
    },
});

export const performInstruction = internalMutation({
    args: {
        requestId: v.id("agentOperationRequests"),
        expectedGeneration: v.number(),
    },
    returns: v.string(),
    handler: async (ctx, args): Promise<string> => {
        const request = await ctx.db.get(args.requestId);
        if (
            !request?.missionId ||
            (request.input.kind !== "control_research" &&
                request.input.kind !== "request_approval" &&
                request.input.kind !== "transmit_source_request")
        )
            throw executionError("operation_not_allowed");
        const { mission, run } = await requireMissionAuthority(
            ctx,
            request.missionId,
            args.expectedGeneration,
        );
        await requireInstructionVersion(
            ctx,
            mission,
            request.instructionVersion,
        );
        if (
            mission.definitionId !== "workbench_v1" ||
            !run.fixedFramingRevisionId
        )
            throw executionError("instruction_not_authorized");
        const input = request.input;
        if (
            input.kind === "transmit_source_request" &&
            request.operationVersion !== 1 &&
            run.sourcesProtocol !== "sources_mission_v1" &&
            input.coverageRole === undefined
        )
            throw executionError("source_request_target_required");
        const message = await ctx.db.get(input.messageId);
        const conversation = message
            ? await ctx.db.get(message.conversationId)
            : null;
        if (
            message?.runId !== run._id ||
            message.role !== "user" ||
            message.turnId !== mission.conversationTurnId ||
            !conversation
        )
            throw executionError("instruction_not_authorized");
        if (request.effect?.outcome.kind === "success")
            return request.effect.outcome.valueJson;
        if (input.kind === "request_approval") {
            const pin = request.pin;
            if (
                pin?.kind !== "workbench_instruction" ||
                pin.generation !== run.executionGeneration ||
                pin.framingId !== run.fixedFramingRevisionId ||
                (pin.controlRevision ?? 0) !==
                    (run.researchControlRevision ?? 0)
            )
                throw executionError("version_conflict");
            const [text] = await readConversationMessages(
                ctx,
                conversation.storageRef,
                [message.storageMessageRef],
            );
            if (!text) throw executionError("instruction_not_authorized");
            const control = explicitResearchControl(text);
            const commandAction =
                control === "pause" && input.action === "pause_research"
                    ? ("pause_research" as const)
                    : control === "resume" && input.action === "resume_research"
                      ? ("resume_research" as const)
                      : undefined;
            if (commandAction) {
                const block = await approvalCatalog[commandAction].availability(
                    ctx,
                    run,
                );
                if (block !== null)
                    return retainOperationEffect(ctx, request, pin, {
                        status: "unavailable" as const,
                        reason: block,
                    });
                const requestId = await recordCommandApproval(ctx, {
                    run,
                    action: commandAction,
                    requestedBy: {
                        type: "agent",
                        missionId: mission._id,
                        messageId: message._id,
                    },
                    decidedBy: {
                        type: "visitor",
                        visitorId: mission.ownerVisitorId,
                    },
                });
                const current = await ctx.db.get(run._id);
                if (!current?.fixedFramingRevisionId)
                    throw executionError("run_unavailable");
                return retainOperationEffect(
                    ctx,
                    request,
                    {
                        kind: "workbench_instruction",
                        generation: current.executionGeneration,
                        framingId: current.fixedFramingRevisionId,
                        ...(current.researchControlRevision !== undefined
                            ? {
                                  controlRevision:
                                      current.researchControlRevision,
                              }
                            : {}),
                    },
                    {
                        status: "applied" as const,
                        action: commandAction,
                        requestId,
                    },
                );
            }
            const facts = await readApprovalFacts(ctx, run);
            const pending = facts.pending.find(
                (item) =>
                    item.action === input.action ||
                    item.alternative === input.action,
            );
            if (!pending) {
                const block = await approvalCatalog[input.action].availability(
                    ctx,
                    run,
                );
                if (block !== null)
                    return retainOperationEffect(ctx, request, pin, {
                        status: "unavailable" as const,
                        reason: block,
                    });
            }
            const raised = await raiseApproval(ctx, {
                run,
                action: input.action,
                requestedBy: {
                    type: "agent",
                    missionId: mission._id,
                    messageId: message._id,
                },
            });
            const current = await ctx.db.get(run._id);
            if (!current?.fixedFramingRevisionId)
                throw executionError("run_unavailable");
            return retainOperationEffect(
                ctx,
                request,
                {
                    kind: "workbench_instruction",
                    generation: current.executionGeneration,
                    framingId: current.fixedFramingRevisionId,
                    ...(current.researchControlRevision !== undefined
                        ? { controlRevision: current.researchControlRevision }
                        : {}),
                },
                raised.status === "applied"
                    ? {
                          status: "applied" as const,
                          action: input.action,
                          requestId: raised.requestId,
                      }
                    : {
                          status: "pending" as const,
                          requestId: raised.requestId,
                      },
            );
        }
        if (input.kind === "control_research") {
            const pin = request.pin;
            if (
                pin?.kind !== "workbench_instruction" ||
                pin.generation !== run.executionGeneration ||
                pin.framingId !== run.fixedFramingRevisionId ||
                (pin.controlRevision ?? 0) !==
                    (run.researchControlRevision ?? 0)
            )
                throw executionError("version_conflict");
            const [text] = await readConversationMessages(
                ctx,
                conversation.storageRef,
                [message.storageMessageRef],
            );
            if (!text || explicitResearchControl(text) !== input.action)
                throw executionError("explicit_research_intent_required");
            const generation = await (input.action === "pause"
                ? pauseResearch
                : resumeResearch)(ctx, {
                runId: run._id,
                expectedGeneration: pin.generation,
            });
            const current = await ctx.db.get(run._id);
            const value = {
                generation,
                status: current?.executionStatus,
                pauseRequested: current?.researchPauseRequested ?? false,
            };
            return retainOperationEffect(
                ctx,
                request,
                {
                    kind: "workbench_instruction",
                    generation,
                    framingId: run.fixedFramingRevisionId,
                    controlRevision: current?.researchControlRevision,
                },
                value,
            );
        }
        const pin = request.pin;
        if (
            pin?.kind !== "framing_revision" ||
            pin.revisionId !== run.fixedFramingRevisionId
        )
            throw executionError("version_conflict");
        const existing = await ctx.db
            .query("workbenchInstructions")
            .withIndex("by_request", (q) => q.eq("requestId", request._id))
            .unique();
        if (existing) {
            const value = {
                instructionId: existing._id,
                status: existing.status,
                outcome: existing.outcome,
            };
            return retainOperationEffect(ctx, request, pin, value);
        }
        if (
            !input.interpretedNeed.trim() ||
            input.interpretedNeed.length > 2000
        )
            throw executionError("instruction_capacity");
        const status =
            input.coverageRole || run.sourcesProtocol === "sources_mission_v1"
                ? ("waiting" as const)
                : ("limited" as const);
        const outcome =
            input.coverageRole || run.sourcesProtocol === "sources_mission_v1"
                ? "Your request is recorded. Transmission waits for the applicable documentary phase and remaining capacity."
                : "This request is recorded, but it cannot be executed through the documentary operations currently available. Inspect Sources or refine the request within the current research scope.";
        const id = await ctx.db.insert("workbenchInstructions", {
            runId: run._id,
            requestId: request._id,
            messageId: message._id,
            interpretedNeed: input.interpretedNeed,
            framingRevisionId: run.fixedFramingRevisionId,
            coverageRole: input.coverageRole ?? undefined,
            status,
            outcome,
            createdAt: Date.now(),
        });
        await ctx.db.insert("agentExecutionEvents", {
            runId: run._id,
            missionId: mission._id,
            actor: { type: "agent", missionId: mission._id },
            kind: "analyst_instruction_registered",
            cause: "analyst_conversation",
            requestId: request._id,
            messageId: message._id,
            interpretedNeed: input.interpretedNeed,
            occurredAt: Date.now(),
        });
        if (status === "waiting")
            await ctx.scheduler.runAfter(
                0,
                internal.workbench.processInstructions,
                { runId: run._id },
            );
        const value = {
            instructionId: id,
            status,
            outcome,
        };
        return retainOperationEffect(ctx, request, pin, value);
    },
});

/** Delivers requests through the domain owner under the same native and mission contract. */
export const processInstructions = internalMutation({
    args: { runId: v.id("researchRuns") },
    returns: v.null(),
    handler: processWorkbenchInstructions,
});

/** Keeps a failed native delivery transactional independently from the retained instruction outcome. */
export const deliverSourceInstruction = internalMutation({
    args: { instructionId: v.id("workbenchInstructions") },
    returns: v.object({
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        status: v.string(),
    }),
    handler: async (
        ctx,
        { instructionId },
    ): Promise<{
        preparationId: Id<"sourceSelectionProposalRebuilds">;
        status: string;
    }> => {
        const request = await ctx.db.get(instructionId);
        if (request?.status !== "waiting" || !request.coverageRole)
            throw executionError("instruction_not_authorized");
        const { run, visitor } = await requireDossierAuthority(
            ctx,
            request.runId,
        );
        const revision = run.activeCorpusRevisionId
            ? await ctx.db.get(run.activeCorpusRevisionId)
            : null;
        const proposal = revision?.sourceSelectionProposalId
            ? await ctx.db.get(revision.sourceSelectionProposalId)
            : null;
        if (
            run.lifecycleState !== "awaiting_source_review" ||
            isResumableResearchPause(run) ||
            run.researchPauseRequested ||
            revision?.status !== "draft" ||
            !proposal ||
            run.fixedFramingRevisionId !== request.framingRevisionId
        )
            throw executionError("instruction_not_authorized");
        const result = await startReviewPreparation(ctx, {
            run,
            revision,
            proposal,
            visitor,
            requestId: `instruction:${request._id}`,
            target: { kind: "coverage", role: request.coverageRole },
            documentaryNeed: request.interpretedNeed,
        });
        return { preparationId: result.preparationId, status: result.status };
    },
});
