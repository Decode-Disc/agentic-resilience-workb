import { Fragment, type ReactNode } from "react";
import {
    ConversationActivity,
    ConversationActivityGroup,
    type ConversationWorkItem,
} from "@/components/chat/conversation-activity";
import { ConversationActivityList } from "./conversation-activity-list";
export type ConversationTurnSnapshot = {
    id: string;
    agentId?: string;
    state: ConversationWorkItem["state"];
    workDetails?: (open: boolean) => ReactNode;
    startedAt?: string;
    finishedAt?: string;
    entries: readonly (
        | { kind: "message"; id: string; phase: "commentary" | "answer" }
        | { kind: "operation"; operation: ConversationWorkItem }
    )[];
};
/** Orders supplied message and operation entries; the shared work group owns disclosure and focus. */
export function ConversationTurn({
    turn,
    renderMessage,
}: {
    turn: ConversationTurnSnapshot;
    renderMessage: (id: string, presentation?: "work-note") => ReactNode;
}) {
    const running =
        turn.state === "running" ||
        turn.state === "waiting" ||
        turn.state === "paused";
    const activities = turn.entries.flatMap((e) =>
        e.kind === "operation" ? [e.operation] : [],
    );
    const render = (entry: ConversationTurnSnapshot["entries"][number]) =>
        entry.kind === "operation" ? (
            <ConversationActivity
                key={entry.operation.id}
                {...entry.operation}
                compact={!running}>
                {entry.operation.details}
            </ConversationActivity>
        ) : (
            <Fragment key={entry.id}>
                {renderMessage(
                    entry.id,
                    activities.length && entry.phase === "commentary"
                        ? "work-note"
                        : undefined,
                )}
            </Fragment>
        );
    const elapsed =
        turn.startedAt && turn.finishedAt
            ? Math.max(
                  0,
                  Math.round(
                      (Date.parse(turn.finishedAt) -
                          Date.parse(turn.startedAt)) /
                          1000,
                  ),
              )
            : undefined;
    const answerEntries = turn.entries.filter(
        (e) => e.kind === "message" && e.phase === "answer",
    );
    return (
        <section
            data-message-id={turn.id}
            data-slot="conversation-turn"
            data-state={turn.state}>
            {activities.length || turn.workDetails ? (
                <>
                    <ConversationActivityGroup
                        id={turn.id}
                        state={turn.state}
                        title={
                            turn.state === "waiting"
                                ? "Waiting for work to continue"
                                : turn.state === "paused"
                                  ? "Work paused"
                                  : turn.state === "blocked"
                                    ? "Work unavailable"
                                    : running
                                      ? "Work in progress"
                                      : turn.state === "interrupted"
                                        ? "Work stopped"
                                        : Number.isFinite(elapsed)
                                          ? `Worked for ${elapsed}s`
                                          : "Work completed"
                        }
                        summary={
                            turn.workDetails
                                ? "Inspect recorded operations"
                                : `${activities.length} ${activities.length === 1 ? "operation" : "operations"}`
                        }
                        triggerLabel="Inspect work for this turn"
                        activities={activities}
                        content={(open) => (
                            <>
                                <ConversationActivityList>
                                    {turn.entries
                                        .filter(
                                            (e) =>
                                                e.kind !== "message" ||
                                                e.phase !== "answer",
                                        )
                                        .map(render)}
                                </ConversationActivityList>
                                {turn.workDetails?.(open)}
                            </>
                        )}
                    />
                    {answerEntries.map(render)}
                </>
            ) : (
                turn.entries.map(render)
            )}
            {turn.entries.length === 0 &&
                !turn.workDetails &&
                turn.state !== "interrupted" && (
                    <p role="status">
                        {turn.state === "running"
                            ? "Working…"
                            : turn.state === "blocked"
                              ? "Response unavailable. Recorded work remains available."
                              : turn.state === "paused"
                                ? "Response paused. Recorded work remains available."
                                : turn.state === "waiting"
                                  ? "Waiting for work to continue."
                                  : "Response completed."}
                    </p>
                )}
            {turn.state === "interrupted" && answerEntries.length === 0 && (
                <p role="status">
                    Response interrupted. Recorded work remains available.
                </p>
            )}
        </section>
    );
}
