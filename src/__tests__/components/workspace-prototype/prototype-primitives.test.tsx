import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { prototypeClaims } from "@/components/workspace-prototype/prototype-data";
import { ClaimSurface } from "@/components/workspace-prototype/prototype-primitives";

describe("ClaimSurface", () => {
    it.each([
        ["Approved", "bg-approved/10"],
        ["Needs review", "bg-review/10"],
        ["Unresolved", "bg-evidence-unknown/10"],
    ] as const)("colors the %s status surface", (status, colorClass) => {
        const claim = prototypeClaims.find((item) => item.status === status);

        if (!claim) {
            throw new Error(`Missing ${status} fixture`);
        }

        render(<ClaimSurface claim={claim} />);

        expect(
            screen
                .getByText(`${status}.`)
                .closest("[data-claim-status]")
                ?.classList.contains(colorClass),
        ).toBe(true);
    });
});
