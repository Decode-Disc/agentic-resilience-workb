import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
    cpSync,
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    writeFileSync,
} from "node:fs";
import type { Server } from "node:http";
import { join, relative, resolve } from "node:path";
import { type Browser, chromium, expect, type Page } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import {
    type FunctionArgs,
    type FunctionReference,
    type FunctionReturnType,
    getFunctionName,
    makeFunctionReference,
} from "convex/server";
import { api, internal } from "../../../convex/_generated/api.js";
import type { Id } from "../../../convex/_generated/dataModel";
import {
    type CampaignManifest,
    campaignConfiguration,
    campaignManifestSchema,
} from "../../../convex/qualificationCampaignPolicy.ts";
import { initialFixtureContent } from "../../../convex/qualificationInitialFixtures.ts";
import { resolveLocalRuntime } from "../../local-runtime.ts";
import {
    configureCampaign,
    restoreCampaignConfiguration,
} from "./campaign-configuration.ts";
import { openQualificationJournal } from "./journal.ts";
import {
    openQualificationSession,
    withQualificationAdministrator,
} from "./model-preparation.ts";
import {
    browserBatteryPath,
    candidateHash,
    preserveQualificationCandidate,
    qualificationFingerprints,
    sha256,
    sourcesBatterySchema,
    verifyQualificationCandidate,
} from "./protocol.ts";
import { createQualificationRelay } from "./relay.mjs";
import {
    inspectCampaignScenarios,
    prepareCampaignScenarios,
    runCampaignScenarios,
} from "./scenarios.ts";
import { sourcesQualificationPhase } from "./sources.ts";

function ref<R extends FunctionReference<"query" | "mutation", "internal">>(
    r: R,
) {
    return makeFunctionReference<
        R["_type"],
        FunctionArgs<R>,
        FunctionReturnType<R>
    >(getFunctionName(r));
}
const read = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const save = (root: string, name: string, value: unknown) =>
    writeFileSync(
        join(root, `${name}.json`),
        `${JSON.stringify(value, null, 2)}\n`,
        { mode: 0o600 },
    );
const batteryPath = (m: CampaignManifest) =>
    m.capability === "sources"
        ? "scripts/evaluations/workbench-browser/sources-cases.json"
        : browserBatteryPath;

const fingerprints = qualificationFingerprints;

/** Binds each semantic judgment to preserved bytes, including Sources requests and captures. */
export function campaignReviewTemplate(
    root: string,
    options: { recovery?: boolean } = {},
) {
    const retained = read(join(root, "campaign-lot.json")) as {
        manifest: CampaignManifest;
        candidateHash: string;
        fingerprints: Record<string, string>;
    };
    const manifest = campaignManifestSchema.parse(retained.manifest);
    const files: Record<string, string> = {};
    const collect = (directory: string) => {
        for (const item of readdirSync(directory, { withFileTypes: true })) {
            const path = join(directory, item.name);
            if (item.isDirectory()) collect(path);
            else if (
                !item.name.startsWith("assessment-") &&
                !(
                    directory === root &&
                    /^(?:review-template|evidence-index)(?:-[a-f0-9]{64})?\.json$/.test(
                        item.name,
                    )
                )
            )
                files[relative(root, path)] = sha256(readFileSync(path));
        }
    };
    for (const [path, expected] of Object.entries(retained.fingerprints)) {
        if (expected !== "deleted")
            assert.equal(
                sha256(readFileSync(join(root, "code", path))),
                expected,
                "Preserved candidate changed",
            );
    }
    const freeze = (name: string, value: unknown) => {
        const path = join(root, `${name}.json`);
        if (existsSync(path))
            assert.deepEqual(
                read(path),
                value,
                "Frozen evidence revision changed",
            );
        else
            writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, {
                mode: 0o600,
                flag: "wx",
            });
    };
    const indexPath = join(root, "evidence-index.json");
    const templatePath = join(root, "review-template.json");
    const currentHash = existsSync(templatePath)
        ? (read(templatePath) as { evidenceHash: string }).evidenceHash
        : undefined;
    if (currentHash !== undefined)
        assert(/^[a-f0-9]{64}$/.test(currentHash), "Invalid evidence revision");
    const currentIndex = currentHash
        ? join(root, `evidence-index-${currentHash}.json`)
        : indexPath;
    if (options.recovery && currentHash) {
        const previous = read(
            existsSync(currentIndex) ? currentIndex : indexPath,
        ) as Record<string, string>;
        assert.equal(
            candidateHash(previous),
            currentHash,
            "Evidence revision unavailable",
        );
        freeze(`evidence-index-${currentHash}`, previous);
        freeze(`review-template-${currentHash}`, read(templatePath));
    }
    let evidence: Record<string, string>;
    if (!options.recovery && existsSync(currentIndex))
        evidence = read(currentIndex) as Record<string, string>;
    else if (!options.recovery && existsSync(indexPath))
        evidence = read(indexPath) as Record<string, string>;
    else {
        collect(root);
        evidence = files;
        if (!existsSync(indexPath)) save(root, "evidence-index", evidence);
    }
    const evidenceHash = candidateHash(evidence);
    if (!options.recovery && currentHash)
        assert.equal(
            evidenceHash,
            currentHash,
            "Evidence revision unavailable",
        );
    for (const [path, expected] of Object.entries(evidence))
        assert.equal(
            sha256(readFileSync(join(root, path))),
            expected,
            "Stale campaign evidence",
        );
    freeze(`evidence-index-${evidenceHash}`, evidence);
    const template = {
        candidateHash: retained.candidateHash,
        batteryHash: manifest.batteryHash,
        evidenceHash,
        cases: manifest.expectations.map((c) => ({
            id: c.id,
            checks: Object.fromEntries(
                c.checks.map((key) => [key, "inconclusive"]),
            ),
            finding: "",
            evidence: [] as string[],
        })),
    };
    freeze(`review-template-${evidenceHash}`, template);
    return template;
}

/** Appends an assessment; a mechanical success cannot fill missing semantic judgments. */
export function assessCampaignLot(root: string, review: unknown) {
    const expected = campaignReviewTemplate(root);
    assert(
        review && typeof review === "object" && "cases" in review,
        "Review required",
    );
    const input = review as typeof expected;
    for (const key of ["candidateHash", "batteryHash", "evidenceHash"] as const)
        assert.equal(input[key], expected[key], "Stale campaign review");
    assert(Array.isArray(input.cases));
    assert.deepEqual(
        input.cases.map((c) => c.id).sort(),
        expected.cases.map((c) => c.id).sort(),
        "Review must cover every mandatory case exactly once",
    );
    for (const item of input.cases) {
        const required = expected.cases.find((c) => c.id === item.id);
        assert(required);
        assert.deepEqual(
            Object.keys(item.checks).sort(),
            Object.keys(required.checks).sort(),
            "Review expectations changed",
        );
        assert(
            typeof item.finding === "string" &&
                item.finding.trim().length >= 10,
            "Evidence-backed finding required",
        );
        assert(
            Array.isArray(item.evidence) && item.evidence.length > 0,
            "Evidence references required",
        );
        for (const path of item.evidence)
            assert(
                !relative(root, resolve(root, path)).startsWith("..") &&
                    existsSync(resolve(root, path)),
                "Invalid review evidence reference",
            );
        assert(
            Object.values(item.checks).every((v) =>
                ["passed", "failed", "inconclusive"].includes(v),
            ),
            "Invalid review verdict",
        );
    }
    const mechanical = read(join(root, "campaign-result.json")) as {
        completed: boolean;
        cleanupCompleted: boolean;
        failure?: unknown;
    };
    const verdict =
        mechanical.failure ||
        !mechanical.completed ||
        !mechanical.cleanupCompleted ||
        input.cases.some((c) => Object.values(c.checks).includes("failed"))
            ? ("failed" as const)
            : input.cases.every((c) =>
                    Object.values(c.checks).every((v) => v === "passed"),
                )
              ? ("passed" as const)
              : ("inconclusive" as const);
    const assessment = {
        ...input,
        verdict,
        reviewer: "development_agent",
        modelTaskQuality: "limited_to_declared_expectations",
    };
    const assessmentHash = sha256(JSON.stringify(assessment));
    const path = join(root, `assessment-${assessmentHash}.json`);
    if (!existsSync(path))
        writeFileSync(path, `${JSON.stringify(assessment, null, 2)}\n`, {
            flag: "wx",
            mode: 0o600,
        });
    return { assessmentHash, verdict, path };
}

/** Closes the fenced context completely; inspection page size cannot limit campaign cleanup. */
export async function closeCampaignContext(
    client: Pick<ConvexHttpClient, "mutation">,
    contextKey: string,
) {
    let cursor: string | undefined;
    for (;;) {
        const result: FunctionReturnType<
            typeof internal.runWorkspace.closeBrowserTestContext
        > = await client.mutation(
            ref(internal.runWorkspace.closeBrowserTestContext),
            { slotKey: "analyst-4", contextKey, cursor },
        );
        if (result.done) return;
        assert(
            result.cursor && result.cursor !== cursor,
            "Context cleanup cursor did not advance",
        );
        cursor = result.cursor;
    }
}

type WorkbenchRunner = (options: {
    mode?: string;
    output?: string;
    locked?: boolean;
    "maximum-requests"?: string;
    campaignLotId?: Id<"qualificationLots">;
    maximumCostUsd?: number;
}) => Promise<void>;
async function executeCampaign(
    action: string,
    output: string,
    options: {
        manifest?: string;
        review?: string;
        correction?: string;
        configuration?: string;
    },
    runWorkbench?: WorkbenchRunner,
) {
    assert(
        ["prepare", "authorize", "run", "status", "assess", "close"].includes(
            action,
        ),
        "Unknown campaign operation",
    );
    const root = resolve(output);
    assert(
        relative(process.cwd(), root).startsWith(".."),
        "Campaign evidence must be outside the checkout",
    );
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const statePath = join(root, "campaign.json");
    if (action === "prepare") {
        assert(
            options.manifest && !existsSync(statePath),
            "A fresh campaign and manifest are required",
        );
        const input = read(options.manifest);
        let resolvedInput = input;
        if (
            input &&
            typeof input === "object" &&
            "version" in input &&
            input.version === 2
        ) {
            let values = { executionSurface: "backend", ...input } as Record<
                string,
                unknown
            >;
            assert(
                values.executionSurface !== "backend" || "scenarios" in values,
                "Backend evaluation requires explicit targeted scenarios",
            );
            if (!("scenarios" in values)) {
                const sourceDefaults = read(
                    "scripts/evaluations/workbench-browser/sources-cases.json",
                ) as {
                    cases: Array<{
                        id: string;
                        companyCik: string;
                        companyName: string;
                        ticker: string;
                        websiteUrl: string;
                        scope: string;
                        questions: unknown[];
                        steps: unknown[];
                        expectations: string[];
                    }>;
                };
                const entries =
                    values.capability === "sources"
                        ? sourceDefaults.cases
                        : (
                              read(browserBatteryPath) as {
                                  cases: Array<{
                                      id: string;
                                      modes: string[];
                                      steps: unknown[];
                                      expectations: string[];
                                  }>;
                              }
                          ).cases.filter((c) =>
                              c.modes.includes(String(values.mode)),
                          );
                values = {
                    ...values,
                    scenarios: entries.map((c) => {
                        const base =
                            "companyCik" in c ? c : sourceDefaults.cases[0];
                        assert(base);
                        return {
                            id: c.id,
                            company: {
                                cik: base.companyCik,
                                name: base.companyName,
                                ticker: base.ticker,
                                websiteUrl: base.websiteUrl,
                            },
                            framing: {
                                scope: base.scope,
                                questions: base.questions,
                            },
                            steps: c.steps,
                        };
                    }),
                    expectations:
                        values.expectations ??
                        entries.map((c) => ({
                            id: c.id,
                            checks: c.expectations,
                        })),
                };
            }
            resolvedInput = {
                ...values,
                batteryHash: sha256(JSON.stringify(values.scenarios)),
            };
        }
        const manifest = campaignManifestSchema.parse(resolvedInput);
        if (manifest.version === 2) {
            for (const scenario of manifest.scenarios)
                if (scenario.initialFixture)
                    assert.equal(
                        scenario.initialFixture.hash,
                        sha256(
                            initialFixtureContent(scenario.initialFixture.id),
                        ),
                        "Initial fixture content changed",
                    );
            manifest.batteryHash = sha256(JSON.stringify(manifest.scenarios));
        }
        if (manifest.version === 1)
            assert.equal(
                sha256(readFileSync(batteryPath(manifest))),
                manifest.batteryHash,
                "Campaign battery changed",
            );
        assert(manifest.expiresAt > Date.now(), "Campaign expired");
        save(root, "campaign", {
            manifest,
            fingerprints: fingerprints(),
            boundary: "prepared_without_authorization",
        });
        return;
    }
    const state = read(statePath) as {
        manifest: CampaignManifest;
        fingerprints: Record<string, string>;
        campaignId?: Id<"qualificationCampaigns">;
    };
    const manifest = campaignManifestSchema.parse(state.manifest);
    if (action === "run" && options.configuration)
        campaignConfiguration(manifest, options.configuration);
    const backend =
        manifest.version === 2 && manifest.executionSurface === "backend";
    const runtime = await resolveLocalRuntime(process.cwd(), {
        requiredOrigins: ["convex"],
        verificationScope: backend ? "required" : "all",
    });
    const web = runtime.origins.web;
    const client = new ConvexHttpClient(runtime.origins.convex, {
        logger: false,
    });
    const config = read(".convex/local/default/config.json") as {
        adminKey: string;
    };
    (
        client as ConvexHttpClient & { setAdminAuth(key: string): void }
    ).setAdminAuth(config.adminKey);
    const command = (args: string[]) => {
        const result = spawnSync(
            process.execPath,
            [
                "node_modules/convex/bin/main.js",
                ...args,
                "--deployment",
                "local",
            ],
            { encoding: "utf8", timeout: 30000 },
        );
        assert.equal(
            result.status,
            0,
            "Local campaign operation failed; sensitive diagnostics withheld",
        );
        return result.stdout.trim();
    };
    const inspectCampaign = async (
        campaignId: Id<"qualificationCampaigns">,
    ) => {
        const snapshot = await client.query(
            ref(internal.qualificationCampaigns.inspect),
            { campaignId },
        );
        const lots = [...snapshot.lots];
        let cursor = snapshot.continueCursor;
        while (cursor) {
            const next = await client.query(
                ref(internal.qualificationCampaigns.inspect),
                { campaignId, paginationOpts: { numItems: 32, cursor } },
            );
            lots.push(...next.lots);
            assert(
                next.continueCursor !== cursor,
                "Campaign audit cursor did not advance",
            );
            cursor = next.continueCursor;
        }
        return {
            ...snapshot,
            lots: lots.sort((a, b) => a.createdAt - b.createdAt),
        };
    };
    const verifyBattery = () =>
        assert.equal(
            manifest.version === 2
                ? sha256(JSON.stringify(manifest.scenarios))
                : sha256(readFileSync(batteryPath(manifest))),
            manifest.batteryHash,
            "Campaign battery changed",
        );
    const existingCampaign = state.campaignId
        ? await inspectCampaign(state.campaignId)
        : null;
    if (existingCampaign && action !== "close")
        assert.deepEqual(
            manifest,
            existingCampaign.campaign.manifest,
            "Local mandate differs from the server authorization",
        );
    if (action === "status") {
        const snapshot = state.campaignId
            ? await inspectCampaign(state.campaignId)
            : { status: "not_authorized" };
        save(root, "status", snapshot);
        console.log(JSON.stringify(snapshot, null, 2));
        return;
    }
    // One process owns temporary flags, model settings and the shared browser slot.
    if (action === "assess") {
        assert(
            state.campaignId && options.review,
            "Authorized campaign and review required",
        );
        const snapshot = await inspectCampaign(state.campaignId);
        const lot = snapshot.lots.find(
            (l) => l._id === snapshot.campaign.activeLotId,
        );
        assert(lot?.status === "review", "A reconciled lot must await review");
        const result = assessCampaignLot(
            join(root, "lots", lot.key),
            read(options.review),
        );
        const archived = spawnSync(
            "pnpm",
            [
                "evaluation:archive",
                "--name",
                `campaign-${state.manifest.key}-${lot.key}-assessment`.slice(
                    0,
                    64,
                ),
                "--external",
                `qualification=${join(root, "lots", lot.key)}`,
            ],
            { encoding: "utf8", timeout: 120000 },
        );
        save(root, `assessment-archive-${lot.key}`, {
            completed: archived.status === 0,
        });
        assert.equal(
            archived.status,
            0,
            "Assessment archive failed; retained evidence is unchanged",
        );
        await client.mutation(ref(internal.qualificationCampaigns.assess), {
            lotId: lot._id,
            assessmentHash: result.assessmentHash,
            verdict: result.verdict,
        });
        save(root, "summary", await inspectCampaign(state.campaignId));
        console.log(JSON.stringify(result));
        process.exitCode =
            result.verdict === "passed"
                ? 0
                : result.verdict === "inconclusive"
                  ? 2
                  : 1;
        return;
    }
    let recovering = false;
    if (action === "close" && state.campaignId)
        await client.mutation(ref(internal.qualificationCampaigns.close), {
            campaignId: state.campaignId,
        });
    if (
        action === "close" &&
        (!existingCampaign?.campaign.activeLotId ||
            existingCampaign.lots.some(
                (l) =>
                    l._id === existingCampaign.campaign.activeLotId &&
                    ["review", "finished"].includes(l.status),
            ))
    )
        return;
    let validationRoot: string | undefined;
    if (action === "run" && state.campaignId) {
        const currentState = await inspectCampaign(state.campaignId);
        if (currentState.campaign.activeLotId) {
            const pending = currentState.lots.find(
                (l) => l._id === currentState.campaign.activeLotId,
            );
            assert(
                pending && ["running", "closing"].includes(pending.status),
                "Review the preceding lot before another run",
            );
            recovering = true;
            await client.mutation(
                ref(internal.qualificationCampaigns.beginCleanup),
                { lotId: currentState.campaign.activeLotId },
            );
        } else {
            validationRoot = join(
                root,
                "preflight",
                candidateHash(fingerprints()),
            );
            mkdirSync(validationRoot, { recursive: true, mode: 0o700 });
            const candidate = preserveQualificationCandidate(validationRoot);
            verifyQualificationCandidate(validationRoot, candidate);
        }
    }
    const publication = await client.query(
        ref(internal.execution.piControl.publicationStatus),
        {},
    );
    assert(
        action === "close" ||
            recovering ||
            (!publication.held && !publication.hasActiveWorkers),
        "Quiet unheld local execution required",
    );
    const previousFlags = new Map(
        command(["env", "list"])
            .split("\n")
            .map((line) => {
                const i = line.indexOf("=");
                return [line.slice(0, i), line.slice(i + 1)];
            }),
    );
    const flagNames = ["E2E_FIXTURES_ENABLED", "WORKBENCH_AGENT_ENABLED"];
    // Intent survives process death; never replace a retained flag snapshot during recovery.
    const flagsPath = join(root, "flags.json");
    const flags: Array<{ name: string; previous: string | null }> =
        existsSync(flagsPath) &&
        !(
            existsSync(join(root, "cleanup.json")) &&
            (read(join(root, "cleanup.json")) as { completed: boolean })
                .completed
        )
            ? (read(flagsPath) as Array<{
                  name: string;
                  previous: string | null;
              }>)
            : flagNames.map((name) => ({
                  name,
                  previous: previousFlags.get(name) ?? null,
              }));
    save(root, "flags", flags);
    save(root, "cleanup", {
        completed: false,
        diagnostics: ["operation_pending"],
    });
    let browser: Browser | undefined;
    let session:
        | Awaited<ReturnType<typeof openQualificationSession>>
        | undefined;
    let page: Page | null = null;
    let relay: Server | undefined;
    let lot:
        | FunctionReturnType<
              typeof internal.qualificationCampaigns.inspect
          >["lots"][number]
        | undefined = existingCampaign?.lots.find(
        (l) => l._id === existingCampaign.campaign.activeLotId,
    );
    let lotRoot: string | undefined = lot
        ? join(root, "lots", lot.key)
        : undefined;
    let completed = false;
    let cleanupCompleted = false;
    let failure: unknown;
    let evidenceCaptureFailed = false;
    let interrupted = false;
    const onSignal = () => {
        interrupted = true;
    };
    const material = read("invitation-otp-codes.local") as {
        invitations: Array<{ slotKey: string; code: string }>;
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
    try {
        for (const flag of flags)
            if (previousFlags.get(flag.name) !== "true")
                command(["env", "set", flag.name, "true"]);
        const analyst = material.invitations.find(
            (i) => i.slotKey === "analyst-4",
        );
        assert(analyst);
        if (backend) {
            session = await openQualificationSession(
                runtime.origins.convex,
                analyst.code,
            );
        } else {
            assert(
                web,
                "Web service unavailable; backend cleanup will still run",
            );
            browser = await chromium.launch({
                ...(process.env.WORKBENCH_UI_BROWSER_PATH
                    ? { executablePath: process.env.WORKBENCH_UI_BROWSER_PATH }
                    : {}),
            });
            const admission = await browser.newContext({
                reducedMotion: "reduce",
                viewport: { width: 1440, height: 1000 },
            });
            page = await admission.newPage();
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
            page.setDefaultTimeout(20_000);
            await page.locator("#invitation-code").fill(analyst.code);
            await page
                .locator("form:has(#invitation-code) button[type=submit]")
                .click();
            await expect(page.locator("#invitation-code")).toHaveCount(0, {
                timeout: 20_000,
            });
        }
        if (action === "authorize") {
            verifyBattery();
            state.campaignId = await client.mutation(
                ref(internal.qualificationCampaigns.authorize),
                { manifest },
            );
            save(root, "campaign", state);
            return;
        }
        assert(state.campaignId, "Campaign has no explicit authorization");
        const snapshot = await inspectCampaign(state.campaignId);
        lot = snapshot.lots.find(
            (l) => l._id === snapshot.campaign.activeLotId,
        );
        if (action === "close")
            await client.mutation(ref(internal.qualificationCampaigns.close), {
                campaignId: state.campaignId,
            });
        if (lot) {
            lotRoot = join(root, "lots", lot.key);
            assert(
                action === "close" ||
                    ["running", "closing"].includes(lot.status),
                "Review the preceding lot before another run",
            );
            // Recovery performs cleanup only. The caller can review retained evidence before admitting another lot.
            if (action !== "close")
                failure = new Error(
                    "Interrupted lot retained; cleanup only, no replay",
                );
            if (failure) throw failure;
            return;
        }
        if (action === "close") return;
        verifyBattery();
        const current = fingerprints();
        const previous = snapshot.lots.at(-1);
        const baseline = previous
            ? (
                  read(
                      join(root, "lots", previous.key, "campaign-lot.json"),
                  ) as { fingerprints: Record<string, string> }
              ).fingerprints
            : state.fingerprints;
        const changedPaths = [
            ...new Set([...Object.keys(current), ...Object.keys(baseline)]),
        ].filter((path) => current[path] !== baseline[path]);
        const key = `lot-${snapshot.campaign.lots + 1}`;
        const lotId = await client.mutation(
            ref(internal.qualificationCampaigns.admit),
            {
                campaignId: state.campaignId,
                key,
                candidateHash: candidateHash(current),
                correction: options.correction,
                configurationId: options.configuration,
                changedPaths,
            },
        );
        lotRoot = join(root, "lots", key);
        mkdirSync(lotRoot, { recursive: true, mode: 0o700 });
        save(lotRoot, "campaign-lot", {
            manifest,
            candidateHash: candidateHash(current),
            fingerprints: current,
            configurationId: options.configuration,
        });
        const active = await inspectCampaign(state.campaignId);
        lot = active.lots.find((l) => l._id === lotId);
        assert(lot, "Admitted lot unavailable");
        save(lotRoot, "campaign-lot", {
            manifest,
            candidateHash: candidateHash(current),
            fingerprints: current,
            configurationId: lot.configurationId,
        });
        if (validationRoot) {
            cpSync(
                join(validationRoot, "validation.json"),
                join(lotRoot, "validation.json"),
            );
            cpSync(join(validationRoot, "checks"), join(lotRoot, "checks"), {
                recursive: true,
            });
        }
        const validatedFingerprints = preserveQualificationCandidate(lotRoot);
        assert.equal(
            candidateHash(validatedFingerprints),
            candidateHash(current),
            "Candidate changed before validation",
        );
        verifyQualificationCandidate(lotRoot, validatedFingerprints);
        const adminCode = material.invitations.find(
            (i) => i.slotKey === "admin",
        )?.code;
        if (manifest.mode === "live") {
            assert(adminCode);
            await withQualificationAdministrator(
                browser ?? null,
                { web: web, convex: runtime.origins.convex },
                adminCode,
                (admin) =>
                    configureCampaign(
                        admin,
                        manifest,
                        join(root, "lots", key),
                        lot?.configurationId,
                    ),
            );
        }
        assert(!interrupted, "Campaign interrupted before dispatch");
        if (manifest.version === 2) {
            assert(lot?.configurationId, "Declared configuration required");
            save(lotRoot, "protocol", {
                version: 3,
                manifest,
                configurationId: lot.configurationId,
                maximumRequests: manifest.perLot.model,
                maximumCostUsd: manifest.perLot.costUsd,
                boundary: `protected_local_${backend ? "backend" : "browser"}_${manifest.mode === "deterministic" ? "simulated" : "real"}_providers`,
            });
            let relayOrigin: string | undefined;
            if (
                manifest.mode === "live" &&
                manifest.capability === "workbench"
            ) {
                relay = createQualificationRelay(
                    lotRoot,
                    previousFlags.get("OPENROUTER_API_KEY"),
                );
                relay.listen(0, "127.0.0.1");
                await once(relay, "listening");
                const address = relay.address();
                assert(address && typeof address !== "string");
                relayOrigin = `http://127.0.0.1:${address.port}`;
            }
            await prepareCampaignScenarios(
                client,
                lotRoot,
                manifest,
                lotId,
                lot.configurationId,
                relayOrigin,
            );
            await runCampaignScenarios(
                page,
                client,
                web,
                runtime.origins.convex,
                lotRoot,
                manifest,
                () => interrupted,
                session?.client,
            );
            completed = true;
        } else if (manifest.capability === "workbench") {
            assert(runWorkbench);
            await runWorkbench({
                mode: manifest.mode,
                output: lotRoot,
                locked: true,
                "maximum-requests": String(Math.max(1, manifest.perLot.model)),
                maximumCostUsd: manifest.perLot.costUsd,
                campaignLotId: lotId,
            });
            const report = read(join(lotRoot, "report.json")) as {
                executionIntegrity?: string;
                cleanup?: { completed: boolean };
            };
            completed =
                report.executionIntegrity === "passed" &&
                report.cleanup?.completed === true;
            process.exitCode = 0;
        } else {
            const profile = campaignConfiguration(
                manifest,
                lot?.configurationId,
            );
            const sourcesChoice = profile.models.sources;
            assert(sourcesChoice, "Sources model required");
            const sourceBattery = sourcesBatterySchema.parse({
                ...(read(batteryPath(manifest)) as object),
                version: 3,
                mode: manifest.mode,
                reasoningEffort: undefined,
                modelRole: "harness_stress",
                model: sourcesChoice.model,
                workbenchModel: profile.models.workbench.model,
                provider: sourcesChoice.provider,
                responseControllerModel: profile.controllerModel,
                reasoningByRole: {
                    workbench: profile.models.workbench.reasoning,
                    sources: sourcesChoice.reasoning,
                },
                maximumModelAttempts: manifest.perLot.model,
                maximumSearchAttempts: manifest.perLot.search,
                maximumAcquisitions: manifest.perLot.acquisition,
                maximumCostUsd: manifest.perLot.costUsd,
            });
            await sourcesQualificationPhase("prepare", lotRoot, {
                battery: sourceBattery,
                lotId,
            });
            assert(
                page && web,
                "Legacy Sources qualification requires browser execution",
            );
            await runSourcesBrowser(
                page,
                web,
                runtime.origins.convex,
                lotRoot,
                client,
                sourceBattery,
                () => interrupted,
            );
            await sourcesQualificationPhase("inspect", lotRoot);
            completed = true;
        }
        assert.equal(
            candidateHash(fingerprints()),
            candidateHash(current),
            "Candidate changed during qualification",
        );
    } catch (error) {
        completed = false;
        failure = error;
    } finally {
        process.removeListener("SIGINT", onSignal);
        process.removeListener("SIGTERM", onSignal);
        const diagnostics: string[] = [];
        if (lot) {
            try {
                await client.mutation(
                    ref(internal.qualificationCampaigns.beginCleanup),
                    { lotId: lot._id },
                );
            } catch {
                diagnostics.push("dispatch_revocation_failed");
            }
        }
        if (lotRoot && existsSync(join(lotRoot, "prepared.json"))) {
            try {
                if (manifest.version === 2)
                    await inspectCampaignScenarios(client, lotRoot);
                else await sourcesQualificationPhase("inspect", lotRoot);
            } catch {
                completed = false;
                evidenceCaptureFailed = true;
            }
        }
        if (lot?.contextId || lot?._id) {
            try {
                const latest = state.campaignId
                    ? await inspectCampaign(state.campaignId)
                    : null;
                const contextId = latest?.lots.find(
                    (l) => l._id === lot?._id,
                )?.contextId;
                if (contextId) {
                    // The retained context key is backend-owned; never infer another active context.
                    const key = latest?.lots.find(
                        (l) => l._id === lot?._id,
                    )?.contextKey;
                    if (key) {
                        await closeCampaignContext(client, key);
                    } else diagnostics.push("context_key_unavailable");
                }
            } catch {
                diagnostics.push("context_cleanup_failed");
            }
        }
        if (
            lotRoot &&
            (backend || (browser && web)) &&
            existsSync(join(lotRoot, "configuration.json"))
        ) {
            try {
                const code = material.invitations.find(
                    (i) => i.slotKey === "admin",
                )?.code;
                assert(code);
                await withQualificationAdministrator(
                    browser ?? null,
                    { web: web, convex: runtime.origins.convex },
                    code,
                    (admin) =>
                        restoreCampaignConfiguration(
                            admin,
                            join(root, "lots", lot?.key ?? "unavailable"),
                        ),
                );
            } catch {
                diagnostics.push("configuration_restore_failed");
            }
        }
        if (
            lotRoot &&
            !backend &&
            (!browser || !web) &&
            existsSync(join(lotRoot, "configuration.json"))
        )
            diagnostics.push("configuration_restore_unavailable");
        try {
            relay?.closeAllConnections();
            if (relay)
                await new Promise<void>((resolve) =>
                    relay?.close(() => resolve()),
                );
        } catch {
            diagnostics.push("relay_close_failed");
        }
        try {
            await browser?.close();
        } catch {
            diagnostics.push("browser_close_failed");
        }
        try {
            await session?.close();
        } catch {
            diagnostics.push("qualification_signout_failed");
        }
        for (const flag of flags) {
            try {
                const current = new Map(
                    command(["env", "list"])
                        .split("\n")
                        .map((line) => {
                            const i = line.indexOf("=");
                            return [line.slice(0, i), line.slice(i + 1)];
                        }),
                );
                if (
                    current.get(flag.name) === flag.previous ||
                    (current.get(flag.name) === undefined &&
                        flag.previous === null)
                )
                    continue;
                assert(
                    current.get(flag.name) === "true",
                    "Temporary flag changed concurrently",
                );
                command(
                    flag.previous === null
                        ? ["env", "remove", flag.name]
                        : ["env", "set", flag.name, flag.previous],
                );
            } catch {
                diagnostics.push(`restore_${flag.name}_failed`);
            }
        }
        cleanupCompleted = diagnostics.length === 0;
        save(root, "cleanup", { completed: cleanupCompleted, diagnostics });
        if (lot && lotRoot) {
            save(lotRoot, "campaign-result", {
                completed,
                cleanupCompleted,
                evidenceCaptureFailed,
                failure: failure
                    ? "Inspect preserved scenario evidence; sensitive exception text withheld"
                    : null,
                diagnostics,
            });
            const result = await client.mutation(
                ref(internal.qualificationCampaigns.reconcile),
                { lotId: lot._id, cleanupCompleted },
            );
            save(lotRoot, "reconciliation", result);
            const archive = spawnSync(
                "pnpm",
                [
                    "evaluation:archive",
                    "--name",
                    `campaign-${manifest.key}-${lot.key}`.slice(0, 64),
                    "--external",
                    `qualification=${lotRoot}`,
                ],
                { encoding: "utf8", timeout: 120000 },
            );
            save(lotRoot, "archive-result", {
                completed: archive.status === 0,
            });
            if (archive.status !== 0) {
                process.exitCode = 1;
                failure ??= new Error(
                    "Campaign archive failed; original evidence retained",
                );
            }
            save(
                lotRoot,
                "review-template",
                campaignReviewTemplate(lotRoot, { recovery: recovering }),
            );
        }
        if (!cleanupCompleted || failure) process.exitCode = 1;
    }
    if (failure)
        throw new Error(
            "Campaign stopped; inspect retained evidence and cleanup diagnostics",
        );
    process.exitCode = 2;
    console.log(JSON.stringify({ status: "awaiting_review", root: lotRoot }));
}

type SourceBattery = ReturnType<typeof sourcesBatterySchema.parse>;
async function runSourcesBrowser(
    page: Page,
    web: string,
    convex: string,
    root: string,
    internalClient: ConvexHttpClient,
    battery: SourceBattery,
    interrupted: () => boolean,
) {
    const journal = openQualificationJournal(
        root,
        read(join(root, "protocol.json")) as Record<string, unknown>,
    );
    const prepared = read(join(root, "prepared.json")) as {
        cases: Array<{
            id: string;
            runId: Id<"researchRuns">;
            fixtureKey: string;
        }>;
    };
    const errors: string[] = [];
    let step = "initialize";
    try {
        await page.setViewportSize({ width: 1440, height: 1000 });
        page.on("pageerror", () => errors.push("page_error"));
        page.on("console", (message) => {
            if (message.type() === "error") errors.push("console_error");
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
        assert(token);
        const admitted = new ConvexHttpClient(convex, { logger: false });
        admitted.setAuth(token);
        await expect
            .poll(() => admitted.query(api.visitors.current), {
                timeout: 20_000,
            })
            .toMatchObject({ status: "active" });
        for (const item of prepared.cases) {
            assert(journal.begin(item.id), "Source scenario already completed");
            step = `${item.id}:framing`;
            const scenario = battery.cases.find((c) => c.id === item.id);
            assert(scenario);
            const inspect = () =>
                internalClient.query(
                    ref(internal.execution.fixtures.inspectWorkbench),
                    { runId: item.runId, fixtureKey: item.fixtureKey },
                );
            const settle = async (requireSources = false) => {
                await expect
                    .poll(
                        async () => {
                            assert(!interrupted(), "Campaign interrupted");
                            const s = await inspect();
                            return (
                                (!requireSources ||
                                    (s.missions.some(
                                        (m) => m.definitionId === "sources_v1",
                                    ) &&
                                        s.phase === "sources_prepared" &&
                                        s.executionStatus === "idle")) &&
                                s.missions.length > 0 &&
                                s.nativeSettled &&
                                s.queuedCount === 0 &&
                                s.missions.every((m) =>
                                    [
                                        "completed",
                                        "blocked",
                                        "failed",
                                        "cancelled",
                                    ].includes(m.status),
                                )
                            );
                        },
                        {
                            timeout:
                                battery.mode === "deterministic"
                                    ? 120_000
                                    : 900_000,
                            intervals: [1000, 2000],
                        },
                    )
                    .toBe(true);
                return inspect();
            };
            await internalClient.mutation(
                ref(internal.execution.fixtures.activateWorkbench),
                {
                    runId: item.runId,
                    fixtureKey: item.fixtureKey,
                    researchAngle: scenario.scope,
                },
            );
            await page.goto(`${web}/workspace/${item.runId}`);
            const framing = await settle();
            save(root, `${item.id}-framing`, framing);
            assert(framing.framing);
            // Public save uses the genuinely admitted browser principal; Start is exercised through the UI.
            await admitted.mutation(api.framing.save, {
                runId: item.runId,
                expectedRevision: framing.framing.revision,
                requestKey: `campaign-${item.id}-framing`,
                content: {
                    scope: scenario.scope,
                    questions: scenario.questions,
                },
            });
            const firstQuestion = scenario.questions[0];
            assert(
                firstQuestion,
                "Sources qualification requires a framed question",
            );
            await expect(
                page.getByRole("button", {
                    name: firstQuestion.shortLabel,
                    exact: true,
                }),
            ).toBeVisible({ timeout: 20_000 });
            step = `${item.id}:start`;
            await page
                .getByRole("button", { name: "Start research", exact: true })
                .click();
            if (item.id === "ccc") {
                step = `${item.id}:pause`;
                await page
                    .getByRole("button", {
                        name: "Pause research",
                        exact: true,
                    })
                    .click();
                await expect
                    .poll(async () => (await inspect()).executionStatus, {
                        timeout: 120_000,
                    })
                    .toBe("paused");
                save(root, `${item.id}-paused`, await inspect());
                step = `${item.id}:reconnect`;
                await page.goto(`${web}/workspace/dossiers`);
                await page.setViewportSize({ width: 390, height: 844 });
                await page.goto(`${web}/workspace/${item.runId}`);
                step = `${item.id}:resume`;
                await page
                    .getByRole("button", {
                        name: "Resume research",
                        exact: true,
                    })
                    .click();
            }
            step = `${item.id}:settle-sources`;
            const after = await settle(true);
            save(root, `${item.id}-after`, after);
            if (battery.mode === "deterministic") {
                assert.equal(
                    after.providerCallCount,
                    0,
                    "Simulated Sources dispatched a provider",
                );
                assert(
                    after.allMissionsSimulated,
                    "Live mission in simulation",
                );
                assert(
                    after.missions.some(
                        (m) =>
                            m.definitionId === "sources_v1" &&
                            m.status === "completed",
                    ),
                    "Sources did not complete",
                );
                const state = await internalClient.query(
                    ref(
                        internal.execution.fixtures.inspectSourcesQualification,
                    ),
                    { runId: item.runId, fixtureKey: item.fixtureKey },
                );
                save(root, `${item.id}-deterministic-assertions`, state);
                for (const kind of [
                    "discover_sources_for_need",
                    "make_source_consultable",
                    "search_available_material",
                    "read_in_context",
                    "submit_documentary_qualification",
                ])
                    assert(
                        state.requests.some(
                            (r) =>
                                r.input.kind === kind &&
                                r.status === "completed" &&
                                r.outcome?.kind === "success" &&
                                r.adoptedAt !== undefined &&
                                !r.adoptionRefusalCode,
                        ),
                        `Missing adopted Sources operation: ${kind}`,
                    );
                assert(
                    state.captures.some(
                        (c) => c.status === "committed" && c.contentHash,
                    ),
                    "No retained capture",
                );
                assert(
                    state.tasks.some(
                        (t) =>
                            t.taskType === "documentary_control" &&
                            t.executionMode === "showcase" &&
                            !t.providerCallId,
                    ),
                    "Missing labelled simulated control",
                );
                assert.equal(
                    state.preparation?.sourcesMission?.result?.outcome,
                    "partial",
                    "Simulation must preserve unfinished real research",
                );
                assert(
                    state.preparation?.sourcesMission?.result?.documents.length,
                    "No prepared documentary handoff",
                );
            }
            step = `${item.id}:follow-up`;
            const beforeCount = after.missions.length;
            if (!(await page.getByRole("textbox").isVisible()))
                await page
                    .getByRole("button", { name: "Ask AI", exact: true })
                    .click();
            await expect(page.getByRole("textbox")).toBeVisible({
                timeout: 20_000,
            });
            await page
                .getByRole("textbox")
                .fill(
                    "Explain the available documentary material, unfinished work and limitations without starting new research.",
                );
            await page
                .getByRole("button", { name: /Send (message|refinement)/ })
                .click();
            await expect
                .poll(async () => (await inspect()).missions.length, {
                    timeout: 20000,
                })
                .toBeGreaterThan(beforeCount);
            save(root, `${item.id}-published`, await settle());
            await page.screenshot({
                path: join(root, `${item.id}-final.png`),
                fullPage: true,
            });
            await page.setViewportSize({ width: 1440, height: 1000 });
            journal.finish(item.id, {
                executionIntegrity: "passed",
                semanticTask: "not_assessed",
            });
        }
        step = "completed";
        journal.finish("qualification", {
            executionIntegrity: "captured",
            semanticTask: "not_assessed",
        });
        assert.equal(errors.length, 0, "Browser errors observed");
    } finally {
        try {
            save(root, "browser-final-state", {
                step,
                url: page.url(),
                buttons: await page.getByRole("button").allTextContents(),
                text: await page.locator("body").innerText(),
            });
            await page.screenshot({
                path: join(root, "browser-final-state.png"),
                fullPage: true,
                mask: [page.locator("#invitation-code")],
            });
        } finally {
            try {
                save(root, "browser-errors", errors);
            } finally {
                await page.close();
            }
        }
    }
}

/** Holds the OS lock throughout configuration, execution and cleanup; process death releases it. */
export async function acquireCampaignLock(path: string) {
    const child = spawn(
        "flock",
        [
            "--exclusive",
            "--nonblock",
            path,
            process.execPath,
            "-e",
            "process.stdout.write('locked\\n'); process.stdin.resume()",
        ],
        { stdio: ["pipe", "pipe", "ignore"] },
    );
    await new Promise<void>((resolveLock, reject) => {
        child.once("error", reject);
        child.once("exit", () =>
            reject(new Error("Another qualification is active")),
        );
        child.stdout.once("data", () => resolveLock());
    });
    return async () => {
        const exit = once(child, "exit");
        child.stdin.end();
        await exit;
    };
}
export async function runCampaign(
    action: string,
    output: string,
    options: {
        manifest?: string;
        review?: string;
        correction?: string;
        configuration?: string;
    },
    runWorkbench?: WorkbenchRunner,
) {
    if (["prepare", "status"].includes(action))
        return executeCampaign(action, output, options, runWorkbench);
    const release = await acquireCampaignLock(
        join(process.cwd(), ".local-runtime", "workbench-qualification.lock"),
    );
    try {
        await executeCampaign(action, output, options, runWorkbench);
    } finally {
        await release();
    }
}
