import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LoadErrorBoundary } from "@/components/load-error-boundary";
import { LoadErrorAlert } from "@/components/ui/load-error-alert";

describe("LoadErrorAlert", () => {
    it("offers an accessible retry action", () => {
        const onRetry = vi.fn();

        render(
            <LoadErrorAlert
                title="Research dossiers unavailable"
                description="We couldn’t load your dossiers. Try again."
                onRetry={onRetry}
            />,
        );

        expect(screen.getByRole("alert").textContent).toContain(
            "Research dossiers unavailable",
        );
        fireEvent.click(screen.getByRole("button", { name: "Try again" }));
        expect(onRetry).toHaveBeenCalledOnce();
    });
});

describe("LoadErrorBoundary", () => {
    it("restores its children without exposing the captured error", () => {
        let shouldFail = true;
        const capturedError = new Error(
            "[CONVEX Q(researchRuns:listMine)] Unavailable",
        );
        const onError = vi.fn();

        function LoadableContent() {
            if (shouldFail) {
                throw capturedError;
            }
            return <p>Research dossiers loaded</p>;
        }

        const consoleError = vi
            .spyOn(console, "error")
            .mockImplementation(() => undefined);

        render(
            <LoadErrorBoundary
                title="Research dossiers unavailable"
                description="We couldn’t load your dossiers. Try again."
                onError={onError}>
                <LoadableContent />
            </LoadErrorBoundary>,
        );

        expect(screen.getByRole("alert").textContent).not.toContain("CONVEX");
        expect(onError).toHaveBeenCalledWith(
            capturedError,
            expect.objectContaining({ componentStack: expect.any(String) }),
        );

        shouldFail = false;
        fireEvent.click(screen.getByRole("button", { name: "Try again" }));

        expect(screen.getByText("Research dossiers loaded")).toBeTruthy();
        consoleError.mockRestore();
    });
});
