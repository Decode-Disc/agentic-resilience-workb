import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs, parseEnv } from "node:util";
import { chromium, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import {
    type FunctionArgs,
    type FunctionReference,
    type FunctionReturnType,
    getFunctionName,
    makeFunctionReference,
} from "convex/server";
import { QUALIFICATION_ACCOUNTING_POLICY } from "../../../convex/qualificationCampaignPolicy.ts";
import {
    RESOURCE_POLICY_VERSION,
    QUALIFICATION_TOOLING_POLICY as TOOLING_POLICY,
} from "../../../convex/resourcePolicy.ts";
import { resolveLocalRuntime } from "../../local-runtime.ts";
import {
    attemptMissions,
    cleanupQualification,
    malformedOutcome,
    qualificationDecision,
    qualificationDiagnostic,
} from "./qualification.ts";

function localReference<
    R extends FunctionReference<"query" | "mutation", "internal">,
>(reference: R) {
    return makeFunctionReference<
        R["_type"],
        FunctionArgs<R>,
        FunctionReturnType<R>
    >(getFunctionName(reference));
}

import type { Server } from "node:http";
import type { Browser } from "@playwright/test";
import { internal } from "../../../convex/_generated/api.js";
import type { Id } from "../../../convex/_generated/dataModel";
import type { RelayEvent } from "./relay.mjs";

type Snapshot = FunctionReturnType<
    typeof internal.execution.fixtures.inspectWorkbench
>;

import { closeCampaignContext, runCampaign } from "./campaign.ts";
import { openQualificationJournal } from "./journal.ts";
import { prepareBrowserQualificationModel } from "./model-preparation.ts";
import {
    assessQualification,
    candidateHash,
    planQualification,
    preserveQualificationCandidate,
    qualificationReviewTemplate,
    readQualificationBattery,
    verifyQualificationCandidate,
} from "./protocol.ts";
import { createQualificationRelay } from "./relay.mjs";
import { sourcesQualificationPhase } from "./sources.ts";

const { values } = parseArgs({
    options: {
        mode: { type: "string", default: "deterministic" },
        output: { type: "string" },
        help: { type: "boolean" },
        locked: { type: "boolean" },
        assess: { type: "string" },
        review: { type: "string" },
        "maximum-requests": { type: "string", default: "20" },
        "sources-phase": { type: "string" },
        campaign: { type: "string" },
        manifest: { type: "string" },
        correction: { type: "string" },
        configuration: { type: "string" },
    },
});

function command(
    binary: string,
    args: string[],
    timeout: number = TOOLING_POLICY.localCommandTimeoutMs,
) {
    const result = spawnSync(binary, args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout,
    });
    if (result.status !== 0 || result.error)
        throw new Error(
            "Qualification command failed; sensitive output suppressed",
        );
    return result.stdout.trim();
}
const cli = (args: string[]) =>
    command(process.execPath, [
        "node_modules/convex/bin/main.js",
        ...args,
        "--deployment",
        "local",
    ]);
const digest = (bytes: Uint8Array) =>
    createHash("sha256").update(bytes).digest("hex");
const save = (root: string, name: string, value: unknown) =>
    writeFileSync(
        join(root, `${name}.json`),
        `${JSON.stringify(value, null, 2)}\n`,
        { mode: 0o600 },
    );

export async function runWorkbenchQualification(
    options: {
        mode?: string;
        output?: string;
        locked?: boolean;
        "maximum-requests"?: string;
        campaignLotId?: Id<"qualificationLots">;
        maximumCostUsd?: number;
    } = values,
) {
    const values = options;
    const maximumRequests = Number(values["maximum-requests"]);
    assert(
        Number.isInteger(maximumRequests) &&
            maximumRequests >= 1 &&
            maximumRequests <= 20,
        "Request allowance must be between one and twenty",
    );
    if (!["deterministic", "live"].includes(values.mode ?? "deterministic"))
        throw new Error("Unknown qualification mode");
    const runtime = await resolveLocalRuntime(process.cwd(), {
        requiredOrigins: ["convex", "web"],
    });
    if (!values.locked) {
        const result = spawnSync(
            "flock",
            [
                "--exclusive",
                "--nonblock",
                join(
                    process.cwd(),
                    ".local-runtime",
                    "workbench-qualification.lock",
                ),
                process.execPath,
                "--experimental-strip-types",
                process.argv[1] ?? "",
                ...process.argv.slice(2),
                "--locked",
            ],
            {
                stdio: "inherit",
                timeout: TOOLING_POLICY.preflightChecksTimeoutMs,
            },
        );
        process.exitCode = result.error ? 1 : (result.status ?? 1);
        return;
    }
    const live = values.mode === "live";
    const root = values.output
        ? resolve(values.output)
        : mkdtempSync(join(tmpdir(), "workbench-qualification-"));
    if (!relative(process.cwd(), root).startsWith(".."))
        throw new Error("Evidence directory must be outside the checkout");
    mkdirSync(root, { recursive: true, mode: 0o700 });
    console.log(`Qualification evidence: ${root}`);
    const { battery, hash: batteryHash } = readQualificationBattery();
    const selectedMode = live ? "live" : "deterministic";
    const plan = planQualification(
        battery,
        selectedMode,
        live ? maximumRequests : 0,
    );
    const protocol = {
        costAccountingPolicy: QUALIFICATION_ACCOUNTING_POLICY,
        version: 2,
        resourcePolicy: RESOURCE_POLICY_VERSION,
        mode: selectedMode,
        capability: battery.capability,
        batteryHash,
        battery,
        plan,
        maximumRequests: live ? maximumRequests : 0,
        maximumCostUsd: live ? (values.maximumCostUsd ?? 0.5) : 0,
        boundary: live
            ? "protected_browser_real_inference"
            : "protected_browser_simulated_model",
        scenarios: battery.cases.map((c) => c.id),
        unavailableCapabilities: battery.unavailableCapabilities.map((c) => ({
            ...c,
            referenceHash: digest(readFileSync(c.reference)),
            caseIds: (() => {
                try {
                    return (
                        JSON.parse(readFileSync(c.reference, "utf8")) as Array<{
                            id: string;
                        }>
                    ).map((item) => item.id);
                } catch (error) {
                    throw new Error("Invalid qualification reference", {
                        cause: error,
                    });
                }
            })(),
            status: "unavailable",
        })),
    };
    const journal = openQualificationJournal(root, protocol);
    if (!journal.begin("qualification"))
        throw new Error("This lot is already closed");
    const fingerprints = preserveQualificationCandidate(root);
    try {
        await verifyQualificationCandidate(root, fingerprints);
    } catch (error) {
        const diagnostic = qualificationDiagnostic("validation", error);
        journal.finish("qualification", {
            executionIntegrity: "blocked",
            semanticTask: "not_assessed",
        });
        save(root, "report", {
            status: "blocked",
            capability: protocol.capability,
            batteryHash,
            candidateHash: candidateHash(fingerprints),
            reason: "candidate_validation_failed",
            diagnostics: [diagnostic],
        });
        throw error;
    }
    let config: { adminKey: string };
    try {
        config = JSON.parse(
            readFileSync(".convex/local/default/config.json", "utf8"),
        );
    } catch (error) {
        throw new Error("Invalid local backend configuration", {
            cause: error,
        });
    }
    const client = new ConvexHttpClient(runtime.origins.convex, {
        logger: false,
    });
    (
        client as ConvexHttpClient & { setAdminAuth(key: string): void }
    ).setAdminAuth(config.adminKey);
    const publication = await client.query(
        localReference(internal.execution.piControl.publicationStatus),
    );
    if (publication.held || publication.hasActiveWorkers)
        throw new Error("A quiet unheld backend is required");
    const initialEnv = new Map(
        cli(["env", "list"])
            .split("\n")
            .map((line) => {
                const at = line.indexOf("=");
                return [line.slice(0, at), line.slice(at + 1)];
            }),
    );
    const changedFlags: string[] = [];
    const errors: Array<Record<string, unknown>> = [];
    let browser: Browser | undefined,
        relay: Server | undefined,
        runId: Id<"researchRuns"> | undefined;
    let contextOpened = false,
        interrupted = false,
        publicationHeld = false;
    const fixtureKey = `qualification-${randomUUID()}`;
    const onSignal = () => {
        interrupted = true;
    };
    process.on("SIGTERM", onSignal);
    process.on("SIGINT", onSignal);
    const inspect = () => {
        assert(runId, "Dossier not prepared");
        return client.query(
            localReference(internal.execution.fixtures.inspectWorkbench),
            { runId, fixtureKey },
        );
    };
    const ledger = (): RelayEvent[] =>
        existsSync(join(root, "ledger.jsonl"))
            ? readFileSync(join(root, "ledger.jsonl"), "utf8")
                  .trim()
                  .split("\n")
                  .filter(Boolean)
                  .map((line) => {
                      try {
                          return JSON.parse(line);
                      } catch (error) {
                          throw new Error(
                              "Invalid retained qualification ledger",
                              { cause: error },
                          );
                      }
                  })
            : [];
    let failure = false;
    let activeStep = "setup";
    const diagnostics: Array<ReturnType<typeof qualificationDiagnostic>> = [];
    try {
        for (const name of [
            "E2E_FIXTURES_ENABLED",
            "WORKBENCH_AGENT_ENABLED",
        ]) {
            if (initialEnv.get(name) !== "true") {
                changedFlags.push(name);
                cli(["env", "set", name, "true"]);
            }
        }
        const material = JSON.parse(
            readFileSync("invitation-otp-codes.local", "utf8"),
        );
        const invitation = material.invitations.find(
            (i: { slotKey: string; code: string }) => i.slotKey === "analyst-4",
        );
        assert(invitation);
        browser = await chromium.launch({
            ...(process.env.WORKBENCH_UI_BROWSER_PATH
                ? { executablePath: process.env.WORKBENCH_UI_BROWSER_PATH }
                : {}),
        });
        if (live) {
            activeStep = "prepare-live-model";
            const adminInvitation = material.invitations.find(
                (i: { slotKey: string; code: string }) => i.slotKey === "admin",
            );
            assert(
                adminInvitation,
                "Local administrator invitation is required for model preparation",
            );
            const preparation = await prepareBrowserQualificationModel(
                browser,
                {
                    web: runtime.origins.web ?? "",
                    convex: runtime.origins.convex,
                },
                adminInvitation.code,
            );
            save(root, "model-preparation", preparation);
        }
        const context = await browser.newContext({
            viewport: { width: 1440, height: 1000 },
            reducedMotion: "reduce",
        });
        const page = await context.newPage();
        const interactionTimeoutMs = TOOLING_POLICY.browserInteractionTimeoutMs;
        page.setDefaultTimeout(interactionTimeoutMs);
        page.on("pageerror", (error) =>
            errors.push(qualificationDiagnostic("browser-page", error)),
        );
        page.on("console", (message) => {
            if (message.type() === "error")
                errors.push({
                    step: "browser-console",
                    category: "console_error",
                    expectation: "no console errors",
                });
        });
        // Explicit image fixtures avoid unrelated third-party requests in this labelled browser dossier.
        await page.route("https://api.poly.io/og**", (route) =>
            route.fulfill({
                headers: { "access-control-allow-origin": "*" },
                json: { ok: false, imageOk: false },
            }),
        );
        await page.route(
            /https:\/\/(www\.google\.com\/s2\/favicons|t[0-9]\.gstatic\.com\/faviconV2).*/,
            (route) =>
                route.fulfill({
                    status: 200,
                    contentType: "image/png",
                    body: Buffer.from(
                        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
                        "base64",
                    ),
                }),
        );
        await page.goto(`${runtime.origins.web}/workspace/dossiers`);
        await page.locator("#invitation-code").fill(invitation.code);
        await page
            .locator("form:has(#invitation-code) button[type=submit]")
            .click();
        await expect(page.locator("#invitation-code")).toHaveCount(0);
        const qualificationContextId = await client.mutation(
            localReference(internal.runWorkspace.openBrowserTestContext),
            {
                slotKey: "analyst-4",
                contextKey: fixtureKey,
                durationMs: TOOLING_POLICY.legacyContextDurationMs,
            },
        );
        contextOpened = true;
        if (values.campaignLotId)
            await client.mutation(
                localReference(internal.qualificationCampaigns.bind),
                {
                    lotId: values.campaignLotId,
                    contextId: qualificationContextId,
                },
            );
        runId = (
            await client.mutation(
                localReference(internal.e2eFixtures.seedSourceReviewScenario),
                {
                    slotKey: "analyst-4",
                    fixtureKey,
                },
            )
        ).runId;
        save(root, "prepared", {
            runId,
            fixtureKey,
            modelBoundary: protocol.boundary,
            syntheticCompany: true,
        });
        if (live) {
            activeStep = "authorize-live-lot";
            const key =
                process.env.OPENROUTER_API_KEY ??
                parseEnv(readFileSync(".env.local", "utf8")).OPENROUTER_API_KEY;
            relay = createQualificationRelay(root, key);
            relay.listen(0, "127.0.0.1");
            await once(relay, "listening");
            await client.mutation(
                localReference(
                    internal.execution.fixtures.authorizeWorkbenchQualification,
                ),
                {
                    runId,
                    fixtureKey,
                    relayOrigin: `http://127.0.0.1:${(relay.address() as import("node:net").AddressInfo).port}`,
                    maximumRequests,
                    maximumCostUsd: values.maximumCostUsd ?? 0.5,
                },
            );
            save(
                root,
                "relay-route",
                await client.query(
                    localReference(
                        internal.execution.fixtures.qualificationRoute,
                    ),
                    { runId, fixtureKey },
                ),
            );
        }
        activeStep = "admission";
        const settle = async (previousMissions: Id<"agentMissions">[]) => {
            let state: Snapshot | undefined;
            await expect
                .poll(
                    async () => {
                        if (interrupted)
                            throw new Error("Qualification interrupted");
                        state = await inspect();
                        const observed = state;
                        const fresh = observed.missions.filter(
                            (m) => !previousMissions.includes(m._id),
                        );
                        return (
                            fresh.length > 0 &&
                            fresh.every((m) =>
                                [
                                    "completed",
                                    "failed",
                                    "blocked",
                                    "cancelled",
                                ].includes(m.status),
                            ) &&
                            observed.nativeSettled &&
                            observed.queuedCount === 0
                        );
                    },
                    {
                        timeout: TOOLING_POLICY.legacyMissionSettleTimeoutMs,
                        intervals: [...TOOLING_POLICY.observationIntervalsMs],
                    },
                )
                .toBe(true);
            assert(state);
            return state;
        };
        const editedQuestion =
            "Which insurer-specific relationships constrain repairer switching?";
        for (const scenarioCase of battery.cases) {
            const { id: scenario, prompt: text } = scenarioCase;
            activeStep = scenario;
            if (!journal.begin(scenario)) continue;
            if (!scenarioCase.modes.includes(selectedMode)) {
                journal.finish(scenario, {
                    executionIntegrity: "not_run",
                    semanticTask: "not_assessed",
                    reason: "requires_real_relay_boundary",
                });
                continue;
            }
            if (
                live &&
                scenarioCase.minimumInferenceRequests > 0 &&
                ledger().filter((e) => e.event === "dispatch").length >=
                    maximumRequests
            ) {
                journal.finish(scenario, {
                    executionIntegrity: "not_run",
                    reason: "remaining_allowance",
                    semanticTask: "not_assessed",
                });
                continue;
            }
            activeStep = `${scenario}:inspect-before`;
            const before = await inspect();
            save(root, `${scenario}-before`, before);
            save(root, "control", {
                runId,
                mode: live ? "live" : "off",
                scenario,
                hold:
                    scenario === "concurrent-edit" ||
                    (live && scenario === "reload"),
                injectInvalidFraming: scenario === "malformed-recovery",
            });
            if (scenario === "stop-before-generation") {
                await client.mutation(
                    localReference(
                        internal.execution.piControl.holdPublication,
                    ),
                    {
                        held: true,
                    },
                );
                publicationHeld = true;
                try {
                    await page.getByRole("textbox").fill(text ?? "");
                    await page
                        .getByRole("button", {
                            name: "Send refinement",
                            exact: true,
                        })
                        .click();
                    await page
                        .getByRole("button", {
                            name: "Stop generation",
                            exact: true,
                        })
                        .click();
                    await expect
                        .poll(async () =>
                            (await inspect()).missions
                                .filter(
                                    (m) =>
                                        !before.missions.some(
                                            (old) => old._id === m._id,
                                        ),
                                )
                                .map((m) => m.status),
                        )
                        .toEqual(["cancelled"]);
                } finally {
                    await client.mutation(
                        localReference(
                            internal.execution.piControl.holdPublication,
                        ),
                        {
                            held: false,
                        },
                    );
                    publicationHeld = false;
                }
                save(root, `${scenario}-after`, await inspect());
                journal.finish(scenario, {
                    executionIntegrity: "passed",
                    semanticTask: "not_required",
                    containment: "cancelled_before_dispatch",
                });
                continue;
            }
            if (scenario === "initial-framing") {
                await client.mutation(
                    localReference(
                        internal.execution.fixtures.activateWorkbench,
                    ),
                    {
                        runId,
                        fixtureKey,
                    },
                );
                await page.goto(`${runtime.origins.web}/workspace/${runId}`);
            } else {
                await page.getByRole("textbox").fill(text ?? "");
                await page
                    .getByRole("button", {
                        name: "Send refinement",
                        exact: true,
                    })
                    .click();
                if (live && ["concurrent-edit", "reload"].includes(scenario)) {
                    await expect
                        .poll(
                            () =>
                                existsSync(join(root, `gate-${scenario}.json`)),
                            {
                                timeout:
                                    TOOLING_POLICY.gateObservationTimeoutMs,
                                intervals: [
                                    ...TOOLING_POLICY.gateObservationIntervalsMs,
                                ],
                            },
                        )
                        .toBe(true);
                    if (scenario === "concurrent-edit") {
                        await page
                            .getByRole("button", {
                                name: "Edit question",
                                exact: true,
                            })
                            .click();
                        await page.getByRole("textbox").fill(editedQuestion);
                        await page
                            .getByRole("button", {
                                name: "Save changes",
                                exact: true,
                            })
                            .click();
                        await expect(
                            page.getByText(editedQuestion, { exact: true }),
                        ).toBeVisible();
                    } else await page.reload();
                    writeFileSync(
                        join(root, `release-${scenario}`),
                        "release",
                        { mode: 0o600 },
                    );
                } else if (scenario === "reload") await page.reload();
            }
            activeStep = `${scenario}:settle`;
            let attemptBefore = before;
            let after = await settle(before.missions.map((m) => m._id));
            const refusal = ledger()
                .filter(
                    (e) =>
                        e.event === "response" &&
                        e.scenario === scenario &&
                        e.outcome === "http_refusal",
                )
                .at(-1);
            let controlledRecovery = false;
            if (
                live &&
                after.missions.some(
                    (m) =>
                        !before.missions.some((old) => old._id === m._id) &&
                        ["failed", "blocked"].includes(m.status),
                ) &&
                refusal?.retryable &&
                typeof refusal.retryAfterAt === "number" &&
                refusal.retryAfterAt - Date.now() <=
                    TOOLING_POLICY.refusalRecoveryMaxWaitMs &&
                ledger().filter((e) => e.event === "dispatch").length <
                    maximumRequests
            ) {
                save(root, `${scenario}-refusal`, after);
                await new Promise((resolveWait) =>
                    setTimeout(
                        resolveWait,
                        Math.max(
                            0,
                            (refusal.retryAfterAt ?? Date.now()) - Date.now(),
                        ),
                    ),
                );
                await page
                    .getByRole("textbox")
                    .fill(
                        `Please handle this request after the temporary interruption: ${text ?? "Propose and save a research program without starting research."}`,
                    );
                await page
                    .getByRole("button", {
                        name: "Send refinement",
                        exact: true,
                    })
                    .click();
                attemptBefore = after;
                const previous = after.missions.map((m) => m._id);
                after = await settle(previous);
                controlledRecovery = true;
            }
            activeStep = `${scenario}:verify`;
            save(root, `${scenario}-after`, after);
            const published = await page.getByRole("main").innerText();
            assert(
                Buffer.byteLength(published, "utf8") <=
                    TOOLING_POLICY.publishedSnapshotMaxBytes,
                "Published snapshot exceeds its bound",
            );
            save(root, `${scenario}-published`, {
                text: published,
                semanticTask: "manual_review_required",
            });
            assert.equal(after.phase, "framing");
            assert.equal(after.executionStatus, "idle");
            assert.equal(after.researchStarted, false);
            if (
                live &&
                ledger().some(
                    (e) =>
                        e.event === "budget_exhausted" &&
                        e.scenario === scenario,
                )
            ) {
                journal.finish(scenario, {
                    executionIntegrity: "not_proven",
                    semanticTask: "not_assessed",
                    reason: "budget_exhausted_mid_turn",
                    containment: "stopped_without_new_lot",
                });
                continue;
            }
            const fresh = attemptMissions(attemptBefore, after);
            assert(
                fresh.length === 1 && fresh[0]?.status === "completed",
                "Expected exactly the admitted attempt to complete",
            );
            if (!live) {
                assert.equal(after.providerCallCount, 0);
                assert.equal(after.allMissionsSimulated, true);
            }
            if (before.nativeSessionId)
                assert.equal(after.nativeSessionId, before.nativeSessionId);
            if (scenario === "concurrent-edit")
                assert.equal(
                    after.framing?.content.questions[0]?.text,
                    editedQuestion,
                );
            if (
                [
                    "reload",
                    "continue",
                    "start-control",
                    "pause-control",
                    "resume-control",
                ].includes(scenario)
            )
                assert.deepEqual(after.framing, before.framing);
            const malformed =
                scenario === "malformed-recovery"
                    ? malformedOutcome({
                          injected: ledger().some(
                              (e) =>
                                  e.event === "fault_applied" &&
                                  e.scenario === scenario,
                          ),
                          refused: after.operationReceipts.some(
                              (r) =>
                                  !before.operationReceipts.some(
                                      (old) => old.id === r.id,
                                  ) &&
                                  r.invalid &&
                                  r.refused,
                          ),
                          forbiddenEffect: after.operationReceipts.some(
                              (r) =>
                                  !before.operationReceipts.some(
                                      (old) => old.id === r.id,
                                  ) &&
                                  r.invalid &&
                                  r.applied,
                          ),
                          continued: fresh[0]?.status === "completed",
                      })
                    : "passed";
            if (malformed === "failed") failure = true;
            journal.finish(scenario, {
                executionIntegrity: malformed,
                semanticTask: "manual_review_required",
                containment: "no_research_started",
                controlledRecovery,
                injectedGuard:
                    scenario === "malformed-recovery"
                        ? ledger().some(
                              (e) =>
                                  e.event === "fault_applied" &&
                                  e.scenario === scenario,
                          )
                            ? "exercised"
                            : "not_exercised"
                        : "not_applicable",
            });
        }
        for (const viewport of [
            { width: 1440, height: 1000 },
            { width: 390, height: 844 },
            { width: 320, height: 520 },
        ]) {
            activeStep = `layout:${viewport.width}x${viewport.height}`;
            await page.setViewportSize(viewport);
            await page.reload();
            activeStep = `layout:${viewport.width}x${viewport.height}:framing`;
            await expect(
                page.getByRole("region", {
                    name: "Research framing",
                    exact: true,
                }),
            ).toBeVisible({ timeout: interactionTimeoutMs });
            activeStep = `layout:${viewport.width}x${viewport.height}:focus`;
            await page.getByRole("textbox").focus();
            await expect(page.getByRole("textbox")).toBeFocused();
            activeStep = `layout:${viewport.width}x${viewport.height}:input-viewport`;
            await expect(page.getByRole("textbox")).toBeInViewport();
            activeStep = `layout:${viewport.width}x${viewport.height}:horizontal-overflow`;
            assert.equal(
                await page.evaluate(
                    () => document.documentElement.scrollWidth > innerWidth,
                ),
                false,
            );
            await page.screenshot({
                path: join(
                    root,
                    `final-${viewport.width}x${viewport.height}.png`,
                ),
            });
        }
        assert.deepEqual(errors, []);
        for (const [file, hash] of Object.entries(fingerprints))
            assert.equal(
                digest(readFileSync(file)),
                hash,
                "Code changed during qualification",
            );
    } catch (error) {
        failure = true;
        const failurePage = browser?.contexts().at(-1)?.pages().at(-1);
        if (failurePage) {
            try {
                save(
                    root,
                    "failure-layout",
                    await failurePage.evaluate(() => ({
                        viewport: { width: innerWidth, height: innerHeight },
                        documentWidth: document.documentElement.scrollWidth,
                        regions: [
                            ...document.querySelectorAll("section[aria-label]"),
                        ].map((region) => region.getAttribute("aria-label")),
                        inputs: [
                            ...document.querySelectorAll(
                                "textarea, [contenteditable=true]",
                            ),
                        ].map((input) => {
                            const bounds = input.getBoundingClientRect();
                            return {
                                top: bounds.top,
                                bottom: bounds.bottom,
                                height: bounds.height,
                                focused: input === document.activeElement,
                            };
                        }),
                    })),
                );
                await failurePage.screenshot({
                    path: join(root, "failure.png"),
                    fullPage: true,
                    mask: [failurePage.locator("#invitation-code")],
                });
            } catch (captureError) {
                diagnostics.push(
                    qualificationDiagnostic("failure-capture", captureError),
                );
            }
        }
        diagnostics.push(
            qualificationDiagnostic(
                activeStep,
                error,
                activeStep.endsWith(":verify")
                    ? "admitted attempt completed; framing idle; research unstarted"
                    : undefined,
            ),
        );
        try {
            save(root, "failure", {
                status: "failed",
                reason: "Inspect scenario snapshots and progress; sensitive exception text excluded",
                interrupted,
                diagnostics,
            });
        } catch (error) {
            diagnostics.push(qualificationDiagnostic("write-failure", error));
        }
    } finally {
        const observation: { final: Snapshot | null } = { final: null };
        const cleanupDiagnostics = await cleanupQualification({
            disableRelay: () =>
                save(root, "control", {
                    runId,
                    mode: "off",
                    scenario: "cleanup",
                }),
            captureFinal: async () => {
                if (runId) {
                    observation.final = await inspect();
                    save(root, "final-state", observation.final);
                }
            },
            closeContext: async () => {
                if (!contextOpened) return;
                await closeCampaignContext(client, fixtureKey);
            },
            releasePublication: async () => {
                if (publicationHeld)
                    await client.mutation(
                        localReference(
                            internal.execution.piControl.holdPublication,
                        ),
                        { held: false },
                    );
            },
            closeBrowser: async () => {
                await browser?.close();
            },
            closeRelay: async () => {
                const owned = relay;
                if (owned) {
                    owned.closeAllConnections();
                    await new Promise<void>((done, reject) =>
                        owned.close((error) =>
                            error ? reject(error) : done(),
                        ),
                    );
                }
            },
            restoreFlags: changedFlags.reverse().map((name) => ({
                name,
                restore: () => {
                    const previous = initialEnv.get(name);
                    cli(
                        previous === undefined
                            ? ["env", "remove", name]
                            : ["env", "set", name, previous],
                    );
                },
            })),
        });
        if (cleanupDiagnostics.length) failure = true;
        diagnostics.push(...cleanupDiagnostics);
        const cleanup = {
            completed: cleanupDiagnostics.length === 0,
            diagnostics: cleanupDiagnostics,
        };
        try {
            save(root, "cleanup", cleanup);
        } catch (error) {
            failure = true;
            diagnostics.push(qualificationDiagnostic("write-cleanup", error));
        }
        const events = ledger(),
            calls = events.filter((e) => e.event === "dispatch"),
            outcomes = events.filter((e) =>
                ["response", "uncertain"].includes(e.event),
            );
        const final = observation.final;
        const matched = outcomes
            .filter(
                (o): o is RelayEvent & { cost: number; generationId: string } =>
                    typeof o.generationId === "string" &&
                    typeof o.cost === "number",
            )
            .every((o) =>
                final?.receipts.some(
                    (r) =>
                        r.providerObservation?.generationId ===
                            o.generationId &&
                        typeof r.reportedCost === "number" &&
                        Math.abs(r.reportedCost - o.cost) < 1e-10,
                ),
            );
        const unknownCharges = calls.filter(
            (e) =>
                !outcomes.some(
                    (o) => o.call === e.call && Number.isFinite(o.cost),
                ),
        ).length;
        const accounting = { unknownCharges, reconciled: matched };
        if (live && !matched) failure = true;
        const report: Record<string, unknown> = {
            status: qualificationDecision(
                failure,
                plan.required,
                journal.results(),
                accounting,
            ),
            boundary: protocol.boundary,
            scenarios: protocol.scenarios.map(
                (scenario) =>
                    journal
                        .results()
                        .find((result) => result.scenario === scenario) ?? {
                        scenario,
                        executionIntegrity: "not_completed",
                        semanticTask: "not_assessed",
                        evidence: `${scenario}-before.json`,
                    },
            ),
            capability: protocol.capability,
            mode: selectedMode,
            batteryHash,
            candidateHash: candidateHash(fingerprints),
            requiredCases: plan.required,
            unavailableCapabilities: protocol.unavailableCapabilities,
            executionIntegrity: qualificationDecision(
                failure,
                plan.required,
                journal
                    .results()
                    .map((r) => ({ ...r, semanticTask: "not_required" })),
                accounting,
            ),
            modelTaskQuality: live
                ? "not_evaluated"
                : "not_applicable_simulation",
            semanticTask: "manual_review_required",
            providerRequests: calls.length,
            costReconciliation: matched
                ? "matched_known_charges"
                : "unreconciled",
            reportedCostUsd: outcomes.reduce(
                (sum, e) => sum + (e.cost ?? 0),
                0,
            ),
            unknownCharges,
            persistedReportedCostUsd:
                final?.receipts.reduce(
                    (sum, r) => sum + (r.reportedCost ?? 0),
                    0,
                ) ?? null,
            cleanup,
            browserErrors: errors,
            diagnostics,
        };
        journal.finish("qualification", {
            executionIntegrity: report.status,
            semanticTask: report.semanticTask,
        });
        save(root, "report", report);
        process.removeListener("SIGTERM", onSignal);
        process.removeListener("SIGINT", onSignal);
        const archiveArgs = [
            "evaluation:archive",
            "--name",
            "workbench-qualification",
            "--external",
            `qualification=${root}`,
        ];
        try {
            command(
                "pnpm",
                [...archiveArgs, "--dry-run"],
                TOOLING_POLICY.archiveCommandTimeoutMs,
            );
            writeFileSync(
                join(root, "archive-result.txt"),
                command(
                    "pnpm",
                    archiveArgs,
                    TOOLING_POLICY.archiveCommandTimeoutMs,
                ),
                { mode: 0o600 },
            );
        } catch {
            failure = true;
            report.status = "failed";
            report.archiveVerified = false;
            save(root, "report", report);
            console.error(
                "Qualification archive failed; original evidence retained.",
            );
        }
        console.log(
            `Qualification ${String(report.status)}; report: ${join(root, "report.json")}`,
        );
        if (report.status !== "passed")
            process.exitCode = report.status === "inconclusive" ? 2 : 1;
    }
    if (failure) process.exitCode = 1;
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
    if (values.help) {
        console.log(
            "Campaign: --campaign prepare|authorize|run|status|assess|close --output ABSOLUTE_DIRECTORY [--manifest FILE] [--configuration ID] [--correction DESCRIPTION] [--review FILE]. Prepare has no authorization effects. Authorize requires the user-approved immutable mandate. Run retains a lot and reports the acknowledged assessment or the pending state. It leaves code and unfinished scenario calls untouched.\n\npnpm workbench:qualify [--sources-phase prepare|inspect|close --output ABSOLUTE_DIRECTORY] [--mode deterministic|live] [--output ABSOLUTE_DIRECTORY] [--maximum-requests 1..20]\nUses the verified running local backend and web server. Real anonymous admission is required. Version-2 campaign manifests declare scenarios, ordered steps, configurations and budgets; executionSurface=backend uses public authenticated backend operations without a browser or web service and requires explicit targeted scenarios; new preparation defaults to backend; select executionSurface=browser explicitly for UI qualification. Previously prepared manifests keep their retained surface. Backend evidence does not qualify UI behavior; run selects the next configuration or --configuration ID. Historical standalone Workbench mode retains 20 requests / USD0.50. Historical standalone Sources phases retain the two-dossier manifest, 40 model attempts / 4 searches / 12 acquisitions / USD2; Start research stays in the admitted browser. An existing output directory cannot renew a closed or interrupted lot.\nOffline assessment: --assess DIRECTORY [--review FILE]. Without --review, print the evidence-bound review template.",
        );
    } else {
        try {
            if (values.campaign) {
                assert(
                    values.output,
                    "Campaign requires an external evidence directory",
                );
                await runCampaign(
                    values.campaign,
                    values.output,
                    values,
                    runWorkbenchQualification,
                );
            } else if (values["sources-phase"]) {
                assert(
                    values.output,
                    "Sources phase requires an explicit output directory",
                );
                await sourcesQualificationPhase(
                    values["sources-phase"],
                    values.output,
                );
            } else if (values.assess) {
                const result = values.review
                    ? assessQualification(
                          resolve(values.assess),
                          JSON.parse(readFileSync(values.review, "utf8")),
                      )
                    : qualificationReviewTemplate(resolve(values.assess));
                console.log(JSON.stringify(result, null, 2));
                if ("status" in result && result.status !== "passed")
                    process.exitCode = result.status === "inconclusive" ? 2 : 1;
            } else {
                assert(!values.review, "--review requires --assess");
                await runWorkbenchQualification();
            }
        } catch {
            console.error(
                "Workbench qualification could not complete. If an evidence directory was printed, inspect its report; otherwise local prerequisites failed before setup. Sensitive diagnostics are excluded.",
            );
            process.exitCode = 1;
        }
    }
}
