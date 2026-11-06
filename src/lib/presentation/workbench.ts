import type { api } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import { isDocumentaryResearchPhase } from "@convex/domain/transitions";
import type { FunctionReturnType } from "convex/server";
import type { ConversationWorkItem } from "@/components/chat/conversation-activity";
import type { ConversationTurnSnapshot } from "@/components/chat/conversation-turn";

type Work = NonNullable<
    FunctionReturnType<typeof api.workbench.snapshot>["activeWork"]
>;
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
        operation: {
            id: operation.id,
            title: operation.title,
            state:
                operation.status === "completed"
                    ? operation.succeeded
                        ? "completed"
                        : "interrupted"
                    : state === "interrupted" || state === "blocked"
                      ? state
                      : operation.status === "waiting"
                        ? "waiting"
                        : "running",
            summary:
                operation.status === "completed"
                    ? operation.succeeded
                        ? "Recorded work remains available."
                        : "This operation could not finish. Retained work remains available."
                    : state === "blocked"
                      ? "This work cannot continue yet."
                      : "Work is recorded as it progresses.",
        } satisfies ConversationWorkItem,
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
                          id: work.turn.publishedMessageId,
                          phase: "answer" as const,
                      },
                  ]
                : []),
        ],
    };
}
export function workbenchFailureCopy(code?: string) {
    if (code === "native_settlement_incomplete")
        return "This conversation requires recovery before another response can begin. Your messages and recorded work remain available. You can continue editing the research program directly.";
    if (code === "pi_storage_capacity" || code === "pi_commit_capacity")
        return "This conversation has reached its storage limit. Your messages and recorded work remain available in the dossier.";
    if (
        code === "missing_authorized_route" ||
        code === "configuration_unavailable" ||
        code === "paid_work_disabled"
    )
        return "Framing assistance is not available yet. Your dossier and messages are saved. You can edit the scope and questions directly, or send another message later.";
    if (
        code === "execution_deadline" ||
        code?.includes("budget") ||
        code === "context_capacity"
    )
        return "This response reached its preparation limit. Your program and recorded work remain available. Send a narrower request to continue.";
    return "This response could not finish. Your messages and recorded work remain available. Send another message to continue.";
}

/** Sources retains its own completed work when later analytical work starts or fails. */
export function sourceMissionState(
    run: Pick<
        Doc<"researchRuns">,
        | "lifecycleState"
        | "executionStatus"
        | "pauseReason"
        | "completionOutcome"
    >,
    preparation: Pick<
        NonNullable<
            FunctionReturnType<typeof api.workbench.snapshot>["preparation"]
        >,
        "status" | "missionStatus"
    > | null,
): ConversationWorkItem["state"] {
    if (preparation?.missionStatus === "completed") return "completed";
    if (
        preparation?.missionStatus &&
        ["blocked", "failed", "cancelled"].includes(preparation.missionStatus)
    )
        return "interrupted";
    if (run.completionOutcome === "insufficient_public_evidence")
        return "blocked";
    if (run.pauseReason === "execution_interrupted") return "interrupted";
    if (run.lifecycleState === "sources_prepared") {
        if (!preparation || preparation.status === "started") return "waiting";
        return preparation.status === "complete" ? "completed" : "interrupted";
    }
    if (!isDocumentaryResearchPhase(run.lifecycleState)) return "completed";
    if (run.executionStatus === "failed" || run.executionStatus === "cancelled")
        return "interrupted";
    if (
        run.lifecycleState === "awaiting_source_review" &&
        preparation?.status !== "started"
    )
        return preparation?.status === "partial" ||
            preparation?.status === "blocked"
            ? "interrupted"
            : "completed";
    if (run.pauseReason === "analyst") return "paused";
    if (run.executionStatus === "running") return "running";
    return "waiting";
}

/** Keeps mission execution, retained material and the available next capability distinct in every Sources heading. */
export function sourceMissionPresentation(
    run: Parameters<typeof sourceMissionState>[0],
    preparation: Parameters<typeof sourceMissionState>[1],
) {
    const state = sourceMissionState(run, preparation);
    const limited =
        state === "completed" &&
        (preparation?.status === "partial" ||
            preparation?.status === "blocked");
    const title =
        run.completionOutcome === "insufficient_public_evidence"
            ? "Public evidence is insufficient"
            : state === "completed"
              ? limited
                  ? "Documentary preparation completed with limits"
                  : "Documentary material ready"
              : state === "paused"
                ? "Documentary preparation paused"
                : state === "interrupted"
                  ? "Documentary preparation interrupted"
                  : state === "waiting" || state === "blocked"
                    ? "Documentary preparation needs review"
                    : "Collecting the documentary material";
    const detail = limited
        ? "Sources finished its mission. Retained material has unresolved gaps or unfinished work. Investigation is not available yet."
        : state === "interrupted"
          ? "Sources stopped before completing its mission. Retained material and unfinished work remain available. Investigation is not available yet."
          : state === "completed"
            ? "Inspect the retained material before continuing. Investigation is not available yet."
            : "Inspect the retained material and preparation limits before continuing.";
    return { state, title, detail };
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
