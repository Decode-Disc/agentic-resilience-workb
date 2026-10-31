import {
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from "@testing-library/react";
import { expect, it } from "vitest";
import { ConversationContext } from "@/components/chat/workbench-conversation";

const slots = {
    plan: <p>Examine claims coordination.</p>,
    outputs: <p>No retained outputs yet.</p>,
    sources: <p>One supplied reference.</p>,
};

it("keeps current work visible and reveals completed work only when requested", async () => {
    render(
        <ConversationContext
            {...slots}
            activities={[
                {
                    id: "active",
                    title: "Check coordination",
                    state: "running",
                    summary: "Comparing the retained material",
                },
                {
                    id: "done",
                    title: "Find reporting",
                    state: "completed",
                    summary: "Annual filing retained",
                },
            ]}
        />,
    );
    const work = within(await screen.findByRole("region", { name: "Work" }));
    expect(work.getByText("Comparing the retained material")).toBeTruthy();
    expect(work.queryByText("Annual filing retained")).toBeNull();
    const completed = work.getByRole("button", {
        name: "Completed work",
    });
    expect(completed.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(completed);
    expect(await work.findByText("Annual filing retained")).toBeTruthy();
});

it("shows a compact plan and keeps its full explanation available on request", async () => {
    render(
        <ConversationContext {...slots} planSummary="Claims coordination" />,
    );
    const plan = within(await screen.findByRole("region", { name: "Plan" }));
    expect(plan.getByText("Claims coordination")).toBeTruthy();
    expect(plan.queryByText("Examine claims coordination.")).toBeNull();
    fireEvent.click(
        plan.getByRole("button", {
            name: "Inspect research plan",
        }),
    );
    expect(await plan.findByText("Examine claims coordination.")).toBeTruthy();
});

it("opens the context initially without reopening it after the analyst dismisses it", async () => {
    const { rerender } = render(<ConversationContext {...slots} />);
    const trigger = screen.getByRole("button", {
        name: /^Research context$/,
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(
        await screen.findByRole("button", { name: "Close research context" }),
    );
    await waitFor(() =>
        expect(trigger.getAttribute("aria-expanded")).toBe("false"),
    );
    rerender(
        <ConversationContext
            {...slots}
            plan={<p>Inspect switching costs.</p>}
        />,
    );
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
});

it("updates work status from supplied activity changes without replaying the work", async () => {
    const { rerender } = render(
        <ConversationContext
            {...slots}
            activities={[
                {
                    id: "sources",
                    title: "Company reporting",
                    state: "running",
                    summary: "Reading supplied material",
                },
            ]}
        />,
    );
    const trigger = screen.getByRole("button", {
        name: /^Research context$/,
    });
    if (trigger.getAttribute("aria-expanded") !== "true")
        fireEvent.click(trigger);
    expect(await screen.findByText("1 working", { exact: true })).toBeTruthy();
    expect(screen.getByText("Reading supplied material")).toBeTruthy();
    rerender(
        <ConversationContext
            {...slots}
            activities={[
                {
                    id: "sources",
                    title: "Company reporting",
                    state: "completed",
                    summary: "Material available",
                },
            ]}
        />,
    );
    const completed = await screen.findByRole("button", {
        name: "Completed work",
    });
    expect(completed.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(completed);
    expect(await screen.findByText("Complete", { exact: true })).toBeTruthy();
    expect(screen.queryByText("1 working", { exact: true })).toBeNull();
    expect(screen.getByText("Material available")).toBeTruthy();
    rerender(
        <ConversationContext
            {...slots}
            activities={[
                {
                    id: "sources",
                    title: "Company reporting",
                    state: "interrupted",
                    summary: "Preparation stopped",
                },
            ]}
        />,
    );
    expect(
        await screen.findByText("Interrupted", { exact: true }),
    ).toBeTruthy();
    expect(screen.getByText("Preparation stopped")).toBeTruthy();
});
