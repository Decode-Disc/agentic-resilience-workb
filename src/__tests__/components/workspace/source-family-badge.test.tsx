import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { SourceFamilyBadge } from "@/components/workspace/source-family-badge";

describe("SourceFamilyBadge", () => {
    test("renders regulatory source family badge with static sky color classes", () => {
        render(<SourceFamilyBadge family="regulatory" />);
        const badge = screen.getByText("Regulatory");
        expect(badge).toBeTruthy();
        expect(badge.className).toContain("bg-sky-500/10");
        expect(badge.className).toContain("text-sky-700");
    });

    test("renders investor_relations source family badge with static indigo color classes", () => {
        render(<SourceFamilyBadge family="investor_relations" />);
        const badge = screen.getByText("Investor relations");
        expect(badge).toBeTruthy();
        expect(badge.className).toContain("bg-indigo-500/10");
        expect(badge.className).toContain("text-indigo-700");
    });

    test("renders counter_evidence source family badge with static rose color classes", () => {
        render(<SourceFamilyBadge family="counter_evidence" />);
        const badge = screen.getByText("Counter evidence");
        expect(badge).toBeTruthy();
        expect(badge.className).toContain("bg-rose-500/10");
        expect(badge.className).toContain("text-rose-700");
    });

    test("renders fallback for unknown family gracefully", () => {
        render(<SourceFamilyBadge family="custom_family_type" />);
        const badge = screen.getByText("Custom family type");
        expect(badge).toBeTruthy();
    });
});
