import { fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useState } from "react";
import { expect, test, vi } from "vitest";
import { WorkbenchShellSurface } from "@/components/workbench-shell/workbench-shell-surface";

test("switching the dossier viewport preserves mounted content, its draft and focus", () => {
    const mounted = vi.fn();
    const unmounted = vi.fn();
    function Dossier() {
        const [draft, setDraft] = useState("");
        useEffect(() => {
            mounted();
            return unmounted;
        }, []);
        return (
            <textarea
                aria-label="Dossier draft"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
            />
        );
    }
    const { rerender } = render(
        <WorkbenchShellSurface>
            <div data-workbench-layout="document">
                <Dossier />
            </div>
        </WorkbenchShellSurface>,
    );
    const input = screen.getByRole("textbox", { name: "Dossier draft" });
    fireEvent.change(input, { target: { value: "Keep my framing draft" } });
    input.focus();
    rerender(
        <WorkbenchShellSurface>
            <div data-workbench-layout="viewport">
                <Dossier />
            </div>
        </WorkbenchShellSurface>,
    );
    expect(screen.getByRole("textbox", { name: "Dossier draft" })).toBe(input);
    expect((input as HTMLTextAreaElement).value).toBe("Keep my framing draft");
    expect(document.activeElement).toBe(input);
    rerender(
        <WorkbenchShellSurface>
            <div data-workbench-layout="document">
                <Dossier />
            </div>
        </WorkbenchShellSurface>,
    );
    expect(screen.getByRole("textbox", { name: "Dossier draft" })).toBe(input);
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(unmounted).not.toHaveBeenCalled();
});
