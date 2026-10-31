import {
    ConversationTurn,
    type ConversationTurnSnapshot,
} from "@/components/chat/conversation-turn";
import { ConversationMessages } from "@/components/chat/workbench-conversation";
import { Button } from "@/components/ui/button";

/** Renders the shared chronological transcript, keeping each message in exactly one turn or standalone position. */
export function ConversationHistory({
    messageIds,
    turns = [],
    onStop,
}: {
    messageIds: readonly string[];
    turns?: readonly ConversationTurnSnapshot[];
    onStop?: () => void;
}) {
    const ids = new Set(messageIds);
    const visibleTurns = turns.filter((t) =>
        t.entries.some((e) => e.kind === "message" && ids.has(e.id)),
    );
    // A later reply stays after intervening messages, even when it completes an earlier turn.
    const initialSegments = new Map(
        visibleTurns.map((turn) => {
            const turnIds = new Set(
                turn.entries.flatMap((entry) =>
                    entry.kind === "message" ? [entry.id] : [],
                ),
            );
            const start = messageIds.findIndex((id) => turnIds.has(id));
            const segment = new Set<string>();
            for (
                let index = start;
                index >= 0 && index < messageIds.length;
                index++
            ) {
                const id = messageIds[index];
                if (id === undefined || !turnIds.has(id)) break;
                segment.add(id);
            }
            return [turn.id, segment] as const;
        }),
    );
    const grouped = new Set(
        [...initialSegments.values()].flatMap((segment) => [...segment]),
    );
    const firstIds = new Map(
        visibleTurns.map((t) => [
            t.entries.find((e) => e.kind === "message")?.id,
            t,
        ]),
    );
    return (
        <>
            {messageIds.map((id) => {
                const turn = firstIds.get(id);
                return turn ? (
                    <ConversationTurn
                        key={turn.id}
                        turn={turn}
                        renderMessage={(id) =>
                            initialSegments.get(turn.id)?.has(id) ? (
                                <ConversationMessages ids={[id]} />
                            ) : null
                        }
                    />
                ) : !grouped.has(id) ? (
                    <ConversationMessages key={id} ids={[id]} />
                ) : null;
            })}
            {onStop && (
                <Button variant="ghost" size="sm" onClick={onStop}>
                    Stop response
                </Button>
            )}
        </>
    );
}
