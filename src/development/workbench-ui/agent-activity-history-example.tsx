import { useState } from "react";
import {
    SOURCES_AGENT,
    WORKBENCH_AGENT,
} from "@/components/chat/conversation-agent";
import { ConversationMission } from "@/components/chat/conversation-mission";
import { Button } from "@/components/ui/button";
import { illustrativeActivity } from "./fixture-data";

/** Reproducible long-history example for virtualized activity, live updates and independent agents. */
export function AgentActivityHistoryExample() {
    const [operations, setOperations] = useState(() =>
        Array.from({ length: 200 }, (_, index) =>
            illustrativeActivity(index + 1),
        ),
    );
    const [completed, setCompleted] = useState(false);
    return (
        <div className="flex w-full max-w-2xl flex-col gap-4">
            <p>
                Illustrative agent activity. No live research or provider calls.
            </p>
            <div className="flex flex-wrap gap-2">
                <Button
                    size="sm"
                    onClick={() =>
                        setOperations((items) => [
                            ...items,
                            illustrativeActivity(
                                Number(
                                    items.at(-1)?.id.split("-").at(-1) ?? 0,
                                ) + 1,
                            ),
                        ])
                    }>
                    Record next activity
                </Button>
                <Button
                    size="sm"
                    onClick={() =>
                        setOperations((items) =>
                            items.map((item, index) =>
                                index === items.length - 1
                                    ? {
                                          ...item,
                                          summary:
                                              "Updated retained result. Documentary limitations remain explicit.",
                                      }
                                    : item,
                            ),
                        )
                    }>
                    Revise latest result
                </Button>
                <Button
                    size="sm"
                    onClick={() => setOperations((items) => items.slice(1))}>
                    Advance recent window
                </Button>
                <Button
                    size="sm"
                    onClick={() => setCompleted((value) => !value)}>
                    {completed
                        ? "Resume illustrative work"
                        : "Finish illustrative work"}
                </Button>
            </div>
            <ConversationMission
                agent={SOURCES_AGENT}
                mission={{
                    id: "long-sources",
                    agentId: "sources",
                    title: "Documentary preparation",
                    state: completed ? "completed" : "running",
                    operations,
                }}
            />
            <ConversationMission
                agent={WORKBENCH_AGENT}
                mission={{
                    id: "long-workbench",
                    agentId: "workbench",
                    title: "Inspect dossier",
                    state: "running",
                    operations,
                }}
            />
        </div>
    );
}
