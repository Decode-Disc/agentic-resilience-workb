import type { Doc, Id } from "@convex/_generated/dataModel";
import type { QueryCtx } from "@convex/_generated/server";
import { conversationInstructions } from "@convex/execution/conversations";
import { executionError } from "@convex/execution/errors";
import { stableStringify } from "./sourcePassages";
import {
    explicitFramingPreservation,
    explicitResearchCommand,
} from "./workbenchContracts";

const MAX_AUTHORITY_REVISIONS = 128;
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
