import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ConversationHistory } from "@/components/chat/conversation-history";
import { ConversationMission } from "@/components/chat/conversation-mission";
import { ConversationThread } from "@/components/chat/conversation-thread";
import { useWorkbenchConversation } from "@/components/chat/workbench-conversation";

const agents = {
    workbench: { id: "workbench", name: "Workbench Agent" },
    sources: { id: "sources", name: "Sources Agent" },
    investigation: { id: "investigation", name: "Investigation Agent" },
};
function MissionHistory({ completed = false }: { completed?: boolean }) {
    const conversation = useWorkbenchConversation({
        messages: [
            { id: "start", role: "assistant", content: "Research started." },
            {
                id: "follow-up",
                role: "user",
                content: "Keep the evidence gap explicit.",
            },
            {
                id: "answer",
                role: "assistant",
                content: "The retained material is ready.",
            },
        ],
        draft: "",
        onDraftChange: () => {},
        onSend: () => {},
    });
    const props = {
        entries: [
            { kind: "message" as const, id: "start" },
            { kind: "mission" as const, id: "documents" },
            { kind: "message" as const, id: "follow-up" },
            { kind: "mission" as const, id: "examination" },
            { kind: "message" as const, id: "answer" },
        ],
        agents,
        missions: [
            {
                id: "documents",
                agentId: "sources",
                title: "Documentary preparation",
                state: completed
                    ? ("completed" as const)
                    : ("running" as const),
                operations: [
                    {
                        id: "reporting",
                        title: "Find company reporting",
                        summary: "Filings and earnings material",
                        state: completed
                            ? ("completed" as const)
                            : ("running" as const),
                    },
                ],
            },
            {
                id: "examination",
                agentId: "investigation",
                title: "Examine decision rights",
                state: "running" as const,
                operations: [
                    {
                        id: "compare",
                        title: "Compare retained passages",
                        summary: "Decision rights remain under examination",
                        state: "running" as const,
                    },
                ],
            },
        ],
    };
    return (
        <ConversationThread runtime={conversation.runtime}>
            <ConversationHistory {...props} />
        </ConversationThread>
    );
}
it("renders independently attributed missions in one chronological conversation", () => {
    render(<MissionHistory />);
    const sources = screen.getByRole("region", {
        name: "Sources Agent · Documentary preparation",
    });
    const investigation = screen.getByRole("region", {
        name: "Investigation Agent · Examine decision rights",
    });
    expect(
        within(sources).getByRole("button", {
            name: "Inspect Find company reporting",
        }),
    ).toBeTruthy();
    expect(
        within(investigation).getByRole("button", {
            name: "Inspect Compare retained passages",
        }),
    ).toBeTruthy();
    expect(screen.queryByText(/Response interrupted/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Stop response" })).toBeNull();
});
it("folds one completed mission without folding another agent's running work or messages", () => {
    const { rerender } = render(<MissionHistory />);
    rerender(<MissionHistory completed />);
    const sources = screen.getByRole("region", {
        name: "Sources Agent · Documentary preparation",
    });
    const trigger = within(sources).getByRole("button", {
        name: "Inspect Sources Agent mission: Documentary preparation",
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(
        within(sources).queryByRole("button", {
            name: "Inspect Find company reporting",
        }),
    ).toBeNull();
    expect(
        screen.getByRole("button", {
            name: "Inspect Compare retained passages",
        }),
    ).toBeTruthy();
    expect(screen.getAllByRole("article").map((n) => n.textContent)).toEqual(
        expect.arrayContaining([
            expect.stringContaining("Keep the evidence gap explicit."),
            expect.stringContaining("The retained material is ready."),
        ]),
    );
    fireEvent.click(trigger);
    expect(
        within(sources).getByRole("button", {
            name: "Inspect Find company reporting",
        }),
    ).toBeTruthy();
});

it("shows a newly started mission before its first operation is recorded", () => {
    render(
        <ConversationMission
            agent={agents.investigation}
            mission={{
                id: "starting",
                agentId: "investigation",
                title: "Examine decision rights",
                state: "running",
                operations: [],
            }}
        />,
    );
    expect(
        screen.getByRole("region", {
            name: "Investigation Agent · Examine decision rights",
        }),
    ).toBeTruthy();
    expect(screen.getByText("Working")).toBeTruthy();
});

it("refreshes a running duration and fixes it at the supplied completion time", () => {
    vi.useFakeTimers();
    try {
        vi.setSystemTime(new Date("2026-10-31T10:00:02Z"));
        const mission = {
            id: "clock",
            agentId: "sources",
            title: "Documentary preparation",
            state: "running" as const,
            startedAt: "2026-10-31T10:00:00Z",
            operations: [
                {
                    id: "clock-op",
                    title: "Find reporting",
                    summary: "Collecting",
                    state: "running" as const,
                },
            ],
        };
        const { rerender } = render(
            <ConversationMission agent={agents.sources} mission={mission} />,
        );
        expect(screen.getByText("2s")).toBeTruthy();
        act(() => vi.advanceTimersByTime(2000));
        expect(screen.getByText("4s")).toBeTruthy();
        rerender(
            <ConversationMission
                agent={agents.sources}
                mission={{
                    ...mission,
                    state: "completed",
                    finishedAt: "2026-10-31T10:00:03Z",
                }}
            />,
        );
        expect(
            screen.getByRole("timer", { name: "Sources Agent work duration" })
                .textContent,
        ).toBe("3s");
        act(() => vi.advanceTimersByTime(10000));
        expect(
            screen.getByRole("timer", { name: "Sources Agent work duration" })
                .textContent,
        ).toBe("3s");
    } finally {
        vi.useRealTimers();
    }
});

it("shows supplied mission progress without inventing a zero operation count", () => {
    render(
        <ConversationMission
            agent={agents.sources}
            mission={{
                id: "aggregate",
                agentId: "sources",
                title: "Documentary preparation",
                state: "completed",
                operations: [],
                summary: "3 references · 0 captures",
                details: <p>Inspect the retained documentary progress.</p>,
            }}
        />,
    );
    expect(screen.getByText(/3 references · 0 captures/)).toBeTruthy();
    expect(screen.queryByText(/0 operations/)).toBeNull();
    fireEvent.click(
        screen.getByRole("button", {
            name: "Inspect Sources Agent mission: Documentary preparation",
        }),
    );
    expect(
        screen.getByText("Inspect the retained documentary progress."),
    ).toBeTruthy();
});

it("keeps a long running mission compact and opens its retained activity on demand", () => {
    const operations = Array.from({ length: 37 }, (_, index) => ({
        id: `op-${index + 1}`,
        title: `Recorded activity ${index + 1}`,
        summary: "Retained result",
        state: "completed" as const,
    }));
    const mission = {
        id: "long-mission",
        agentId: "sources",
        title: "Documentary preparation",
        state: "running" as const,
        operations,
    };
    const { rerender } = render(
        <ConversationMission agent={agents.sources} mission={mission} />,
    );
    const trigger = screen.getByRole("button", {
        name: "Inspect Sources Agent mission: Documentary preparation",
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("Recorded activity 37")).toBeTruthy();
    expect(
        screen.queryByRole("region", { name: "Agent activities" }),
    ).toBeNull();
    fireEvent.click(trigger);
    expect(
        screen.getByRole("region", { name: "Agent activities" }),
    ).toBeTruthy();
    expect(
        screen.queryByRole("navigation", { name: "Activity pagination" }),
    ).toBeNull();
    rerender(
        <ConversationMission
            agent={agents.sources}
            mission={{ ...mission, state: "completed" }}
        />,
    );
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(
        screen.getByRole("region", { name: "Agent activities" }),
    ).toBeTruthy();
});

it("returns focus from the latest activity to its mission summary when work finishes", () => {
    const mission = {
        id: "focused-preview",
        agentId: "sources",
        title: "Documentary preparation",
        state: "running" as const,
        operations: [
            {
                id: "focused-operation",
                title: "Inspect retained reporting",
                summary: "Reading available material",
                state: "running" as const,
            },
        ],
    };
    const { rerender } = render(
        <ConversationMission agent={agents.sources} mission={mission} />,
    );
    const activity = screen.getByRole("button", {
        name: "Inspect Inspect retained reporting",
    });
    act(() => activity.focus());
    expect(document.activeElement).toBe(activity);
    rerender(
        <ConversationMission
            agent={agents.sources}
            mission={{ ...mission, state: "completed" }}
        />,
    );
    expect(document.activeElement).toBe(
        screen.getByRole("button", {
            name: "Inspect Sources Agent mission: Documentary preparation",
        }),
    );
});
