import { Plus } from "@hugeicons/core-free-icons";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { Button } from "@/components/ui/button";
import ToolbarExpandable from "@/components/ui/toolbar-expandable";
import { AddSourceDialog } from "@/components/workspace/add-source-dialog";

test("does not collapse when clicking inside a portaled dialog inside step content", () => {
    const onExpandedChange = vi.fn();
    render(
        <div>
            <div data-testid="outside-area">Outside</div>
            <ToolbarExpandable
                onExpandedChange={onExpandedChange}
                steps={[
                    {
                        id: "add-source",
                        title: "Add source",
                        description: "Add a public link",
                        icon: Plus,
                        content: (
                            <AddSourceDialog
                                trigger={
                                    <Button
                                        type="button"
                                        data-testid="open-dialog-trigger">
                                        Add source link
                                    </Button>
                                }
                            />
                        ),
                    },
                ]}
            />
        </div>,
    );

    // 1. Click step header to open ToolbarExpandable
    const stepButton = screen.getByRole("button", { name: "Add source" });
    fireEvent.click(stepButton);

    // Step content should now be visible
    expect(screen.getByText("Add a public link")).toBeDefined();

    // 2. Click trigger button inside step content to open AddSourceDialog
    const triggerBtn = screen.getByTestId("open-dialog-trigger");
    fireEvent.click(triggerBtn);

    // The dialog should be open
    const dialogTitle = screen.getByText("Add public sources");
    expect(dialogTitle).toBeDefined();

    // 3. Click inside the dialog (e.g. on the dialog title or input field)
    fireEvent.mouseDown(dialogTitle);

    // ToolbarExpandable MUST remain open (onExpandedChange(false) should NOT have been called by the click inside dialog)
    expect(onExpandedChange).not.toHaveBeenCalledWith(false);

    // 4. Click outside area
    const outsideArea = screen.getByTestId("outside-area");
    fireEvent.mouseDown(outsideArea);

    // Now ToolbarExpandable should collapse
    expect(onExpandedChange).toHaveBeenLastCalledWith(false);
});
