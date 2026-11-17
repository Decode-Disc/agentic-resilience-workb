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

/** Reveals and returns a Browser tests dossier row, paging forward if concurrent workers added newer runs. */
export async function browserTestDossierRow(
    page: Page,
    runId: string,
): Promise<Locator> {
    const panel = page.getByRole("tabpanel", { name: "Browser tests" });
    await expect(
        panel.getByRole("button", { name: "Open dossier", exact: true }).first(),
    ).toBeVisible();
    const row = panel
        .locator('[data-slot="item"]')
        .filter({ has: page.getByText(runId, { exact: true }) });
    const loadMore = panel.getByRole("button", {
        name: "Load more dossiers",
        exact: true,
    });
    for (let pageIndex = 0; pageIndex < 5; pageIndex += 1) {
        if ((await row.count()) > 0) return row;
        if ((await loadMore.count()) === 0) break;
        const previousCount = await panel
            .getByRole("button", { name: "Open dossier", exact: true })
            .count();
        await loadMore.click();
        await expect
            .poll(() =>
                panel
                    .getByRole("button", { name: "Open dossier", exact: true })
                    .count(),
            )
            .toBeGreaterThan(previousCount);
    }
    return row;
}
