import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { expect, test } from "@playwright/test";
import manifest from "@/__tests__/design-system/workbench-ui/references/manifest.json" with {
    type: "json",
};

test.beforeAll(async () => {
    for (const file of ["tokens.css", "bundle.css"] as const) {
        const bytes = await readFile(
            new URL(`../references/${file}`, import.meta.url),
        );
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(
            manifest[file],
        );
    }
});

for (const [name, reference] of Object.entries(manifest.references))
    for (const theme of ["light", "dark"]) {
        test(`${name} ${theme} matches frozen reference`, async ({
            page,
        }, info) => {
            const source = await readFile(
                new URL(`../references/${name}.html`, import.meta.url),
            );
            expect(createHash("sha256").update(source).digest("hex")).toBe(
                reference.sha256,
            );
            await page.setViewportSize({
                width: reference.width,
                height: name === "AppraisalBlock" ? 800 : reference.height,
            });
            await page.clock.install({
                time: new Date("2026-10-27T11:59:00Z"),
            });
            await page.clock.pauseAt(new Date("2026-10-27T12:00:00Z"));
            await page.goto(`/reference/${name}?theme=${theme}`);
            await page.evaluate(() => document.fonts.ready);
            await page.addStyleTag({
                content:
                    "*,*::before,*::after{transition:none!important;animation:none!important}",
            });
            const capture =
                name === "InventorySheet"
                    ? manifest.captures.InventorySheet
                    : undefined;
            const referenceBox = capture
                ? await page.locator(capture.reference).boundingBox()
                : null;
            const expected = capture
                ? await page
                      .locator(capture.reference)
                      .screenshot({ animations: "disabled" })
                : await page.screenshot({ animations: "disabled" });
            const path = info.snapshotPath("reference.png");
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, expected);
            const errors: string[] = [];
            page.on("pageerror", (e) => errors.push(e.message));
            await page.goto(`/?component=${name}&theme=${theme}`);
            await page.locator(`[data-component="${name}"]`).waitFor();
            if (name === "InventorySheet")
                await page
                    .getByRole("button", {
                        name: "Open inventory",
                        exact: true,
                    })
                    .click();
            await page.evaluate(() => document.fonts.ready);
            await page.addStyleTag({
                content:
                    "*,*::before,*::after{transition:none!important;animation:none!important}",
            });
            await expect(page.locator("vite-error-overlay")).toHaveCount(0);
            if (capture)
                expect(
                    await page.locator(capture.actual).boundingBox(),
                ).toEqual(referenceBox);
            const actual = capture
                ? await page
                      .locator(capture.actual)
                      .screenshot({ animations: "disabled" })
                : await page.screenshot({ animations: "disabled" });
            await expect(actual).toMatchSnapshot("reference.png", {
                threshold: 0,
                maxDiffPixels: 0,
            });
            expect(errors).toEqual([]);
        });
    }

test("inventory closes with Escape and carries its dark theme through the portal", async ({
    page,
}) => {
    await page.goto("/?component=InventorySheet&theme=dark");
    await page
        .getByRole("button", { name: "Open inventory", exact: true })
        .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
        dialog.locator("xpath=ancestor::*[@data-theme][1]"),
    ).toHaveAttribute("data-theme", "dark");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(
        page.getByRole("button", { name: "Open inventory" }),
    ).toBeFocused();
});

test("narrow gallery preserves component geometry with horizontal scrolling", async ({
    page,
}) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?component=QuestionCard&theme=light");
    await expect(page.locator('[data-component="QuestionCard"]')).toHaveCSS(
        "width",
        "1040px",
    );
    expect(
        await page
            .locator(".gallery-scroll")
            .evaluate((el) => el.scrollWidth > el.clientWidth),
    ).toBe(true);
});

test("inventory keeps keyboard focus contained and restores its trigger after animated dismissal", async ({
    page,
}) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/?component=InventorySheet&theme=light");
    const trigger = page.getByRole("button", {
        name: "Open inventory",
        exact: true,
    });
    await page.keyboard.press("Tab");
    await expect(trigger).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(
        page.getByRole("searchbox", { name: "Search assertions" }),
    ).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(
        page.getByRole("button", {
            name: "Q3 Context · integrations to replace",
        }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(trigger).toBeFocused();
});

test("inventory search and filters operate on the supplied illustrative assertions", async ({
    page,
}) => {
    await page.goto("/?component=InventorySheet&theme=light");
    await page
        .getByRole("button", { name: "Open inventory", exact: true })
        .click();
    await page
        .getByRole("searchbox", { name: "Search assertions" })
        .fill("insurer");
    await page.getByRole("button", { name: "Fact 64" }).click();
    await expect(
        page.getByRole("table", { name: "Evidence by question" }),
    ).toBeVisible();
    await expect(
        page.getByText(
            "CCC reports insurer-configurable workflows connecting insurers and repairers.",
            { exact: true },
        ),
    ).toBeVisible();
    await expect(
        page.getByText(
            "Workflow execution alone does not establish authority over insurer decisions.",
            { exact: true },
        ),
    ).toHaveCount(0);
});

test("reader pagination keeps the displayed page position in sync", async ({
    page,
}) => {
    await page.goto("/?component=SourceReader&theme=light");
    await page.getByRole("button", { name: "Previous passage" }).click();
    await expect(page.getByText("p. 7 / 142", { exact: true })).toBeVisible();
    await expect(
        page.getByRole("button", { name: "Previous passage" }),
    ).toBeDisabled();
});

test("the gallery index remains available until an inventory preview is opened", async ({
    page,
}) => {
    await page.goto("/");
    await expect(
        page.getByRole("heading", { name: "Workbench UI", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page
        .getByRole("button", { name: "Open inventory", exact: true })
        .filter({ hasText: "Open inventory" })
        .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(
        page.getByRole("table", { name: "Evidence by question" }),
    ).toBeVisible();
    await expect(
        page
            .getByRole("table", { name: "Evidence by question" })
            .getByRole("row"),
    ).toHaveCount(4);
    await page.keyboard.press("Escape");
    await expect(
        page
            .getByRole("button", { name: "Open inventory", exact: true })
            .filter({ hasText: "Open inventory" }),
    ).toBeFocused();
});
