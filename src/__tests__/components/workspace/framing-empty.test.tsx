import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { FramingProposal } from "@/components/workspace/start/start-screens";

it("offers question creation without empty question navigation", () => {
    const add = vi.fn();
    render(<FramingProposal questions={[]} onAddRequest={add} />);
    expect(
        screen.queryByRole("group", { name: "Question navigation" }),
    ).toBeNull();
    expect(screen.queryByText("0 of 0")).toBeNull();
    expect(screen.getByText("No research questions yet")).toBeTruthy();
    fireEvent.click(
        screen.getByRole("button", { name: "Add research question" }),
    );
    expect(add).toHaveBeenCalledOnce();
});

it("keeps an attached empty program to one summary and question action until a question exists", () => {
    const add = vi.fn();
    const start = vi.fn();
    const { rerender } = render(
        <FramingProposal
            collapsible
            questions={[]}
            onAddRequest={add}
            onStart={start}
            composer={<textarea aria-label="Refine framing" />}
        />,
    );
    expect(screen.getByText("No questions yet")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start research" })).toBeNull();
    expect(
        screen.queryByText("Refine the framing below, or add a question."),
    ).toBeNull();
    fireEvent.click(
        screen.getByRole("button", { name: "Add research question" }),
    );
    expect(add).toHaveBeenCalledOnce();
    rerender(
        <FramingProposal
            collapsible
            questions={[
                {
                    id: "coordination",
                    label: "Q1",
                    shortLabel: "Coordination",
                    text: "Who controls coordination?",
                    rationale: "Separate workflow control from execution.",
                },
            ]}
            onAddRequest={add}
            onStart={start}
            composer={<textarea aria-label="Refine framing" />}
        />,
    );
    expect(
        screen.getByRole("heading", { name: "Who controls coordination?" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start research" }));
    expect(start).toHaveBeenCalledOnce();
});

it("retains the scope in a read-only empty program without an attached composer", () => {
    render(
        <FramingProposal
            collapsible
            questions={[]}
            scope="Claims coordination across insurers and repairers"
        />,
    );
    expect(
        screen.getByText("Claims coordination across insurers and repairers"),
    ).toBeTruthy();
});

it("shows only question entry while an empty program is being edited", () => {
    render(
        <FramingProposal
            collapsible
            actionActive
            questions={[]}
            onStart={vi.fn()}
            onAddRequest={vi.fn()}
            composer={<textarea aria-label="Add research question" />}
        />,
    );
    expect(
        screen.getByRole("textbox", { name: "Add research question" }),
    ).toBeTruthy();
    expect(screen.queryByText("No research questions yet")).toBeNull();
    expect(
        screen.queryByText("Refine the framing below, or add a question."),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Start research" })).toBeNull();
});

it("uses the editor instead of repeating the selected question during contextual entry", () => {
    render(
        <FramingProposal
            collapsible
            actionActive
            questions={[
                {
                    id: "q1",
                    label: "Q1",
                    shortLabel: "Coordination",
                    text: "Who controls coordination?",
                    rationale: "Distinguish control from execution.",
                },
            ]}
            composer={<textarea aria-label="Edit research question" />}
        />,
    );
    expect(
        screen.getByRole("textbox", { name: "Edit research question" }),
    ).toBeTruthy();
    expect(
        screen.queryByRole("heading", { name: "Who controls coordination?" }),
    ).toBeNull();
});
