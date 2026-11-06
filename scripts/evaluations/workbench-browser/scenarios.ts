import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import {
    type FunctionArgs,
    type FunctionReference,
    type FunctionReturnType,
    getFunctionName,
    makeFunctionReference,
} from "convex/server";
import { api, internal } from "../../../convex/_generated/api.js";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import {
    type ConfigurableCampaignManifest,
    campaignConfiguration,
    type QualificationScenario,
} from "../../../convex/qualificationCampaignPolicy.ts";
import { openQualificationJournal } from "./journal.ts";
import { sha256 } from "./protocol.ts";

function ref<R extends FunctionReference<"query" | "mutation", "internal">>(
    r: R,
) {
    return makeFunctionReference<
        R["_type"],
        FunctionArgs<R>,
        FunctionReturnType<R>
    >(getFunctionName(r));
}
const save = (root: string, name: string, value: unknown) =>
    writeFileSync(
        join(root, `${name}.json`),
        `${JSON.stringify(value, null, 2)}\n`,
        { mode: 0o600 },
    );
type Dossier = { id: string; runId: Id<"researchRuns">; fixtureKey: string };
function prepared(root: string): { cases: Dossier[] } {
    return JSON.parse(readFileSync(join(root, "prepared.json"), "utf8"));
}
/** Creates one fresh, labelled dossier per declared path. No user action or provider is executed here. */
export async function prepareCampaignScenarios(
    client: ConvexHttpClient,
    root: string,
    manifest: ConfigurableCampaignManifest,
    lotId: Id<"qualificationLots">,
    configurationId: string,
    relayOrigin?: string,
) {
    assert(
        !existsSync(join(root, "prepared.json")),
        "Scenario preparation cannot be renewed",
    );
    const profile = campaignConfiguration(manifest, configurationId);
    const contextKey = `campaign-${randomUUID()}`;
    const contextId = await client.mutation(
        ref(internal.runWorkspace.openBrowserTestContext),
        {
            slotKey: "analyst-4",
            contextKey,
            durationMs: Math.min(40 * 60000, manifest.expiresAt - Date.now()),
        },
    );
    await client.mutation(ref(internal.qualificationCampaigns.bind), {
        lotId,
        contextId,
    });
    const cases: Dossier[] = [];
    // Persist incremental progress so cleanup and audit remain possible after a failed seed.
    save(root, "prepared", { cases });
    for (const scenario of manifest.scenarios) {
        const fixtureKey = `scenario-${randomUUID()}`;
        const result = await client.mutation(
            ref(internal.e2eFixtures.seedSourceReviewScenario),
            {
                slotKey: "analyst-4",
                fixtureKey,
                emptyDocumentaryMaterial: true,
                recordedScenario: {
                    companyName: scenario.company.name,
                    companyCik: scenario.company.cik,
                    ticker: scenario.company.ticker,
                    websiteUrl: scenario.company.websiteUrl,
                    researchAngle: scenario.framing.scope,
                    sources: [],
                },
            },
        );
        cases.push({ id: scenario.id, runId: result.runId, fixtureKey });
        save(root, "prepared", { cases });
    }
    const dossiers = cases.map((c) => ({
        runId: c.runId,
        fixtureKey: c.fixtureKey,
        scenarioId: c.id,
    }));
    if (manifest.mode === "deterministic")
        await client.mutation(
            ref(internal.execution.fixtures.bindCampaignScenarios),
            { dossiers },
        );
    else {
        const first = cases[0];
        assert(first);
        await client.mutation(
            ref(internal.execution.fixtures.authorizeWorkbenchQualification),
            {
                runId: first.runId,
                fixtureKey: first.fixtureKey,
                dossiers,
                relayOrigin,
                maximumRequests: manifest.perLot.model,
                maximumCostUsd: manifest.perLot.costUsd,
                ...(manifest.capability === "sources"
                    ? {
                          sourcesLot: dossiers,
                          responseControllerModel: profile.controllerModel,
                          expectedModels: {
                              workbench: profile.models.workbench.model,
                              sources: profile.models.sources?.model ?? "",
                          },
                          reasoningSelection: {
                              workbench: profile.models.workbench.reasoning,
                              sources:
                                  profile.models.sources?.reasoning ??
                                  "recommended",
                          },
                      }
                    : {}),
            },
        );
    }
    if (relayOrigin) {
        const first = cases[0];
        assert(first);
        save(
            root,
            "relay-route",
            await client.query(
                ref(internal.execution.fixtures.qualificationRoute),
                { runId: first.runId, fixtureKey: first.fixtureKey },
            ),
        );
    }
}

/** Exports complete cursor-based inventories, transcripts and hash-checked captures, without retaining signed URLs. */
export async function inspectCampaignScenarios(
    client: ConvexHttpClient,
    root: string,
) {
    for (const c of prepared(root).cases) {
        const args = { runId: c.runId, fixtureKey: c.fixtureKey };
        const directory = join(root, c.id);
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        save(
            directory,
            "snapshot",
            await client.query(
                ref(internal.execution.fixtures.qualificationSnapshot),
                args,
            ),
        );
        for (const kind of [
            "receipts",
            "missions",
            "requests",
            "sources",
            "tasks",
            "captures",
            "messages",
        ] as const) {
            let cursor: string | null = null;
            let pageNumber = 0;
            do {
                const result: FunctionReturnType<
                    typeof internal.execution.fixtures.inspectQualificationPage
                > = await client.query(
                    ref(internal.execution.fixtures.inspectQualificationPage),
                    { ...args, kind, paginationOpts: { cursor, numItems: 32 } },
                );
                if ("downloads" in result) {
                    const downloads: Extract<
                        FunctionReturnType<
                            typeof internal.execution.fixtures.inspectQualificationPage
                        >,
                        { downloads: unknown }
                    >["downloads"] = result.downloads;
                    for (const download of downloads) {
                        const capture: Doc<"sourceCaptures"> | undefined =
                            result.page.find(
                                (row) => row._id === download.captureId,
                            );
                        assert(
                            capture &&
                                "contentHash" in capture &&
                                capture.contentHash,
                            "Capture hash unavailable",
                        );
                        const response: Response = await fetch(download.url, {
                            signal: AbortSignal.timeout(30000),
                        });
                        assert(response.ok, "Capture download failed");
                        const bytes: Buffer = Buffer.from(
                            await response.arrayBuffer(),
                        );
                        assert.equal(
                            sha256(bytes),
                            capture.contentHash,
                            "Capture bytes changed",
                        );
                        writeFileSync(
                            join(
                                directory,
                                `capture-${download.captureId}.txt`,
                            ),
                            bytes,
                            { mode: 0o600 },
                        );
                    }
                }
                const { downloads: _, ...retained } = {
                    downloads: undefined,
                    ...result,
                };
                save(directory, `${kind}-${++pageNumber}`, retained);
                if (result.isDone) break;
                assert(
                    result.continueCursor !== cursor,
                    "Audit cursor did not advance",
                );
                cursor = result.continueCursor;
            } while (cursor);
        }
        let cursor: string | null = null;
        let pageNumber = 0;
        do {
            const page: FunctionReturnType<
                typeof internal.execution.fixtures.inspectSourcesInvocations
            > = await client.query(
                ref(internal.execution.fixtures.inspectSourcesInvocations),
                { ...args, paginationOpts: { cursor, numItems: 1 } },
            );
            save(directory, `invocations-${++pageNumber}`, page);
            if (page.isDone) break;
            assert(page.continueCursor !== cursor);
            cursor = page.continueCursor;
        } while (cursor);
    }
}

/** Finite action interpreter. Configuration supplies domain actions and text, never executable code or selectors. */
export async function runCampaignScenarios(
    page: Page,
    client: ConvexHttpClient,
    web: string,
    convex: string,
    root: string,
    manifest: ConfigurableCampaignManifest,
    interrupted: () => boolean,
) {
    const protocol = JSON.parse(
        readFileSync(join(root, "protocol.json"), "utf8"),
    );
    const journal = openQualificationJournal(root, protocol);
    const errors: string[] = [];
    page.on("pageerror", () => errors.push("page_error"));
    page.on("console", (m) => {
        if (m.type() === "error") errors.push("console_error");
    });
    await page.goto(`${web}/workspace/dossiers`);
    const token = await page.evaluate(() => {
        const keys = Object.keys(localStorage).filter((k) =>
            k.startsWith("__convexAuthJWT"),
        );
        return keys.length === 1 ? localStorage.getItem(keys[0] ?? "") : null;
    });
    assert(token, "Admitted session required");
    const admitted = new ConvexHttpClient(convex, { logger: false });
    admitted.setAuth(token);
    await expect
        .poll(() => admitted.query(api.visitors.current), { timeout: 20000 })
        .toMatchObject({ status: "active" });
    for (const c of prepared(root).cases) {
        const scenario = manifest.scenarios.find((s) => s.id === c.id);
        assert(scenario);
        assert(journal.begin(c.id), "Scenario already completed");
        const directory = join(root, c.id);
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        let activeStep = "initialize";
        let held = false;
        let armed:
            | undefined
            | "malformed_response"
            | "http_refusal"
            | "concurrent_edit";
        let controlKey: string | undefined;
        const requiredFaults: Array<{ key: string; event: string }> = [];
        const inspect = () =>
            client.query(
                ref(internal.execution.fixtures.qualificationSnapshot),
                { runId: c.runId, fixtureKey: c.fixtureKey },
            );
        type Snapshot = Awaited<ReturnType<typeof inspect>>;
        const settled = (s: Snapshot) =>
            s.nativeSettled &&
            !s.conversation?.activeTurnId &&
            !s.conversation?.queuedCount;
        const wait = async (
            state:
                | "conversation_settled"
                | "sources_prepared"
                | "paused"
                | "running",
        ) => {
            await expect
                .poll(
                    async () => {
                        assert(!interrupted(), "Campaign interrupted");
                        const s = await inspect();
                        if (state === "conversation_settled") return settled(s);
                        if (state === "sources_prepared")
                            return (
                                settled(s) &&
                                s.run.lifecycleState === "sources_prepared" &&
                                s.run.executionStatus === "idle" &&
                                !!s.sourcesMission &&
                                [
                                    "completed",
                                    "blocked",
                                    "failed",
                                    "cancelled",
                                ].includes(s.sourcesMission.status)
                            );
                        return s.run.executionStatus === state;
                    },
                    {
                        timeout:
                            manifest.mode === "deterministic" ? 120000 : 900000,
                        intervals: [500, 1000],
                    },
                )
                .toBe(true);
        };
        const release = () => {
            if (controlKey)
                writeFileSync(join(root, `release-${controlKey}`), "release", {
                    mode: 0o600,
                });
        };
        const framing = async (content: QualificationScenario["framing"]) => {
            const before = await inspect();
            assert(before.framing);
            await admitted.mutation(api.framing.save, {
                runId: c.runId,
                expectedRevision: before.framing.revision,
                requestKey: `${c.fixtureKey}:${activeStep}`,
                content,
            });
            const question = content.questions[0];
            assert(question);
            await expect(
                page.getByRole("button", {
                    name: question.shortLabel,
                    exact: true,
                }),
            ).toBeVisible({ timeout: 20000 });
        };
        try {
            save(root, "control", {
                runId: c.runId,
                mode: manifest.mode,
                scenario: `${c.id}-initial`,
            });
            await client.mutation(
                ref(internal.execution.fixtures.activateWorkbench),
                {
                    runId: c.runId,
                    fixtureKey: c.fixtureKey,
                    researchAngle: scenario.framing.scope,
                },
            );
            await page.setViewportSize({ width: 1440, height: 1000 });
            await page.goto(`${web}/workspace/${c.runId}`);
            await wait("conversation_settled");
            for (const step of scenario.steps) {
                activeStep = step.id;
                assert(!interrupted(), "Campaign interrupted");
                save(directory, `${step.id}-before`, await inspect());
                switch (step.action) {
                    case "save_framing":
                        await framing(step.content ?? scenario.framing);
                        break;
                    case "send_message": {
                        const previous = (await inspect()).lastMessage?._id;
                        controlKey = `${c.id}-${step.id}`;
                        save(root, "control", {
                            runId: c.runId,
                            mode: manifest.mode,
                            scenario: controlKey,
                            hold: armed === "concurrent_edit",
                            injectInvalidFraming:
                                armed === "malformed_response",
                            injectHttpRefusal: armed === "http_refusal",
                        });
                        const expectedFault = armed;
                        if (expectedFault)
                            requiredFaults.push({
                                key: controlKey,
                                event:
                                    expectedFault === "concurrent_edit"
                                        ? "gate_armed"
                                        : "fault_applied",
                            });
                        armed = undefined;
                        await expect
                            .poll(
                                async () =>
                                    (await page
                                        .getByRole("textbox")
                                        .isVisible()) ||
                                    (await page
                                        .getByRole("button", {
                                            name: "Ask AI",
                                            exact: true,
                                        })
                                        .isVisible()),
                                { timeout: 20000 },
                            )
                            .toBe(true);
                        if (!(await page.getByRole("textbox").isVisible()))
                            await page
                                .getByRole("button", {
                                    name: "Ask AI",
                                    exact: true,
                                })
                                .click();
                        await expect(page.getByRole("textbox")).toBeVisible({
                            timeout: 20000,
                        });
                        await page.getByRole("textbox").fill(step.text);
                        await page
                            .getByRole("button", {
                                name: /Send (message|refinement)/,
                            })
                            .click();
                        await expect
                            .poll(
                                async () => (await inspect()).lastMessage?._id,
                                { timeout: 20000 },
                            )
                            .not.toBe(previous);
                        if (step.wait !== "started") {
                            assert(
                                expectedFault !== "concurrent_edit",
                                "Concurrent edit requires a started turn before the configured framing edit",
                            );
                            await wait("conversation_settled");
                        } else {
                            await expect
                                .poll(
                                    async () =>
                                        !!(await inspect()).conversation
                                            ?.activeTurnId,
                                    { timeout: 20000 },
                                )
                                .toBe(true);
                            if (expectedFault === "concurrent_edit")
                                await expect
                                    .poll(
                                        () =>
                                            existsSync(
                                                join(
                                                    root,
                                                    `gate-${controlKey}.json`,
                                                ),
                                            ),
                                        { timeout: 65000 },
                                    )
                                    .toBe(true);
                        }
                        break;
                    }
                    case "start_research":
                        await page
                            .getByRole("button", {
                                name: "Start research",
                                exact: true,
                            })
                            .click();
                        break;
                    case "pause_research":
                        await page
                            .getByRole("button", {
                                name: "Pause research",
                                exact: true,
                            })
                            .click();
                        await wait("paused");
                        break;
                    case "resume_research":
                        await page
                            .getByRole("button", {
                                name: "Resume research",
                                exact: true,
                            })
                            .click();
                        break;
                    case "stop_response":
                        await page
                            .getByRole("button", {
                                name: "Stop generation",
                                exact: true,
                            })
                            .click();
                        if (held) {
                            await client.mutation(
                                ref(
                                    internal.execution.piControl
                                        .holdPublication,
                                ),
                                { held: false },
                            );
                            held = false;
                        }
                        release();
                        await wait("conversation_settled");
                        break;
                    case "reload":
                        await page.reload();
                        break;
                    case "navigate":
                        if (step.target === "dossier_list")
                            await page.goto(`${web}/workspace/dossiers`);
                        else if (step.target === "dossier")
                            await page.goto(`${web}/workspace/${c.runId}`);
                        else
                            await page.goto(
                                `${web}/workspace/${c.runId}?section=progress&detail=${step.target}`,
                            );
                        break;
                    case "viewport":
                        await page.setViewportSize({
                            width: step.width,
                            height: step.height,
                        });
                        break;
                    case "wait_for":
                        if (step.state === "conversation_settled") release();
                        await wait(step.state);
                        break;
                    case "fault": {
                        if (step.recipe === "stop_before_generation") {
                            assert(!held, "Publication gate already held");
                            await client.mutation(
                                ref(
                                    internal.execution.piControl
                                        .holdPublication,
                                ),
                                { held: true },
                            );
                            held = true;
                        } else {
                            assert(
                                manifest.mode === "live" &&
                                    manifest.capability === "workbench",
                                "Transport faults require live Workbench relay",
                            );
                            assert(
                                !armed,
                                "Consume the preceding fault before arming another",
                            );
                            armed = step.recipe;
                        }
                        break;
                    }
                }
                save(directory, `${step.id}-after`, await inspect());
                await page.screenshot({
                    path: join(directory, `${step.id}.png`),
                    fullPage: true,
                });
            }
            assert(!armed && !held, "Unconsumed fault recipe");
            release();
            await wait("conversation_settled");
            if (requiredFaults.length) {
                const ledger = readFileSync(join(root, "ledger.jsonl"), "utf8")
                    .trim()
                    .split("\n")
                    .map((line) => JSON.parse(line));
                for (const required of requiredFaults)
                    assert(
                        ledger.some(
                            (e) =>
                                e.event === required.event &&
                                e.scenario === required.key,
                        ),
                        "Declared transport fault did not fire",
                    );
            }
            save(directory, "published-ui", {
                text: await page.locator("body").innerText(),
            });
            assert.equal(
                errors.length,
                0,
                "Browser errors retained in scenario failure",
            );
            journal.finish(c.id, {
                executionIntegrity: "passed",
                semanticTask: "not_assessed",
            });
        } catch (error) {
            save(directory, "failure", {
                step: activeStep,
                errors,
                reason:
                    error instanceof Error ? error.message : "Scenario failed",
            });
            await page
                .screenshot({
                    path: join(directory, "failure.png"),
                    fullPage: true,
                })
                .catch(() => {});
            throw error;
        } finally {
            release();
            if (held)
                await client.mutation(
                    ref(internal.execution.piControl.holdPublication),
                    { held: false },
                );
        }
    }
    await inspectCampaignScenarios(client, root);
    if (manifest.mode === "deterministic")
        for (const c of prepared(root).cases) {
            const directory = join(root, c.id);
            const receiptPage = JSON.parse(
                readFileSync(join(directory, "receipts-1.json"), "utf8"),
            );
            assert.equal(
                receiptPage.page.length,
                0,
                "Simulation dispatched a provider",
            );
        }
}
