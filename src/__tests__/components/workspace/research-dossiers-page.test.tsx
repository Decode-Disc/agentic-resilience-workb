import { api } from "@convex/_generated/api";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("convex/react", async () => {
    const { convexReactHarness } = await import(
        "@/__tests__/helpers/convex-react-harness"
    );
    return convexReactHarness.module;
});

vi.mock("@tanstack/react-router", async (importOriginal) => {
    const router =
        await importOriginal<typeof import("@tanstack/react-router")>();

    return {
        ...router,
        Link: ({
            to,
            params,
            search: _search,
            children,
            ...props
        }: Omit<ComponentProps<"a">, "children"> & {
            to: string;
            params?: { runId: string };
            search?: Record<string, string>;
            children: ReactNode;
        }) => (
            <a
                href={params ? to.replace("$runId", params.runId) : to}
                {...props}>
                {children}
            </a>
        ),
    };
});

import { convexReactHarness } from "@/__tests__/helpers/convex-react-harness";
import { ResearchDossiersPage } from "@/components/workspace/research-dossiers-page";

describe("ResearchDossiersPage", () => {
    beforeEach(() => {
        convexReactHarness.reset();
        convexReactHarness
            .action(api.companyCoverImage.renderCompanyPreview)
            .uses(vi.fn());
    });

    it("lists each research dossier in a cutout card", () => {
        convexReactHarness.query(api.researchRuns.listMine).returns([
            {
                runId: "run-1",
                company: {
                    legalName: "ServiceNow, Inc.",
                    ticker: "NOW",
                    exchange: "NYSE",
                    cik: "0001373715",
                },
                lifecycleState: "awaiting_source_review",
                executionStatus: "paused",
                pauseReason: "source_review",
                coveragePreset: "balanced",
                researchAngle: "Platform resilience and AI distribution",
                activeCorpusRevisionId: "corpus-1",
                completionOutcome: undefined,
                updatedAt: Date.UTC(2026, 6, 27),
                providerFailures: [],
            },
        ] as never);

        render(<ResearchDossiersPage />);

        expect(screen.getByRole("heading", { name: "Dossiers" })).toBeTruthy();
        const dossierLink = screen.getByRole("link", {
            name: /Open ServiceNow, Inc. dossier/i,
        });
        expect(dossierLink.getAttribute("href")).toBe("/workspace/run-1");
        const card = dossierLink.closest('[data-slot="cutout-card"]');
        expect(card).toBeTruthy();
        expect(
            card?.querySelector('[data-slot="cutout-card-media"]'),
        ).toBeTruthy();
        expect(
            card?.querySelector('[data-slot="cutout-card-overlay"]'),
        ).toBeTruthy();
        expect(
            card?.querySelector('[data-slot="cutout-card-inset-label"]'),
        ).toBeTruthy();
        expect(
            card?.querySelector('[data-slot="cutout-card-pin"]'),
        ).toBeTruthy();
        expect(
            card?.querySelector('[data-slot="cutout-card-action"]'),
        ).toBeTruthy();
        expect(
            card
                ?.querySelector('[data-slot="cutout-card-image"]')
                ?.getAttribute("src"),
        ).toBe("/images/placeholders/research-dossier-cover.png");
        expect(
            screen
                .getByRole("button", { name: "Open dossier" })
                .getAttribute("href"),
        ).toBe("/workspace/run-1");
        fireEvent.mouseEnter(card as Element);
        expect(card?.getAttribute("data-state")).toBe("hovered");
        fireEvent.mouseLeave(card as Element);
        fireEvent.focus(dossierLink);
        expect(card?.getAttribute("data-state")).toBe("hovered");
        expect(screen.getByText("Review source set")).toBeTruthy();
        expect(screen.getByText("Waiting for review")).toBeTruthy();
        expect(screen.getByText("NOW · NYSE")).toBeTruthy();
    });

    it("preserves the page layout while dossiers load", () => {
        convexReactHarness.query(api.researchRuns.listMine).returns(undefined);

        render(<ResearchDossiersPage />);

        const loadingRegion = screen.getByRole("status", {
            name: "Loading research dossiers",
        });
        const cards = loadingRegion.querySelectorAll(
            '[data-slot="research-dossier-card-skeleton"]',
        );

        expect(cards).toHaveLength(3);
        for (const card of cards) {
            expect(
                card.querySelector('[data-slot="cutout-card-media"]'),
            ).toBeTruthy();
            expect(
                card.querySelector('[data-slot="cutout-card-inset-label"]'),
            ).toBeTruthy();
            expect(
                card.querySelector('[data-slot="cutout-card-pin"]'),
            ).toBeTruthy();
            expect(
                card.querySelector('[data-slot="cutout-card-content"]'),
            ).toBeTruthy();
            expect(
                card.querySelector('[data-slot="cutout-card-footer"]'),
            ).toBeTruthy();
        }
    });

    it("offers a clear first action when no dossier exists", () => {
        convexReactHarness.query(api.researchRuns.listMine).returns([]);

        render(<ResearchDossiersPage />);

        expect(screen.getByText("No research dossiers yet")).toBeTruthy();
        expect(
            screen
                .getByRole("button", { name: "Start a dossier" })
                .getAttribute("href"),
        ).toBe("/workspace/start");
    });

    it("shows an actionable error when dossiers cannot load", () => {
        const consoleError = vi
            .spyOn(console, "error")
            .mockImplementation(() => undefined);
        const dossiersQuery = convexReactHarness.query(
            api.researchRuns.listMine,
        );
        dossiersQuery.throws(new Error("Unavailable"));

        render(<ResearchDossiersPage />);

        expect(screen.getByRole("alert").textContent).toContain(
            "Research dossiers unavailable",
        );
        dossiersQuery.returns([]);
        fireEvent.click(screen.getByRole("button", { name: "Try again" }));
        expect(screen.getByText("No research dossiers yet")).toBeTruthy();
        consoleError.mockRestore();
    });
});
