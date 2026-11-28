import type { Doc, Id } from "@convex/_generated/dataModel";
import type { MutationCtx } from "@convex/_generated/server";
import {
    FRAMING_RECEIPT_OPERATION_VERSION,
    type framingContentValidator,
    framingRevisionResult,
} from "@convex/domain/framingContracts";
import {
    requireFramingEditAuthority,
    researchQuestionCapacity,
} from "@convex/domain/framingEditAuthority";
import {
    companyProvisionalProgram,
    framingBasisAfterEdit,
    prepareProvisionalFraming,
    requireFramingDocumentaryFields,
    savedFramingReceipt,
    validateFramingPublicBasis,
} from "@convex/domain/framingProvenance";
import { MAX_RESEARCH_PLAN_QUESTIONS } from "@convex/domain/researchPlan";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import {
    supportsDirectedFraming,
    supportsFramingContractCorrections,
} from "@convex/domain/workbenchContracts";
import {
    requireDossierAuthority,
    requireMissionAuthority,
} from "@convex/execution/authority";
import {
    conversationInstructions,
    requireInstructionVersion,
} from "@convex/execution/conversationCore";
import { executionError } from "@convex/execution/errors";
import { recordContextObservation } from "@convex/execution/journal";
import {
    prepareOperationEffect,
    retainOperationEffect,
} from "@convex/execution/operations";
import { turnFramingCitationPolicy } from "@convex/framingCitationPolicyCore";
import type { Infer } from "convex/values";
import { validate } from "convex-helpers/validators";

export function validateFramingRequestKey(key: string) {
    if (!/^[a-zA-Z0-9._:-]{1,120}$/.test(key))
        throw executionError("invalid_request_key");
}

type FramingSave = {
    runId: Id<"researchRuns">;
    expectedRevision: number;
    requestKey: string;
    content: Infer<typeof framingContentValidator>;
    eventBasis?: Doc<"framingRevisions">["eventBasis"];
};

async function prepareFramingSave(ctx: MutationCtx, args: FramingSave) {
    const { run } = await requireDossierAuthority(ctx, args.runId);
    if (run.startMode !== "framed" || run.lifecycleState !== "framing")
        throw executionError("framing_fixed");
    validateFramingRequestKey(args.requestKey);
    const content = args.content;
    if (
        content.questions.length > MAX_RESEARCH_PLAN_QUESTIONS ||
        new TextEncoder().encode(stableStringify(content)).length > 65536 ||
        content.questions.some(
            (q) =>
                !q.id.trim() ||
                !q.text.trim() ||
                !q.rationale.trim() ||
                !q.shortLabel.trim(),
        ) ||
        new Set(content.questions.map((q) => q.id)).size !==
            content.questions.length
    )
        throw executionError("framing_invalid");
    const previous = await ctx.db
        .query("framingRevisions")
        .withIndex("by_run_and_key", (q) =>
            q.eq("runId", run._id).eq("requestKey", args.requestKey),
        )
        .unique();
    const current = run.currentFramingRevisionId
        ? await ctx.db.get(run.currentFramingRevisionId)
        : null;
    const baseline = previous ?? current;
    const eventBasis =
        args.eventBasis ??
        (baseline ? framingBasisAfterEdit(baseline, content) : undefined);
    const hash = sha256Hex(
        stableStringify(eventBasis ? { content, eventBasis } : content),
    );
    if (previous) {
        if (previous.contentHash !== hash)
            throw executionError("framing_identity_conflict");
        return { kind: "retained" as const, revision: previous.revision };
    }
    if (!current || current.revision !== args.expectedRevision)
        throw executionError("framing_version_conflict");
    // Only growth is refused, so a draft left over capacity by a configuration change can still be reworded or reduced.
    if (content.questions.length > current.content.questions.length) {
        const capacity = await researchQuestionCapacity(ctx, run);
        if (capacity !== null && content.questions.length > capacity)
            throw executionError("framing_question_capacity", [
                {
                    path: "content.questions",
                    expected: `At most ${capacity} research question${capacity === 1 ? "" : "s"}; documentary preparation cannot take on more in this workspace.`,
                },
            ]);
    }
    return {
        kind: "ready" as const,
        run,
        previousRevision: current.revision,
        draft: {
            runId: run._id,
            revision: current.revision + 1,
            content,
            eventBasis,
            contentHash: hash,
            requestKey: args.requestKey,
        },
    };
}

async function persistFramingSave(
    ctx: MutationCtx,
    prepared: Extract<
        Awaited<ReturnType<typeof prepareFramingSave>>,
        { kind: "ready" }
    >,
    origin: "analyst" | "workbench",
    actor?: Doc<"agentExecutionEvents">["actor"],
) {
    const { run, draft, previousRevision } = prepared;
    const { revision, content, eventBasis } = draft;
    const id = await ctx.db.insert("framingRevisions", {
        ...draft,
        origin,
        createdAt: Date.now(),
    });
    await ctx.db.patch(run._id, {
        currentFramingRevisionId: id,
        updatedAt: Date.now(),
    });
    await recordContextObservation(ctx, run._id, {
        key: `framing:${id}`,
        topic: "framing",
        actor:
            actor ??
            (origin === "analyst" && run.ownerVisitorId
                ? { type: "visitor", visitorId: run.ownerVisitorId }
                : { type: "system" }),
        value: {
            revision,
            previousRevision,
            origin,
            content,
            ...(eventBasis ? { eventBasis } : {}),
            fixed: false,
        },
    });
    if (origin === "analyst") {
        const conversation = await ctx.db
            .query("agentConversations")
            .withIndex("by_run", (q) => q.eq("runId", run._id))
            .unique();
        const turn = conversation?.activeTurnId
            ? await ctx.db.get(conversation.activeTurnId)
            : null;
        if (turn?.status === "active")
            await ctx.db.patch(turn._id, {
                instructionVersion: turn.instructionVersion + 1,
            });
    }
    return id;
}

/** Persists a single versioned draft for direct analyst edits. */
export async function saveFraming(
    ctx: MutationCtx,
    args: FramingSave,
    origin: "analyst" | "workbench",
    actor?: Doc<"agentExecutionEvents">["actor"],
): Promise<number> {
    const prepared = await prepareFramingSave(ctx, args);
    if (prepared.kind === "retained") return prepared.revision;
    await persistFramingSave(ctx, prepared, origin, actor);
    return prepared.draft.revision;
}

type WorkbenchFramingScope = {
    requestId: Id<"agentOperationRequests">;
    expectedGeneration: number;
};

/** Resolves authorization, framing validation and receipt capacity before a Workbench write. */
export async function prepareWorkbenchFraming(
    ctx: MutationCtx,
    args: WorkbenchFramingScope,
) {
    const request = await ctx.db.get(args.requestId);
    if (!request?.missionId || request.input.kind !== "adjust_framing")
        throw executionError("operation_not_allowed");
    const { mission, run } = await requireMissionAuthority(
        ctx,
        request.missionId,
        args.expectedGeneration,
    );
    if (mission.definitionId !== "workbench_v1")
        throw executionError("operation_not_allowed");
    await requireInstructionVersion(ctx, mission, request.instructionVersion);
    const citationPolicy = await turnFramingCitationPolicy(ctx, mission);
    const reportsCitations =
        request.operationVersion === FRAMING_RECEIPT_OPERATION_VERSION;
    if (request.effect?.outcome.kind === "success") {
        const { valueJson } = request.effect.outcome;
        if (reportsCitations)
            return { kind: "retained" as const, result: valueJson };
        const retained: unknown = JSON.parse(valueJson);
        if (!validate(framingRevisionResult, retained))
            throw executionError("operation_result_conflict");
        return { kind: "retained" as const, result: retained.revision };
    }
    const currentRevision = run.currentFramingRevisionId
        ? await ctx.db.get(run.currentFramingRevisionId)
        : null;
    if (
        !currentRevision ||
        currentRevision.revision !== request.input.expectedRevision
    )
        throw executionError("framing_version_conflict");
    const { messageId: causingMessageId } = request.input;
    let { content, eventBasis: proposedBasis } = request.input;
    if (
        !proposedBasis &&
        currentRevision.eventBasis?.kind === "open" &&
        currentRevision.content.scope === content.scope
    )
        proposedBasis = currentRevision.eventBasis;
    if (
        supportsDirectedFraming(mission.definitionVersion) &&
        proposedBasis?.kind === "open" &&
        proposedBasis.activityExcerpt === undefined &&
        proposedBasis.conditions === undefined &&
        currentRevision.content.scope.trim()
    ) {
        if (
            currentRevision.eventBasis?.kind !== "open" ||
            stableStringify(currentRevision.content) !==
                stableStringify(content)
        )
            throw executionError("framing_open_preserve_program");
        proposedBasis = currentRevision.eventBasis;
    }
    if (
        proposedBasis?.kind === "open" &&
        !supportsDirectedFraming(mission.definitionVersion) &&
        (proposedBasis.activityExcerpt !== undefined ||
            proposedBasis.conditions !== undefined)
    )
        throw executionError("framing_event_basis_invalid");
    if (
        proposedBasis?.kind === "open" &&
        supportsDirectedFraming(mission.definitionVersion) &&
        (supportsFramingContractCorrections(mission.definitionVersion) ||
            proposedBasis.activityExcerpt !== undefined ||
            proposedBasis.conditions !== undefined ||
            currentRevision.content.scope.trim())
    ) {
        const prepared = await prepareProvisionalFraming(ctx, {
            basis: proposedBasis,
            content,
            current: currentRevision,
            mission,
            request,
            messageId: causingMessageId,
            citationPolicy,
        });
        content = prepared.content;
        proposedBasis = prepared.basis;
    } else if (proposedBasis?.kind === "open") {
        if (
            currentRevision.origin !== "initial" &&
            (currentRevision.origin !== "workbench" ||
                currentRevision.eventBasis?.kind !== "open")
        )
            throw executionError("framing_open_preserve_program");
        // The proposed wording may already assume an answer to the clarification.
        const company =
            run.companySnapshot?.legalName ?? "the selected company";
        content = companyProvisionalProgram(company);
    }
    if (request.operationVersion === 2 || reportsCitations)
        await requireFramingEditAuthority(ctx, mission, {
            messageId: causingMessageId,
            proposed: content,
        });
    if (
        !proposedBasis &&
        request.input.eventBasisRequired &&
        currentRevision.content.scope !== content.scope
    )
        throw executionError("framing_event_basis_required");
    let eventBasis: Doc<"framingRevisions">["eventBasis"];
    if (proposedBasis?.kind === "analyst") {
        const instructions = await conversationInstructions(ctx, mission);
        const message = instructions?.messages.find(
            ({ messageId }) => messageId === causingMessageId,
        );
        if (
            !message ||
            !proposedBasis.excerpt.trim() ||
            !message.text.includes(proposedBasis.excerpt)
        )
            throw executionError("framing_event_basis_invalid", [
                {
                    path: "eventBasis.excerpt",
                    expected:
                        "Copy a nonblank exact excerpt identifying the event from the active analyst message; otherwise keep the event open or use adopted public readings.",
                },
            ]);
        eventBasis = { ...proposedBasis, messageId: message.messageId };
    } else if (proposedBasis?.kind === "public") {
        eventBasis = await validateFramingPublicBasis(ctx, {
            basis: proposedBasis,
            current: currentRevision,
            scope: content.scope,
            mission,
            request,
            messageId: causingMessageId,
            citationPolicy,
        });
    } else {
        eventBasis = proposedBasis;
    }
    if (reportsCitations) requireFramingDocumentaryFields(content);
    const prepared = await prepareFramingSave(ctx, {
        runId: mission.runId,
        expectedRevision: request.input.expectedRevision,
        requestKey: `operation:${request._id}`,
        content,
        eventBasis,
    });
    if (prepared.kind !== "ready")
        throw executionError("operation_result_conflict");
    const value = reportsCitations
        ? savedFramingReceipt(prepared.draft)
        : { revision: prepared.draft.revision };
    await prepareOperationEffect(ctx, request, value);
    return {
        kind: "ready" as const,
        prepared,
        missionId: mission._id,
        request,
        value,
        reportsCitations,
    };
}

export async function persistWorkbenchFraming(
    ctx: MutationCtx,
    state: Awaited<ReturnType<typeof prepareWorkbenchFraming>>,
): Promise<number | string> {
    if (state.kind === "retained") return state.result;
    const { prepared, missionId, request, value, reportsCitations } = state;
    const revisionId = await persistFramingSave(ctx, prepared, "workbench", {
        type: "agent",
        missionId,
    });
    const valueJson = await retainOperationEffect(
        ctx,
        request,
        { kind: "framing_revision", revisionId },
        value,
    );
    return reportsCitations ? valueJson : prepared.draft.revision;
}

/** Applies a retained Workbench framing request inside the caller's transaction. */
export async function applyFromWorkbenchInTx(
    ctx: MutationCtx,
    args: WorkbenchFramingScope,
) {
    return persistWorkbenchFraming(
        ctx,
        await prepareWorkbenchFraming(ctx, args),
    );
}
