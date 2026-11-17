import type { Doc, Id } from "@convex/_generated/dataModel";
import type { QueryCtx } from "@convex/_generated/server";
import { researchSlotBlock } from "@convex/execution/authority";
import { conversationInstructions } from "@convex/execution/conversations";
import { executionError } from "@convex/execution/errors";
import { sourcePreparationWindowMs } from "@convex/resourceLimits";
import {
    MAX_ANALYSES_PER_VISITOR,
    MAX_FRAMING_AUTHORITY_REVISIONS as MAX_AUTHORITY_REVISIONS,
} from "@convex/resourcePolicy";
import {
    sourcesQualificationEnabled,
    sourcesQualificationEnvelope,
} from "@convex/sourcesSimulation";
import { stableStringify } from "./sourcePassages";
import {
    activatedSourcesEnvelope,
    documentaryQuestionCapacity,
} from "./sources";
import {
    explicitFramingPreservation,
    explicitResearchCommand,
} from "./workbenchContracts";

type Content = Doc<"framingRevisions">["content"];

/** A retry may observe newer framing without renewing the original message's edit authority. */
export async function requireFramingEditAuthority(
    ctx: QueryCtx,
    mission: Doc<"agentMissions">,
    args: {
        messageId: Id<"agentMessageDeliveries"> | undefined;
        proposed: Content;
    },
): Promise<void> {
    const message = args.messageId ? await ctx.db.get(args.messageId) : null;
    if (
        !message ||
        message.runId !== mission.runId ||
        message.turnId !== mission.conversationTurnId ||
        message.role !== "user" ||
        message.status !== "active"
    )
        throw executionError("instruction_not_authorized");
    const instructions = await conversationInstructions(ctx, mission);
    const selected = instructions?.messages.find(
        (instruction) => instruction.messageId === message._id,
    );
    if (!selected) throw executionError("instruction_not_authorized");
    if (
        explicitResearchCommand(selected.text) ||
        instructions?.messages.some((instruction) =>
            explicitFramingPreservation(instruction.text),
        )
    )
        throw executionError("framing_read_only");
    const base = message.framingBaseRevisionId
        ? await ctx.db.get(message.framingBaseRevisionId)
        : null;
    const run = await ctx.db.get(mission.runId);
    const current = run?.currentFramingRevisionId
        ? await ctx.db.get(run.currentFramingRevisionId)
        : null;
    if (
        !base ||
        !current ||
        base.runId !== mission.runId ||
        current.runId !== mission.runId ||
        base.revision > current.revision
    )
        throw executionError("framing_authority_unavailable");
    const revisions = await ctx.db
        .query("framingRevisions")
        .withIndex("by_run_and_revision", (q) =>
            q
                .eq("runId", mission.runId)
                .gt("revision", base.revision)
                .lte("revision", current.revision),
        )
        .take(MAX_AUTHORITY_REVISIONS + 1);
    if (revisions.length > MAX_AUTHORITY_REVISIONS)
        throw executionError("framing_authority_capacity");
    if (revisions.length !== current.revision - base.revision)
        throw executionError("framing_authority_unavailable");

    let scopeProtected = false;
    let orderProtected = false;
    const protectedQuestions = new Set<string>();
    let previous = base;
    for (const revision of revisions) {
        if (revision.revision !== previous.revision + 1)
            throw executionError("framing_authority_unavailable");
        if (revision.origin === "analyst") {
            scopeProtected ||=
                previous.content.scope !== revision.content.scope;
            const before = new Map(
                previous.content.questions.map((question) => [
                    question.id,
                    question,
                ]),
            );
            const after = new Map(
                revision.content.questions.map((question) => [
                    question.id,
                    question,
                ]),
            );
            for (const id of new Set([...before.keys(), ...after.keys()]))
                if (
                    stableStringify(before.get(id) ?? null) !==
                    stableStringify(after.get(id) ?? null)
                )
                    protectedQuestions.add(id);
            orderProtected ||=
                stableStringify([...before.keys()]) !==
                stableStringify([...after.keys()]);
        }
        previous = revision;
    }
    const latest = new Map(
        current.content.questions.map((question) => [question.id, question]),
    );
    const proposed = new Map(
        args.proposed.questions.map((question) => [question.id, question]),
    );
    const questionConflict = [...protectedQuestions].some(
        (id) =>
            stableStringify(latest.get(id) ?? null) !==
            stableStringify(proposed.get(id) ?? null),
    );
    const orderConflict =
        orderProtected &&
        stableStringify([...latest.keys()].filter((id) => proposed.has(id))) !==
            stableStringify(
                [...proposed.keys()].filter((id) => latest.has(id)),
            );
    if (
        (scopeProtected && current.content.scope !== args.proposed.scope) ||
        questionConflict ||
        orderConflict
    )
        throw executionError("framing_analyst_conflict");
}

/** Shared Start admission: presentation reports the same unmet prerequisite as execution. */
export async function researchStartBlock(
    ctx: QueryCtx,
    run: Doc<"researchRuns">,
    framing: Doc<"framingRevisions"> | null,
    visitor: Doc<"visitors">,
) {
    if (
        run.researchStartRequestKey ||
        run.researchStartedAt ||
        run.fixedFramingRevisionId
    )
        return "research_already_started";
    if (
        run.startMode !== "framed" ||
        run.lifecycleState !== "framing" ||
        run.executionStatus !== "idle"
    )
        return "framing_fixed";
    if (!framing?.content.scope.trim() || !framing.content.questions.length)
        return "framing_invalid";
    const qualification = await sourcesQualificationEnabled(ctx, run);
    if (!qualification && visitor.analysesReserved >= MAX_ANALYSES_PER_VISITOR)
        return "analysis_limit_reached";
    const capacity = await researchQuestionCapacity(ctx, run);
    if (capacity === null) return "sources_configuration_unavailable";
    if (framing.content.questions.length > capacity)
        return "sources_need_capacity";
    return researchSlotBlock(ctx, visitor._id);
}

/**
 * Research questions the envelope a Start would pin can prepare, while framing is open. Null otherwise or while documentary
 * preparation is unavailable: research runs only through the Sources mission, with no corpus-approval fallback.
 */
export async function researchQuestionCapacity(
    ctx: QueryCtx,
    run: Doc<"researchRuns">,
) {
    if (run.lifecycleState !== "framing" || run.fixedFramingRevisionId)
        return null;
    try {
        sourcePreparationWindowMs();
    } catch {
        return null;
    }
    const envelope =
        (await sourcesQualificationEnvelope(ctx, run)) ??
        activatedSourcesEnvelope();
    const capacity = envelope ? documentaryQuestionCapacity(envelope) : 0;
    return capacity > 0 ? capacity : null;
}
