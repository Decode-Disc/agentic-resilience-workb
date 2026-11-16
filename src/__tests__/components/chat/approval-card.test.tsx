import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ApprovalCard } from "@/components/chat/approval-card";

test("renders the default choices in order and reports the chosen value", () => {
    const onChoose = vi.fn();
    render(
        <ApprovalCard
            title="Pause research"
            description="Suspends research progression."
            state="request"
            onChoose={onChoose}
        />,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual([
        "Deny",
        "Always allow",
        "Allow once",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Always allow" }));
    expect(onChoose).toHaveBeenCalledWith("always");
});

test("replaces the default choices", () => {
    const onChoose = vi.fn();
    render(
        <ApprovalCard
            title="The Sources Agent reached its time limit"
            state="request"
            choices={[
                {
                    value: "alternative",
                    label: "Use what's prepared",
                    variant: "outline",
                },
                {
                    value: "once",
                    label: "Continue once",
                    variant: "outline",
                },
                {
                    value: "always",
                    label: "Always continue",
                    variant: "default",
                },
            ]}
            onChoose={onChoose}
        />,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual([
        "Use what's prepared",
        "Continue once",
        "Always continue",
    ]);
    expect(screen.queryByRole("button", { name: "Deny" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue once" }));
    expect(onChoose).toHaveBeenCalledWith("once");
});

test("a disabled choice exposes its reason", () => {
    const reason =
        "Another of your analyses is running. Continue when it finishes, or use what's prepared now.";
    render(
        <ApprovalCard
            title="The Sources Agent reached its time limit"
            state="request"
            choices={[
                {
                    value: "alternative",
                    label: "Use what's prepared",
                    variant: "outline",
                },
                {
                    value: "once",
                    label: "Continue once",
                    variant: "outline",
                    disabledReason: reason,
                },
                {
                    value: "always",
                    label: "Always continue",
                    variant: "default",
                    disabledReason: reason,
                },
            ]}
            onChoose={vi.fn()}
        />,
    );
    const once = screen.getByRole("button", { name: "Continue once" });
    const always = screen.getByRole("button", { name: "Always continue" });
    expect(once).toHaveProperty("disabled", true);
    expect(always).toHaveProperty("disabled", true);
    const describedBy = once.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const ids = (describedBy ?? "").split(/\s+/).filter(Boolean);
    const text = ids
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ");
    expect(text).toContain(reason);
    expect(
        screen.getByRole("button", { name: "Use what's prepared" }),
    ).toHaveProperty("disabled", false);
});

test("a superseded request shows no choices", () => {
    render(
        <ApprovalCard
            title="The Sources Agent reached its time limit"
            state="superseded"
            statusLabel="Superseded: Continue preparation was not applied."
            choices={[
                {
                    value: "once",
                    label: "Continue once",
                    variant: "outline",
                },
            ]}
            onChoose={vi.fn()}
        />,
    );
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(
        screen.getByText("Superseded: Continue preparation was not applied."),
    ).toBeTruthy();
});

test("choices are reachable in order with Tab", () => {
    render(
        <ApprovalCard
            title="Pause research"
            state="request"
            onChoose={vi.fn()}
        />,
    );
    const group = screen.getByRole("group");
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual([
        "Deny",
        "Always allow",
        "Allow once",
    ]);
    for (const button of buttons) {
        expect(group.contains(button)).toBe(true);
        expect(button.tabIndex).toBe(0);
        button.focus();
        expect(document.activeElement).toBe(button);
    }
});
