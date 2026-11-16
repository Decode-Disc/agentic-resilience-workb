import { expect, type Locator, type Page } from "@playwright/test";

/** The opened dossier's detail: beside the list on wide screens, inside a side panel on narrow ones. */
export function dossierDetail(page: Page): Locator {
    return page.getByRole("region", { name: "Dossier detail" });
}

/** Closes the dossier detail the way its host offers: Escape for the side panel, its Close control inline. */
export async function closeDossierDetail(page: Page) {
    const detail = dossierDetail(page);
    const panel = page.getByRole("dialog").filter({ has: detail });
    if (await panel.count()) await page.keyboard.press("Escape");
    else await detail.getByRole("button", { name: "Close dossier" }).click();
    await expect(detail).toBeHidden();
}
