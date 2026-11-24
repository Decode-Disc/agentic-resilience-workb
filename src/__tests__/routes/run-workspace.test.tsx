import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { responsive } = vi.hoisted(() => ({
    responsive: {
        isMobile: false,
        isTabletOrBelow: false,
        isDesktop: true,
    },
}));

vi.mock("@/hooks/use-responsive", () => ({
    useResponsive: () => responsive,
    useMediaQuery: () => responsive.isMobile,
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
    const router =
        await importOriginal<typeof import("@tanstack/react-router")>();
    return {
        ...router,
        Link: ({
            children,
            to,
            params,
            search: _search,
            ...props
        }: React.ComponentProps<"a"> & {
            to: string;
            search?: unknown;
            params?: { runId?: string };
        }) => {
            const href = params?.runId
                ? to.replace("$runId", params.runId)
                : to;
            return (
                <a
                    href={href}
                    {...props}
                    onClick={(event) => {
                        props.onClick?.(event);
                        event.preventDefault();
                    }}>
                    {children}
                </a>
            );
        },
    };
});

import { WorkspaceNavigation } from "@/components/workspace/workspace-navigation";

afterEach(() => {
    window.localStorage.clear();
    responsive.isMobile = false;
    responsive.isTabletOrBelow = false;
    responsive.isDesktop = true;
    vi.restoreAllMocks();
});

describe("production run workspace", () => {
    it("keeps four named sections and explains unavailable capabilities", () => {
        render(
            <WorkspaceNavigation runId={"run-1" as never} section="sources" />,
        );
        expect(
            screen
                .getByRole("link", { name: "Sources" })
                .getAttribute("aria-current"),
        ).toBe("page");
        expect(screen.getByRole("link", { name: "Overview" })).toBeTruthy();
        for (const label of ["Investigation", "Synthesis"]) {
            const tab = screen.getByRole("button", { name: label });
            expect(tab.getAttribute("aria-disabled")).toBe("true");
            expect(tab.getAttribute("aria-describedby")).toBeTruthy();
        }
        expect(screen.queryByText("Evidence")).toBeNull();
        expect(
            screen.queryByRole("button", { name: /Collapse navigation/ }),
        ).toBeNull();
    });

    it("keeps every section one tap away on narrow screens, labelling only the current one", () => {
        responsive.isMobile = true;
        render(
            <WorkspaceNavigation runId={"run-1" as never} section="sources" />,
        );
        const sources = screen.getByRole("link", { name: "Sources" });
        expect(sources.getAttribute("aria-current")).toBe("page");
        expect(sources.textContent).toContain("Sources");
        // Other sections stay reachable by icon; their names remain accessible.
        expect(screen.getByRole("link", { name: "Overview" }).textContent).toBe(
            "",
        );
        expect(
            screen
                .getByRole("button", { name: "Investigation" })
                .getAttribute("aria-disabled"),
        ).toBe("true");
        expect(
            screen.queryByRole("button", { name: /Workspace section/ }),
        ).toBeNull();
    });
});
