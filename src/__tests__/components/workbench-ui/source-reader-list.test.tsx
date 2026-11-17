import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { SourceReaderList } from "@/components/workbench-ui/source-reader-list";

const item = (id: string, title: string) => ({
    id,
    docType: "DOC",
    title,
    meta: "theregister.com",
    reading: "full" as const,
});

function renderList(selectedId = "annual") {
    render(
        <SourceReaderList
            groups={[
                {
                    id: "retained",
                    label: "Retained",
                    items: [
                        item("annual", "10-K · 2026-01-29"),
                        item("register", "Salesforce is taking on ServiceNow"),
                    ],
                },
                {
                    id: "not_retained",
                    label: "Not retained",
                    items: [item("idc", "Worldwide ITSM market shares")],
                },
            ]}
            selectedId={selectedId}
            onSelect={vi.fn()}
        />,
    );
}

test("retained sources start open and other groups fold unless they hold the open source", () => {
    renderList();
    expect(
        screen
            .getByRole("button", { name: /Retained · 2/ })
            .getAttribute("aria-expanded"),
    ).toBe("true");
    const other = screen.getByRole("button", { name: /Not retained · 1/ });
    expect(other.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: /Worldwide ITSM/ })).toBeNull();
    fireEvent.click(other);
    expect(screen.getByRole("button", { name: /Worldwide ITSM/ })).toBeTruthy();
});

test("the group holding the open source starts open", () => {
    renderList("idc");
    expect(
        screen
            .getByRole("button", { name: /Not retained · 1/ })
            .getAttribute("aria-expanded"),
    ).toBe("true");
});

test("the filter narrows every group and says when nothing matches", () => {
    renderList();
    const filter = screen.getByRole("searchbox", { name: "Filter sources" });
    fireEvent.change(filter, { target: { value: "itsm" } });
    expect(screen.queryByRole("button", { name: /10-K/ })).toBeNull();
    // Matches are shown even inside a folded group.
    expect(screen.getByRole("button", { name: /Worldwide ITSM/ })).toBeTruthy();
    fireEvent.change(filter, { target: { value: "zzz" } });
    expect(screen.getByText("No source matches this filter.")).toBeTruthy();
});

test("a source with a conflict offers a direct way to it", () => {
    const onSelect = vi.fn();
    const onOpenConflict = vi.fn();
    render(
        <SourceReaderList
            groups={[
                {
                    id: "retained",
                    label: "Retained",
                    items: [
                        {
                            ...item(
                                "register",
                                "Salesforce is taking on ServiceNow",
                            ),
                            conflicts: 1,
                        },
                    ],
                },
            ]}
            onSelect={onSelect}
            onOpenConflict={onOpenConflict}
        />,
    );
    fireEvent.click(
        screen.getByRole("button", {
            name: "Go to the conflict in Salesforce is taking on ServiceNow",
        }),
    );
    expect(onOpenConflict).toHaveBeenCalledWith("register");
    expect(onSelect).not.toHaveBeenCalled();
});
