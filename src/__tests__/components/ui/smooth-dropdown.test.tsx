import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { SmoothDropdwon } from "@/components/ui/smooth-dropdown";

test("Escape closes the dropdown, removes its controls from keyboard access and restores its trigger", () => {
    render(
        <SmoothDropdwon
            defaultOpen
            trigger={<button type="button">Choose company</button>}
            header={<input aria-label="Search companies" />}
            items={[{ id: "company-1", label: "First company" }]}
        />,
    );
    const search = screen.getByRole("textbox", { name: "Search companies" });
    search.focus();
    fireEvent.keyDown(search, { key: "Escape" });
    expect(
        screen.queryByRole("textbox", { name: "Search companies" }),
    ).toBeNull();
    expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Choose company" }),
    );
});

test("allows a keyboard user to select a dropdown option", () => {
    const onSelect = vi.fn();
    render(
        <SmoothDropdwon
            defaultOpen
            items={[
                {
                    id: "company-1",
                    label: "CCC Intelligent Solutions",
                    onSelect,
                },
            ]}
        />,
    );

    fireEvent.keyDown(
        screen.getByRole("option", {
            name: "CCC Intelligent Solutions",
        }),
        { key: "Enter" },
    );

    expect(onSelect).toHaveBeenCalledTimes(1);
});

test("renders collection controls outside the option list", () => {
    render(
        <SmoothDropdwon
            defaultOpen
            items={[{ id: "company-1", label: "First company" }]}
            footer={<button type="button">Next results</button>}
        />,
    );

    const listbox = screen.getByRole("listbox");
    const footerButton = screen.getByRole("button", { name: "Next results" });
    expect(listbox.contains(footerButton)).toBe(false);
});
