import {
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { StartScreenPreview } from "@/development/workbench-ui/start-screen-examples";

it("adds and edits through the same composer while protecting launch and preserving the ordinary draft", async () => {
    sessionStorage.clear();
    render(
        <StartScreenPreview
            name="framing"
            theme="light"
            onNavigate={vi.fn()}
            onOpenProgress={vi.fn()}
        />,
    );
    const form = within(
        screen.getByRole("form", { name: "Message the workbench" }),
    );
    const frame = within(
        screen.getByRole("region", { name: "Proposed framing" }),
    );
    const input = form.getByRole("textbox", {
        name: "Refine the framing in your own words",
    });
    fireEvent.change(input, { target: { value: "Keep my ordinary draft." } });
    fireEvent.click(
        frame.getByRole("button", { name: "Add research question" }),
    );
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(
        screen.getByRole<HTMLButtonElement>("button", {
            name: "Start research",
        }).disabled,
    ).toBe(true);
    fireEvent.change(form.getByRole("textbox"), {
        target: { value: "Can agents change pricing power?" },
    });
    fireEvent.click(form.getByRole("button", { name: /^Add question$/ }));
    await waitFor(() =>
        expect(
            screen.getByText("Can agents change pricing power?", {
                selector: "h3",
            }),
        ).toBeTruthy(),
    );
    expect((form.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
        "Keep my ordinary draft.",
    );
    expect(frame.getByText("5 of 5")).toBeTruthy();
});
it("edits a question without adding another", async () => {
    sessionStorage.clear();
    render(
        <StartScreenPreview
            name="framing"
            theme="light"
            onNavigate={vi.fn()}
            onOpenProgress={vi.fn()}
        />,
    );
    const frame = within(
        screen.getByRole("region", { name: "Proposed framing" }),
    );
    const form = within(
        screen.getByRole("form", { name: "Message the workbench" }),
    );
    fireEvent.click(frame.getByRole("button", { name: "Edit question" }));
    fireEvent.change(form.getByRole("textbox"), {
        target: { value: "Who controls pricing?" },
    });
    fireEvent.click(form.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
        expect(
            frame.getByText("Who controls pricing?", { selector: "h3" }),
        ).toBeTruthy(),
    );
    expect(frame.getByText("1 of 4")).toBeTruthy();
});
