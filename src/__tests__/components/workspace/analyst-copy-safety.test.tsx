import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { AddSourceDialog } from "@/components/workspace/add-source-dialog";

describe("analyst-facing errors", () => {
    test("hides source backend details", async () => {
        const onAdd = vi
            .fn()
            .mockRejectedValue(
                new Error(
                    "[CONVEX A(sourceActions:addManualUrl)] Source metadata retry limit reached",
                ),
            );

        render(
            <AddSourceDialog
                open={true}
                onOpenChange={vi.fn()}
                onAdd={onAdd}
            />,
        );

        fireEvent.change(screen.getByLabelText(/Public source link/i), {
            target: { value: "https://example.com/report" },
        });
        fireEvent.click(screen.getByRole("button", { name: /^Add$/i }));

        expect(
            await screen.findByText(
                /We couldn't add that source\. Try again\./i,
            ),
        ).toBeTruthy();
        expect(screen.queryByText(/CONVEX|retry limit/i)).toBeNull();
    });
});
