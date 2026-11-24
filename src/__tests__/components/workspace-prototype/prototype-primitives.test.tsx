import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { prototypeClaims } from "@/components/workspace-prototype/prototype-data";
import { ClaimSurface } from "@/components/workspace-prototype/prototype-primitives";

describe("ClaimSurface", () => {
    it.each([
        "Approved",
        "Needs review",
        "Unresolved",
    ] as const)("presents the %s claim with its evidence and uncertainty", (status) => {
        const claim = prototypeClaims.find((item) => item.status === status);
        if (!claim) throw new Error(`Missing ${status} fixture`);

        render(<ClaimSurface claim={claim} />);

        expect(screen.getByText(`${status}.`)).toBeTruthy();
        expect(screen.getByText(claim.classification)).toBeTruthy();
        expect(screen.getByText(claim.statement)).toBeTruthy();
        expect(screen.getByText(claim.evidence, { exact: false })).toBeTruthy();
        expect(screen.getByText(claim.locator, { exact: false })).toBeTruthy();
        expect(screen.getByText(claim.counterEvidence)).toBeTruthy();
    });
});
