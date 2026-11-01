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
