import {
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { StartScreenPreview } from "@/development/workbench-ui/start-screen-examples";
import { ResearchComposerView } from "@/components/workspace/start/research-composer-view";
import {
    CompanyMandatePanel,
    FramingClarification,
    FramingProposal,
} from "@/components/workspace/start/start-screens";

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
            screen.queryByRole("form", { name: "Clarify research context" }),
        ).toBeNull();
        expect(document.activeElement).toBe(
            screen.getByRole("region", { name: "Framing summary" }),
        );
        expect(start).not.toHaveBeenCalled();
    });
    it("accepts the system proposal without requiring a contextual answer", () => {
        const start = vi.fn();
        render(<FramingFixture needsContext onStart={start} />);
        fireEvent.click(
            screen.getByRole("button", { name: "Use proposed scope" }),
        );
        expect(
            screen.queryByRole("form", { name: "Clarify research context" }),
        ).toBeNull();
        expect(
            screen.queryByRole("region", { name: "Your clarification" }),
        ).toBeNull();
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
    it("preserves optional corrections and additional research questions", () => {
        render(<FramingFixture />);
        fireEvent.click(screen.getByRole("button", { name: "Edit Q1" }));
        expect(
            screen.queryByRole("textbox", { name: "Edit Q2 wording" }),
        ).toBeNull();
        fireEvent.change(
            screen.getByRole("textbox", { name: "Edit Q1 wording" }),
            {
                target: { value: "Who can change routing rules?" },
            },
        );
        expect(
            screen.getByRole<HTMLButtonElement>("button", {
                name: "Start research",
            }).disabled,
        ).toBe(true);
        fireEvent.click(screen.getByRole("button", { name: "Save question" }));
        fireEvent.click(screen.getByText("Add a research question"));
        fireEvent.change(
            screen.getByRole("textbox", {
                name: "Another question to investigate",
            }),
            { target: { value: "Who owns the repairer relationship?" } },
        );
        fireEvent.click(screen.getByRole("button", { name: "Add to framing" }));
        const summary = screen.getByRole("region", { name: "Framing summary" });
        expect(
            within(summary).getByText("Who can change routing rules?"),
        ).toBeTruthy();
        expect(
            within(summary).getByText("Who owns the repairer relationship?"),
        ).toBeTruthy();
    });
    it("cancels a question edit without changing its wording and returns focus", () => {
        render(<FramingFixture />);
        const edit = screen.getByRole("button", {
            name: "Edit Q1",
        });
        fireEvent.click(edit);
        fireEvent.change(
            screen.getByRole("textbox", { name: "Edit Q1 wording" }),
            { target: { value: "Discard this change" } },
        );
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
        expect(
            screen.queryByRole("textbox", { name: "Edit Q1 wording" }),
        ).toBeNull();
        expect(screen.getByText("Who controls routing?")).toBeTruthy();
        expect(document.activeElement).toBe(edit);
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
    const [questions, setQuestions] = useState([
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
                        onUseProposal={() => setShowContext(false)}
                    />
                ) : undefined
            }
            onAdjustScope={() => setShowContext(true)}
            questions={questions}
            onQuestionChange={(id, text) =>
                setQuestions((current) =>
                    current.map((question) =>
                        question.id === id ? { ...question, text } : question,
                    ),
                )
            }
            onAddQuestion={(text) =>
                setQuestions((current) => [
                    ...current,
                    {
                        id: `q${current.length + 1}`,
                        label: `Q${current.length + 1}`,
                        text,
                        rationale: "Additional research question.",
                    },
                ])
            }
            onStart={onStart}
        />
    );
}

it("keeps an unfinished question edit and launch guard when the pending program is folded", () => {
    render(
        <FramingProposal
            collapsible
            scope="Claims coordination"
            questions={[
                { id: "q1", label: "Q1", text: "Who controls the workflow?" },
            ]}
            onQuestionChange={vi.fn()}
            onStart={vi.fn()}
        />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Edit Q1$/ }));
    const editor = screen.getByRole("textbox", { name: "Edit Q1 wording" });
    fireEvent.change(editor, {
        target: { value: "Who can replace a service?" },
    });
    const disclosure = screen
        .getByText("Proposed research", { selector: "summary span" })
        .closest("details");
    if (!disclosure) throw new Error("Missing pending program disclosure");
    fireEvent.click(
        screen.getByText("Proposed research", { selector: "summary span" }),
    );
    expect(disclosure.open).toBe(false);
    expect(
        screen.getByRole<HTMLButtonElement>("button", {
            name: "Start research",
        }).disabled,
    ).toBe(true);
    fireEvent.click(
        screen.getByText("Proposed research", { selector: "summary span" }),
    );
    expect(
        screen.getByRole<HTMLTextAreaElement>("textbox", {
            name: "Edit Q1 wording",
        }).value,
    ).toBe("Who can replace a service?");
});
