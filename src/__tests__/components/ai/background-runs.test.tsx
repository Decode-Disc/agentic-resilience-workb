import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { BackgroundRuns } from "@/components/ai/background-runs";

test("renders passive stages without open or cancel controls when no action is connected", () => {
    render(
        <BackgroundRuns
            items={[
                {
                    id: "reading",
                    label: "Read candidate sources",
                    status: "running",
                },
            ]}
        />,
    );
    expect(screen.getByText("Read candidate sources")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
});

test("does not summarize an interrupted task as all done", () => {
    render(
        <BackgroundRuns
            items={[
                {
                    id: "checks",
                    label: "Check source contributions",
                    status: "failed",
                },
            ]}
        />,
    );
    expect(screen.getByText("Needs attention")).toBeTruthy();
    expect(screen.queryByText("All done")).toBeNull();
});
