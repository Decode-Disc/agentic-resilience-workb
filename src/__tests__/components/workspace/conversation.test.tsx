import {
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { StartScreenPreview } from "@/development/workbench-ui/start-screen-examples";

it("restarts illustrative work while preserving the completed mission in conversation history", async () => {
    sessionStorage.clear();
    render(
        <StartScreenPreview
            name="launched"
            theme="light"
            onNavigate={vi.fn()}
            onOpenProgress={vi.fn()}
        />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Preview tools" }));
    fireEvent.click(
        await screen.findByRole("button", { name: "Finish illustrative work" }),
    );
    expect(
        screen.getByRole<HTMLButtonElement>("button", {
            name: "Finish illustrative work",
        }).disabled,
    ).toBe(true);
    const retained = within(screen.getByRole("log")).getByRole("button", {
        name: "Inspect Sources Agent mission: Documentary preparation",
    });
    expect(retained.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(retained);
    expect(
        within(screen.getByRole("log")).getByRole("button", {
            name: "Inspect Find company reporting",
        }),
    ).toBeTruthy();
    fireEvent.click(retained);
    expect(
        within(screen.getByRole("log")).queryByRole("button", {
            name: "Inspect Find company reporting",
        }),
    ).toBeNull();
    fireEvent.click(
        screen.getByRole("button", { name: "Restart illustrative work" }),
    );
    expect(
        screen.getByRole<HTMLButtonElement>("button", {
            name: "Finish illustrative work",
        }).disabled,
    ).toBe(false);
    expect(
        within(screen.getByRole("log")).getByRole("button", {
            name: "Inspect Sources Agent mission: Documentary preparation",
        }),
    ).toBeTruthy();
    expect(
        within(screen.getByRole("log")).getAllByRole("region", {
            name: "Sources Agent · Documentary preparation",
        }),
    ).toHaveLength(2);
    expect(
        within(screen.getByRole("log")).getByText(
            "Looking for filings and earnings material about claims coordination.",
        ),
    ).toBeTruthy();
});

it("retains an unsent draft after failed delivery and records it once on explicit retry", async () => {
    sessionStorage.clear();
    render(
        <StartScreenPreview
            name="framing"
            theme="light"
            onNavigate={vi.fn()}
            onOpenProgress={vi.fn()}
        />,
    );
    expect(screen.queryByRole("button", { name: "Fail next send" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Preview tools" }));
    const fail = await screen.findByRole("button", { name: "Fail next send" });
    fireEvent.click(fail);
    fireEvent.keyDown(fail, { key: "Escape" });
    const form = within(
        screen.getByRole("form", { name: "Message the workbench" }),
    );
    const log = within(screen.getByRole("log"));
    const input = form.getByRole<HTMLTextAreaElement>("textbox", {
        name: "Refine the framing in your own words",
    });
    fireEvent.change(input, {
        target: { value: "Inspect the carrier's decision rights." },
    });
    fireEvent.click(form.getByRole("button", { name: "Send refinement" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Your message could not be sent");
    expect(input.value).toBe("Inspect the carrier's decision rights.");
    expect(
        log.queryByText("Inspect the carrier's decision rights."),
    ).toBeNull();
    expect(alert.textContent).not.toMatch(
        /execution|requestId|fixture_delivery_failure/,
    );
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    await waitFor(() =>
        expect(
            log.getAllByText("Inspect the carrier's decision rights."),
        ).toHaveLength(1),
    );
    expect(input.value).toBe("");
    expect(screen.queryByRole("alert")).toBeNull();
});

it("keeps partial illustrative output visibly interrupted rather than declaring it complete", async () => {
    sessionStorage.clear();
    render(
        <StartScreenPreview
            name="framing"
            theme="light"
            onNavigate={vi.fn()}
            onOpenProgress={vi.fn()}
        />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Preview tools" }));
    fireEvent.click(
        await screen.findByRole("button", { name: "Grow illustrative reply" }),
    );
    const log = screen.getByRole("log");
    await waitFor(() =>
        expect(log.textContent).toContain("Illustrative reading"),
    );
    fireEvent.click(
        screen.getByRole("button", { name: "Interrupt illustrative reply" }),
    );
    await waitFor(() =>
        expect(log.textContent).toContain("Response interrupted"),
    );
    expect(log.textContent).toContain("Illustrative reading");
    expect(log.textContent).not.toContain("Response complete");
});

it("retains the result of a guided framing correction in conversation history", async () => {
    sessionStorage.clear();
    render(
        <StartScreenPreview
            name="framing"
            theme="light"
            onNavigate={vi.fn()}
            onOpenProgress={vi.fn()}
        />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Preview tools" }));
    fireEvent.click(
        await screen.findByRole("button", { name: "Example: reword Q1" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Send refinement" }));
    await waitFor(() =>
        expect(
            within(screen.getByRole("log")).getByText(
                "Updated Q1: Does CCC decide coordination rules, or execute workflows defined by insurers?",
            ),
        ).toBeTruthy(),
    );
    expect(
        screen.queryByText("Workbench response", { exact: true }),
    ).toBeNull();
    expect(
        screen.queryByText("Response available", { exact: true }),
    ).toBeNull();
});
