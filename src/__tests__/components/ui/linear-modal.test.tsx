import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import {
    Dialog,
    DialogClose,
    DialogContainer,
    DialogContent,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/linear-modal";

function ControlledModal() {
    const [open, setOpen] = useState(false);
    return (
        <>
            <output>{open ? "Opened" : "Closed"}</output>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger>Open inventory</DialogTrigger>
                <DialogContainer>
                    <DialogContent>
                        <DialogTitle>Inventory</DialogTitle>
                        <DialogClose>Close inventory</DialogClose>
                    </DialogContent>
                </DialogContainer>
            </Dialog>
        </>
    );
}

describe("Linear modal", () => {
    it("provides a tabbable native trigger and an accessible dialog title", async () => {
        render(<ControlledModal />);
        const trigger = screen.getByRole("button", { name: "Open inventory" });
        expect(trigger.tagName).toBe("BUTTON");
        expect(trigger.tabIndex).toBe(0);
        fireEvent.click(trigger);
        expect(
            await screen.findByRole("dialog", { name: "Inventory" }),
        ).toBeTruthy();
    });

    it("reports opening and closing to its controlled state owner", async () => {
        render(<ControlledModal />);
        fireEvent.click(screen.getByRole("button", { name: "Open inventory" }));
        expect(screen.getByText("Opened")).toBeTruthy();
        fireEvent.click(
            await screen.findByRole("button", { name: "Close inventory" }),
        );
        expect(screen.getByText("Closed")).toBeTruthy();
    });
});
