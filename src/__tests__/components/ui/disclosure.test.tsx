import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";

const preference = vi.hoisted(() => ({ reduced: false }));
vi.mock("motion/react", async (importOriginal) => ({
    ...(await importOriginal<typeof import("motion/react")>()),
    useReducedMotion: () => preference.reduced,
}));
beforeEach(() => {
    preference.reduced = false;
});

function Example({
    kind,
    animated,
    keepMounted,
}: {
    kind: "accordion" | "collapsible";
    animated?: boolean;
    keepMounted?: boolean;
}) {
    const content = (
        <>
            <button type="button">Panel action</button>
            <input aria-label="Draft" defaultValue="Initial" />
        </>
    );
    return kind === "accordion" ? (
        <Accordion defaultValue={["topic"]} animated={animated}>
            <AccordionItem value="topic">
                <AccordionTrigger>Toggle details</AccordionTrigger>
                <AccordionContent keepMounted={keepMounted}>
                    {content}
                </AccordionContent>
            </AccordionItem>
        </Accordion>
    ) : (
        <Collapsible defaultOpen animated={animated}>
            <CollapsibleTrigger>Toggle details</CollapsibleTrigger>
            <CollapsibleContent keepMounted={keepMounted}>
                {content}
            </CollapsibleContent>
        </Collapsible>
    );
}

for (const kind of ["accordion", "collapsible"] as const) {
    test(`${kind} keeps exiting content mounted but inaccessible until its Motion exit completes`, async () => {
        render(<Example kind={kind} />);
        const trigger = screen.getByRole("button", { name: "Toggle details" });
        fireEvent.click(trigger);
        expect(trigger.getAttribute("aria-expanded")).toBe("false");
        expect(screen.queryByText("Panel action")).not.toBeNull();
        expect(
            screen.queryByRole("button", { name: "Panel action" }),
        ).toBeNull();
        await waitFor(() =>
            expect(screen.queryByText("Panel action")).toBeNull(),
        );
        fireEvent.click(trigger);
        expect(
            screen.getByRole("button", { name: "Panel action" }),
        ).toBeTruthy();
    });

    test(`${kind} closes without retaining content when animation is disabled`, () => {
        render(<Example kind={kind} animated={false} />);
        fireEvent.click(screen.getByRole("button", { name: "Toggle details" }));
        expect(screen.queryByText("Panel action")).toBeNull();
    });

    test(`${kind} uses the immediate native path for reduced motion`, () => {
        preference.reduced = true;
        render(<Example kind={kind} />);
        fireEvent.click(screen.getByRole("button", { name: "Toggle details" }));
        expect(screen.queryByText("Panel action")).toBeNull();
    });

    test(`${kind} preserves a mounted draft across interrupted and completed closing`, async () => {
        render(<Example kind={kind} keepMounted />);
        const trigger = screen.getByRole("button", { name: "Toggle details" });
        const input = screen.getByRole("textbox", {
            name: "Draft",
        }) as HTMLInputElement;
        fireEvent.change(input, { target: { value: "Analyst draft" } });
        fireEvent.click(trigger);
        fireEvent.click(trigger);
        expect(screen.getByRole("textbox", { name: "Draft" })).toBe(input);
        fireEvent.click(trigger);
        await waitFor(() =>
            expect(
                input.closest("[data-slot$='content']")?.hasAttribute("hidden"),
            ).toBe(true),
        );
        expect(screen.queryByRole("textbox", { name: "Draft" })).toBeNull();
        fireEvent.click(trigger);
        expect(screen.getByRole("textbox", { name: "Draft" })).toBe(input);
        expect(input.value).toBe("Analyst draft");
    });
}
