import type { Page } from "@playwright/test";

/** Opens optional program review without folding an already-open editor. */
export async function reviewResearchProgram(page: Page) {
    const panel = page.locator('[data-slot="conversation-pending-details"]');
    await panel.waitFor({ state: "attached" });
    if (
        !(await panel.evaluate(
            (node) => node instanceof HTMLDetailsElement && node.open,
        ))
    ) {
        await panel.locator(":scope > summary").click();
    }
}

/** Enters the program inspector before requesting its scope correction. */
export async function changeResearchScope(page: Page) {
    const change = page.getByRole("button", {
        name: "Change scope",
        exact: true,
    });
    if (!(await change.isVisible())) await inspectResearchProgram(page);
    await change.click();
}

/** Opens the research-context card, whose scope actions include View framing and Change scope. */
export async function inspectResearchProgram(page: Page) {
    const context = page.getByRole("button", {
        name: "Research context",
        exact: true,
    });
    if ((await context.getAttribute("aria-expanded")) !== "true")
        await context.click();
}
