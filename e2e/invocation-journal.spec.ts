import { readFileSync } from "node:fs";
import { closeDossierDetail, dossierDetail } from "./support/admin";
import { expect } from "@playwright/test";
import type { internal } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import {
    accessCodeField,
    expectAdmissionClosed,
    submitAccessCode,
} from "./support/admission";
import { closeBrowserTestContext, test } from "./support/browser-workspace";
import { runConvexJson } from "./support/convex-cli";
import { admitAnalyst } from "./support/source-review-fixture";

type Snapshot = FunctionReturnType<typeof internal.execution.fixtures.inspect>;
for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
]) {
    for (const backend of ["ai-sdk", "convex-agent", "pi-durable"] as const) {
        for (const definition of [
            "inspection",
            "validation",
            "conversation",
        ] as const) {
            test(`administrator inspects the ${definition} journal with ${backend} after reconnection at ${viewport.width}px`, async ({
                page,
                browser,
            }) => {
                test.setTimeout(240_000);
                await page.setViewportSize(viewport);
                const errors: string[] = [];
                page.on("pageerror", (error) => errors.push(error.message));
                page.on("console", (message) => {
                    if (message.type() === "error") errors.push(message.text());
                });
                const analystContext = await browser.newContext({
                    baseURL: test.info().project.use.baseURL,
                    reducedMotion: "reduce",
                });
                const analystPage = await analystContext.newPage();
                try {
                    await admitAnalyst(analystPage);
                    const missionId = runConvexJson<string>(
                        definition === "inspection"
                            ? "execution/fixtures:start"
                            : definition === "validation"
                              ? "execution/fixtures:startValidation"
                              : "execution/fixtures:startConversation",
                        {
                            fixtureKey: `journal-${backend}-${definition}-${viewport.width}`,
                            generationBackend: {
                                id: backend,
                                version: backend === "convex-agent" ? 2 : 1,
                            },
                        },
                    );
                    const inspect = () =>
                        runConvexJson<Snapshot>("execution/fixtures:inspect", {
                            missionId,
                        });
                    await expect
                        .poll(inspect, { timeout: 180_000 })
                        .toMatchObject({
                            status: "completed",
                            providerCallCount: 0,
                        });
                    const snapshot = inspect();
                    expect(snapshot.generationBackends).toEqual(
                        Array.from(
                            { length: snapshot.invocationCount },
                            () => ({
                                id: backend,
                                version: backend === "convex-agent" ? 2 : 1,
                            }),
                        ),
                    );
                    expect(snapshot.backendStorageCount).toBe(
                        backend === "convex-agent"
                            ? snapshot.invocationCount
                            : 0,
                    );
                    await page.goto("/workspace/admin");
                    const material = JSON.parse(
                        readFileSync("invitation-otp-codes.local", "utf8"),
                    ) as { invitations: Array<{ role: string; code: string }> };
                    const invitation = material.invitations.find(
                        (item) => item.role === "admin",
                    );
                    if (!invitation)
                        throw new Error(
                            "Local administrator invitation is missing",
                        );
                    await expect(accessCodeField(page)).toBeVisible({
                        timeout: 30_000,
                    });
                    await submitAccessCode(page, invitation.code);
                    await expectAdmissionClosed(page);
                    await page
                        .getByRole("tab", { name: "Dossiers", exact: true })
                        .click();
                    await page
                        .getByRole("tab", {
                            name: "Browser tests",
                            exact: true,
                        })
                        .click();
                    const row = page.locator('[data-slot="item"]').filter({
                        has: page.getByText(snapshot.runId, { exact: true }),
                    });
                    await row
                        .getByRole("button", {
                            name: "Open dossier",
                            exact: true,
                        })
                        .click();
                    await dossierDetail(page)
                        .getByRole("tab", { name: "Execution journal" })
                        .click();
                    const dialog = dossierDetail(page);
                    const journal = dialog.getByRole("region", {
                        name: "Execution journal",
                    });
                    await expect(
                        dialog.getByText("Provider receipts", { exact: true }),
                    ).toBeVisible();
                    await expect(
                        journal.getByRole("heading", {
                            name: "Execution journal",
                        }),
                    ).toBeVisible();
                    const event = journal
                        .getByRole("button", { name: /Request recorded/ })
                        .first();
                    await event.focus();
                    await expect(event).toBeFocused();
                    await page.keyboard.press("Enter");
                    await expect(
                        journal.getByText("Simulation · Not live", {
                            exact: true,
                        }),
                    ).toBeVisible();
                    const request = journal.getByRole("button", {
                        name: "Request snapshot",
                        exact: true,
                    });
                    await request.focus();
                    await page.keyboard.press("Enter");
                    const payload = journal.locator("pre");
                    await expect(payload).toContainText(
                        '"provenance":"simulation"',
                    );
                    await expect(payload).toContainText(
                        definition === "inspection"
                            ? "availableMaterials"
                            : definition === "validation"
                              ? "validationValues"
                              : "conversationInstructions",
                    );
                    if (definition === "conversation") {
                        const recorded = JSON.parse((await payload.textContent()) ?? "null") as {
                            input?: { prompt: Array<{ role: string; content: string | Array<{ type: string; text?: string }> }> };
                            messages?: Array<{ role: string; content: string }>;
                        };
                        const marker = "Required current mission state:\n";
                        const contexts = backend === "pi-durable"
                            ? (recorded.messages ?? []).flatMap(message => message.role === "system" && message.content.includes(marker) ? [message.content.slice(message.content.indexOf(marker) + marker.length)] : [])
                            : (recorded.input?.prompt ?? []).flatMap(message => message.role === "user" && Array.isArray(message.content) ? message.content.flatMap(part => part.type === "text" && part.text ? [part.text] : []) : []);
                        expect(contexts).toHaveLength(1);
                        expect(JSON.parse(contexts[0] ?? "null")).toMatchObject(
                            {
                                conversationInstructions: {
                                    instructionVersion: 2,
                                    messages: [
                                        expect.objectContaining({
                                            delivery: "queue",
                                            text: "Simulation only: explain retained work.",
                                        }),
                                        expect.objectContaining({
                                            delivery: "steer",
                                            text: "Simulation only: keep the scope narrow.",
                                        }),
                                    ],
                                },
                                triggeringRequestsAndResults:
                                    expect.arrayContaining([
                                        expect.objectContaining({
                                            input: {
                                                kind: "wait_fixture_result",
                                                value: 7,
                                            },
                                            status: "completed",
                                            outcome: {
                                                kind: "success",
                                                valueJson: '{"value":14}',
                                            },
                                        }),
                                    ]),
                            },
                        );
                        await expect(payload).not.toContainText(
                            "queued-follow-up-fixture",
                        );
                        expect(snapshot.runExecutionStatus).toBe("paused");
                        expect(snapshot.conversationTurnStatus).toBe(
                            "published",
                        );
                        expect(snapshot.conversationQueuedCount).toBe(1);
                        expect(snapshot.operations).toContain(
                            "wait_fixture_result",
                        );
                        expect(snapshot.outcomes).toContain("success");
                    }
                    await payload.focus();
                    await expect(payload).toBeFocused();
                    expect(
                        (await payload.textContent())?.length,
                    ).toBeGreaterThan(1000);
                    await page.screenshot({
                        path: test
                            .info()
                            .outputPath(
                                `journal-${backend}-${definition}-${viewport.width}.png`,
                            ),
                    });
                    expect(
                        await dialog.evaluate(
                            (element) =>
                                element.scrollWidth <= element.clientWidth,
                        ),
                    ).toBe(true);
                    await journal
                        .getByRole("button", {
                            name: "Reply snapshot",
                            exact: true,
                        })
                        .click();
                    await expect(payload).toContainText('"content"');
                    await expect(payload).toContainText(
                        '"provenance":"simulation"',
                    );
                    await expect(payload).not.toContainText(
                        definition === "inspection"
                            ? "availableMaterials"
                            : definition === "validation"
                              ? "validationValues"
                              : "conversationInstructions",
                    );
                    const more = journal.getByRole("button", {
                        name: "Load more events",
                        exact: true,
                    });
                    if (
                        definition !== "conversation" ||
                        (await more.isVisible())
                    )
                        await more.click();
                    await expect(
                        journal.getByRole("button", {
                            name: /mission completed/,
                        }),
                    ).toBeVisible();
                    await journal
                        .getByRole("button", { name: /Operation completed/ })
                        .first()
                        .click();
                    await journal
                        .getByRole("button", {
                            name: "Operation request and result",
                            exact: true,
                        })
                        .click();
                    await expect(journal.locator("pre")).toContainText(
                        definition === "inspection"
                            ? '"kind": "consult_mission_state"'
                            : definition === "validation"
                              ? '"kind": "check_fixture_value"'
                              : '"kind": "wait_fixture_result"',
                    );
                    await expect(journal.locator("pre")).toContainText(
                        '"kind": "success"',
                    );
                    // The open dossier is part of the address; close it so reconnection reopens it from the list.
                    await closeDossierDetail(page);
                    await page.context().setOffline(true);
                    await page.context().setOffline(false);
                    await page.reload();
                    await expect(
                        page.getByRole("heading", {
                            name: "Administration",
                            exact: true,
                        }),
                    ).toBeVisible();
                    await expectAdmissionClosed(page);
                    await page
                        .getByRole("tab", { name: "Dossiers", exact: true })
                        .click();
                    await page
                        .getByRole("tab", {
                            name: "Browser tests",
                            exact: true,
                        })
                        .click();
                    await row
                        .getByRole("button", {
                            name: "Open dossier",
                            exact: true,
                        })
                        .click();
                    await dossierDetail(page)
                        .getByRole("tab", { name: "Execution journal" })
                        .click();
                    await expect(
                        journal.getByRole("heading", {
                            name: "Execution journal",
                        }),
                    ).toBeVisible();
                    await expect(journal.locator("pre")).toHaveCount(0);
                    await closeDossierDetail(page);
                    await expect(
                        row.getByRole("button", {
                            name: "Open dossier",
                            exact: true,
                        }),
                    ).toBeFocused();
                    expect(inspect()).toEqual(snapshot);
                    expect(errors).toEqual([]);
                } finally {
                    closeBrowserTestContext(analystPage);
                    await analystContext.close();
                }
            });
        }
    }
}
