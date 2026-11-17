import { CheckListIcon, Clock01Icon } from "@hugeicons/core-free-icons";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import AnimatedListFilter from "@/components/ui/animated-list-filters";

const options = [
    { value: "all", label: "All decisions", icon: CheckListIcon },
    { value: "pending", label: "Pending review", icon: Clock01Icon },
] as const;

test("supports keyboard selection and restores focus when closed", async () => {
    const onChange = vi.fn();
    render(
        <AnimatedListFilter
            label="Filter candidate sources"
            value="all"
            options={options}
            onChange={onChange}
        />,
    );

    const trigger = screen.getByRole("button", {
        name: /Filter candidate sources: All decisions/i,
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(trigger);

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Done" })).toBeTruthy();
    const radios = screen.getAllByRole("radio");
    await waitFor(() => expect(document.activeElement).toBe(radios[0]));

    fireEvent.keyDown(radios[0] as HTMLElement, { key: "ArrowDown" });
    expect(document.activeElement).toBe(radios[1]);
    fireEvent.keyDown(radios[1] as HTMLElement, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith("pending");
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
});

test("closes on Escape and outside pointer input without changing value", async () => {
    const onChange = vi.fn();
    render(
        <div>
            <AnimatedListFilter
                label="Filter candidate sources"
                value="all"
                options={options}
                onChange={onChange}
            />
            <button type="button">Outside</button>
        </div>,
    );

    const trigger = screen.getByRole("button", {
        name: /Filter candidate sources: All decisions/i,
    });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getAllByRole("radio")[0] as HTMLElement, {
        key: "Escape",
    });
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    await waitFor(() => expect(screen.queryByRole("radio")).toBeNull());

    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));
    await waitFor(() => expect(screen.queryByRole("radio")).toBeNull());
    expect(onChange).not.toHaveBeenCalled();
});

test("applies positioning styles based on align, alignOffset, side, and sideOffset props", () => {
    const onChange = vi.fn();
    const { rerender } = render(
        <AnimatedListFilter
            label="Filter candidate sources"
            value="all"
            options={options}
            onChange={onChange}
        />,
    );

    const trigger = screen.getByRole("button", {
        name: /Filter candidate sources: All decisions/i,
    });
    fireEvent.click(trigger);

    const popupDefault = screen.getByRole("dialog", {
        name: "Filter candidate sources",
    });
    expect(popupDefault.style.top).toBe("calc(100% + 4px)");
    expect(popupDefault.style.left).toBe("0px");

    rerender(
        <AnimatedListFilter
            label="Filter candidate sources"
            value="all"
            options={options}
            onChange={onChange}
            align="end"
            alignOffset={8}
            side="top"
            sideOffset={12}
        />,
    );

    const popupCustom = screen.getByRole("dialog", {
        name: "Filter candidate sources",
    });
    expect(popupCustom.style.bottom).toBe("calc(100% + 12px)");
    expect(popupCustom.style.right).toBe("-8px");
});
