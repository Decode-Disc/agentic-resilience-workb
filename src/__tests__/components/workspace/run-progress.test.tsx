import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { RunProgress } from "@/components/workspace/run-progress";

test("shows an explicit empty state before persisted events arrive", () => {
    render(
        <RunProgress
            run={
                {
                    lifecycleState: "draft",
                    executionStatus: "idle",
                    providerFailures: [],
                } as never
            }
            events={[] as never}
        />,
    );

    expect(screen.getByText("No progress events yet")).toBeTruthy();
    expect(
        screen.getByText(
            /Updates will appear here after the research run starts/i,
        ),
    ).toBeTruthy();
});
