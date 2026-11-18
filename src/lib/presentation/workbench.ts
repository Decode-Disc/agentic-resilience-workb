import type { api } from "@convex/_generated/api";
import { agentName } from "@convex/domain/agentIdentities";
import type { FunctionReturnType } from "convex/server";
import type { ConversationWorkItem } from "@/components/chat/conversation-activity";
import type { ConversationTurnSnapshot } from "@/components/chat/conversation-turn";

type Work = NonNullable<
    FunctionReturnType<typeof api.workbench.snapshot>["activeWork"]
>;
/** One operation projection supplies both conversational turns and independent research missions. */
export function conversationOperation(
    operation: Work["operations"][number],
    parentState: ConversationWorkItem["state"],
): ConversationWorkItem {
    return {
        id: operation.id,
        title: operation.title,
        state:
            operation.status === "completed"
                ? operation.succeeded
                    ? "completed"
                    : "interrupted"
                : parentState === "interrupted" ||
                    parentState === "blocked" ||
                    parentState === "paused"
                  ? parentState
                  : operation.status === "waiting"
                    ? "waiting"
                    : "running",
        summary: [operation.subject, operation.summary]
            .filter(Boolean)
            .join(" · "),
    };
}
/** Translates persisted execution state into public work snapshots without exposing diagnostic keys. */
export function workbenchTurn(work: Work): ConversationTurnSnapshot {
    const state =
        work.turn.status === "published"
            ? "completed"
            : work.turn.status === "interrupted" ||
                work.turn.status === "cancelled"
              ? "interrupted"
              : work.missionStatus === "blocked"
                ? "blocked"
                : work.missionStatus === "waiting"
                  ? "waiting"
                  : "running";
    const operations = work.operations.map((operation) => ({
        kind: "operation" as const,
        operation: conversationOperation(operation, state),
    }));
    return {
        id: work.turn._id,
        agentId: "workbench",
        state,
        startedAt: new Date(work.turn.createdAt).toISOString(),
        finishedAt: work.turn.completedAt
            ? new Date(work.turn.completedAt).toISOString()
            : undefined,
        entries: [
            ...operations,
            ...(work.turn.publishedMessageId
                ? [
                      {
                          kind: "message" as const,
                          id: `reply:${work.turn._id}`,
                          phase: "answer" as const,
                      },
                  ]
                : work.turn.preview
                  ? [
                        {
                            kind: "message" as const,
                            id: `reply:${work.turn._id}`,
                            phase: "answer" as const,
                        },
                    ]
                  : []),
        ],
    };
}
export function workbenchFailureCopy(code?: string) {
    if (code === "definition_version_conflict")
        return "This conversation was started with an earlier version of the Workbench and cannot continue. Its messages remain readable. Start a new dossier to keep working with the Workbench.";
    if (code === "native_settlement_incomplete")
        return "This conversation requires recovery before another response can begin. Your messages and recorded work remain available. You can continue editing the research program directly.";
    if (code === "pi_storage_capacity" || code === "pi_commit_capacity")
        return "This conversation has reached its storage limit. Your messages and recorded work remain available in the dossier.";
    if (
        code === "missing_authorized_route" ||
        code === "configuration_unavailable" ||
        code === "paid_work_disabled"
    )
        return `The ${agentName("workbench")} cannot respond right now. Your dossier and messages are saved; send your message again later.`;
    if (
        code === "execution_deadline" ||
        code?.includes("budget") ||
        code === "context_capacity"
    )
        return "This response reached its preparation limit. Your program and recorded work remain available. Send a narrower request to continue.";
    return "This response could not finish. Your messages and recorded work remain available. Send another message to continue.";
}

const plural = (count: number, noun: string) =>
    `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * The research program's limits as the analyst reads them, from the server's Start admission. Start is offered
 * only when the server would accept it; each refusal names what the analyst can do next.
 */
export function researchProgramReadiness(
    researchStart: FunctionReturnType<
        typeof api.workbench.snapshot
    >["researchStart"],
    questionCount: number,
) {
    const capacity = researchStart.questionCapacity ?? undefined;
    return {
        questionLimit: capacity,
        addUnavailable:
            capacity !== undefined && questionCount >= capacity
                ? questionCapacityCopy(capacity)
                : undefined,
        startUnavailable: researchStartRefusalCopy(
            researchStart.block,
            capacity === undefined
                ? undefined
                : { capacity, excess: questionCount - capacity },
        ),
    };
}

/** Why a new question cannot be added; shared by the disabled control and a refused save. */
export function questionCapacityCopy(capacity: number) {
    return `This workspace can prepare sources for up to ${plural(capacity, "research question")}. Edit a question to change focus.`;
}

/** Why Start cannot proceed, for the disabled control and for a refusal that raced it. Undefined when Start is available or no longer applies. */
export function researchStartRefusalCopy(
    code: string | null | undefined,
    capacity?: { capacity: number; excess: number },
) {
    if (
        !code ||
        code === "research_already_started" ||
        code === "framing_fixed"
    )
        return undefined;
    if (code === "framing_invalid")
        return "Add a research scope and at least one research question to start.";
    if (code === "sources_need_capacity")
        return capacity && capacity.excess > 0
            ? `Remove ${plural(capacity.excess, "question")} to start. Documentary preparation can take on ${plural(capacity.capacity, "research question")} in this workspace. Your research program is saved.`
            : "This program has more questions than documentary preparation can take on in this workspace. Remove a question to start. Your research program is saved.";
    if (code === "sources_configuration_unavailable")
        return "Documentary preparation is not available in this workspace yet, so research cannot start. Your research program is saved.";
    if (code === "analysis_limit_reached")
        return "Every analysis available to this workspace has been used, so research cannot start. Your research program is saved.";
    if (code === "execution_slot_unavailable")
        return "Another of your analyses is still running. Start this one when it finishes. Your research program is saved.";
    return "Research cannot start right now. Review the latest program, then try again. Your research program is saved.";
}

/** A consistency estimate is scoped to recorded facts; it never becomes a general truth score. */
export function responseCoherenceNotice(value: unknown) {
    if (!value || typeof value !== "object" || !("status" in value)) return;
    if (value.status !== "review_needed" && value.status !== "unavailable")
        return;
    const score =
        value.status === "review_needed" &&
        "support" in value &&
        typeof value.support === "number" &&
        Number.isFinite(value.support) &&
        value.support >= 0 &&
        value.support <= 1
            ? value.support
            : undefined;
    return {
        title:
            value.status === "unavailable"
                ? "Consistency check unavailable"
                : "Consistency with recorded actions: review needed",
        score:
            score === undefined
                ? undefined
                : `Estimated consistency: ${Math.round(score * 100)}%`,
        detail:
            value.status === "unavailable"
                ? "This explanation has not received a current consistency assessment."
                : score === undefined
                  ? "A limited status check flagged a possible inconsistency. The original explanation is retained."
                  : "This automated estimate concerns recorded actions and dossier state, not the factual accuracy of the whole explanation.",
    };
}
