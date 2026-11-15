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

test("moves from search to options with arrow keys and follows the supplied selection", () => {
    const { rerender } = render(
        <SmoothDropdwon
            defaultOpen
            activeItemId="first"
            header={<input aria-label="Filter dossiers" />}
            items={[
                { id: "first", label: "First dossier" },
                { id: "second", label: "Second dossier" },
            ]}
        />,
    );
    const input = screen.getByRole("textbox", { name: "Filter dossiers" });
    input.focus();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(document.activeElement).toBe(
        screen.getByRole("option", { name: "First dossier" }),
    );
    fireEvent.keyDown(screen.getByRole("option", { name: "First dossier" }), {
        key: "ArrowDown",
    });
    expect(document.activeElement).toBe(
        screen.getByRole("option", { name: "Second dossier" }),
    );
    rerender(
        <SmoothDropdwon
            defaultOpen
            activeItemId="second"
            items={[
                { id: "first", label: "First dossier" },
                { id: "second", label: "Second dossier" },
            ]}
        />,
    );
    expect(
        screen
            .getByRole("option", { name: "Second dossier" })
            .getAttribute("aria-selected"),
    ).toBe("true");
});

test("supports start, center and end horizontal alignment like DropdownMenuContent", () => {
    const { rerender } = render(
        <SmoothDropdwon
            defaultOpen
            align="center"
            items={[{ id: "first", label: "First dossier" }]}
        />,
    );
    const menu = screen.getByTestId("smooth-dropdown-menu");
    expect(menu.getAttribute("data-align")).toBe("center");
    expect(menu.className).toContain("left-1/2");
    expect(menu.className).toContain("-translate-x-1/2");

    rerender(
        <SmoothDropdwon
            defaultOpen
            align="end"
            items={[{ id: "first", label: "First dossier" }]}
        />,
    );
    expect(menu.getAttribute("data-align")).toBe("end");
    expect(menu.getAttribute("data-open-from")).toBe("right");
    expect(menu.className).toContain("right-0");

    rerender(
        <SmoothDropdwon
            defaultOpen
            align="start"
            items={[{ id: "first", label: "First dossier" }]}
        />,
    );
    expect(menu.getAttribute("data-align")).toBe("start");
    expect(menu.getAttribute("data-open-from")).toBe("left");
    expect(menu.className).toContain("left-0");
});
