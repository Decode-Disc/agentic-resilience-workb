import { fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useState } from "react";
import { expect, test, vi } from "vitest";
import {
    WorkbenchViewportContext,
    useWorkbenchViewport,
} from "@/components/workbench-shell/workbench-viewport";
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
            <Dossier />
        </WorkbenchShellSurface>,
    );
    const input = screen.getByRole("textbox", { name: "Dossier draft" });
    fireEvent.change(input, { target: { value: "Keep my framing draft" } });
    input.focus();
    rerender(
        <WorkbenchShellSurface plain>
            <Dossier />
        </WorkbenchShellSurface>,
    );
    expect(screen.getByRole("textbox", { name: "Dossier draft" })).toBe(input);
    expect((input as HTMLTextAreaElement).value).toBe("Keep my framing draft");
    expect(document.activeElement).toBe(input);
    rerender(
        <WorkbenchShellSurface>
            <Dossier />
        </WorkbenchShellSurface>,
    );
    expect(screen.getByRole("textbox", { name: "Dossier draft" })).toBe(input);
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(unmounted).not.toHaveBeenCalled();
});

test("a dossier can request the bounded viewport without restarting its subscription owner", () => {
    const mounted = vi.fn();
    const unmounted = vi.fn();
    function Dossier() {
        useWorkbenchViewport(true);
        useEffect(() => {
            mounted();
            return unmounted;
        }, []);
        return <p>Research conversation ready</p>;
    }
    function Shell() {
        const [plain, setPlain] = useState(false);
        return (
            <WorkbenchViewportContext.Provider value={setPlain}>
                <WorkbenchShellSurface plain={plain}>
                    <Dossier />
                </WorkbenchShellSurface>
            </WorkbenchViewportContext.Provider>
        );
    }
    render(<Shell />);
    expect(screen.getByText("Research conversation ready")).toBeTruthy();
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(unmounted).not.toHaveBeenCalled();
});
