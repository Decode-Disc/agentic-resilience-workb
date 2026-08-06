import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConvexError } from "convex/values";
import { describe, expect, test, vi } from "vitest";

import {
    AddSourceDialog,
    validatePublicSourceUrl,
} from "@/components/workspace/add-source-dialog";

describe("validatePublicSourceUrl", () => {
    test("accepts valid public https URLs", () => {
        expect(
            validatePublicSourceUrl("https://company.example/report.pdf"),
        ).toBe(true);
        expect(
            validatePublicSourceUrl("https://sec.gov/Archives/edgar/data/123"),
        ).toBe(true);
    });

    test("rejects non-https, invalid, or credentialed URLs", () => {
        expect(validatePublicSourceUrl("http://company.example/report")).toBe(
            false,
        );
        expect(validatePublicSourceUrl("not-a-url")).toBe(false);
        expect(
            validatePublicSourceUrl("https://user:pass@company.example"),
        ).toBe(false);
        expect(validatePublicSourceUrl("")).toBe(false);
    });
});

describe("AddSourceDialog", () => {
    test("explains when the dossier source review scope is full", async () => {
        render(
            <AddSourceDialog
                open={true}
                onOpenChange={vi.fn()}
                onAdd={vi.fn(async () => {
                    throw new ConvexError({
                        area: "manual_source_intake",
                        code: "candidate_limit",
                        retryable: false,
                    });
                })}
            />,
        );

        fireEvent.change(screen.getByLabelText(/Public source link/i), {
            target: { value: "https://example.com/report" },
        });
        fireEvent.click(screen.getByRole("button", { name: /^Add$/i }));

        expect(
            await screen.findByText(/reached its source review limit/i),
        ).toBeTruthy();
        expect(screen.queryByText(/candidate limit/i)).toBeNull();
    });

    test.each([
        ["duplicate_source", /already in this dossier/i],
        ["intake_rate_limited", /wait a moment before trying again/i],
        ["preparation_expired", /add this source again before starting/i],
        ["dossier_not_accepting_sources", /isn't accepting new sources/i],
    ])("renders safe copy for %s", async (code, expectedMessage) => {
        render(
            <AddSourceDialog
                open={true}
                onOpenChange={vi.fn()}
                onAdd={vi.fn(async () => {
                    throw new ConvexError({
                        area: "manual_source_intake",
                        code,
                        retryable: false,
                    });
                })}
            />,
        );

        fireEvent.change(screen.getByLabelText(/Public source link/i), {
            target: { value: "https://example.com/report" },
        });
        fireEvent.click(screen.getByRole("button", { name: /^Add$/i }));

        expect(await screen.findByText(expectedMessage)).toBeTruthy();
        expect(screen.queryByText(/manual_source_intake|CONVEX/i)).toBeNull();
    });

    test("renders trigger and opens dialog when trigger is clicked", async () => {
        render(
            <AddSourceDialog
                trigger={<button type="button">Add source link</button>}
            />,
        );

        expect(screen.queryByRole("dialog")).toBeNull();
        fireEvent.click(
            screen.getByRole("button", { name: /Add source link/i }),
        );

        expect(await screen.findByRole("dialog")).toBeTruthy();
        expect(
            screen.getByRole("heading", { name: /Add public sources/i }),
        ).toBeTruthy();
    });

    test("displays disabled file dropzone with prototype tooltip explanation", async () => {
        render(<AddSourceDialog open={true} onOpenChange={vi.fn()} />);

        expect(await screen.findByRole("dialog")).toBeTruthy();

        // Disabled dropzone presence
        const fileInput = screen.getByLabelText(
            /Browse files/i,
        ) as HTMLInputElement;
        expect(fileInput.disabled).toBe(true);

        // Hover over the tooltip trigger to open tooltip content
        const tooltipTrigger = screen
            .getByLabelText(/Browse files/i)
            .closest('[data-slot="tooltip-trigger"]');
        expect(tooltipTrigger).toBeTruthy();
        if (tooltipTrigger) {
            fireEvent.mouseOver(tooltipTrigger);
            fireEvent.focus(tooltipTrigger);
        }

        // Tooltip message explaining prototype limitation
        expect(
            await screen.findByText(
                /File upload is not supported in this prototype\. Add only public source links\./i,
            ),
        ).toBeTruthy();
    });

    test("adds public link via onAdd callback with analyst-safe error handling", async () => {
        const onAdd = vi.fn().mockResolvedValue(undefined);

        render(
            <AddSourceDialog
                open={true}
                onOpenChange={vi.fn()}
                onAdd={onAdd}
            />,
        );

        const input = screen.getByLabelText(/Public source link/i);
        fireEvent.change(input, {
            target: { value: "https://investors.company.com/q4-report" },
        });

        const submitBtn = screen.getByRole("button", { name: /^Add$/i });
        fireEvent.click(submitBtn);

        await waitFor(() => {
            expect(onAdd).toHaveBeenCalledWith(
                "https://investors.company.com/q4-report",
            );
        });

        expect(
            await screen.findByText(/Source added for your review\./i),
        ).toBeTruthy();
    });

    test("renders analyst-friendly error when onAdd rejects and suppresses raw errors", async () => {
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

        const input = screen.getByLabelText(/Public source link/i);
        fireEvent.change(input, {
            target: { value: "https://company.example/report" },
        });

        fireEvent.click(screen.getByRole("button", { name: /^Add$/i }));

        expect(
            await screen.findByText(
                /We couldn't add that source\. Try again\./i,
            ),
        ).toBeTruthy();
        expect(screen.queryByText(/CONVEX|retry limit/i)).toBeNull();
    });

    test("manages staged references list when urls and onUrlsChange are provided", async () => {
        const onUrlsChange = vi.fn();
        const urls = [
            "https://company.example/doc1",
            "https://company.example/doc2",
        ];

        render(
            <AddSourceDialog
                open={true}
                onOpenChange={vi.fn()}
                urls={urls}
                onUrlsChange={onUrlsChange}
            />,
        );

        expect(screen.getByText("https://company.example/doc1")).toBeTruthy();
        expect(screen.getByText("https://company.example/doc2")).toBeTruthy();

        const removeBtn = screen.getByRole("button", {
            name: /Remove https:\/\/company\.example\/doc1/i,
        });
        fireEvent.click(removeBtn);

        expect(onUrlsChange).toHaveBeenCalledWith([
            "https://company.example/doc2",
        ]);
    });
});
