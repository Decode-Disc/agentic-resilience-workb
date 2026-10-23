import {
    Cancel01Icon,
    CheckListIcon,
    CheckmarkCircle02Icon,
} from "@hugeicons/core-free-icons";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import DiscreteTabs from "@/components/ui/discrete-tabs";

test("supports vertical group selection with arrow keys, Home and End", () => {
    render(
        <DiscreteTabs
            orientation="vertical"
            labelVisibility="all"
            defaultValue="all"
            tabs={[
                {
                    id: "all",
                    title: "Recommended",
                    icon: CheckListIcon,
                    count: 16,
                },
                {
                    id: "attention",
                    title: "Needs attention",
                    icon: Cancel01Icon,
                    count: 2,
                },
                {
                    id: "alternatives",
                    title: "Alternatives",
                    icon: CheckmarkCircle02Icon,
                    count: 32,
                },
            ]}
        />,
    );
    const first = screen.getByRole("tab", { name: "Recommended 16" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    const second = screen.getByRole("tab", { name: "Needs attention 2" });
    expect(document.activeElement).toBe(second);
    expect(second.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(second, { key: "End" });
    expect(document.activeElement).toBe(
        screen.getByRole("tab", { name: "Alternatives 32" }),
    );
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Home" });
    expect(document.activeElement).toBe(first);
});

test("moves focus and selection between local tabs with arrow keys", () => {
    const onValueChange = vi.fn();
    render(
        <DiscreteTabs
            ariaLabel="Source decision filters"
            defaultValue="all"
            onValueChange={onValueChange}
            tabs={[
                { id: "all", title: "All", icon: CheckListIcon },
                {
                    id: "accepted",
                    title: "Accepted",
                    icon: CheckmarkCircle02Icon,
                },
                {
                    id: "rejected",
                    title: "Rejected",
                    icon: Cancel01Icon,
                },
            ]}
        />,
    );
    const all = screen.getByRole("tab", { name: "All" });
    const accepted = screen.getByRole("tab", { name: "Accepted" });

    all.focus();
    fireEvent.keyDown(all, { key: "ArrowRight" });

    expect(document.activeElement).toBe(accepted);
    expect(accepted.getAttribute("aria-selected")).toBe("true");
    expect(onValueChange).toHaveBeenCalledWith("accepted");
});
