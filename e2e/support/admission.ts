import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Locates the admission field by its stable id instead of its visible label, so
 * renaming the label cannot turn an absence assertion into a vacuous pass.
 */
export function accessCodeField(page: Page): Locator {
    return page.locator("#invitation-code");
}

/** Admits the visitor through the real drawer without depending on its copy. */
export async function submitAccessCode(
    page: Page,
    code: string,
): Promise<void> {
    await accessCodeField(page).fill(code);
    await page.locator("form:has(#invitation-code) button[type=submit]").click();
}

/** Proves the admission surface is not rendered for the current session. */
export async function expectAdmissionClosed(page: Page): Promise<void> {
    await expect(accessCodeField(page)).toHaveCount(0);
}
