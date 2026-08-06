import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { PaginationControls } from "@/components/pagination-controls";

test("changes explicit pages with accessible buttons", () => {
    const onPageChange = vi.fn();
    render(
        <PaginationControls
            page={2}
            pageCount={5}
            onPageChange={onPageChange}
            ariaLabel="Company search result pages"
        />,
    );

    expect(
        screen.getByRole("navigation", {
            name: "Company search result pages",
        }),
    ).toBeTruthy();
    expect(
        screen
            .getByRole("button", { name: "Page 2" })
            .getAttribute("aria-current"),
    ).toBe("page");

    fireEvent.click(screen.getByRole("button", { name: "Page 3" }));
    fireEvent.click(screen.getByRole("button", { name: "Go to next page" }));

    expect(onPageChange).toHaveBeenNthCalledWith(1, 3);
    expect(onPageChange).toHaveBeenNthCalledWith(2, 3);
});
