import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { DirectionAwareTabs } from "@/components/ui/direction-aware-tabs";

test("exposes a roving keyboard tablist with linked panels", () => {
    const onChange = vi.fn();
    render(
        <DirectionAwareTabs
            tabs={[
                { id: "overview", label: "Overview", content: "First panel" },
                { id: "evidence", label: "Evidence", content: "Second panel" },
                { id: "risks", label: "Risks", content: "Third panel" },
            ]}
            onChange={onChange}
        />,
    );

    const overview = screen.getByRole("tab", { name: "Overview" });
    const evidence = screen.getByRole("tab", { name: "Evidence" });
    const risks = screen.getByRole("tab", { name: "Risks" });
    expect(overview.getAttribute("tabindex")).toBe("0");
    expect(evidence.getAttribute("tabindex")).toBe("-1");
    expect(overview.getAttribute("aria-controls")).toBe(
        screen.getByRole("tabpanel").id,
    );
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(
        overview.id,
    );

    overview.focus();
    fireEvent.keyDown(overview, { key: "ArrowRight" });
    expect(document.activeElement).toBe(evidence);
    expect(evidence.getAttribute("aria-selected")).toBe("true");
    expect(onChange).toHaveBeenLastCalledWith("evidence");

    fireEvent.keyDown(evidence, { key: "End" });
    expect(document.activeElement).toBe(risks);
    fireEvent.keyDown(risks, { key: "Home" });
    expect(document.activeElement).toBe(overview);
});
