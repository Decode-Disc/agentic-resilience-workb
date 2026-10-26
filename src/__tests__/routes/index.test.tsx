import {
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async (importOriginal) => {
    const router =
        await importOriginal<typeof import("@tanstack/react-router")>();

    return {
        ...router,
        Link: ({
            to,
            search: _search,
            ...props
        }: ComponentProps<"a"> & {
            to: string;
            search?: Record<string, string>;
        }) => <a href={to} {...props} />,
    };
});

import { IndexPage } from "@/components/landing/index-page";

describe("IndexPage", () => {
    it("introduces the research question with an illustrative evidence matrix", () => {
        render(<IndexPage />);

        expect(
            screen.getByRole("heading", {
                name: "Which advantages survive the agentic shift?",
            }),
        ).toBeTruthy();
        expect(
            screen.getByRole("heading", { name: "Evidence matrix" }),
        ).toBeTruthy();
        expect(screen.getByText("Counter-evidence")).toBeTruthy();
        expect(
            screen.getByLabelText("Agentic Resilience Workbench"),
        ).toBeTruthy();
        expect(
            screen
                .getByRole("link", { name: "Open workbench" })
                .getAttribute("href"),
        ).toContain("/workspace/start");
        expect(
            screen
                .getByRole("link", { name: "Explore the workbench" })
                .getAttribute("href"),
        ).toContain("/workspace/start");
        expect(
            screen.queryByRole("button", { name: "Explore the workbench" }),
        ).toBeNull();
        expect(screen.getByText("Illustrative preview")).toBeTruthy();
        expect(screen.queryByText(/analysis complete/i)).toBeNull();
        expect(
            screen.queryByText(/pricing|get started|free trial/i),
        ).toBeNull();
    });

    it("reveals project context from the fixed navigation menu", async () => {
        render(<IndexPage />);

        const navigation = screen.getByRole("navigation", {
            name: "Project context",
        });
        const projectTrigger = screen.getByRole("button", {
            name: "Value at stake",
        });

        expect(navigation.contains(projectTrigger)).toBe(true);
        expect(within(navigation).getAllByRole("button")).toHaveLength(3);
        expect(
            within(navigation).queryByRole("link", { name: "Capabilities" }),
        ).toBeNull();
        expect(
            screen.queryByRole("heading", {
                name: "See what could hold. And what could erode.",
            }),
        ).toBeNull();

        fireEvent.click(projectTrigger);

        expect(
            await screen.findByRole("heading", {
                name: "See what could hold. And what could erode.",
            }),
        ).toBeTruthy();
        expect(screen.getByText(/Look beyond AI announcements/i)).toBeTruthy();

        fireEvent.keyDown(projectTrigger, { key: "Escape" });
        await waitFor(() => {
            expect(
                screen.queryByRole("heading", {
                    name: "See what could hold. And what could erode.",
                }),
            ).toBeNull();
        });
        expect(document.activeElement).toBe(projectTrigger);
    });

    it.each([
        ["Value at stake", "See what could hold. And what could erode."],
        ["Test the thesis", "Put the company's story to the test."],
        ["Your judgment", "Keep every conclusion open to challenge."],
    ])("opens the %s panel", async (label, title) => {
        render(<IndexPage />);

        fireEvent.click(screen.getByRole("button", { name: label }));

        expect(
            await screen.findByRole("heading", { name: title }),
        ).toBeTruthy();
        expect(screen.getByRole("region", { name: title })).toBeTruthy();
    });

    it("repeats the project context and CTA in the mobile sheet", async () => {
        render(<IndexPage />);

        fireEvent.click(
            screen.getByRole("button", { name: "Open project menu" }),
        );

        const dialog = await screen.findByRole("dialog", {
            name: "Project context",
        });
        const mobileMenu = within(dialog);
        for (const [label, title] of [
            ["Value at stake", "See what could hold. And what could erode."],
            ["Test the thesis", "Put the company's story to the test."],
            ["Your judgment", "Keep every conclusion open to challenge."],
        ]) {
            expect(
                mobileMenu.getByRole("button", { name: label }),
            ).toBeTruthy();
            fireEvent.click(mobileMenu.getByRole("button", { name: label }));
            expect(
                await mobileMenu.findByRole("heading", { name: title }),
            ).toBeTruthy();
        }
        expect(
            mobileMenu.queryByRole("link", { name: "Capabilities" }),
        ).toBeNull();
        expect(
            mobileMenu.getByRole("link", { name: "Open workbench" }),
        ).toBeTruthy();
    });
});
