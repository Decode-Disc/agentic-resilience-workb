import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import {
    SOURCES_AGENT,
    WORKBENCH_AGENT,
} from "@/components/chat/conversation-agent";
import { ConversationMission } from "@/components/chat/conversation-mission";
import {
    ConversationTurn,
    type ConversationTurnSnapshot,
} from "@/components/chat/conversation-turn";
import {
    ConversationActivityGroup,
    type ConversationWorkItem,
} from "@/components/chat/workbench-conversation";

const reference: ConversationWorkItem = {
    id: "reference",
    title: "Check supplied reference",
    state: "completed",
    summary: "Reference recorded; contents have not been retrieved.",
    details: <a href="https://www.sec.gov/">Inspect reference context</a>,
};
const reporting: ConversationWorkItem = {
    id: "reporting",
    title: "Find company reporting",
    state: "running",
    summary: "Looking for filings related to claims coordination.",
};

it("discloses work on demand, then folds the finished group while preserving retained details", () => {
    const { rerender } = render(
        <div>
            <ConversationActivityGroup
                id="source-turn"
                title="Source preparation"
                state="running"
                summary="Preparing the documentary basis"
                activities={[reference, reporting]}
            />
        </div>,
    );
    const liveGroup = screen.getByRole("button", {
        name: "Inspect source preparation",
    });
    expect(liveGroup.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(liveGroup);
    expect(liveGroup.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(reference.summary)).toBeTruthy();
    expect(screen.getByText(reporting.summary)).toBeTruthy();
    const retainedReference = screen.getByRole("button", {
        name: "Inspect Check supplied reference",
    });
    fireEvent.click(retainedReference);
    const link = screen.getByRole("link", {
        name: "Inspect reference context",
    });
    link.focus();

    const activities = [
        reference,
        {
            ...reporting,
            state: "completed" as const,
            summary: "Company reporting found.",
        },
    ];
    rerender(
        <div>
            <ConversationActivityGroup
                id="source-turn"
                title="Source preparation"
                state="running"
                summary="Preparing the next operation"
                activities={activities}
            />
        </div>,
    );
    expect(screen.getByText("Company reporting found.")).toBeTruthy();
    expect(
        screen.getByRole("link", { name: "Inspect reference context" }),
    ).toBe(link);
    expect(liveGroup.getAttribute("aria-expanded")).toBe("true");

    rerender(
        <div>
            <ConversationActivityGroup
                id="source-turn"
                title="Source preparation"
                state="completed"
                summary="Company reporting found; supplied reference remains unread."
                activities={activities}
            />
            <p>The available material is ready for review.</p>
        </div>,
    );
    const group = screen.getByRole("button", {
        name: "Inspect source preparation",
    });
    expect(group.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(group);
    expect(
        screen.queryByRole("link", { name: "Inspect reference context" }),
    ).toBeNull();
    expect(
        screen.getByText("The available material is ready for review."),
    ).toBeTruthy();
    fireEvent.click(group);
    expect(group.getAttribute("aria-expanded")).toBe("true");
    expect(
        screen.getByRole("link", { name: "Inspect reference context" }),
    ).toBeTruthy();
});

it("keeps interrupted work distinct from a successful outcome and omits groups without operations", () => {
    const { rerender } = render(
        <ConversationActivityGroup
            id="empty-turn"
            title="Source preparation"
            state="completed"
            summary="Nothing observed"
            activities={[]}
        />,
    );
    expect(screen.queryByText("Nothing observed")).toBeNull();
    rerender(
        <ConversationActivityGroup
            id="source-turn"
            title="Source preparation"
            state="interrupted"
            summary="Reporting search stopped; reference context is retained."
            activities={[reference, { ...reporting, state: "interrupted" }]}
        />,
    );
    const group = screen.getByRole("button", {
        name: "Inspect source preparation",
    });
    expect(group.textContent).toContain("Interrupted");
    fireEvent.click(group);
    expect(
        within(
            screen.getByRole("region", { name: "Source preparation" }),
        ).getAllByText("Interrupted"),
    ).toHaveLength(2);
    expect(
        screen.getByText(
            "Reporting search stopped; reference context is retained.",
        ),
    ).toBeTruthy();
});

it("keeps each agent's supplied execution state readable independently of other running work", () => {
    const renderMissions = (state: ConversationWorkItem["state"]) => (
        <>
            <ConversationMission
                agent={SOURCES_AGENT}
                mission={{
                    id: "sources",
                    agentId: "sources",
                    title: "Documentary preparation",
                    state,
                    operations: [{ ...reporting, state }],
                }}
            />
            <ConversationMission
                agent={WORKBENCH_AGENT}
                mission={{
                    id: "workbench",
                    agentId: "workbench",
                    title: "Explain the dossier",
                    state: "running",
                    operations: [],
                }}
            />
        </>
    );
    const view = render(renderMissions("running"));
    const cases = [
        ["running", "Working"],
        ["waiting", "Waiting"],
        ["paused", "Paused"],
        ["blocked", "Unavailable"],
        ["interrupted", "Interrupted"],
        ["completed", "Complete"],
    ] as const;
    for (const [state, label] of cases) {
        view.rerender(renderMissions(state));
        expect(
            screen.getByRole("status", { name: "Sources Agent mission status" })
                .textContent,
        ).toBe(label);
        expect(
            screen.getByRole("status", {
                name: "Workbench Agent mission status",
            }).textContent,
        ).toBe("Working");
        expect(
            screen
                .getByRole("button", {
                    name: "Inspect Sources Agent mission: Documentary preparation",
                })
                .getAttribute("aria-expanded"),
        ).toBe("false");
    }
});

it("attributes conversational activity to its supplied agent and leaves the answer outside folded work", () => {
    const agent = { id: "specialist", name: "Dossier specialist" };
    const turn: ConversationTurnSnapshot = {
        id: "specialist-turn",
        agentId: agent.id,
        state: "running",
        entries: [
            { kind: "operation", operation: reporting },
            { kind: "message", id: "answer", phase: "answer" },
        ],
    };
    const view = render(
        <ConversationTurn
            agent={agent}
            turn={{ ...turn, entries: [] }}
            renderMessage={() => null}
        />,
    );
    expect(
        screen.getByRole("status", {
            name: "Dossier specialist response status",
        }).textContent,
    ).toBe("Working");
    view.rerender(
        <ConversationTurn
            agent={agent}
            turn={turn}
            renderMessage={() => (
                <p>The material leaves workflow control unresolved.</p>
            )}
        />,
    );
    const group = screen.getByRole("button", {
        name: "Inspect work for this turn",
    });
    expect(group.textContent).toContain("Dossier specialist");
    expect(
        screen.getByRole("status", {
            name: "Dossier specialist response status",
        }).textContent,
    ).toBe("Working");
    fireEvent.click(group);
    view.rerender(
        <ConversationTurn
            agent={agent}
            turn={{ ...turn, state: "completed" }}
            renderMessage={() => (
                <p>The material leaves workflow control unresolved.</p>
            )}
        />,
    );
    expect(group.getAttribute("aria-expanded")).toBe("false");
    expect(
        screen
            .getByText("The material leaves workflow control unresolved.")
            .closest('[data-slot="conversation-work-group"]'),
    ).toBeNull();
});
