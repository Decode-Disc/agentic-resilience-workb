import { Loading03Icon } from "@hugeicons/core-free-icons";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { AgentIdentity } from "@/components/chat/agent-identity";
import {
    ConversationActivityGroup,
    type ConversationWorkItem,
    workStateLabels,
} from "@/components/chat/conversation-activity";
import type { ConversationAgent } from "@/components/chat/conversation-agent";
import Icon from "@/components/icon";
import { Button } from "@/components/ui/button";
import type { ConversationAgents } from "./conversation-agent";

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
            tabIndex={-1}
            data-state={mission.state}>
            <ConversationActivityGroup
                id={mission.id}
                state={mission.state}
                title={`${agent.name} · ${mission.title}`}
                titleContent={
                    <>
                        <AgentIdentity agent={agent} /> · {mission.title}
                    </>
                }
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
                        <AgentIdentity agent={agent} />
                        <strong>{mission.title}</strong>
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

/** Returns to an offscreen live mission; terminal history never leaves a permanent composer summary. */
export function ConversationWorkReturn({
    missions,
    agents,
}: {
    missions: readonly ConversationMissionSnapshot[];
    agents: ConversationAgents;
}) {
    const anchor = useRef<HTMLDivElement>(null);
    const [outside, setOutside] = useState<ReadonlySet<string>>(new Set());
    const active = missions.filter(
        (m) => m.state === "running" || m.state === "waiting",
    );
    const identities = active.map((m) => m.id).join("|");
    useEffect(() => {
        const host = anchor.current?.closest(
            '[data-slot="conversation-thread"]',
        );
        if (!host || typeof IntersectionObserver === "undefined") return;
        const observer = new IntersectionObserver(
            (entries) => {
                setOutside((previous) => {
                    const next = new Set(previous);
                    for (const entry of entries) {
                        const id = entry.target.getAttribute("data-mission-id");
                        if (id) {
                            if (entry.isIntersecting) next.delete(id);
                            else next.add(id);
                        }
                    }
                    return next;
                });
            },
            {
                root: host.querySelector(
                    '[data-slot="conversation-thread-log"]',
                ),
            },
        );
        for (const id of identities.split("|")) {
            const target = [...host.querySelectorAll("[data-mission-id]")].find(
                (node) => node.getAttribute("data-mission-id") === id,
            );
            if (target) observer.observe(target);
        }
        return () => observer.disconnect();
    }, [identities]);
    return (
        <div ref={anchor} className="chat-work-return">
            {active
                .filter((m) => outside.has(m.id))
                .map((m) => {
                    const agent = agents[m.agentId];
                    return (
                        <Button
                            key={m.id}
                            variant="ghost"
                            size="sm"
                            aria-label={`Return to ${agents[m.agentId]?.name ?? "Unidentified agent"} work`}
                            onClick={() => {
                                const target = [
                                    ...(anchor.current
                                        ?.closest(
                                            '[data-slot="conversation-thread"]',
                                        )
                                        ?.querySelectorAll<HTMLElement>(
                                            "[data-mission-id]",
                                        ) ?? []),
                                ].find(
                                    (node) =>
                                        node.getAttribute("data-mission-id") ===
                                        m.id,
                                );
                                target?.scrollIntoView({ block: "nearest" });
                                target?.focus({ preventScroll: true });
                            }}>
                            <Icon
                                iconNode={Loading03Icon}
                                size={14}
                                className="chat-working-icon"
                            />
                            {agent ? (
                                <AgentIdentity agent={agent} />
                            ) : (
                                "Unidentified agent"
                            )}{" "}
                            ·{" "}
                            {m.operations.find((o) => o.state === "running")
                                ?.title ?? m.title}
                        </Button>
                    );
                })}
        </div>
    );
}
