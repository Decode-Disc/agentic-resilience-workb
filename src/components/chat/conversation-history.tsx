import {
    type ConversationAgents,
    DEFAULT_CONVERSATION_AGENTS,
} from "@/components/chat/conversation-agent";
import {
    ConversationMission,
    type ConversationMissionSnapshot,
} from "@/components/chat/conversation-mission";
import {
    ConversationTurn,
    type ConversationTurnSnapshot,
} from "@/components/chat/conversation-turn";
import { ConversationMessages } from "@/components/chat/workbench-conversation";
import { LoadErrorAlert } from "@/components/ui/load-error-alert";

export type ConversationHistoryEntry = {
    kind: "message" | "mission";
    id: string;
};

/** Renders the shared chronological transcript, keeping each message in exactly one turn or standalone position. */
export function ConversationHistory({
    entries,
    missions = [],
    agents = DEFAULT_CONVERSATION_AGENTS,
    turns = [],
}: {
    entries: readonly ConversationHistoryEntry[];
    missions?: readonly ConversationMissionSnapshot[];
    agents?: ConversationAgents;
    turns?: readonly ConversationTurnSnapshot[];
}) {
    const messageIds = entries.flatMap((entry) =>
        entry.kind === "message" ? [entry.id] : [],
    );
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
            const start = entries.findIndex(
                (entry) => entry.kind === "message" && turnIds.has(entry.id),
            );
            const segment = new Set<string>();
            for (
                let index = start;
                index >= 0 && index < entries.length;
                index++
            ) {
                const entry = entries[index];
                if (entry?.kind !== "message" || !turnIds.has(entry.id)) break;
                const id = entry.id;
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
            {entries.map((entry) => {
                const id = entry.id;
                if (entry.kind === "mission") {
                    const mission = missions.find(
                        (mission) => mission.id === id,
                    );
                    const agent = mission && agents[mission.agentId];
                    return mission && agent ? (
                        <ConversationMission
                            key={`mission:${id}`}
                            mission={mission}
                            agent={agent}
                        />
                    ) : (
                        <LoadErrorAlert
                            key={`mission:${id}`}
                            variant="inline"
                            title="Work details unavailable"
                            description="This activity could not be restored. Your conversation remains available."
                        />
                    );
                }
                const turn = firstIds.get(id);
                return turn ? (
                    <ConversationTurn
                        key={turn.id}
                        turn={turn}
                        renderMessage={(id, presentation) =>
                            initialSegments.get(turn.id)?.has(id) ? (
                                <ConversationMessages
                                    ids={[id]}
                                    agents={agents}
                                    presentation={presentation}
                                />
                            ) : null
                        }
                    />
                ) : !grouped.has(id) ? (
                    <ConversationMessages key={id} ids={[id]} agents={agents} />
                ) : null;
            })}
        </>
    );
}
