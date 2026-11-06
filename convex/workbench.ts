import { getAgentDefinition } from "@convex/execution/agentCatalog";
import { reasoningChoices } from "@convex/integrations/modelRouting";
import { api, internal } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import {
    internalMutation,
    mutation,
    type QueryCtx,
    query,
} from "@convex/_generated/server";
import { mergeRunCompanyMetadata } from "@convex/domain/companyMetadata";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import {
    isResumableResearchPause,
    supportsResearchControl,
} from "@convex/domain/transitions";
import { companySnapshotValidator } from "@convex/domain/validators";
import {
    explicitResearchControl,
    workbenchCommand,
    workbenchCommandOutcome,
} from "@convex/domain/workbenchContracts";
import {
    processWorkbenchInstructions,
    readWorkbenchInstructions,
} from "@convex/domain/workbenchInstructions";
import {
    requireDossierAuthority,
    requireMissionAuthority,
} from "@convex/execution/authority";
import {
    analystConversationTurn,
    conversationTurnForAnalyst,
    recordControlExchange,
    requireConversationRequestKey,
    requireInstructionVersion,
} from "@convex/execution/conversations";
import { executionError, executionFailureCode } from "@convex/execution/errors";
import { retainOperationEffect } from "@convex/execution/operations";
import {
    pauseResearch,
    researchControlConfirmation,
    resumeResearch,
} from "@convex/execution/researchControl";
import { readConversationMessages } from "@convex/integrations/agentStorage";
import {
    modelPrepared,
    requireReasoningEffort,
    resolveAgentModel,
} from "@convex/modelConfiguration";
import { reasoningEffort } from "@convex/modelConfigurationSchema";
import { sourceDossierCandidateLimit } from "@convex/resourceLimits";
import { requireWorkspaceRun } from "@convex/runWorkspace";
import schema from "@convex/schema";
import { startReviewPreparation } from "@convex/sourcePreparation";
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
        return recordControlExchange(ctx, conversation, {
            requestKey: args.requestKey,
            contentHash,
            name: args.command,
            expectedGeneration: args.expectedGeneration,
            outcome,
            text,
        });
    },
});

const operationView = v.object({
    id: v.id("agentOperationRequests"),
    title: v.string(),
    status: schema.tables.agentOperationRequests.validator.fields.status,
    succeeded: v.boolean(),
    createdAt: v.number(),
});
const turnView = v.object({
    turn: analystConversationTurn,
    missionStatus: v.optional(v.string()),
    operations: v.array(operationView),
    operationsLimited: v.boolean(),
    deferred: v.optional(v.boolean()),
});
const operationTitles: Record<string, string> = {
    adjust_framing: "Adjust the research program",
    consult_run_state: "Inspect dossier progress",
    consult_mission_state: "Inspect recorded work",
    check_response_coherence: "Check response consistency",
    consult_conversation: "Read earlier conversation",
    search_available_material: "Search retained documentary material",
    read_in_context: "Read a passage in context",
    control_research: "Adjust research progression",
    transmit_source_request: "Transmit an analyst instruction",
};

async function readTurn(ctx: QueryCtx, turn: Doc<"agentConversationTurns">) {
    const mission = turn.missionId ? await ctx.db.get(turn.missionId) : null;
    const requests = mission
        ? await ctx.db
              .query("agentOperationRequests")
              .withIndex("by_mission", (q) => q.eq("missionId", mission._id))
              .order("desc")
              .take(33)
        : [];
    return {
        turn: conversationTurnForAnalyst(turn),
        missionStatus: mission?.status,
        operationsLimited: requests.length > 32,
        operations: requests
            .slice(0, 32)
            .reverse()
            .map((r) => ({
                id: r._id,
                title:
                    operationTitles[r.input.kind] ??
                    "Operation details unavailable",
                status: r.status,
                succeeded: r.outcome?.kind === "success",
                createdAt: r.createdAt,
            })),
    };
}

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

async function sourceCaptureState(ctx: QueryCtx, sourceId: Id<"sources">) {
    const latest = await ctx.db
        .query("sourceCaptures")
        .withIndex("by_source_and_updated_at", (q) =>
            q.eq("sourceId", sourceId),
        )
        .order("desc")
        .first();
    if (!latest)
        return { committed: null, capturing: false, unavailable: false };
    const byStatus = (status: Doc<"sourceCaptures">["status"]) =>
        ctx.db
            .query("sourceCaptures")
            .withIndex("by_source_and_status_and_updated_at", (q) =>
                q.eq("sourceId", sourceId).eq("status", status),
            )
            .order("desc")
            .first();
    const committed =
        latest.status === "committed" ? latest : await byStatus("committed");
    if (committed) return { committed, capturing: false, unavailable: false };
    const capturing =
        latest.status === "reserved" ||
        latest.status === "uploaded" ||
        !!(await byStatus("reserved")) ||
        !!(await byStatus("uploaded"));
    const unavailable =
        latest.status === "unavailable" || !!(await byStatus("unavailable"));
    return { committed: null, capturing, unavailable };
}

export const snapshot = query({
    args: { runId: v.id("researchRuns") },
    returns: v.object({
        run: schema.doc("researchRuns"),
        researchControlAvailable: v.boolean(),
        availableCommands: v.array(workbenchCommand),
        company: v.union(companySnapshotValidator, v.null()),
        framing: v.union(schema.doc("framingRevisions"), v.null()),
        instructions: v.array(
            v.object({
                id: v.id("workbenchInstructions"),
                need: v.string(),
                status: v.string(),
                outcome: v.string(),
            }),
        ),
        activeWork: v.union(turnView, v.null()),
        preparation: v.union(
            schema.doc("sourceSelectionProposalRebuilds"),
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
        const { run } = await requireWorkspaceRun(ctx, runId);
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
        return {
            run,
            researchControlAvailable: supportsResearchControl(run),
            availableCommands:
                workbenchCommandsSupported(conversation) &&
                run.fixedFramingRevisionId &&
                supportsResearchControl(run)
                    ? run.researchPauseRequested ||
                      isResumableResearchPause(run)
                        ? ["/resume" as const]
                        : run.executionStatus === "running"
                          ? ["/pause" as const]
                          : []
                    : [],
            company: company ?? null,
            framing,
            instructions,
            activeWork: turn ? await readTurn(ctx, turn) : null,
            preparation: run.sourcePreparationId
                ? await ctx.db.get(run.sourcePreparationId)
                : null,
            sources,
        };
    },
});

const messageFields = schema.tables.agentMessageDeliveries.validator.pick(
    "runId",
    "turnId",
    "role",
    "delivery",
    "status",
    "createdAt",
    "responseControl",
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
        const texts = await readConversationMessages(
            ctx,
            conversation.storageRef,
            page.page.map((m) => m.storageMessageRef),
        );
        const turns = new Map<
            string,
            Awaited<ReturnType<typeof readTurn>> & { deferred?: boolean }
        >();
        for (const message of page.page)
            if (message.turnId && !turns.has(message.turnId)) {
                const turn = await ctx.db.get(message.turnId);
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
                }
            }
        return {
            ...page,
            page: page.page.map((m, index) => {
                const text = texts[index];
                if (text === undefined)
                    throw new Error("Conversation message unavailable");
                return {
                    _id: m._id,
                    runId: m.runId,
                    turnId: m.turnId,
                    role: m.role,
                    delivery: m.delivery,
                    status: m.status,
                    createdAt: m.createdAt,
                    ...(m.responseControl
                        ? { responseControl: m.responseControl }
                        : {}),
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
