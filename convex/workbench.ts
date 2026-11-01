import { internal } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import {
    internalMutation,
    type QueryCtx,
    query,
} from "@convex/_generated/server";
import { mergeRunCompanyMetadata } from "@convex/domain/companyMetadata";
import { preparationFailureCode } from "@convex/domain/sourcePreparationAuthority";
import { supportsResearchControl } from "@convex/domain/transitions";
import { companySnapshotValidator } from "@convex/domain/validators";
import {
    requireDossierAuthority,
    requireMissionAuthority,
} from "@convex/execution/authority";
import { requireInstructionVersion } from "@convex/execution/conversations";
import { executionError } from "@convex/execution/errors";
import { retainOperationEffect } from "@convex/execution/operations";
import {
    pauseResearch,
    resumeResearch,
} from "@convex/execution/researchControl";
import { readConversationMessages } from "@convex/integrations/agentStorage";
import { sourceDossierCandidateLimit } from "@convex/resourceLimits";
import { requireWorkspaceRun } from "@convex/runWorkspace";
import schema from "@convex/schema";
import { startReviewPreparation } from "@convex/sourcePreparation";
import {
    paginationOptsValidator,
    paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";

const operationView = v.object({
    id: v.id("agentOperationRequests"),
    title: v.string(),
    status: schema.tables.agentOperationRequests.validator.fields.status,
    succeeded: v.boolean(),
    createdAt: v.number(),
});
const turnView = v.object({
    turn: schema.doc("agentConversationTurns"),
    missionStatus: v.optional(v.string()),
    operations: v.array(operationView),
    operationsLimited: v.boolean(),
    deferred: v.optional(v.boolean()),
});
const operationTitles: Record<string, string> = {
    adjust_framing: "Adjust the research program",
    consult_run_state: "Inspect dossier progress",
    consult_mission_state: "Inspect recorded work",
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
        turn,
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
        const requests = await ctx.db
            .query("workbenchInstructions")
            .withIndex("by_run", (q) => q.eq("runId", run._id))
            .order("desc")
            .take(20);
        const instructions = await Promise.all(
            requests.map(async (request) => {
                const preparation = request.preparationId
                    ? await ctx.db.get(request.preparationId)
                    : null;
                const finished =
                    preparation && preparation.status !== "started";
                return {
                    id: request._id,
                    need: request.interpretedNeed,
                    status: finished
                        ? preparation.status === "complete"
                            ? "completed"
                            : "limited"
                        : request.status,
                    outcome: finished
                        ? "This preparation has ended. Inspect Sources for the retained material, limitations and any unfinished work."
                        : request.outcome,
                };
            }),
        );
        return {
            run,
            researchControlAvailable: supportsResearchControl(run),
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
                        turn,
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
        if (input.kind === "control_research") {
            if (request.effect?.outcome.kind === "success")
                return request.effect.outcome.valueJson;
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
            const normalized = text
                ?.trim()
                .toLowerCase()
                .replace(/[.!]+$/g, "")
                .replace(/\s+/g, " ");
            const allowed =
                input.action === "pause"
                    ? /^(please )?(pause|suspend|stop) (the |my |this )?research$|^(mets la recherche en pause|suspends la recherche)$/
                    : /^(please )?(resume|continue) (the |my |this )?research$|^(reprends la recherche|reprendre la recherche)$/;
            if (!normalized || !allowed.test(normalized))
                throw executionError("explicit_research_intent_required");
            const generation = await (input.action === "pause"
                ? pauseResearch
                : resumeResearch)(ctx, {
                runId: run._id,
                expectedGeneration: pin.generation,
            });
            const current = await ctx.db.get(run._id);
            const valueJson = JSON.stringify({
                generation,
                status: current?.executionStatus,
                pauseRequested: current?.researchPauseRequested ?? false,
            });
            await retainOperationEffect(
                ctx,
                request,
                {
                    kind: "workbench_instruction",
                    generation,
                    framingId: run.fixedFramingRevisionId,
                    controlRevision: current?.researchControlRevision,
                },
                valueJson,
            );
            return valueJson;
        }
        const existing = await ctx.db
            .query("workbenchInstructions")
            .withIndex("by_request", (q) => q.eq("requestId", request._id))
            .unique();
        if (existing)
            return JSON.stringify({
                instructionId: existing._id,
                status: existing.status,
                outcome: existing.outcome,
            });
        if (
            !input.interpretedNeed.trim() ||
            input.interpretedNeed.length > 2000
        )
            throw executionError("instruction_capacity");
        const status = input.coverageRole
            ? ("waiting" as const)
            : ("limited" as const);
        const outcome = input.coverageRole
            ? "Your request is recorded. Transmission waits for the applicable documentary phase and remaining capacity."
            : "This request is recorded, but it cannot be executed through the documentary operations currently available. Inspect Sources or refine the request within the current research scope.";
        const id = await ctx.db.insert("workbenchInstructions", {
            runId: run._id,
            requestId: request._id,
            messageId: message._id,
            interpretedNeed: input.interpretedNeed,
            framingRevisionId: run.fixedFramingRevisionId,
            coverageRole: input.coverageRole,
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
        return JSON.stringify({ instructionId: id, status, outcome });
    },
});

/** Delivers one eligible request through the existing targeted-preparation owner and its cumulative allowances. */
export const processInstructions = internalMutation({
    args: { runId: v.id("researchRuns") },
    returns: v.null(),
    handler: async (ctx, { runId }): Promise<null> => {
        const { run } = await requireDossierAuthority(ctx, runId);
        const requests = await ctx.db
            .query("workbenchInstructions")
            .withIndex("by_run_and_status", (q) =>
                q.eq("runId", runId).eq("status", "waiting"),
            )
            .take(20);
        if (
            !requests.length ||
            run.pauseReason === "analyst" ||
            run.researchPauseRequested
        )
            return null;
        if (
            [
                "draft",
                "checking_public_evidence",
                "discovering_sources",
            ].includes(run.lifecycleState)
        )
            return null;
        const preparation = run.sourcePreparationId
            ? await ctx.db.get(run.sourcePreparationId)
            : null;
        if (preparation?.status === "started") return null;
        const revision = run.activeCorpusRevisionId
            ? await ctx.db.get(run.activeCorpusRevisionId)
            : null;
        const proposal = revision?.sourceSelectionProposalId
            ? await ctx.db.get(revision.sourceSelectionProposalId)
            : null;
        for (const request of requests) {
            if (
                run.lifecycleState !== "awaiting_source_review" ||
                revision?.status !== "draft" ||
                !proposal ||
                request.framingRevisionId !== run.fixedFramingRevisionId ||
                !request.coverageRole
            ) {
                await ctx.db.patch(request._id, {
                    status: "limited",
                    outcome:
                        "This request cannot reopen the fixed source set or begin another documentary phase.",
                });
                continue;
            }
            try {
                const result = await ctx.runMutation(
                    internal.workbench.deliverSourceInstruction,
                    { instructionId: request._id },
                );
                await ctx.db.patch(request._id, {
                    status:
                        result.status === "started" ? "transmitted" : "blocked",
                    preparationId: result.preparationId,
                    outcome:
                        result.status === "started"
                            ? "Your request was transmitted to source preparation. Its treatment is still in progress."
                            : "Source preparation cannot perform this request within the remaining allowance. Inspect Sources for the retained work and available recovery.",
                });
                if (result.status === "started") return null;
            } catch (error) {
                const code = preparationFailureCode(error);
                await ctx.db.patch(request._id, {
                    status: "blocked",
                    outcome: code
                        ? "This request could not be transmitted under the current preparation limits. Inspect Sources to continue."
                        : "This request could not be transmitted. Your instruction is retained; inspect Sources before trying again.",
                });
                await ctx.db.insert("agentExecutionEvents", {
                    runId,
                    actor: { type: "system" },
                    kind: "analyst_instruction_blocked",
                    cause: "instruction_delivery",
                    messageId: request.messageId,
                    code: code ?? "instruction_dispatch_failed",
                    occurredAt: Date.now(),
                });
            }
        }
        if (requests.length === 20)
            await ctx.scheduler.runAfter(
                0,
                internal.workbench.processInstructions,
                { runId },
            );
        return null;
    },
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
            run.pauseReason === "analyst" ||
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
