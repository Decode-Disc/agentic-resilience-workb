import { internal } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import type { MutationCtx, QueryCtx } from "@convex/_generated/server";
import { requireDossierAuthority } from "@convex/execution/authority";
import { executionError, executionFailureCode } from "@convex/execution/errors";
import { recordContextObservation } from "@convex/execution/journal";
import { readConversationMessages } from "@convex/integrations/agentStorage";
import { SOURCES_HANDOFF_READ_CAPACITY } from "@convex/resourcePolicy";
import { sha256Hex, stableStringify } from "./sourcePassages";
import { preparationFailureCode } from "./sourcePreparationAuthority";
import { SourceReviewReads } from "./sourceReviewReads";
import {
    assertSourcesCompletionCapacity,
    hasEngagedSourcesControl,
    sourcesInstructionTreatment,
} from "./sources";
import {
    isResumableResearchPause,
    isSourcesSettlementPause,
} from "./transitions";

/** Resolves current treatment separately from the retained transmission receipt. */
export async function readWorkbenchInstructions(
    ctx: QueryCtx,
    runId: Id<"researchRuns">,
) {
    const requests = await ctx.db
        .query("workbenchInstructions")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .order("desc")
        .take(20);
    const preparationIds = [
        ...new Set(
            requests.flatMap((request) =>
                request.preparationId ? [request.preparationId] : [],
            ),
        ),
    ];
    const preparations = new Map(
        preparationIds.map((id) => [id, ctx.db.get(id)] as const),
    );
    return Promise.all(
        requests.map(async (request) => {
            const preparation = request.preparationId
                ? await preparations.get(request.preparationId)
                : null;
            const finished = preparation && preparation.status !== "started";
            const needOutcome = request.needId
                ? preparation?.sourcesMission?.result?.needs.find(
                      (n) => n.needId === request.needId,
                  )
                : undefined;
            const requestFinished = preparation?.sourcesMission
                ? !!needOutcome && needOutcome.unfinished.length === 0
                : preparation?.status === "complete";
            return {
                ...request,
                transmissionStatus: request.status,
                status: finished
                    ? requestFinished
                        ? ("completed" as const)
                        : ("limited" as const)
                    : request.status,
                outcome: finished
                    ? "This preparation has ended. Inspect Sources for the retained material, limitations and any unfinished work."
                    : request.outcome,
            };
        }),
    );
}

/** Model-facing requests preserve actual analyst wording and treatment without persistence metadata. */
export async function projectWorkbenchInstructions(
    ctx: QueryCtx,
    requests: Awaited<ReturnType<typeof readWorkbenchInstructions>>,
    loaded?: Map<Id<"agentMessageDeliveries">, string>,
) {
    const messageIds = [
        ...new Set(requests.map((request) => request.messageId)),
    ];
    const messages = await Promise.all(messageIds.map((id) => ctx.db.get(id)));
    const texts = new Map<Id<"agentMessageDeliveries">, string>();
    const conversationIds = [
        ...new Set(
            messages.flatMap((message) =>
                message ? [message.conversationId] : [],
            ),
        ),
    ];
    for (const conversationId of conversationIds) {
        const conversation = await ctx.db.get(conversationId);
        if (!conversation)
            throw executionError("conversation_message_unavailable");
        const group = messages.filter(
            (message) => message?.conversationId === conversationId,
        );
        const selected = group.flatMap((message) => (message ? [message] : []));
        if (
            selected.some(
                (message) =>
                    message.role !== "user" ||
                    message.runId !== conversation.runId ||
                    !requests.some(
                        (request) =>
                            request.messageId === message._id &&
                            request.runId === conversation.runId,
                    ),
            )
        )
            throw executionError("conversation_message_unavailable");
        const original = await readConversationMessages(
            ctx,
            conversation.storageRef,
            selected,
            loaded,
        );
        selected.forEach((message, index) => {
            const text = original[index];
            if (text === undefined)
                throw executionError("conversation_message_unavailable");
            texts.set(message._id, text);
        });
    }
    return requests.map((request) => {
        const originalText = texts.get(request.messageId);
        if (originalText === undefined)
            throw executionError("conversation_message_unavailable");
        return {
            instructionId: request._id,
            messageId: request.messageId,
            originalText,
            interpretedNeed: request.interpretedNeed,
            target: request.target ?? null,
            needId: request.needId ?? null,
            preparationId: request.preparationId ?? null,
            framingRevisionId: request.framingRevisionId,
            status: request.status,
            transmissionStatus: request.transmissionStatus,
            outcome: request.outcome,
        };
    });
}

/** A registered request must receive an outcome before preparation can close. */
export async function hasWaitingWorkbenchInstructions(
    ctx: QueryCtx,
    runId: Id<"researchRuns">,
) {
    return !!(await ctx.db
        .query("workbenchInstructions")
        .withIndex("by_run_and_status", (q) =>
            q.eq("runId", runId).eq("status", "waiting"),
        )
        .first());
}

/** Treatment changes and their observed result commit together, independently of the original transmission. */
async function updateInstructionTreatment(
    ctx: MutationCtx,
    request: Doc<"workbenchInstructions">,
    patch: Pick<Doc<"workbenchInstructions">, "status" | "outcome"> &
        Partial<Pick<Doc<"workbenchInstructions">, "preparationId" | "needId">>,
) {
    await ctx.db.patch(request._id, patch);
    const value = {
        event: "instruction_treatment_changed",
        instructionId: request._id,
        messageId: request.messageId,
        interpretedNeed: request.interpretedNeed,
        status: patch.status,
        outcome: patch.outcome,
        preparationId: patch.preparationId ?? request.preparationId ?? null,
        needId: patch.needId ?? request.needId ?? null,
    };
    await recordContextObservation(ctx, request.runId, {
        key: `instruction-treatment:${request._id}:${sha256Hex(stableStringify(value))}`,
        topic: "analyst_request",
        actor: { type: "system" },
        value,
    });
}

/** Delivers bounded instruction batches while preserving admitted material and individual outcomes. */
export async function processWorkbenchInstructions(
    ctx: MutationCtx,
    { runId }: { runId: Id<"researchRuns"> },
    sharedReads?: SourceReviewReads,
): Promise<null> {
    const { run } = await requireDossierAuthority(ctx, runId);
    const requests = await ctx.db
        .query("workbenchInstructions")
        .withIndex("by_run_and_status", (q) =>
            q.eq("runId", runId).eq("status", "waiting"),
        )
        .take(20);
    if (!requests.length) return null;
    const preparation = run.sourcePreparationId
        ? await ctx.db.get(run.sourcePreparationId)
        : null;
    const settling =
        isSourcesSettlementPause(run) &&
        preparation?.settlementRequestedAt !== undefined;
    if (
        (isResumableResearchPause(run) || run.researchPauseRequested) &&
        !settling
    )
        return null;
    if (run.sourcesProtocol === "sources_mission_v1") {
        let data =
            preparation?.runId === run._id
                ? preparation.sourcesMission
                : undefined;
        if (
            !data &&
            [
                "draft",
                "checking_public_evidence",
                "discovering_sources",
            ].includes(run.lifecycleState)
        )
            return null;
        const reads =
            sharedReads ??
            new SourceReviewReads(
                ctx.db,
                run._id,
                SOURCES_HANDOFF_READ_CAPACITY,
            );
        const controlEngaged =
            preparation?.status === "started" &&
            data &&
            !data.result &&
            (await hasEngagedSourcesControl(reads, data));
        const framing = run.fixedFramingRevisionId
            ? await ctx.db.get(run.fixedFramingRevisionId)
            : null;
        for (const request of requests) {
            const target = request.target;
            if (request.framingRevisionId !== run.fixedFramingRevisionId) {
                await updateInstructionTreatment(ctx, request, {
                    status: "limited",
                    outcome:
                        "This request refers to an earlier framing and cannot change the fixed research program.",
                });
                continue;
            }
            if (target?.kind === "existing_need") {
                const need = data?.needs.find(({ id }) => id === target.needId);
                if (!preparation || !need) {
                    await updateInstructionTreatment(ctx, request, {
                        status: "limited",
                        outcome:
                            "That documentary need is unavailable in the current preparation.",
                    });
                    continue;
                }
                const saved = data?.result?.needs.find(
                    ({ needId }) => needId === need.id,
                );
                const ended =
                    preparation.status !== "started" || !!data?.result;
                await updateInstructionTreatment(ctx, request, {
                    status:
                        ended && (!saved || saved.unfinished.length)
                            ? "limited"
                            : "transmitted",
                    preparationId: preparation._id,
                    needId: need.id,
                    outcome: ended
                        ? "Your request refers to existing Sources work. Inspect its recorded material and limitations."
                        : "Sources already has this check in its preparation.",
                });
                continue;
            }
            if (controlEngaged) continue;
            const questionId =
                target?.kind === "new_need" ? target.questionId : undefined;
            if (
                questionId !== undefined &&
                !framing?.content.questions.some(({ id }) => id === questionId)
            ) {
                await updateInstructionTreatment(ctx, request, {
                    status: "limited",
                    outcome:
                        "That question is outside the fixed research program.",
                });
                continue;
            }
            if (settling) {
                await updateInstructionTreatment(ctx, request, {
                    status: "limited",
                    outcome:
                        "You chose to use what's prepared. This request was not carried out before preparation ended.",
                });
                continue;
            }
            const treatment = sourcesInstructionTreatment(
                preparation
                    ? { status: preparation.status, sourcesMission: data }
                    : null,
            );
            if (!preparation || !data || treatment.status !== "open") {
                await updateInstructionTreatment(ctx, request, {
                    status: "limited",
                    outcome: treatment.description,
                });
                continue;
            }
            const needId = `instruction:${request._id}`;
            const proposed = {
                ...data,
                needsRevision: data.needsRevision + 1,
                needs: [
                    ...data.needs,
                    {
                        id: needId,
                        version: 1,
                        information: request.interpretedNeed,
                        questionIds:
                            questionId === undefined ? [] : [questionId],
                        commonContext: false,
                    },
                ],
            };
            try {
                await assertSourcesCompletionCapacity(
                    reads,
                    preparation,
                    proposed,
                    null,
                    request.requestId,
                );
            } catch (error) {
                const code =
                    executionFailureCode(error) ??
                    preparationFailureCode(error);
                if (
                    code !== "sources_result_capacity" &&
                    code !== "source_review_capacity"
                )
                    throw error;
                await updateInstructionTreatment(ctx, request, {
                    status: "limited",
                    outcome:
                        "Your request exceeds the remaining preparation capacity. The material already prepared remains available. Refine the request to continue.",
                });
                continue;
            }
            data = proposed;
            await updateInstructionTreatment(ctx, request, {
                status: "transmitted",
                preparationId: preparation._id,
                needId,
                outcome:
                    "Your request was transmitted to Sources. Its treatment is still in progress.",
            });
        }
        if (preparation && data && data !== preparation.sourcesMission)
            await ctx.db.patch(preparation._id, { sourcesMission: data });
        return null;
    }
    for (const request of requests) {
        await updateInstructionTreatment(ctx, request, {
            status: "limited",
            outcome:
                "This request cannot reopen the fixed source set or begin another documentary phase.",
        });
    }
    if (requests.length === 20)
        await ctx.scheduler.runAfter(
            0,
            internal.workbench.processInstructions,
            { runId },
        );
    return null;
}
