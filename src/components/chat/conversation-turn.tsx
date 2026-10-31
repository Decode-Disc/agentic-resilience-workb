import { Fragment, type ReactNode } from "react";
import {
    ConversationActivity,
    ConversationActivityGroup,
    type ConversationWorkItem,
} from "@/components/chat/conversation-activity";
export type ConversationTurnSnapshot = {
    id: string;
    agentId?: string;
    state: "running" | "completed" | "interrupted";
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
    renderMessage: (id: string) => ReactNode;
}) {
    const running = turn.state === "running";
    const activities = turn.entries.flatMap((e) =>
        e.kind === "operation" ? [e.operation] : [],
    );
    const render = (entry: ConversationTurnSnapshot["entries"][number]) =>
        entry.kind === "operation" ? (
            <ConversationActivity key={entry.operation.id} {...entry.operation}>
                {entry.operation.details}
            </ConversationActivity>
        ) : (
            <Fragment key={entry.id}>{renderMessage(entry.id)}</Fragment>
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
            {activities.length ? (
                <>
                    <ConversationActivityGroup
                        id={turn.id}
                        state={turn.state}
                        title={
                            running
                                ? "Work in progress"
                                : turn.state === "interrupted"
                                  ? "Work stopped"
                                  : Number.isFinite(elapsed)
                                    ? `Worked for ${elapsed}s`
                                    : "Work completed"
                        }
                        summary={`${activities.length} ${activities.length === 1 ? "operation" : "operations"}`}
                        triggerLabel="Inspect work for this turn"
                        activities={activities}
                        content={turn.entries
                            .filter(
                                (e) =>
                                    running ||
                                    e.kind !== "message" ||
                                    e.phase !== "answer",
                            )
                            .map(render)}
                    />
                    {!running && answerEntries.map(render)}
                </>
            ) : (
                turn.entries.map(render)
            )}
            {turn.state === "interrupted" && answerEntries.length === 0 && (
                <p role="status">
                    Response interrupted. Recorded work remains available.
                </p>
            )}
        </section>
    );
}
