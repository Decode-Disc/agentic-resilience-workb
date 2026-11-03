import { expect, test } from "@playwright/test";

for (const width of [1440, 390]) {
    for (const theme of ["light", "dark"] as const) {
        test(`theme switch preserves the framing draft ${theme} ${width}`, async ({
            page,
        }) => {
            const errors: string[] = [];
            page.on("pageerror", (error) => errors.push(error.message));
            await page.setViewportSize({ width, height: 1000 });
            await page.goto(
                `/?layout=start&screen=framing&theme=${theme}&impeccable=0#program`,
            );
            const draft = page.getByRole("textbox", {
                name: "Refine the framing in your own words",
                exact: true,
            });
            await draft.fill("Keep the focus on coordination.");
            await page.screenshot({
                path: `/tmp/theme-before-${theme}-${width}.png`,
            });
            const documents: string[] = [];
            page.on("request", (request) => {
                if (request.resourceType() === "document")
                    documents.push(request.url());
            });
            await page.getByLabel("Switch theme", { exact: true }).click();
            const next = theme === "light" ? "dark" : "light";
            await expect(page).toHaveURL(new RegExp(`theme=${next}`));
            expect(documents).toEqual([]);
            await expect(draft).toHaveValue("Keep the focus on coordination.");
            await expect(page.locator(".start-screen-preview")).toHaveAttribute(
                "data-theme",
                next,
            );
            expect(
                await page
                    .locator("html")
                    .evaluate((element) => element.classList.contains("dark")),
            ).toBe(next === "dark");
            const url = new URL(page.url());
            expect(url.searchParams.get("screen")).toBe("framing");
            expect(url.searchParams.get("impeccable")).toBe("0");
            expect(url.hash).toBe("#program");
            const toggle = page.getByRole("button", {
                name: "Switch theme",
                exact: true,
            });
            await expect(toggle.locator("svg")).toHaveCount(1);
            await page.mouse.move(0, 0);
            await toggle.focus();
            await toggle.press("Tab");
            await page.keyboard.press("Shift+Tab");
            await expect(page.getByRole("tooltip")).toContainText(
                `Switch to ${theme} theme`,
            );
            await expect(toggle).toHaveAccessibleDescription(
                `Switch to ${theme} theme`,
            );
            await page.mouse.move(0, 0);
            await page.screenshot({
                path: `/tmp/theme-after-${next}-${width}.png`,
            });
            await toggle.press("Enter");
            await expect(page).toHaveURL(new RegExp(`theme=${theme}`));
            await expect(draft).toHaveValue("Keep the focus on coordination.");
            expect(documents).toEqual([]);
            expect(errors).toEqual([]);
        });
    }
}

for (const layout of ["catalog", "gallery", "chat-mocks"]) {
    test(`theme switch updates ${layout} without navigation`, async ({
        page,
    }) => {
        await page.goto(
            layout === "catalog"
                ? "/?theme=dark"
                : layout === "gallery"
                  ? "/?component=Composer&theme=dark"
                  : "/?layout=chat-mocks&theme=dark",
        );
        const documents: string[] = [];
        page.on("request", (request) => {
            if (request.resourceType() === "document")
                documents.push(request.url());
        });
        await page
            .getByRole("banner")
            .first()
            .getByRole("button", { name: "Switch theme", exact: true })
            .click();
        await expect(page).toHaveURL(/theme=light/);
        if (layout !== "catalog") {
            await expect(page.locator(".wb-ui").first()).toHaveAttribute(
                "data-theme",
                "light",
            );
        }
        expect(
            await page
                .locator("html")
                .evaluate((element) => element.classList.contains("dark")),
        ).toBe(false);
        expect(documents).toEqual([]);
    });
}
