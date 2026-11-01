import { Loading03Icon, Task01Icon } from "@hugeicons/core-free-icons";
import { type ReactNode, useEffect, useState } from "react";
import {
    ConversationActivityGroup,
    type ConversationWorkItem,
    workStateLabels,
} from "@/components/chat/conversation-activity";
import type { ConversationAgent } from "@/components/chat/conversation-agent";
import Icon from "@/components/icon";

/** A mission's supplied execution snapshot; it contains no conversational messages or dispatch policy. */
export type ConversationMissionSnapshot = {
    id: string;
    agentId: string;
    title: string;
    state: ConversationWorkItem["state"];
    startedAt?: string;
    finishedAt?: string;
    operations: readonly ConversationWorkItem[];
    summary?: string;
    details?: ReactNode;
};

/** Shows ongoing agent work independently of response generation, folding only this mission at termination. */
export function ConversationMission({
    mission,
    agent,
}: {
    mission: ConversationMissionSnapshot;
    agent: ConversationAgent;
}) {
    const [now, setNow] = useState(Date.now);
    const running = mission.state === "running";
    useEffect(() => {
        if (!running || !mission.startedAt) return;
        setNow(Date.now());
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [running, mission.startedAt]);
    const end = running
        ? now
        : mission.finishedAt
          ? Date.parse(mission.finishedAt)
          : undefined;
    const elapsed =
        mission.startedAt && end !== undefined
            ? Math.max(
                  0,
                  Math.round((end - Date.parse(mission.startedAt)) / 1000),
              )
            : undefined;
    const duration =
        elapsed !== undefined && Number.isFinite(elapsed)
            ? `${elapsed}s`
            : undefined;
    const count =
        mission.summary ??
        `${mission.operations.length} ${mission.operations.length === 1 ? "operation" : "operations"}`;
    const stateLabel = workStateLabels[mission.state];
    return (
        <section
            data-slot="conversation-mission"
            data-mission-id={mission.id}
            data-state={mission.state}>
            <ConversationActivityGroup
                id={mission.id}
                state={mission.state}
                title={`${agent.name} · ${mission.title}`}
                summary={[
                    mission.state === "completed" ? "Completed" : undefined,
                    duration ? `Worked for ${duration}` : undefined,
                    count,
                ]
                    .filter(Boolean)
                    .join(" · ")}
                triggerLabel={`Inspect ${agent.name} mission: ${mission.title}`}
                activities={mission.operations}
                content={mission.details}
                runningHeader={
                    <div className="chat-mission-heading">
                        <Icon iconNode={Task01Icon} size={17} />
                        <strong>
                            {agent.name} · {mission.title}
                        </strong>
                        <span
                            className="chat-mission-status"
                            role="status"
                            aria-label={`${agent.name} mission status`}>
                            <Icon
                                iconNode={Loading03Icon}
                                size={14}
                                className="chat-working-icon"
                            />
                            {stateLabel}
                        </span>
                        {duration && (
                            <span className="chat-mission-duration">
                                {duration}
                            </span>
                        )}
                    </div>
                }
            />
            {mission.state === "interrupted" && (
                <p role="status" className="chat-mission-interruption">
                    {agent.name} work interrupted. Recorded work remains
                    available.
                </p>
            )}
        </section>
    );
}
