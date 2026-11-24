import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { expect, test, vi } from "vitest";
import { SourceReader } from "@/components/workbench-ui/source-reader";

const pages: ComponentProps<typeof SourceReader>["pages"] = [
    {
        id: "s1",
        label: "Excerpt 1",
        section: "Business",
        passages: [
            { id: "plain", text: "An uncited opening passage." },
            { id: "a", kind: "fact", text: "Insurers configure workflows." },
            { id: "b", kind: "counter", text: "Rules are set by insurers." },
        ],
    },
    {
        id: "s2",
        label: "Excerpt 2",
        section: "Outlook",
        passages: [{ id: "c", kind: "hypothesis", text: "Growth continues." }],
    },
];
const contributions: ComponentProps<typeof SourceReader>["contributions"] = [
    {
        id: "c1",
        kind: "fact",
        meta: "FY2025",
        status: null,
        text: "Workflows connect insurers and repairers.",
        questions: ["Q1"],
        needIds: ["workflow"],
        target: { pageId: "s1", passageId: "a" },
    },
    {
        id: "c2",
        kind: "counter",
        meta: "FY2025",
        status: null,
        text: "The call describes recommended routing.",
        questions: ["Q2"],
        needIds: ["assignment"],
        target: { pageId: "s1", passageId: "b" },
    },
    {
        id: "c3",
        kind: "fact",
        meta: "FY2025",
        status: null,
        text: "Insurers own the assignment rules.",
        questions: ["Q2"],
        needIds: ["assignment"],
        target: { pageId: "s1", passageId: "b" },
    },
    {
        id: "c4",
        kind: "hypothesis",
        meta: "Outlook",
        status: null,
        text: "Network participation should grow.",
        questions: ["Q1"],
        needIds: ["workflow"],
        target: { pageId: "s2", passageId: "c" },
    },
    {
        id: "c5",
        kind: "fact",
        meta: "Undated",
        status: null,
        text: "A statement without a located passage.",
    },
];

function renderReader(
    props: Partial<ComponentProps<typeof SourceReader>> = {},
) {
    render(
        <SourceReader
            title="Annual report"
            meta="sec.gov · complete capture"
            pages={pages}
            contributions={contributions}
            noteMode="inline"
            {...props}
        />,
    );
    return screen.getByRole("region", { name: props.title ?? "Annual report" });
}

const position = () =>
    screen.getByRole("status", { name: "Citation position" });

test("cited passages are numbered in reading order across excerpts and one marker covers a shared passage", () => {
    renderReader({ noteMode: "margin" });
    expect(
        screen
            .getAllByRole("button", { name: /^Citation \d/ })
            .map((marker) => marker.getAttribute("aria-label")),
    ).toEqual([
        "Citation 1: Fact",
        "Citation 2: 2 notes",
        "Citation 3: Hypothesis",
    ]);
    expect(position().textContent).toBe("Citation 1 of 3");
    // A contribution without a located passage stays visible rather than disappearing.
    expect(
        within(
            screen.getByRole("region", { name: "Unplaced notes" }),
        ).getByText("A statement without a located passage."),
    ).toBeTruthy();
});

test("stepping opens the focused note even while notes are hidden, and one control shows them all", () => {
    const reader = renderReader();
    expect(
        screen.queryByText("The call describes recommended routing."),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Next citation" }));
    expect(position().textContent).toBe("Citation 2 of 3");
    expect(
        screen.getByText("The call describes recommended routing."),
    ).toBeTruthy();
    expect(screen.getByText("Insurers own the assignment rules.")).toBeTruthy();
    expect(screen.queryByText("Network participation should grow.")).toBeNull();

    fireEvent.keyDown(reader, { key: "j" });
    expect(position().textContent).toBe("Citation 3 of 3");
    fireEvent.keyDown(reader, { key: "k" });
    expect(position().textContent).toBe("Citation 2 of 3");

    const all = screen.getByRole("button", { name: "Show all notes" });
    expect(all.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(all);
    expect(all.getAttribute("aria-pressed")).toBe("true");
    expect(
        screen.getByText("Workflows connect insurers and repairers."),
    ).toBeTruthy();
    expect(screen.getByText("Network participation should grow.")).toBeTruthy();
});

test("below the margin width an explicit note line opens a citation's note", () => {
    renderReader();
    // The number is an index there, not a hidden trigger.
    expect(screen.queryByRole("button", { name: /^Citation 3/ })).toBeNull();
    const line = screen.getByRole("button", {
        name: "Show note for citation 3: Hypothesis",
    });
    expect(line.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(line);
    expect(line.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Network participation should grow.")).toBeTruthy();
    expect(position().textContent).toBe("Citation 3 of 3");
    expect(line.textContent).toContain("Hide note");
    fireEvent.click(line);
    expect(screen.queryByText("Network participation should grow.")).toBeNull();
});

test("in the margin layout a marker toggles its own note", () => {
    renderReader({ noteMode: "margin", notesShown: false });
    const third = screen.getByRole("button", {
        name: "Citation 3: Hypothesis",
    });
    fireEvent.click(third);
    expect(screen.getByText("Network participation should grow.")).toBeTruthy();
    fireEvent.click(third);
    expect(screen.queryByText("Network participation should grow.")).toBeNull();
});

test("a question narrows the citations the stepper walks through", () => {
    renderReader();
    fireEvent.click(
        within(
            screen.getByRole("group", { name: "Filter by question" }),
        ).getByRole("button", { name: /^Q1/ }),
    );
    // Choosing a question moves to its first citation and opens it.
    expect(position().textContent).toBe("Q1 · Citation 1 of 2");
    expect(
        screen.getByText("Workflows connect insurers and repairers."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next citation" }));
    expect(position().textContent).toBe("Q1 · Citation 2 of 2");
    expect(screen.getByText("Network participation should grow.")).toBeTruthy();
});

test("opened for a documentary need, the reader starts on that need's first citation", () => {
    renderReader({ focusNeedId: "assignment" });
    expect(position().textContent).toBe("Citation 2 of 3");
    expect(screen.getByText("Insurers own the assignment rules.")).toBeTruthy();
});

test("margin notes are shown by default", () => {
    renderReader({ noteMode: "margin" });
    expect(
        screen.getByText("Workflows connect insurers and repairers."),
    ).toBeTruthy();
    expect(
        screen
            .getByRole("button", { name: "Show all notes" })
            .getAttribute("aria-pressed"),
    ).toBe("true");
});

test("uncited text folds so the citations come first, and Full text restores it", () => {
    renderReader();
    expect(screen.queryByText("An uncited opening passage.")).toBeNull();
    const fold = screen.getByRole("button", { name: "1 paragraph not cited" });
    fireEvent.click(fold);
    expect(screen.getByText("An uncited opening passage.")).toBeTruthy();

    const second = within(renderReader({ title: "Second copy" }));
    expect(second.queryByText("An uncited opening passage.")).toBeNull();
    const full = second.getByRole("button", { name: "Full text" });
    expect(full.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(full);
    expect(full.getAttribute("aria-pressed")).toBe("true");
    expect(second.getByText("An uncited opening passage.")).toBeTruthy();
});

test("follow-up actions sit in the header menu", () => {
    const check = vi.fn();
    renderReader({
        followUps: [
            { id: "check", label: "Request a targeted check", onSelect: check },
            {
                id: "challenge",
                label: "Challenge this selection",
                onSelect: vi.fn(),
            },
        ],
    });
    fireEvent.click(screen.getByRole("button", { name: "Follow up" }));
    fireEvent.click(
        screen.getByRole("menuitem", { name: "Request a targeted check" }),
    );
    expect(check).toHaveBeenCalledTimes(1);
});

test("an unfolded run of uncited paragraphs folds again", () => {
    renderReader();
    fireEvent.click(
        screen.getByRole("button", { name: "1 paragraph not cited" }),
    );
    expect(screen.getByText("An uncited opening passage.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Fold 1 paragraph" }));
    expect(screen.queryByText("An uncited opening passage.")).toBeNull();
});

test("the Conflicts filter steps through conflicting citations only", () => {
    renderReader();
    fireEvent.click(
        within(
            screen.getByRole("group", { name: "Filter by question" }),
        ).getByRole("button", { name: /^Conflicts/ }),
    );
    expect(position().textContent).toBe("Conflicts · Citation 1 of 1");
    expect(
        screen.getByText("The call describes recommended routing."),
    ).toBeTruthy();
});

test("opened on a conflict, the reader starts on the first conflicting citation", () => {
    renderReader({ focusConflict: true });
    expect(position().textContent).toBe("Conflicts · Citation 1 of 1");
});

test("an active question states its full text", () => {
    renderReader({
        questionTexts: { Q1: "Does CCC control coordination?" },
    });
    fireEvent.click(
        within(
            screen.getByRole("group", { name: "Filter by question" }),
        ).getByRole("button", { name: /^Q1/ }),
    );
    expect(
        screen.getByText("Does CCC control coordination?", { exact: false }),
    ).toBeTruthy();
});

test("the original document opens from the title line", () => {
    renderReader({ originalHref: "https://www.sec.gov/annual" });
    const link = screen.getByRole("link", { name: "Open original document" });
    expect(link.getAttribute("href")).toBe("https://www.sec.gov/annual");
    expect(link.closest("h2, [data-title-row]")).not.toBeNull();
});
