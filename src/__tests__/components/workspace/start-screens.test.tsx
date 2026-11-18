import {
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ResearchComposerView } from "@/components/workspace/start/research-composer-view";
import {
    CompanyMandatePanel,
    FramingClarification,
    FramingProposal,
} from "@/components/workspace/start/start-screens";
import { StartScreenPreview } from "@/development/workbench-ui/start-screen-examples";

describe("Start presentation without backend providers", () => {
    it("reports composer edits and leaves its supplied value under caller control", () => {
        const change = vi.fn();
        render(
            <ResearchComposerView
                value="Initial angle"
                onValueChange={change}
                toolbar={<span>Supplied toolbar</span>}
            />,
        );
        fireEvent.change(screen.getByRole("textbox"), {
            target: { value: "Another angle" },
        });
        expect(change).toHaveBeenCalledWith("Another angle");
        expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe(
            "Initial angle",
        );
    });
    it("presents the research program directly without a questionnaire for each economic question", () => {
        render(<FramingFixture />);
        expect(
            screen.queryByRole("form", {
                name: "Optional research directions",
            }),
        ).toBeNull();
        expect(
            screen.getByRole("region", { name: "Framing summary" }),
        ).toBeTruthy();
        expect(
            within(
                screen.getByRole("region", { name: "Framing summary" }),
            ).getByText("Who controls routing?"),
        ).toBeTruthy();
        expect(screen.queryByRole("radio")).toBeNull();
    });
    it("updates the proposed scope from a supplied clarification without starting research", () => {
        const start = vi.fn();
        render(<FramingFixture needsContext onStart={start} />);
        fireEvent.click(
            screen.getByRole("radio", { name: "Repair network management" }),
        );
        fireEvent.click(screen.getByRole("button", { name: "Update framing" }));
        expect(
            within(
                screen.getByRole("region", { name: "Proposed research scope" }),
            ).getByText("Repair network management"),
        ).toBeTruthy();
        expect(
            within(
                screen.getByRole("region", { name: "Your clarification" }),
            ).getByText("Repair network management"),
        ).toBeTruthy();
        expect(
            screen.queryByRole("region", { name: "Clarify research context" }),
        ).toBeNull();
        expect(document.activeElement).toBe(
            screen.getByRole("region", { name: "Framing summary" }),
        );
        expect(start).not.toHaveBeenCalled();
    });
    it("accepts the system proposal without requiring a contextual answer", () => {
        const start = vi.fn();
        render(<FramingFixture needsContext onStart={start} />);
        fireEvent.click(screen.getByRole("button", { name: "Update framing" }));
        expect(
            screen.queryByRole("region", { name: "Clarify research context" }),
        ).toBeNull();
        expect(
            within(
                screen.getByRole("region", { name: "Your clarification" }),
            ).getByText("Photo-led claims"),
        ).toBeTruthy();
        expect(
            within(
                screen.getByRole("region", { name: "Proposed research scope" }),
            ).getByText("Photo-led claims"),
        ).toBeTruthy();
        expect(start).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole("button", { name: "Start research" }));
        expect(start).toHaveBeenCalledTimes(1);
    });
    it("accepts a freeform scope and can reopen its context control", () => {
        render(<FramingFixture />);
        fireEvent.click(screen.getByRole("button", { name: "Adjust scope" }));
        fireEvent.click(
            screen.getByRole("radio", { name: "Another activity or boundary" }),
        );
        fireEvent.change(
            screen.getByRole("textbox", {
                name: "Another activity or boundary",
            }),
            { target: { value: "Claims intake" } },
        );
        fireEvent.click(screen.getByRole("button", { name: "Update framing" }));
        expect(
            within(
                screen.getByRole("region", { name: "Proposed research scope" }),
            ).getByText("Claims intake"),
        ).toBeTruthy();
    });
    it("preserves optional corrections through the shared composer", () => {
        sessionStorage.clear();
        render(
            <StartScreenPreview
                name="framing"
                theme="light"
                onNavigate={vi.fn()}
                onOpenProgress={vi.fn()}
            />,
        );
        const program = within(
            screen.getByRole("region", { name: "Proposed framing" }),
        );
        fireEvent.click(program.getByRole("button", { name: "Edit question" }));
        fireEvent.change(program.getByRole("textbox"), {
            target: { value: "Who can change routing rules?" },
        });
        expect(
            program.queryByRole("button", {
                name: "Start research",
            }),
        ).toBeNull();
        fireEvent.click(program.getByRole("button", { name: "Save changes" }));
        expect(
            program.getByRole("heading", {
                name: "Who can change routing rules?",
            }),
        ).toBeTruthy();
        expect(
            program.getByRole<HTMLButtonElement>("button", {
                name: "Start research",
            }).disabled,
        ).toBe(false);
    });
    it("cancels a question edit without changing its wording and returns focus to its editing command", async () => {
        sessionStorage.clear();
        render(
            <StartScreenPreview
                name="framing"
                theme="light"
                onNavigate={vi.fn()}
                onOpenProgress={vi.fn()}
            />,
        );
        const program = within(
            screen.getByRole("region", { name: "Proposed framing" }),
        );
        const original = program.getByRole("region", {
            name: "Framing summary",
        }).textContent;
        const edit = program.getByRole("button", { name: "Edit question" });
        edit.focus();
        fireEvent.click(edit);
        fireEvent.change(program.getByRole("textbox"), {
            target: { value: "Discard this change" },
        });
        fireEvent.click(program.getByRole("button", { name: "Cancel" }));
        expect(
            program.getByRole("region", { name: "Framing summary" })
                .textContent,
        ).toBe(original);
        await waitFor(() => expect(document.activeElement).toBe(edit));
    });
    it("keeps shifted and composing Enter inside the composer and sends an ordinary Enter", async () => {
        sessionStorage.clear();
        render(
            <StartScreenPreview
                name="framing"
                theme="light"
                onNavigate={vi.fn()}
                onOpenProgress={vi.fn()}
            />,
        );
        const input = screen.getByRole<HTMLTextAreaElement>("textbox", {
            name: "Refine the framing in your own words",
        });
        fireEvent.change(input, {
            target: { value: "Inspect the dependencies" },
        });
        fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
        fireEvent.keyDown(input, { key: "Enter", isComposing: true });
        expect(
            within(screen.getByRole("log")).queryByText(
                "Inspect the dependencies",
            ),
        ).toBeNull();
        expect(input.value).toBe("Inspect the dependencies");
        fireEvent.keyDown(input, { key: "Enter" });
        await waitFor(() =>
            expect(
                within(screen.getByRole("log")).getByText(
                    "Inspect the dependencies",
                ),
            ).toBeTruthy(),
        );
        expect(input.value).toBe("");
    });
    it("keeps confirmation controls disabled while its caller is preparing framing", () => {
        render(
            <CompanyMandatePanel
                company={{
                    legalName: "ExampleCo",
                    ticker: "EXAMPLE",
                    exchange: "Illustrative",
                    cik: "Fixture",
                }}
                mandate="Primary sources first"
                pending
                onConfirm={vi.fn()}
                onChangeCompany={vi.fn()}
            />,
        );
        expect(
            screen.getByRole<HTMLButtonElement>("button", {
                name: "Preparing framing…",
            }).disabled,
        ).toBe(true);
        expect(
            screen.getByRole<HTMLButtonElement>("button", {
                name: "Back",
            }).disabled,
        ).toBe(true);
    });
});

function FramingFixture({
    onStart = () => {},
    needsContext = false,
}: {
    onStart?: () => void;
    needsContext?: boolean;
}) {
    const [showContext, setShowContext] = useState(needsContext);
    const [scope, setScope] = useState("Photo-led claims");
    const [context, setContext] = useState<{
        question: string;
        answer: string;
    }>();
    const [questions] = useState([
        {
            id: "q1",
            label: "Q1",
            text: "Who controls routing?",
            rationale: "Distinguish running the flow from deciding its rules.",
        },
        {
            id: "q2",
            label: "Q2",
            text: "What makes the data difficult to replace?",
            rationale: "Investigate what can be reproduced.",
        },
    ]);
    return (
        <FramingProposal
            introduction="Proposed scope"
            scope={scope}
            suppliedContext={context}
            clarification={
                showContext ? (
                    <FramingClarification
                        question={{
                            id: "activity",
                            prompt: "Which activity would you like to examine?",
                            reason: "The activity changes the research scope.",
                            proposedValue: "Photo-led claims",
                            choices: [
                                {
                                    value: "Photo-led claims",
                                    label: "Photo-led claims",
                                },
                                {
                                    value: "Repair network management",
                                    label: "Repair network management",
                                },
                            ],
                        }}
                        onAnswer={(answer) => {
                            setScope(answer);
                            setContext({
                                question: "Activity to examine",
                                answer,
                            });
                            setShowContext(false);
                        }}
                    />
                ) : undefined
            }
            onAdjustScope={() => setShowContext(true)}
            questions={questions}
            onStart={onStart}
        />
    );
}

it("keeps an unfinished question edit and launch guard when the pending program is folded", () => {
    sessionStorage.clear();
    render(
        <StartScreenPreview
            name="framing"
            theme="light"
            onNavigate={vi.fn()}
            onOpenProgress={vi.fn()}
        />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit question" }));
    const editor = screen.getByRole("textbox", {
        name: "Edit research question",
    });
    fireEvent.change(editor, {
        target: { value: "Who can replace a service?" },
    });
    const disclosure = screen
        .getByText("Proposed research program", { selector: "summary span" })
        .closest("details");
    if (!disclosure) throw new Error("Missing pending program disclosure");
    fireEvent.click(
        screen.getByText("Proposed research program", {
            selector: "summary span",
        }),
    );
    expect(disclosure.open).toBe(false);
    expect(
        screen.queryByRole("button", {
            name: "Start research",
        }),
    ).toBeNull();
    fireEvent.click(
        screen.getByText("Proposed research program", {
            selector: "summary span",
        }),
    );
    expect(
        screen.getByRole<HTMLTextAreaElement>("textbox", {
            name: "Edit research question",
        }).value,
    ).toBe("Who can replace a service?");
});

it("lists every question of a prepared program and opens one at a time with its rationale", () => {
    const questions = [
        {
            id: "a",
            label: "Q1",
            shortLabel: "Position",
            text: "Who controls routing?",
            rationale: "Separate control from supply.",
        },
        {
            id: "b",
            label: "Q2",
            shortLabel: "Switching",
            text: "What would a customer rebuild?",
            rationale: "Examine dependencies.",
        },
    ];
    const start = vi.fn();
    render(
        <FramingProposal
            collapsible
            questions={questions}
            composer={<p>Conversation input</p>}
            onStart={start}
            onEditRequest={vi.fn()}
            onAddRequest={vi.fn()}
        />,
    );
    expect(screen.queryByRole("combobox")).toBeNull();
    const first = screen.getByRole("button", { name: "1 Position" });
    const second = screen.getByRole("button", { name: "2 Switching" });
    expect(first.getAttribute("aria-expanded")).toBe("true");
    expect(second.getAttribute("aria-expanded")).toBe("false");
    expect(
        screen.getByRole("heading", { name: "Who controls routing?" }),
    ).toBeTruthy();
    expect(screen.getByText("Separate control from supply.")).toBeTruthy();
    expect(screen.queryByText("What would a customer rebuild?")).toBeNull();

    fireEvent.click(second);
    expect(second.getAttribute("aria-expanded")).toBe("true");
    expect(first.getAttribute("aria-expanded")).toBe("false");
    expect(
        screen.getByRole("heading", { name: "What would a customer rebuild?" }),
    ).toBeTruthy();
    expect(screen.queryByText("Who controls routing?")).toBeNull();

    fireEvent.click(second);
    expect(second.getAttribute("aria-expanded")).toBe("false");
    expect(
        screen.queryByRole("region", { name: "Framing summary" }),
    ).toBeNull();

    fireEvent.click(screen.getByText("Hide questions"));
    expect(screen.queryByRole("button", { name: "1 Position" })).toBeNull();
    expect(screen.getByText("Position · Switching")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start research" }));
    expect(start).toHaveBeenCalledOnce();
});
