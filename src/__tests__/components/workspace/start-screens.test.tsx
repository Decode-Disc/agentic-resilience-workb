import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ResearchComposerView } from "@/components/workspace/start/research-composer-view";
import {
    CompanyMandatePanel,
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
    it("delegates framing edits and launch without inferring workflow state", () => {
        const activity = vi.fn(),
            question = vi.fn(),
            start = vi.fn();
        render(
            <FramingProposal
                introduction="Proposed scope"
                activities={[
                    { id: "claims", label: "Claims" },
                    { id: "network", label: "Network" },
                ]}
                activity="claims"
                onActivityChange={activity}
                questions={[
                    { id: "q1", label: "Q1", text: "Who controls routing?" },
                ]}
                onQuestionChange={question}
                onStart={start}
            />,
        );
        fireEvent.click(screen.getByRole("radio", { name: "Network" }));
        fireEvent.change(
            screen.getByRole("textbox", { name: "Q1 research question" }),
            { target: { value: "Who can change routing?" } },
        );
        fireEvent.click(screen.getByRole("button", { name: "Start research" }));
        expect(activity).toHaveBeenCalledWith("network");
        expect(question).toHaveBeenCalledWith("q1", "Who can change routing?");
        expect(start).toHaveBeenCalledTimes(1);
    });
    it("keeps confirmation controls disabled while its caller is preparing framing", () => {
        render(
            <CompanyMandatePanel
                company={{
                    name: "ExampleCo",
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
                name: "Change company",
            }).disabled,
        ).toBe(true);
    });
});
