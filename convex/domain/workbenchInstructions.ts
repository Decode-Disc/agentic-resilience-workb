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
import { isResumableResearchPause } from "./transitions";

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
            selected.map((message) => message.storageMessageRef),
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
    if (
        !requests.length ||
        isResumableResearchPause(run) ||
        run.researchPauseRequested
    )
        return null;
    if (run.sourcesProtocol === "sources_mission_v1") {
        const preparation = run.sourcePreparationId
            ? await ctx.db.get(run.sourcePreparationId)
            : null;
        let data = preparation?.sourcesMission;
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
        if (
            preparation?.status === "started" &&
            data &&
            !data.result &&
            (await hasEngagedSourcesControl(reads, data))
        )
            return null;
        for (const request of requests) {
            const treatment = sourcesInstructionTreatment(
                preparation
                    ? { status: preparation.status, sourcesMission: data }
                    : null,
            );
            if (
                !preparation ||
                !data ||
                treatment.status !== "open" ||
                request.framingRevisionId !== run.fixedFramingRevisionId
            ) {
                await updateInstructionTreatment(ctx, request, {
                    status: "limited",
                    outcome:
                        treatment.status !== "open"
                            ? treatment.description
                            : "This request refers to an earlier research framing and cannot change the fixed research program.",
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
                        questionIds: [],
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
                    code !== "sources_response_capacity" &&
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
    if (
        ["draft", "checking_public_evidence", "discovering_sources"].includes(
            run.lifecycleState,
        )
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
            await updateInstructionTreatment(ctx, request, {
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
            await updateInstructionTreatment(ctx, request, {
                status: result.status === "started" ? "transmitted" : "blocked",
                preparationId: result.preparationId,
                outcome:
                    result.status === "started"
                        ? "Your request was transmitted to source preparation. Its treatment is still in progress."
                        : "Source preparation cannot perform this request within the remaining allowance. Inspect Sources for the retained work and available recovery.",
            });
            if (result.status === "started") return null;
        } catch (error) {
            const code = preparationFailureCode(error);
            if (!code) throw error;
            await updateInstructionTreatment(ctx, request, {
                status: "blocked",
                outcome:
                    "This request could not be transmitted under the current preparation limits. Inspect Sources to continue.",
            });
            await ctx.db.insert("agentExecutionEvents", {
                runId,
                actor: { type: "system" },
                kind: "analyst_instruction_blocked",
                cause: "instruction_delivery",
                messageId: request.messageId,
                code,
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
}
