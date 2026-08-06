import {
    Cancel01Icon,
    CheckListIcon,
    CheckmarkCircle02Icon,
} from "@hugeicons/core-free-icons";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import DiscreteTabs from "@/components/ui/discrete-tabs";

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
