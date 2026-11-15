import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { SourceFamilyBadge } from "@/components/workspace/source-family-badge";

describe("SourceFamilyBadge", () => {
    test.each([
        ["regulatory", "Regulatory"],
        ["investor_relations", "Investor relations"],
        ["counter_evidence", "Counter evidence"],
        ["custom_family_type", "Custom family type"],
    ])("labels the %s source family", (family, label) => {
        render(<SourceFamilyBadge family={family} />);
        expect(screen.getByText(label)).toBeTruthy();
    });
});
