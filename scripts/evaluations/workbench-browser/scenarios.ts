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
import {
    MAX_QUALIFICATION_CONTEXT_DURATION_MS,
    PERSISTENCE_PAGE_SIZE,
    QUALIFICATION_TOOLING_POLICY as TOOLING_POLICY,
} from "../../../convex/resourcePolicy.ts";
import { openQualificationJournal } from "./journal.ts";
import { sha256 } from "./protocol.ts";
import { hydrateSourcesTranscriptPage } from "./sources.ts";

function ref<
    R extends FunctionReference<"query" | "mutation" | "action", "internal">,
>(r: R) {
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
    const remainingMs = manifest.expiresAt - Date.now();
    assert(remainingMs > 0, "Campaign has expired");
    const contextKey = `campaign-${randomUUID()}`;
    const contextId = await client.mutation(
        ref(internal.runWorkspace.openBrowserTestContext),
        {
            slotKey: "analyst-4",
            contextKey,
            durationMs: Math.min(
                manifest.contextDurationMs ??
                    MAX_QUALIFICATION_CONTEXT_DURATION_MS,
                remainingMs,
            ),
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
                    {
                        ...args,
                        kind,
                        paginationOpts: {
                            cursor,
                            numItems:
                                PERSISTENCE_PAGE_SIZE.qualificationFixtures,
                        },
                    },
                );
                const { downloads: _, ...retained } = {
                    downloads: undefined,
                    ...result,
                };
                save(directory, `${kind}-${++pageNumber}`, retained);
                if ("downloads" in result) {
                    const downloads: Extract<
                        FunctionReturnType<
                            typeof internal.execution.fixtures.inspectQualificationPage
                        >,
                        { downloads: unknown }
                    >["downloads"] = result.downloads;
                    for (const capture of result.page) {
                        if (capture.status === "committed")
                            assert(
                                capture.contentHash &&
                                    capture.storageId &&
                                    downloads.some(
                                        (download) =>
                                            download.captureId === capture._id,
                                    ),
                                "Capture bytes unavailable",
                            );
                    }
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
                            signal: AbortSignal.timeout(
                                TOOLING_POLICY.captureDownloadTimeoutMs,
                            ),
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
            save(
                directory,
                `invocations-${++pageNumber}`,
                await hydrateSourcesTranscriptPage(page, (textArgs) =>
                    client.query(
                        ref(
                            internal.execution.fixtures
                                .inspectSourcesTextFragments,
                        ),
                        { ...args, ...textArgs },
                    ),
                ),
            );
            if (page.isDone) break;
            assert(page.continueCursor !== cursor);
            cursor = page.continueCursor;
        } while (cursor);
    }
}

/** Finite action interpreter. Configuration supplies domain actions and text, never executable code or selectors. */
export async function runCampaignScenarios(
    page: Page | null,
    client: ConvexHttpClient,
    web: string | undefined,
    convex: string,
    root: string,
    manifest: ConfigurableCampaignManifest,
    interrupted: () => boolean,
    backendClient?: ConvexHttpClient,
) {
    assert(
        page
            ? manifest.executionSurface !== "backend"
            : manifest.executionSurface === "backend",
        "Execution surface mismatch",
    );
    const protocol = JSON.parse(
        readFileSync(join(root, "protocol.json"), "utf8"),
    );
    const journal = openQualificationJournal(root, protocol);
    const errors: string[] = [];
    let admitted = backendClient;
    if (page) {
        assert(web);
        page.on("pageerror", () => errors.push("page_error"));
        page.on("console", (m) => {
            if (m.type() === "error") errors.push("console_error");
        });
        await page.goto(`${web}/workspace/dossiers`);
        const token = await page.evaluate(() => {
            const keys = Object.keys(localStorage).filter((k) =>
                k.startsWith("__convexAuthJWT"),
            );
            return keys.length === 1
                ? localStorage.getItem(keys[0] ?? "")
                : null;
        });
        assert(token, "Admitted session required");
        admitted = new ConvexHttpClient(convex, { logger: false });
        admitted.setAuth(token);
    }
    assert(admitted, "Admitted backend session required");
    await expect
        .poll(() => admitted.query(api.visitors.current), {
            timeout: TOOLING_POLICY.browserInteractionTimeoutMs,
        })
        .toMatchObject({ status: "active" });
    assert.equal(errors.length, 0, "Browser initialization failed");
    const failedScenarios: string[] = [];
    for (const c of prepared(root).cases) {
        const scenario = manifest.scenarios.find((s) => s.id === c.id);
        assert(scenario);
        assert(journal.begin(c.id), "Scenario already completed");
        const directory = join(root, c.id);
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        let activeStep = "initialize";
        const errorStart: number = errors.length;
        let failed = false;
        let held = false;
        let armed:
            | undefined
            | "malformed_response"
            | "http_refusal"
            | "concurrent_edit";
        let controlKey: string | undefined;
        const requiredFaults: Array<{ key: string; event: string }> = [];
        const requestKey = () =>
            `qualification:${sha256(JSON.stringify([c.fixtureKey, activeStep]))}`;
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
                        if (
                            state !== "conversation_settled" &&
                            ["failed", "cancelled"].includes(
                                s.run.executionStatus,
                            )
                        )
                            throw new Error(
                                `Research ${s.run.executionStatus} before ${state} (phase: ${s.run.lifecycleState})`,
                            );
                        if (
                            (state === "conversation_settled" ||
                                state === "sources_prepared") &&
                            s.conversation?.activeTurnId &&
                            s.mission?.status === "blocked" &&
                            !s.mission.piActiveWriter
                        )
                            throw new Error(
                                `Conversation blocked before native settlement: ${s.mission.blockCode ?? "mission_blocked"}`,
                            );
                        if (
                            state === "sources_prepared" &&
                            scenario.initialFixture?.id ===
                                "sources_correction" &&
                            s.run.lifecycleState !== "sources_prepared" &&
                            s.sourcesMission &&
                            ["completed", "blocked"].includes(
                                s.sourcesMission.status,
                            )
                        ) {
                            await client.mutation(
                                ref(
                                    internal.qualificationInitialFixtureSetup
                                        .finish,
                                ),
                                {
                                    runId: c.runId,
                                    fixtureKey: c.fixtureKey,
                                    scenarioId: c.id,
                                },
                            );
                            return false;
                        }
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
                            manifest.mode === "deterministic"
                                ? TOOLING_POLICY.deterministicObservationTimeoutMs
                                : TOOLING_POLICY.liveObservationTimeoutMs,
                        intervals: [...TOOLING_POLICY.observationIntervalsMs],
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
                requestKey: requestKey(),
                content,
            });
            const question = content.questions[0];
            assert(question);
            if (page)
                await expect(
                    page.getByRole("button", {
                        name: question.shortLabel,
                        exact: true,
                    }),
                ).toBeVisible({
                    timeout: TOOLING_POLICY.browserInteractionTimeoutMs,
                });
        };
        try {
            save(root, "control", {
                runId: c.runId,
                mode: manifest.mode,
                scenario: `${c.id}-initial`,
            });
            if (scenario.initialFixture) {
                activeStep = "initial-fixture";
                save(
                    directory,
                    "initial-fixture-intent",
                    scenario.initialFixture,
                );
                const scope = {
                    runId: c.runId,
                    fixtureKey: c.fixtureKey,
                    scenarioId: c.id,
                };
                const initial = await client.action(
                    ref(internal.qualificationInitialFixtureSetup.install),
                    scope,
                );
                save(directory, "initial-fixture", {
                    ...scenario.initialFixture,
                    ...initial,
                    provenance:
                        "retained_illustrative_material_not_live_evidence",
                });
                if (scenario.initialFixture.id === "sources_correction")
                    await client.mutation(
                        ref(internal.qualificationInitialFixtureSetup.activate),
                        scope,
                    );
            } else
                await client.mutation(
                    ref(internal.execution.fixtures.activateWorkbench),
                    {
                        runId: c.runId,
                        fixtureKey: c.fixtureKey,
                        researchAngle: scenario.framing.scope,
                    },
                );
            if (page) {
                await page.setViewportSize({ width: 1440, height: 1000 });
                await page.goto(`${web}/workspace/${c.runId}`);
            }
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
                        if (page) {
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
                                    {
                                        timeout:
                                            TOOLING_POLICY.browserInteractionTimeoutMs,
                                    },
                                )
                                .toBe(true);
                            if (!(await page.getByRole("textbox").isVisible()))
                                await page
                                    .getByRole("button", {
                                        name: "Ask AI",
                                        exact: true,
                                    })
                                    .click();
                            await expect(page.getByRole("textbox")).toBeVisible(
                                {
                                    timeout:
                                        TOOLING_POLICY.browserInteractionTimeoutMs,
                                },
                            );
                            await page.getByRole("textbox").fill(step.text);
                            await page
                                .getByRole("button", {
                                    name: /Send (message|refinement)/,
                                })
                                .click();
                        } else {
                            await admitted.mutation(
                                api.execution.conversations.submit,
                                {
                                    runId: c.runId,
                                    requestKey: requestKey(),
                                    text: step.text,
                                    delivery: "queue",
                                },
                            );
                        }
                        await expect
                            .poll(
                                async () => (await inspect()).lastMessage?._id,
                                {
                                    timeout:
                                        TOOLING_POLICY.browserInteractionTimeoutMs,
                                },
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
                                    {
                                        timeout:
                                            TOOLING_POLICY.browserInteractionTimeoutMs,
                                    },
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
                                        {
                                            timeout:
                                                TOOLING_POLICY.gateObservationTimeoutMs,
                                        },
                                    )
                                    .toBe(true);
                        }
                        break;
                    }
                    case "start_research":
                        if (page)
                            await page
                                .getByRole("button", {
                                    name: "Start research",
                                    exact: true,
                                })
                                .click();
                        else {
                            const framing = (await inspect()).framing;
                            assert(
                                framing,
                                "Current framing required before research start",
                            );
                            await admitted.mutation(api.framing.startResearch, {
                                runId: c.runId,
                                expectedRevision: framing.revision,
                                requestKey: requestKey(),
                            });
                        }
                        break;
                    case "pause_research":
                        if (page)
                            await page
                                .getByRole("button", {
                                    name: "Pause research",
                                    exact: true,
                                })
                                .click();
                        else
                            await admitted.mutation(
                                api.execution.researchControl.pause,
                                {
                                    runId: c.runId,
                                    expectedGeneration: (await inspect()).run
                                        .executionGeneration,
                                },
                            );
                        await wait("paused");
                        break;
                    case "resume_research":
                        if (page)
                            await page
                                .getByRole("button", {
                                    name: "Resume research",
                                    exact: true,
                                })
                                .click();
                        else
                            await admitted.mutation(
                                api.execution.researchControl.resume,
                                {
                                    runId: c.runId,
                                    expectedGeneration: (await inspect()).run
                                        .executionGeneration,
                                },
                            );
                        break;
                    case "stop_response":
                        if (page)
                            await page
                                .getByRole("button", {
                                    name: "Stop generation",
                                    exact: true,
                                })
                                .click();
                        else {
                            const turnId = (await inspect()).conversation
                                ?.activeTurnId;
                            assert(
                                turnId,
                                "Active turn required before stopping a response",
                            );
                            await admitted.mutation(
                                api.execution.conversations.stopResponse,
                                { runId: c.runId, turnId },
                            );
                        }
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
                        assert(page, "Reload requires browser execution");
                        await page.reload();
                        await expect(
                            page
                                .getByRole("textbox")
                                .or(
                                    page.getByRole("button", {
                                        name: "Ask AI",
                                        exact: true,
                                    }),
                                )
                                .first(),
                        ).toBeVisible({
                            timeout: TOOLING_POLICY.browserInteractionTimeoutMs,
                        });
                        break;
                    case "navigate":
                        assert(page, "Navigation requires browser execution");
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
                        assert(page, "Viewport requires browser execution");
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
                if (page)
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
            if (page)
                save(directory, "published-ui", {
                    text: await page.locator("body").innerText(),
                });
            else save(directory, "published-backend", await inspect());
            assert.equal(
                errors.length - errorStart,
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
                errors: errors.slice(errorStart),
                reason:
                    error instanceof Error ? error.message : "Scenario failed",
            });
            if (page)
                await page.screenshot({
                    path: join(directory, "failure.png"),
                    fullPage: true,
                });
            failed = true;
        } finally {
            release();
            if (held)
                await client.mutation(
                    ref(internal.execution.piControl.holdPublication),
                    { held: false },
                );
        }
        if (failed) {
            if (!page) {
                journal.finish(c.id, {
                    executionIntegrity: "failed",
                    semanticTask: "not_assessed",
                });
                throw new Error(
                    "Backend evaluation stopped at its first failing scenario; evidence retained",
                );
            }
            assert(
                !interrupted(),
                "Campaign interrupted after scenario failure",
            );
            const [state, publication] = await Promise.all([
                inspect(),
                client.query(
                    ref(internal.execution.piControl.publicationStatus),
                    {},
                ),
            ]);
            const accounting = state.accounting;
            assert(
                settled(state) &&
                    state.run.executionStatus === "idle" &&
                    (!state.sourcesMission ||
                        [
                            "completed",
                            "blocked",
                            "failed",
                            "cancelled",
                        ].includes(state.sourcesMission.status)) &&
                    accounting &&
                    !accounting.pending &&
                    !accounting.unknown &&
                    !accounting.overruns &&
                    !publication.held &&
                    !publication.hasActiveWorkers,
                "Failed scenario is not quiet and reconciled; independent continuation refused",
            );
            save(directory, "independent-continuation", {
                executionStatus: state.run.executionStatus,
                sourcesStatus: state.sourcesMission?.status ?? null,
                pending: accounting.pending,
                unknown: accounting.unknown,
                overruns: accounting.overruns,
                publication,
            });
            journal.finish(c.id, {
                executionIntegrity: "failed",
                semanticTask: "not_assessed",
            });
            failedScenarios.push(c.id);
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
    assert.equal(
        failedScenarios.length,
        0,
        "Scenarios failed; independent results and original failures retained",
    );
}
