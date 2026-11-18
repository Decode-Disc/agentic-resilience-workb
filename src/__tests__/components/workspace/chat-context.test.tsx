import {
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ConversationContext } from "@/components/chat/workbench-conversation";

const slots = {
    scope: "Claims coordination",
    questions: ["Position", "Switching"],
    sources: <p>One supplied reference.</p>,
};

it("shows scope, program and sources together without drill-down views", async () => {
    render(<ConversationContext {...slots} sourcesSummary="1 reference" />);
    const card = within(
        await screen.findByRole("dialog", { name: "Research context" }),
    );
    expect(
        within(card.getByRole("region", { name: "Scope" })).getByText(
            "Claims coordination",
        ),
    ).toBeTruthy();
    const program = within(
        card.getByRole("region", { name: "Research program" }),
    );
    expect(program.getByText("2 questions")).toBeTruthy();
    expect(program.getByText("Position · Switching")).toBeTruthy();
    const sources = within(card.getByRole("region", { name: "Sources" }));
    expect(sources.getByText("1 reference")).toBeTruthy();
    expect(sources.queryByText("One supplied reference.")).toBeNull();
    fireEvent.click(sources.getByRole("button", { name: "Show sources" }));
    expect(await sources.findByText("One supplied reference.")).toBeTruthy();
    expect(
        card.queryByRole("button", { name: "Back to research context" }),
    ).toBeNull();
    expect(card.queryByRole("button", { name: "Research program" })).toBeNull();
});

it("reduces work to the current status line instead of repeating the conversation", async () => {
    const { rerender } = render(
        <ConversationContext
            {...slots}
            activities={[
                {
                    id: "done",
                    title: "Find reporting",
                    state: "completed",
                    summary: "Annual filing retained",
                },
                {
                    id: "active",
                    title: "Check coordination",
                    state: "running",
                    summary: "Comparing the retained material",
                },
            ]}
        />,
    );
    const work = within(await screen.findByRole("region", { name: "Work" }));
    expect(work.getByText("Check coordination")).toBeTruthy();
    expect(work.getByText("Working")).toBeTruthy();
    expect(work.queryByText("Find reporting")).toBeNull();
    expect(work.queryByText("Annual filing retained")).toBeNull();

    rerender(
        <ConversationContext
            {...slots}
            activities={[
                {
                    id: "active",
                    title: "Check coordination",
                    state: "interrupted",
                    summary: "Preparation stopped",
                },
            ]}
        />,
    );
    expect(await screen.findByText("Interrupted")).toBeTruthy();

    rerender(
        <ConversationContext
            {...slots}
            activities={[
                {
                    id: "done",
                    title: "Find reporting",
                    state: "completed",
                    summary: "Annual filing retained",
                },
            ]}
        />,
    );
    await waitFor(() =>
        expect(screen.queryByRole("region", { name: "Work" })).toBeNull(),
    );
});

it("opens initially without reopening it after the analyst dismisses it", async () => {
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
    rerender(<ConversationContext {...slots} scope="Switching costs" />);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
});

it("keeps narrow context closed until requested, nonmodal, and closes it when changing scope", async () => {
    const bounds = vi
        .spyOn(HTMLElement.prototype, "getBoundingClientRect")
        .mockImplementation(function (this: HTMLElement) {
            return this.matches('[data-slot="conversation-thread"]')
                ? new DOMRect(0, 0, 420, 700)
                : new DOMRect(0, 0, 32, 32);
        });
    try {
        const changeScope = vi.fn();
        render(
            <div data-slot="conversation-thread">
                <ConversationContext {...slots} onChangeScope={changeScope} />
            </div>,
        );
        const trigger = screen.getByRole("button", {
            name: "Research context",
        });
        await waitFor(() =>
            expect(trigger.getAttribute("aria-expanded")).toBe("false"),
        );
        fireEvent.click(trigger);
        const panel = await screen.findByRole("dialog", {
            name: "Research context",
        });
        await waitFor(() =>
            expect(panel.getAttribute("aria-modal")).not.toBe("true"),
        );
        fireEvent.click(screen.getByRole("button", { name: "Change scope" }));
        expect(changeScope).toHaveBeenCalledOnce();
        await waitFor(() =>
            expect(trigger.getAttribute("aria-expanded")).toBe("false"),
        );
    } finally {
        bounds.mockRestore();
    }
});
