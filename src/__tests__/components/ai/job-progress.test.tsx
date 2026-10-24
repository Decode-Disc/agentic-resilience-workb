import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { JobProgress } from "@/components/ai/job-progress";

test("explains interrupted stages instead of presenting them as ongoing completion", () => {
    render(
        <JobProgress
            title="Source preparation"
            stages={[
                {
                    id: "checks",
                    label: "Check source contributions",
                    status: "failed",
                    detail: "Saved readings remain available",
                },
            ]}
        />,
    );
    expect(screen.getByText("Needs attention")).toBeTruthy();
    expect(screen.getByText("Saved readings remain available")).toBeTruthy();
    expect(
        screen.getByRole("listitem", {
            name: "Check source contributions: Interrupted",
        }),
    ).toBeTruthy();
    expect(screen.queryByText(/% complete/)).toBeNull();
});
