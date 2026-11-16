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
