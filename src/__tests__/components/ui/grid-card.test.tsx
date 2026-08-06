import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GridCard } from "@/components/ui/grid-card";

describe("GridCard", () => {
    it("keeps its content accessible and hides its grid decoration", () => {
        const { container } = render(
            <GridCard tone="accent">
                <h2>Verified evidence</h2>
            </GridCard>,
        );

        expect(
            screen.getByRole("heading", { name: "Verified evidence" }),
        ).toBeTruthy();
        expect(
            container.querySelector("svg")?.getAttribute("aria-hidden"),
        ).toBe("true");
        expect(container.firstElementChild?.getAttribute("data-tone")).toBe(
            "accent",
        );
    });
});
