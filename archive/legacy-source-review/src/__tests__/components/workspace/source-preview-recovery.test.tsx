import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";

vi.mock("@/hooks/use-source-preview", () => ({
    useSourcePreview: () => ({ status: "unavailable" }),
}));

import { SourceContextPanel } from "@/components/workspace/source-context-panel";

test("an unavailable visual preview retains the original and returns to source details", async () => {
    render(
        <SourceContextPanel
            source={{
                sourceId: "source-preview" as never,
                title: "Customer agreement",
                canonicalUrl: "https://example.com/terms",
                origin: "exa",
                category: "official_commercial",
                publishedAt: undefined,
                decision: "pending",
                reason: undefined,
            }}
        />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Preview" }));
    expect(await screen.findByText("Preview unavailable")).toBeTruthy();
    expect(screen.getByLabelText("Source address").textContent).toContain(
        "https://example.com/terms",
    );
    expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
    expect(
        screen.getByText("Preview — for visual reference only"),
    ).toBeTruthy();
    fireEvent.click(
        screen.getByRole("button", { name: "View source details" }),
    );
    expect(
        screen
            .getByRole("tab", { name: "Source details" })
            .getAttribute("aria-selected"),
    ).toBe("true");
    await waitFor(() =>
        expect(screen.queryByText("Preview unavailable")).toBeNull(),
    );
    expect(
        screen
            .getByRole("link", { name: "Open original" })
            .getAttribute("href"),
    ).toBe("https://example.com/terms");
});
