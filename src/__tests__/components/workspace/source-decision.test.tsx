import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
    getSourceDecisionButtonLabel,
    SourceDecisionStatus,
} from "@/components/workspace/source-decision";

describe("getSourceDecisionButtonLabel", () => {
    it.each([
        ["accepted", true, "Accepted"],
        ["accepted", false, "Accept"],
        ["rejected", true, "Rejected"],
        ["rejected", false, "Reject"],
        ["pending", true, "Pending review"],
        ["pending", false, "Keep pending"],
    ] as const)("uses %s as %s label when selected is %s", (decision, selected, label) => {
        expect(getSourceDecisionButtonLabel(decision, selected)).toBe(label);
    });
});

describe("SourceDecisionStatus", () => {
    it.each([
        ["accepted", "Accepted", "success"],
        ["rejected", "Rejected", "danger"],
        ["pending", "Pending review", "warning"],
    ] as const)("renders %s as a readable, semantic status with an icon", (decision, label, status) => {
        const { container } = render(
            <SourceDecisionStatus decision={decision} />,
        );

        expect(screen.getByText(label)).toBeTruthy();
        expect(
            container.querySelector(
                `[data-slot="source-decision-status"][data-status="${status}"]`,
            ),
        ).not.toBeNull();
        expect(
            container.querySelector('[data-slot="source-decision-icon"]'),
        ).not.toBeNull();
    });
});
