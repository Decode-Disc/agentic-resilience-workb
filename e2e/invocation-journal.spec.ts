import {
    browserTestDossierRow,
    closeDossierDetail,
    dossierDetail,
} from "./support/admin";
import { expect } from "@playwright/test";
import type { internal } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import {
    admitAdministrator,
    expectAdmissionClosed,
} from "./support/admission";
import {
    browserTestSlot,
    closeBrowserTestContext,
    test,
} from "./support/browser-workspace";
import { runConvexJson } from "./support/convex-admin";
import { admitAnalyst } from "./support/source-review-fixture";

type Snapshot = FunctionReturnType<typeof internal.execution.fixtures.inspect>;
const backends = ["ai-sdk", "convex-agent", "pi-durable"] as const;
const definitions = ["inspection", "validation", "conversation"] as const;
// Every backend and definition at desktop width; one representative proves the narrow layout,
// whose rendering does not depend on the backend or definition.
const cases = [
    ...backends.flatMap((backend) =>
        definitions.map((definition) => ({
            backend,
            definition,
            viewport: { width: 1440, height: 1000 },
        })),
    ),
    {
        backend: "pi-durable",
        definition: "conversation",
        viewport: { width: 390, height: 844 },
    },
] as const;

for (const { backend, definition, viewport } of cases) {
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
            const missionId = await runConvexJson<string>(
                definition === "inspection"
                    ? "execution/fixtures:start"
                    : definition === "validation"
                      ? "execution/fixtures:startValidation"
                      : "execution/fixtures:startConversation",
                {
                    fixtureKey: `journal-${backend}-${definition}-${viewport.width}`,
                    slotKey: browserTestSlot(),
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
            const snapshot = await inspect();
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
            await admitAdministrator(page);
            await page
                .getByRole("tab", { name: "Dossiers", exact: true })
                .click();
            await page
                .getByRole("tab", {
                    name: "Browser tests",
                    exact: true,
                })
                .click();
            const row = await browserTestDossierRow(page, snapshot.runId);
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
                dialog.getByRole("tab", { name: /^Provider receipts/ }),
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
                const recorded = JSON.parse(
                    (await payload.textContent()) ?? "null",
                ) as {
                    input?: {
                        messages?: Array<{
                            role: string;
                            content:
                                | string
                                | Array<{ type: string; text?: string }>;
                        }>;
                    };
                    messages?: Array<{
                        role: string;
                        sections?: Record<string, string>;
                    }>;
                };
                const marker = "Required current mission state:\n";
                const contexts =
                    backend === "pi-durable"
                        ? (recorded.messages ?? []).flatMap((message) => {
                              const state =
                                  message.role === "system"
                                      ? message.sections
                                            ?.workbench_current_state
                                      : undefined;
                              return state?.startsWith(marker)
                                  ? [state.slice(marker.length)]
                                  : [];
                          })
                        : // The provider request: required state is the user message.
                          (recorded.input?.messages ?? []).flatMap((message) =>
                              message.role !== "user"
                                  ? []
                                  : typeof message.content === "string"
                                    ? [message.content]
                                    : message.content.flatMap((part) =>
                                          part.type === "text" && part.text
                                              ? [part.text]
                                              : [],
                                      ),
                          );
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
                                // The required state keeps a compact observation; the full
                                // input and result stay readable through its history reference.
                                expect.objectContaining({
                                    input: expect.objectContaining({
                                        kind: "wait_fixture_result",
                                    }),
                                    status: "completed",
                                    outcome: expect.objectContaining({
                                        kind: "success",
                                    }),
                                    historyReference: expect.any(String),
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
            expect(await inspect()).toEqual(snapshot);
            expect(errors).toEqual([]);
        } finally {
            await closeBrowserTestContext(analystPage);
            await analystContext.close();
        }
    });
}
