import { render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { expect, test, vi } from "vitest";

vi.mock("@tanstack/react-router", async (importOriginal) => {
    const router =
        await importOriginal<typeof import("@tanstack/react-router")>();
    return {
        ...router,
        Outlet: () => <div>Workspace outlet</div>,
        useParams: () => ({ runId: "run-7" }),
    };
});

vi.mock("@/components/workbench-shell/workbench-shell", () => ({
    WorkbenchShell: ({
        children,
        activeRunId,
    }: {
        children: React.ReactNode;
        activeRunId?: string;
    }) => <div data-active-run-id={activeRunId}>{children}</div>,
}));

import { Route } from "@/routes/workspace/route";

test("marks the active run in the persistent workspace shell", () => {
    const Component = Route.options.component as ComponentType;
    render(<Component />);

    expect(
        screen
            .getByText("Workspace outlet")
            .parentElement?.getAttribute("data-active-run-id"),
    ).toBe("run-7");
});
