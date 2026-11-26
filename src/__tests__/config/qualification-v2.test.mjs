import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCampaign } from "../../../scripts/evaluations/workbench-browser/campaign.ts";

import { configurableCampaign } from "../setup/qualification-v2.ts";

test("preparation stores one complete filing for four independent scenarios", async () => {
    const root = mkdtempSync(join(tmpdir(), "qualification-shared-filing-"));
    const text = readFileSync(
        "scripts/evaluations/workbench-browser/fixtures/documentary-operations-20261121/nvidia-annual-report.txt",
        "utf8",
    );
    const draft = configurableCampaign();
    draft.configurations = draft.configurations.slice(0, 1);
    draft.scenarios = Array.from({ length: 4 }, (_, index) => ({
        ...draft.scenarios[0],
        id: `shared-filing-${index}`,
        framingRequest: {
            text: "Investigate the supplied filing.",
            receivedAt: "2026-11-21T16:00:00.000Z",
        },
        framingPublicContext: true,
        framingReplay: {
            materialHash: "a".repeat(64),
            case: "heldout",
            unavailable: false,
            documents: [
                {
                    url: "https://example.com/filing",
                    title: "Retained complete filing",
                    text,
                },
            ],
        },
        steps: [
            {
                id: "settled",
                action: "wait_for",
                state: "conversation_settled",
            },
        ],
    }));
    draft.expectations = draft.scenarios.map((s) => ({
        id: s.id,
        checks: ["complete-independent-reading"],
    }));
    const input = join(root, "input.json");
    writeFileSync(input, JSON.stringify(draft));
    await runCampaign("prepare", root, { manifest: input });
    const prepared = JSON.parse(
        readFileSync(join(root, "campaign.json"), "utf8"),
    );
    assert(
        Buffer.byteLength(JSON.stringify(prepared.manifest)) < 1024 * 1024,
        "The prepared four-dossier mandate must fit the observed Convex value boundary",
    );
    assert.equal(
        Object.keys(prepared.manifest.sharedFramingDocuments).length,
        1,
    );
    const { resolveFramingReplay } = await import(
        "../../../convex/qualificationCampaignPolicy.ts"
    );
    for (const scenario of prepared.manifest.scenarios) {
        assert.equal(scenario.framingReplay.documents, undefined);
        assert.equal(
            resolveFramingReplay(prepared.manifest, scenario).documents[0].text,
            text,
        );
    }
});

test("preparation pins the accounting policy before mandate authorization", async () => {
    const root = mkdtempSync(join(tmpdir(), "qualification-accounting-pin-"));
    const input = join(root, "input.json");
    const draft = configurableCampaign();
    delete draft.costAccountingPolicy;
    writeFileSync(input, JSON.stringify(draft));
    await runCampaign("prepare", root, { manifest: input });
    const prepared = JSON.parse(
        readFileSync(join(root, "campaign.json"), "utf8"),
    );
    assert.equal(prepared.manifest.costAccountingPolicy, "known_final_v1");
});

test("new Sources preparation requires explicit research authority without changing historical parsing", async () => {
    const root = mkdtempSync(
        join(tmpdir(), "qualification-research-authority-"),
    );
    const input = join(root, "input.json");
    const legacy = { ...configurableCampaign(), batteryHash: "a".repeat(64) };
    delete legacy.researchDurationMs;
    assert.equal(
        campaignManifestSchema.parse(legacy).researchDurationMs,
        undefined,
    );
    writeFileSync(input, JSON.stringify(legacy));
    await assert.rejects(
        runCampaign("prepare", root, { manifest: input }),
        /Explicit researchDurationMs/,
    );
    assert.equal(existsSync(join(root, "campaign.json")), false);
});

test("prepare retains the explicit campaign context duration", async () => {
    const root = mkdtempSync(join(tmpdir(), "qualification-duration-"));
    const input = join(root, "input.json");
    writeFileSync(
        input,
        JSON.stringify({
            ...configurableCampaign(),
            contextDurationMs: 75 * 60_000,
        }),
    );
    await runCampaign("prepare", root, { manifest: input });
    const retained = JSON.parse(
        readFileSync(join(root, "campaign.json"), "utf8"),
    );
    assert.equal(retained.manifest.contextDurationMs, 4_500_000);
});

test("prepare freezes three free scenarios and two configurations with allowances above the former lot caps", async () => {
    const root = mkdtempSync(join(tmpdir(), "qualification-v2-"));
    const input = join(root, "input.json");
    writeFileSync(input, JSON.stringify(configurableCampaign()));
    await runCampaign("prepare", root, { manifest: input });
    const retained = JSON.parse(
        readFileSync(join(root, "campaign.json"), "utf8"),
    );
    assert.equal(retained.campaignId, undefined);
    assert.equal(retained.manifest.version, 2);
    assert.deepEqual(
        retained.manifest.scenarios.map((s) => s.id),
        ["claims", "creative", "platform"],
    );
    assert.deepEqual(
        retained.manifest.configurations.map((c) => c.id),
        ["first", "second"],
    );
    assert.deepEqual(retained.manifest.perLot, {
        model: 60,
        search: 6,
        acquisition: 18,
        costUsd: 3,
    });
    assert.match(retained.manifest.batteryHash, /^[a-f0-9]{64}$/);
});

import { getFunctionName } from "convex/server";
import { api } from "../../../convex/_generated/api.js";
import { campaignManifestSchema } from "../../../convex/qualificationCampaignPolicy.ts";
import { initialFixtureContent } from "../../../convex/qualificationInitialFixtures.ts";
import { sha256 } from "../../../scripts/evaluations/workbench-browser/protocol.ts";
import {
    inspectCampaignScenarios,
    prepareCampaignScenarios,
    runCampaignScenarios,
} from "../../../scripts/evaluations/workbench-browser/scenarios.ts";

test("prepare freezes an explicitly selected documentary starting fixture without changing ordinary scenarios", async () => {
    const root = mkdtempSync(join(tmpdir(), "qualification-initial-fixture-"));
    const input = join(root, "input.json");
    const manifest = configurableCampaign();
    const initialFixture = {
        id: "sources_completed_partial",
        hash: sha256(initialFixtureContent("sources_completed_partial")),
    };
    manifest.scenarios[0].initialFixture = initialFixture;
    manifest.scenarios[0].steps = [
        {
            id: "inspect",
            action: "send_message",
            text: "Explain the retained fixture limits.",
        },
    ];
    writeFileSync(input, JSON.stringify(manifest));
    await runCampaign("prepare", root, { manifest: input });
    const retained = JSON.parse(
        readFileSync(join(root, "campaign.json"), "utf8"),
    );
    assert.deepEqual(
        retained.manifest.scenarios[0].initialFixture,
        initialFixture,
    );
    assert.equal(retained.manifest.scenarios[1].initialFixture, undefined);
});

test("prepare refuses a documentary starting fixture outside Sources capability", async () => {
    const root = mkdtempSync(join(tmpdir(), "qualification-initial-scope-"));
    const input = join(root, "input.json");
    const manifest = configurableCampaign();
    manifest.capability = "workbench";
    for (const scenario of manifest.scenarios)
        scenario.steps = [
            {
                id: "inspect",
                action: "send_message",
                text: "Explain retained material.",
            },
        ];
    manifest.scenarios[0].initialFixture = {
        id: "sources_completed_partial",
        hash: sha256(initialFixtureContent("sources_completed_partial")),
    };
    writeFileSync(input, JSON.stringify(manifest));
    await assert.rejects(
        runCampaign("prepare", root, { manifest: input }),
        /Sources/,
    );
    assert.equal(existsSync(join(root, "campaign.json")), false);
});

test("an unavailable retained capture fails export while preserving its metadata", async () => {
    const root = mkdtempSync(join(tmpdir(), "qualification-missing-capture-"));
    writeFileSync(
        join(root, "prepared.json"),
        JSON.stringify({
            cases: [
                { id: "retained", runId: "fixture-run", fixtureKey: "fixture" },
            ],
        }),
    );
    const capture = {
        _id: "fixture-capture",
        status: "committed",
        storageId: "fixture-storage",
        contentHash: "a".repeat(64),
    };
    const client = {
        query: async (reference, args) => {
            const name = getFunctionName(reference);
            if (name === "execution/fixtures:qualificationSnapshot")
                return { run: { _id: "fixture-run" } };
            return {
                page: args.kind === "captures" ? [capture] : [],
                downloads: [],
                isDone: true,
                continueCursor: "",
            };
        },
    };
    await assert.rejects(
        () => inspectCampaignScenarios(client, root),
        /Capture bytes unavailable/,
    );
    const retained = JSON.parse(
        readFileSync(join(root, "retained/captures-1.json"), "utf8"),
    );
    assert.deepEqual(retained.page, [capture]);
    assert.equal("downloads" in retained, false);
    const postCleanup = join(root, "post-cleanup");
    await inspectCampaignScenarios(client, root, postCleanup, {
        mode: "post_cleanup",
    });
    assert.deepEqual(
        JSON.parse(
            readFileSync(join(postCleanup, "retained/captures-1.json"), "utf8"),
        ).page,
        [capture],
    );
    assert.equal(existsSync(join(postCleanup, "retained/snapshot.json")), true);
    assert.equal(
        existsSync(join(postCleanup, "retained/invocations-1.json")),
        false,
    );
});

for (const scenarioQuiet of [false, true]) {
    test(`full observation certifies cleanup reuse only for quiet Sources work=${scenarioQuiet}`, async () => {
        const root = mkdtempSync(join(tmpdir(), "qualification-observation-"));
        writeFileSync(
            join(root, "prepared.json"),
            JSON.stringify({
                cases: [
                    {
                        id: "retained",
                        runId: "fixture-run",
                        fixtureKey: "fixture",
                    },
                ],
            }),
        );
        const client = {
            query: async (reference) => {
                const name = getFunctionName(reference);
                if (name.endsWith(":qualificationContinuation"))
                    return {
                        scenarioQuiet,
                        accountingSettled: true,
                        hasEngagedEffects: false,
                    };
                if (name.endsWith(":qualificationSnapshot"))
                    return { run: { _id: "fixture-run" } };
                return {
                    page: [],
                    payloads: [],
                    isDone: true,
                    continueCursor: "",
                };
            },
        };
        const result = await inspectCampaignScenarios(client, root, root, {
            mode: "before_cleanup",
        });
        assert.equal(result.reusableAfterCleanup, scenarioQuiet);
        assert.equal(
            existsSync(join(root, "retained/invocations-1.json")),
            true,
        );
    });
}

async function independentScenarioProbe(t, overrides = {}) {
    const root = mkdtempSync(join(tmpdir(), "qualification-independent-"));
    const input = configurableCampaign();
    const manifest = campaignManifestSchema.parse({
        ...input,
        ...(overrides.backend ? { executionSurface: "backend" } : {}),
        batteryHash: "a".repeat(64),
        scenarios: input.scenarios.slice(0, 2).map((s) => ({
            ...s,
            ...(overrides.freshFraming
                ? {
                      framingRequest: {
                          text: "Which workflow remains durable?",
                          receivedAt: new Date().toISOString(),
                      },
                  }
                : {}),
            steps: [
                {
                    id: "settled",
                    action: "wait_for",
                    state: "conversation_settled",
                },
            ],
        })),
        expectations: input.expectations.slice(0, 2),
    });
    writeFileSync(
        join(root, "protocol.json"),
        `${JSON.stringify({ version: 3, manifest }, null, 2)}\n`,
    );
    writeFileSync(
        join(root, "prepared.json"),
        JSON.stringify({
            cases: manifest.scenarios.map((s) => ({
                id: s.id,
                runId: `fixture-${s.id}`,
                fixtureKey: `fixture-${s.id}`,
            })),
        }),
    );
    t.mock.method(
        globalThis,
        "fetch",
        async () =>
            new Response(
                JSON.stringify({
                    status: "success",
                    value: { status: "active" },
                }),
                { headers: { "Content-Type": "application/json" } },
            ),
    );
    const listeners = {};
    const activated = [];
    const page = {
        on: (name, listener) => {
            listeners[name] = listener;
        },
        goto: async (url) => {
            if (url.endsWith("/fixture-claims")) {
                listeners.console({ type: () => "error" });
                throw new Error("Retained first-scenario browser failure");
            }
        },
        evaluate: async () => "unit-boundary-token",
        setViewportSize: async () => {},
        screenshot: async ({ path }) => {
            if (overrides.screenshotFailure)
                throw new Error("Evidence capture failed");
            writeFileSync(path, "Mocked screenshot boundary");
        },
        locator: () => ({
            innerText: async () => "Unit boundary; no providers",
        }),
    };
    const snapshot = {
        run: { executionStatus: "idle" },
        conversation: { queuedCount: 0 },
        nativeSettled: true,
        sourcesMission: null,
        accounting: {
            pending: 0,
            unknown: 0,
            overruns: 0,
            conflicts: 0,
            usage: { model: 0, costUsd: 0 },
        },
        lotAccounting:
            overrides.snapshot && "accounting" in overrides.snapshot
                ? overrides.snapshot.accounting
                : {
                      pending: 0,
                      unknown: 0,
                      overruns: 0,
                      conflicts: 0,
                      usage: { model: 0, costUsd: 0 },
                  },
        hasEngagedEffects: false,
        continuationAuthorized: true,
        ...overrides.snapshot,
    };
    const client = {
        mutation: async (_reference, args) => {
            activated.push(args.runId);
            if (
                overrides.backend &&
                args.runId === "fixture-claims" &&
                !overrides.freshFraming
            )
                throw new Error("Settled backend case failure");
        },
        query: async (reference, args) => {
            const name = getFunctionName(reference);
            if (overrides.observeQuery) {
                const result = overrides.observeQuery(name, args, snapshot);
                if (result !== undefined) return result;
            }
            if (name === "visitors:current") return { status: "active" };
            if (name === "execution/fixtures:qualificationContinuation") {
                const quietConversation =
                    snapshot.nativeSettled &&
                    !snapshot.conversation?.activeTurnId &&
                    !snapshot.conversation?.queuedCount;
                const sourcesQuiet =
                    !snapshot.sourcesMission ||
                    ["completed", "blocked", "failed", "cancelled"].includes(
                        snapshot.sourcesMission.status,
                    );
                return {
                    accounting: snapshot.lotAccounting,
                    accountingSettled:
                        !!snapshot.lotAccounting &&
                        [
                            snapshot.lotAccounting.pending,
                            snapshot.lotAccounting.unknown,
                            snapshot.lotAccounting.overruns,
                            snapshot.lotAccounting.conflicts,
                        ].every((v) => v === 0),
                    hasEngagedEffects: snapshot.hasEngagedEffects,
                    authorized: snapshot.continuationAuthorized,
                    scenarioQuiet:
                        snapshot.run.executionStatus === "idle" &&
                        sourcesQuiet &&
                        quietConversation,
                    executionStatus: snapshot.run.executionStatus,
                    sourcesStatus: snapshot.sourcesMission?.status ?? null,
                    conversation: quietConversation
                        ? { kind: "settled" }
                        : {
                              kind: "unsettled",
                              ...(snapshot.mission?.blockCode
                                  ? { code: snapshot.mission.blockCode }
                                  : {}),
                          },
                };
            }
            if (name === "execution/fixtures:qualificationSnapshot")
                return snapshot;
            if (name === "execution/piControl:publicationStatus")
                return {
                    held: false,
                    hasActiveWorkers: false,
                    ...overrides.publication,
                };
            return { page: [], payloads: [], isDone: true, continueCursor: "" };
        },
    };
    await assert.rejects(() =>
        runCampaignScenarios(
            overrides.backend ? null : page,
            client,
            "http://localhost:5173",
            "http://localhost:3210",
            root,
            manifest,
            () => overrides.interrupted ?? false,
            overrides.backend ? client : undefined,
        ),
    );
    return { root, activated };
}

test("a terminal scenario failure remains failed while a quiet independent scenario is evaluated", async (t) => {
    const { root, activated } = await independentScenarioProbe(t);
    assert.deepEqual(activated, ["fixture-claims", "fixture-creative"]);
    const results = readFileSync(join(root, "progress.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
        .filter((e) => e.event === "finished");
    assert.deepEqual(
        results.map((r) => [r.scenario, r.executionIntegrity]),
        [
            ["claims", "failed"],
            ["creative", "passed"],
        ],
    );
    assert.deepEqual(
        JSON.parse(readFileSync(join(root, "claims/failure.json"))).errors,
        ["console_error"],
    );
});

test("backend failures preserve failure and continue quiet independent cases", async (t) => {
    const { root, activated } = await independentScenarioProbe(t, {
        backend: true,
    });
    assert.deepEqual(activated, ["fixture-claims", "fixture-creative"]);
    const events = readFileSync(join(root, "progress.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map(JSON.parse)
        .filter((e) => e.event === "finished");
    assert.deepEqual(
        events.map((e) => [e.scenario, e.executionIntegrity]),
        [
            ["claims", "failed"],
            ["creative", "passed"],
        ],
    );
});

test("a saved framing milestone survives a later blocked turn", async (t) => {
    const framing = {
        _id: "framing-before-failure",
        origin: "workbench",
        content: { scope: "Retained program", questions: [] },
    };
    const { root } = await independentScenarioProbe(t, {
        backend: true,
        freshFraming: true,
        snapshot: {
            framing,
            conversation: { activeTurnId: "blocked-turn" },
            mission: { status: "blocked", blockCode: "control_failed" },
        },
    });
    assert.deepEqual(
        JSON.parse(
            readFileSync(join(root, "claims/agent-saved-framing.json"), "utf8"),
        ),
        framing,
    );
    assert.equal(existsSync(join(root, "claims/latest-snapshot.json")), true);
});

test("a quiet local generation block continues independent scenarios while retaining the failed dossier", async (t) => {
    const { root, activated } = await independentScenarioProbe(t, {
        backend: true,
        freshFraming: true,
        snapshot: {
            framing: {
                _id: "framing-creative",
                origin: "workbench",
                content: { scope: "Creative program", questions: [] },
            },
        },
        observeQuery: (name, args, snapshot) => {
            if (args?.runId !== "fixture-claims") return undefined;
            if (name === "execution/fixtures:qualificationSnapshot")
                return {
                    ...snapshot,
                    nativeSettled: false,
                    conversation: {
                        activeTurnId: "blocked-turn",
                        queuedCount: 0,
                    },
                    mission: {
                        status: "blocked",
                        blockCode: "repetition_stop",
                    },
                };
            if (name === "execution/fixtures:qualificationContinuation")
                return {
                    accounting: snapshot.lotAccounting,
                    accountingSettled: true,
                    hasEngagedEffects: false,
                    authorized: true,
                    scenarioQuiet: true,
                    executionStatus: "idle",
                    sourcesStatus: null,
                    conversation: {
                        kind: "quiet_blocked",
                        code: "repetition_stop",
                    },
                };
            return undefined;
        },
    });
    assert.deepEqual(activated, ["fixture-claims", "fixture-creative"]);
    const events = readFileSync(join(root, "progress.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map(JSON.parse)
        .filter((e) => e.event === "finished");
    assert.deepEqual(
        events.map((e) => [e.scenario, e.executionIntegrity]),
        [
            ["claims", "failed"],
            ["creative", "passed"],
        ],
    );
    assert.deepEqual(
        JSON.parse(
            readFileSync(
                join(root, "claims/independent-continuation.json"),
                "utf8",
            ),
        ).conversation,
        { kind: "quiet_blocked", code: "repetition_stop" },
    );
});

test("unsettled work, uncertain accounting, publication holds and interruption prevent independent continuation", async (t) => {
    for (const overrides of [
        { snapshot: { nativeSettled: false } },
        { snapshot: { run: { executionStatus: "running" } } },
        { snapshot: { sourcesMission: { status: "running" } } },
        { snapshot: { accounting: null } },
        { snapshot: { accounting: { pending: 1, unknown: 0, overruns: 0 } } },
        { snapshot: { accounting: { pending: 0, unknown: 1, overruns: 0 } } },
        { snapshot: { accounting: { pending: 0, unknown: 0, overruns: 1 } } },
        {
            snapshot: {
                accounting: {
                    pending: 0,
                    unknown: 0,
                    overruns: 0,
                    conflicts: 1,
                },
            },
        },
        { snapshot: { hasEngagedEffects: true } },
        { snapshot: { continuationAuthorized: false } },
        {
            snapshot: {
                accounting: {
                    pending: 0,
                    unknown: 0,
                    overruns: 0,
                    conflicts: 0,
                    usage: { model: 60, costUsd: 0 },
                },
            },
        },
        { publication: { hasActiveWorkers: true } },
        { publication: { held: true } },
        { interrupted: true },
        { screenshotFailure: true },
    ]) {
        const { root, activated } = await independentScenarioProbe(
            t,
            overrides,
        );
        const entries = readFileSync(join(root, "progress.jsonl"), "utf8")
            .trim()
            .split("\n")
            .map(JSON.parse);
        assert(
            entries.some(
                (e) => e.event === "unrun" && e.scenario === "creative",
            ),
        );
        assert(
            !activated.includes("fixture-creative"),
            JSON.stringify(overrides),
        );
    }
});

test("scenario preparation uses the declared duration instead of the former forty-minute cap", async () => {
    const root = mkdtempSync(join(tmpdir(), "qualification-context-"));
    const manifest = campaignManifestSchema.parse({
        ...configurableCampaign(),
        batteryHash: "a".repeat(64),
        contextDurationMs: 75 * 60_000,
        expiresAt: Date.now() + 90 * 60_000,
    });
    let duration;
    let seeded = 0;
    await prepareCampaignScenarios(
        {
            mutation: async (reference, args) => {
                const name = getFunctionName(reference);
                if (name === "runWorkspace:openBrowserTestContext") {
                    duration = args.durationMs;
                    return "fixture-context";
                }
                if (name === "e2eFixtures:seedSourceReviewScenario")
                    return { runId: `fixture-run-${++seeded}` };
                return null;
            },
        },
        root,
        manifest,
        "fixture-lot",
        "first",
    );
    assert.equal(duration, 4_500_000);
    assert.equal(seeded, 3);
});

test("context duration respects mandate expiry and the server maximum before setup", async () => {
    const base = { ...configurableCampaign(), batteryHash: "a".repeat(64) };
    assert.equal(
        campaignManifestSchema.safeParse({
            ...base,
            contextDurationMs: 7_200_001,
        }).success,
        false,
    );
    for (const remaining of [30 * 60_000, 3 * 60 * 60_000]) {
        const manifest = campaignManifestSchema.parse({
            ...base,
            expiresAt: Date.now() + remaining,
        });
        let duration;
        await prepareCampaignScenarios(
            {
                mutation: async (reference, args) => {
                    if (
                        getFunctionName(reference) ===
                        "runWorkspace:openBrowserTestContext"
                    )
                        duration = args.durationMs;
                    return { runId: "fixture-run" };
                },
            },
            mkdtempSync(join(tmpdir(), "qualification-cap-")),
            manifest,
            "lot",
            "first",
        );
        assert(duration <= Math.min(remaining, 7_200_000));
        assert(
            duration >= Math.min(manifest.expiresAt - Date.now(), 7_200_000),
        );
    }
    let calls = 0;
    await assert.rejects(
        () =>
            prepareCampaignScenarios(
                {
                    mutation: async () => {
                        calls++;
                    },
                },
                mkdtempSync(join(tmpdir(), "qualification-expired-")),
                campaignManifestSchema.parse({
                    ...base,
                    expiresAt: Date.now() - 1,
                }),
                "lot",
                "first",
            ),
        /Campaign has expired/,
    );
    assert.equal(calls, 0);
});

test("explicit browser preparation may use the editable default battery and retain explicit steps", async () => {
    const root = mkdtempSync(join(tmpdir(), "qualification-default-"));
    const { scenarios, expectations, ...input } = configurableCampaign();
    const path = join(root, "input.json");
    writeFileSync(
        path,
        JSON.stringify({ ...input, executionSurface: "browser" }),
    );
    await runCampaign("prepare", root, { manifest: path });
    const retained = JSON.parse(
        readFileSync(join(root, "campaign.json"), "utf8"),
    ).manifest;
    assert.deepEqual(
        retained.scenarios.map((s) => s.id),
        ["ccc", "adobe"],
    );
    assert(
        retained.scenarios[0].steps.some((s) => s.action === "pause_research"),
    );
    assert.equal(retained.expectations.length, 2);
});
test("unsupported fault combinations and executable configuration are refused before setup", () => {
    const input = { ...configurableCampaign(), batteryHash: "a".repeat(64) };
    assert.equal(
        campaignManifestSchema.safeParse({
            ...input,
            mode: "deterministic",
            perLot: { model: 0, search: 0, acquisition: 0, costUsd: 0 },
            total: { model: 0, search: 0, acquisition: 0, costUsd: 0 },
            scenarios: input.scenarios.map((s) => ({
                ...s,
                steps: [
                    {
                        id: "fault",
                        action: "fault",
                        recipe: "malformed_response",
                    },
                ],
            })),
        }).success,
        false,
    );
    assert.equal(
        campaignManifestSchema.safeParse({
            ...input,
            scenarios: input.scenarios.map((s) => ({
                ...s,
                steps: [
                    {
                        id: "execute",
                        action: "evaluate",
                        script: "arbitrary()",
                    },
                ],
            })),
        }).success,
        false,
    );
});

import {
    configureCampaign,
    restoreCampaignConfiguration,
} from "../../../scripts/evaluations/workbench-browser/campaign-configuration.ts";

test("the selected shared-model profile changes one catalogue default and restores it once", async () => {
    const root = mkdtempSync(join(tmpdir(), "qualification-shared-profile-"));
    const raw = configurableCampaign();
    raw.configurations[1] = {
        id: "second",
        purpose: "harness_stress",
        models: {
            workbench: { model: "fixture/shared", reasoning: "low" },
            sources: { model: "fixture/shared", reasoning: "high" },
        },
    };
    const m = campaignManifestSchema.parse({
        ...raw,
        batteryHash: "a".repeat(64),
    });
    const state = {
        models: [
            {
                _id: "catalogue",
                model: "fixture/shared",
                enabled: true,
                status: "ready",
                currentRevisionId: "revision-1",
                revision: 1,
                reasoning: { preference: "recommended" },
                compatible: true,
            },
        ],
        assignments: ["workbench", "sources"].map((agent) => ({
            agent,
            catalogId: "catalogue",
            revision: 1,
        })),
        responseControl: {
            revision: 1,
            enabled: false,
            model: "fixture/control",
        },
    };
    const preferences = [];
    const client = {
        query: async () => structuredClone(state),
        mutation: async (_ref, args) => {
            assert.equal(args.catalogId, "catalogue");
            assert.equal(args.expectedRevision, state.models[0].revision);
            preferences.push(args.preference);
            const model = state.models[0];
            model.revision++;
            model.currentRevisionId = `revision-${model.revision}`;
            model.reasoning.preference = args.preference;
            return { revision: model.revision };
        },
        action: async () => {
            return { isDone: true, continueCursor: null };
        },
    };
    await configureCampaign(client, m, root, "second");
    assert.equal(state.models[0].reasoning.preference, "high");
    await restoreCampaignConfiguration(client, root);
    assert.deepEqual(preferences, ["high", "recommended"]);
});

test("campaign cleanup follows every owned context page beyond the legacy 25-page loop", async () => {
    const { closeCampaignContext } = await import(
        "../../../scripts/evaluations/workbench-browser/campaign.ts"
    );
    assert.equal(typeof closeCampaignContext, "function");
    let pages = 0;
    await closeCampaignContext(
        {
            mutation: async (_ref, args) => {
                assert.equal(args.contextKey, "retained-context");
                assert.equal(args.slotKey, "analyst-4");
                assert.equal(args.cursor, pages ? `page-${pages}` : undefined);
                pages++;
                return {
                    done: pages === 27,
                    cursor: `page-${pages}`,
                    cancelled: 0,
                };
            },
        },
        "retained-context",
    );
    assert.equal(pages, 27);
});
test("campaign cleanup refuses a stalled backend cursor instead of looping silently", async () => {
    const { closeCampaignContext } = await import(
        "../../../scripts/evaluations/workbench-browser/campaign.ts"
    );
    assert.equal(typeof closeCampaignContext, "function");
    let pages = 0;
    await assert.rejects(
        () =>
            closeCampaignContext(
                {
                    mutation: async () => {
                        pages++;
                        return { done: false, cursor: "stalled", cancelled: 0 };
                    },
                },
                "retained-context",
            ),
        /cursor did not advance/,
    );
    assert.equal(pages, 2);
});

test("backend campaigns retain an explicit execution boundary without changing historical mandates", () => {
    const original = { ...configurableCampaign(), batteryHash: "a".repeat(64) };
    const backend = campaignManifestSchema.parse({
        ...original,
        executionSurface: "backend",
    });
    assert.equal(backend.executionSurface, "backend");
    assert.equal(
        campaignManifestSchema.parse(original).executionSurface,
        undefined,
    );
    for (const action of [
        { action: "reload" },
        { action: "navigate", target: "dossier" },
        { action: "viewport", width: 390, height: 844 },
    ]) {
        const value = structuredClone(backend);
        value.scenarios[0].steps.push({ id: "browser-only", ...action });
        assert.equal(campaignManifestSchema.safeParse(value).success, false);
    }
});

for (const withInitialFixture of [false, true])
    test(`backend execution retains public-operation effects and snapshots without a browser${withInitialFixture ? " from a prepared fixture" : ""}`, async () => {
        const root = mkdtempSync(join(tmpdir(), "qualification-backend-"));
        const base = configurableCampaign();
        const manifest = campaignManifestSchema.parse({
            ...base,
            executionSurface: "backend",
            mode: "deterministic",
            scenarios: [
                {
                    ...base.scenarios[0],
                    ...(withInitialFixture
                        ? {
                              initialFixture: {
                                  id: "sources_completed_partial",
                                  hash: sha256(
                                      initialFixtureContent(
                                          "sources_completed_partial",
                                      ),
                                  ),
                              },
                          }
                        : {}),
                    steps: [
                        ...(!withInitialFixture
                            ? [{ id: "frame", action: "save_framing" }]
                            : []),
                        {
                            id: "ask",
                            action: "send_message",
                            text: "Explain the scoped workflow.",
                        },
                    ],
                },
            ],
            expectations: [base.expectations[0]],
            perLot: { model: 0, search: 0, acquisition: 0, costUsd: 0 },
            total: { model: 0, search: 0, acquisition: 0, costUsd: 0 },
            batteryHash: "a".repeat(64),
        });
        writeFileSync(
            join(root, "protocol.json"),
            `${JSON.stringify(
                { boundary: "protected_local_backend_simulated_providers" },
                null,
                2,
            )}\n`,
        );
        writeFileSync(
            join(root, "prepared.json"),
            JSON.stringify({
                cases: [{ id: "claims", runId: "run", fixtureKey: "fixture" }],
            }),
        );
        const snapshot = {
            nativeSettled: true,
            conversation: { activeTurnId: null, queuedCount: 0 },
            framing: { revision: 1 },
            run: { executionStatus: "idle" },
            lastMessage: null,
        };
        const effects = [];
        const client = {
            action: async (reference) => {
                effects.push(getFunctionName(reference));
                return {
                    preparationId: "preparation",
                    missionId: "mission",
                    captureId: "capture",
                };
            },
            query: async (reference) =>
                getFunctionName(reference) ===
                "execution/fixtures:qualificationSnapshot"
                    ? structuredClone(snapshot)
                    : {
                          page: [],
                          payloads: [],
                          downloads: [],
                          isDone: true,
                          continueCursor: "",
                      },
            mutation: async (reference) => {
                effects.push(getFunctionName(reference));
                assert.equal(
                    getFunctionName(reference),
                    "execution/fixtures:activateWorkbench",
                );
            },
        };
        const admitted = {
            query: async () => ({ status: "active" }),
            mutation: async (reference, args) => {
                effects.push(getFunctionName(reference));
                if (getFunctionName(reference) === "framing:save")
                    snapshot.framing.revision++;
                else {
                    assert.equal(
                        getFunctionName(reference),
                        "execution/conversations:submit",
                    );
                    assert.equal(args.text, "Explain the scoped workflow.");
                    snapshot.lastMessage = {
                        _id: "reply",
                        text: "Scoped explanation retained",
                    };
                }
            },
        };
        await runCampaignScenarios(
            null,
            client,
            undefined,
            "http://127.0.0.1:3210",
            root,
            manifest,
            () => false,
            admitted,
        );
        const after = JSON.parse(
            readFileSync(join(root, "claims/ask-after.json")),
        );
        assert.equal(after.framing.revision, withInitialFixture ? 1 : 2);
        if (withInitialFixture)
            assert.deepEqual(effects, [
                "qualificationInitialFixtureSetup:install",
                "execution/conversations:submit",
            ]);
        assert.equal(after.lastMessage.text, "Scoped explanation retained");
        assert.equal(existsSync(join(root, "claims/published-ui.json")), false);
        assert.match(
            readFileSync(join(root, "progress.jsonl"), "utf8"),
            /"executionIntegrity":"passed"/,
        );
    });

import { withQualificationAdministrator } from "../../../scripts/evaluations/workbench-browser/model-preparation.ts";

test("backend admission uses real public auth and invitation APIs and signs out after a failed callback", async (t) => {
    const paths = [];
    const token = `test.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.test`;
    t.mock.method(globalThis, "fetch", async (_input, init) => {
        const { path, args } = JSON.parse(init.body);
        paths.push(path);
        if (path !== "auth:signIn")
            assert.equal(
                new Headers(init.headers).get("Authorization"),
                `Bearer ${token}`,
            );
        if (path === "invitations:claim") assert.equal(args[0].code, "1234");
        return new Response(
            JSON.stringify({
                status: "success",
                value:
                    path === "auth:signIn"
                        ? { tokens: { token, refreshToken: "test-refresh" } }
                        : path === "visitors:current"
                          ? { status: "active" }
                          : null,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
        );
    });
    await assert.rejects(
        () =>
            withQualificationAdministrator(
                null,
                { convex: "http://127.0.0.1:3210" },
                "1234",
                async (client) => {
                    assert.equal(
                        (await client.query(api.visitors.current, {})).status,
                        "active",
                    );
                    throw new Error("Retained evaluation failure");
                },
            ),
        /Retained evaluation failure/,
    );
    assert.deepEqual(paths, [
        "auth:signIn",
        "invitations:claim",
        "visitors:current",
        "auth:signOut",
    ]);
});

test("backend preparation refuses an implicit full browser battery", async () => {
    const root = mkdtempSync(join(tmpdir(), "backend-explicit-scenarios-"));
    const input = configurableCampaign();
    delete input.scenarios;
    const path = join(root, "input.json");
    writeFileSync(
        path,
        JSON.stringify({ ...input, executionSurface: "backend" }),
    );
    await assert.rejects(
        () => runCampaign("prepare", root, { manifest: path }),
        /explicit targeted scenarios/,
    );
    assert.equal(existsSync(join(root, "campaign.json")), false);
});

test("backend authentication refreshes expiring credentials before protected requests", async (t) => {
    let refreshed = false;
    let signedOut = false;
    const token = (seconds) =>
        `test.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + seconds })).toString("base64url")}.test`;
    const initial = token(5);
    const renewed = token(3600);
    t.mock.method(globalThis, "fetch", async (_input, init) => {
        const { path, args } = JSON.parse(init.body);
        if (path === "auth:signIn") {
            if (args[0].refreshToken) {
                assert.equal(args[0].refreshToken, "initial-refresh");
                refreshed = true;
            }
        } else
            assert.equal(
                new Headers(init.headers).get("Authorization"),
                `Bearer ${renewed}`,
            );
        if (path === "auth:signOut") signedOut = true;
        return new Response(
            JSON.stringify({
                status: "success",
                value:
                    path === "auth:signIn"
                        ? {
                              tokens: {
                                  token: refreshed ? renewed : initial,
                                  refreshToken: refreshed
                                      ? "renewed-refresh"
                                      : "initial-refresh",
                              },
                          }
                        : null,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
        );
    });
    await withQualificationAdministrator(
        null,
        { convex: "http://127.0.0.1:3210" },
        "1234",
        async () => assert(refreshed),
    );
    assert(signedOut);
});

for (const status of ["failed", "cancelled", "idle"])
    test(`research handoff ${status === "idle" ? "accepts a blocked Sources mission after its idle partial handoff" : `stops on terminal ${status} state before another scenario`}`, async () => {
        const root = mkdtempSync(join(tmpdir(), "backend-terminal-research-"));
        const base = configurableCampaign();
        const scenarios =
            status === "idle" ? base.scenarios.slice(0, 1) : base.scenarios;
        const manifest = campaignManifestSchema.parse({
            ...base,
            executionSurface: "backend",
            batteryHash: "a".repeat(64),
            scenarios: scenarios.map((s) => ({
                ...s,
                steps: [
                    {
                        id: "handoff",
                        action: "wait_for",
                        state: "sources_prepared",
                    },
                ],
            })),
            expectations:
                status === "idle"
                    ? base.expectations.slice(0, 1)
                    : base.expectations,
        });
        writeFileSync(
            join(root, "protocol.json"),
            `${JSON.stringify({ boundary: "backend" }, null, 2)}\n`,
        );
        writeFileSync(
            join(root, "prepared.json"),
            JSON.stringify({
                cases: scenarios.map((s) => ({
                    id: s.id,
                    runId: s.id,
                    fixtureKey: s.id,
                })),
            }),
        );
        let reads = 0;
        const execute = () =>
            runCampaignScenarios(
                null,
                {
                    query: async (reference) => {
                        if (
                            getFunctionName(reference) !==
                            "execution/fixtures:qualificationSnapshot"
                        )
                            return {
                                page: [],
                                payloads: [],
                                downloads: [],
                                isDone: true,
                                continueCursor: "",
                            };
                        reads++;
                        return {
                            nativeSettled: true,
                            conversation: {
                                activeTurnId: null,
                                queuedCount: 0,
                            },
                            run: {
                                lifecycleState:
                                    status === "idle"
                                        ? "sources_prepared"
                                        : "draft",
                                executionStatus: status,
                            },
                            sourcesMission: { status: "blocked" },
                        };
                    },
                    mutation: async (reference) => {
                        assert.equal(
                            getFunctionName(reference),
                            "execution/fixtures:activateWorkbench",
                        );
                        return null;
                    },
                },
                undefined,
                "http://127.0.0.1:3210",
                root,
                manifest,
                () => reads > (status === "idle" ? 12 : 3),
                {
                    query: async () => ({ status: "active" }),
                    mutation: async () => {
                        throw new Error("No analyst action expected");
                    },
                },
            );
        if (status === "idle") {
            await execute();
            assert.equal(existsSync(join(root, "claims/failure.json")), false);
            assert.match(
                readFileSync(join(root, "progress.jsonl"), "utf8"),
                /"executionIntegrity":"passed"/,
            );
            return;
        }
        await assert.rejects(execute, /not quiet and reconciled/);
        const failure = JSON.parse(
            readFileSync(join(root, "claims/failure.json"), "utf8"),
        );
        assert.match(
            failure.reason,
            new RegExp(`Research ${status} before sources_prepared`),
        );
        assert.equal(failure.step, "handoff");
        assert.equal(existsSync(join(root, "creative")), false);
    });

test("unsafe backend execution records the first failure without starting another scenario", async () => {
    const root = mkdtempSync(join(tmpdir(), "backend-first-failure-"));
    const original = configurableCampaign();
    const manifest = campaignManifestSchema.parse({
        ...original,
        executionSurface: "backend",
        batteryHash: "a".repeat(64),
    });
    writeFileSync(
        join(root, "protocol.json"),
        `${JSON.stringify({ boundary: "backend" }, null, 2)}\n`,
    );
    writeFileSync(
        join(root, "prepared.json"),
        JSON.stringify({
            cases: original.scenarios.map((s) => ({
                id: s.id,
                runId: s.id,
                fixtureKey: s.id,
            })),
        }),
    );
    const snapshot = {
        nativeSettled: true,
        conversation: { activeTurnId: null, queuedCount: 0 },
        framing: { revision: 1 },
        run: { executionStatus: "idle" },
    };
    await assert.rejects(
        () =>
            runCampaignScenarios(
                null,
                {
                    query: async () => snapshot,
                    mutation: async () => null,
                },
                undefined,
                "http://127.0.0.1:3210",
                root,
                manifest,
                () => false,
                {
                    query: async () => ({ status: "active" }),
                    mutation: async () => {
                        throw new Error("Known framing rejection");
                    },
                },
            ),
        /not quiet and reconciled/,
    );
    assert.match(
        readFileSync(join(root, "claims/failure.json"), "utf8"),
        /Known framing rejection/,
    );
    assert.match(
        readFileSync(join(root, "progress.jsonl"), "utf8"),
        /"executionIntegrity":"failed"/,
    );
    assert.equal(existsSync(join(root, "creative")), false);
});

for (const workerCompletes of [false, true])
    test(`a blocked conversation ${workerCompletes ? "waits for its active worker" : "stops qualification after its worker has stopped"}`, async () => {
        const root = mkdtempSync(join(tmpdir(), "backend-blocked-response-"));
        const base = configurableCampaign();
        const selectedScenarios = workerCompletes
            ? base.scenarios.slice(0, 1)
            : base.scenarios;
        const manifest = campaignManifestSchema.parse({
            ...base,
            executionSurface: "backend",
            batteryHash: "a".repeat(64),
            scenarios: selectedScenarios.map((s) => ({
                ...s,
                steps: [
                    {
                        id: "ask",
                        action: "send_message",
                        text: "Explain retained material.",
                    },
                ],
            })),
            expectations: workerCompletes
                ? base.expectations.slice(0, 1)
                : base.expectations,
        });
        writeFileSync(
            join(root, "protocol.json"),
            `${JSON.stringify({ boundary: "backend" }, null, 2)}\n`,
        );
        writeFileSync(
            join(root, "prepared.json"),
            JSON.stringify({
                cases: selectedScenarios.map((s) => ({
                    id: s.id,
                    runId: s.id,
                    fixtureKey: s.id,
                })),
            }),
        );
        let submitted = false,
            reads = 0;
        const client = {
            mutation: async () => null,
            query: async (reference) => {
                if (
                    getFunctionName(reference) ===
                    "execution/fixtures:inspectSourcesInvocations"
                )
                    return {
                        page: [],
                        payloads: [],
                        isDone: true,
                        continueCursor: "",
                    };
                reads++;
                const done = workerCompletes && reads >= 6;
                return {
                    contextExpiresAt: manifest.expiresAt,
                    nativeSettled: !submitted || done,
                    conversation: {
                        activeTurnId: submitted && !done ? "turn" : null,
                        queuedCount: 0,
                    },
                    mission:
                        submitted && !done
                            ? {
                                  status: "blocked",
                                  blockCode: "qualification_budget_exhausted",
                                  ...(workerCompletes
                                      ? { piActiveWriter: "engaged-worker" }
                                      : {}),
                              }
                            : null,
                    lastMessage: submitted ? { _id: "new-message" } : null,
                    run: { executionStatus: "idle" },
                };
            },
        };
        const execute = () =>
            runCampaignScenarios(
                null,
                client,
                undefined,
                "http://127.0.0.1:3210",
                root,
                manifest,
                () => reads > 8,
                {
                    query: async () => ({ status: "active" }),
                    mutation: async () => {
                        submitted = true;
                    },
                },
            );
        if (workerCompletes) {
            // One response is enough to establish that active-writer settlement is allowed to finish.
            await execute();
            assert.equal(
                existsSync(join(root, "claims/published-backend.json")),
                true,
            );
        } else {
            await assert.rejects(execute, /not quiet and reconciled/);
            assert.match(
                readFileSync(join(root, "claims/failure.json"), "utf8"),
                /qualification_budget_exhausted/,
            );
            assert.equal(existsSync(join(root, "creative")), false);
        }
    });

test("new campaign preparation defaults to backend and freezes the choice without changing historical manifests", async () => {
    const root = mkdtempSync(join(tmpdir(), "qualification-backend-default-"));
    const input = join(root, "input.json");
    writeFileSync(input, JSON.stringify(configurableCampaign()));
    await runCampaign("prepare", root, { manifest: input });
    const retained = JSON.parse(
        readFileSync(join(root, "campaign.json"), "utf8"),
    );
    assert.equal(retained.manifest.executionSurface, "backend");
    assert.equal(retained.campaignId, undefined);
    assert.equal(
        campaignManifestSchema.parse({
            ...configurableCampaign(),
            batteryHash: "a".repeat(64),
        }).executionSurface,
        undefined,
    );
});

test("a first dispatched Sources request is hydrated once and survives blocked preparation", async (t) => {
    const archive = process.env.SOURCES_REPLAY_INPUT
        ? JSON.parse(readFileSync(process.env.SOURCES_REPLAY_INPUT, "utf8"))
        : null;
    const wire = archive
        ? archive.payloads.find(
              (p) => p.part === "request" && p.state === "complete",
          ).json
        : JSON.stringify({
              messages: [
                  {
                      role: "user",
                      content: "actual dispatched economic question",
                  },
              ],
          });
    const contentHash = sha256(wire);
    let hydrated = 0,
        snapshots = 0,
        snapshotBytes = 0,
        fragmentReads = 0;
    const binding = {
        runId: "fixture-claims",
        framingRevisionId: "fixed-revision",
        preset: "balanced",
        preparationId: "preparation",
        missionId: "sources",
        invocationId: "first-sources",
        providerCallId: "receipt",
        contentHash,
        dispatch: "observed",
    };
    const { root } = await independentScenarioProbe(t, {
        backend: true,
        freshFraming: true,
        snapshot: {
            firstSourcesInput: binding,
            conversation: { activeTurnId: "blocked-turn" },
            mission: { status: "blocked", blockCode: "control_failed" },
        },
        observeQuery: (name, _args, snapshot) => {
            if (name === "execution/fixtures:qualificationSnapshot") {
                snapshots++;
                const polled =
                    snapshots === 1
                        ? {
                              ...snapshot,
                              contextExpiresAt: Date.now() + 60_000,
                              nativeSettled: false,
                              mission: {
                                  status: "running",
                                  piActiveWriter: "worker-1",
                              },
                          }
                        : snapshot;
                snapshotBytes += Buffer.byteLength(JSON.stringify(polled));
                return polled;
            }
            if (name === "execution/fixtures:inspectSourcesTextFragments")
                fragmentReads++;
            if (name === "execution/fixtures:inspectSourcesInvocations") {
                hydrated++;
                return {
                    page: [{ _id: "first-sources", inputJson: "{}" }],
                    payloads: [
                        {
                            part: "request",
                            state: "complete",
                            contentHash,
                            json: wire,
                        },
                    ],
                    isDone: true,
                    continueCursor: "",
                };
            }
        },
    });
    const actual = JSON.parse(
        readFileSync(join(root, "claims/actual-start-input.json"), "utf8"),
    );
    assert.deepEqual(actual.binding, binding);
    assert.equal(actual.transcript.payloads[0].json, wire);
    assert.equal(hydrated, 1);
    assert(snapshots >= 2);
    assert.equal(
        JSON.parse(
            readFileSync(join(root, "claims/latest-snapshot.json"), "utf8"),
        ).run.executionStatus,
        "idle",
    );
    if (process.env.SOURCES_REPLAY_METRICS)
        writeFileSync(
            process.env.SOURCES_REPLAY_METRICS,
            JSON.stringify({
                snapshotQueries: snapshots,
                snapshotBytes,
                requestBytes: Buffer.byteLength(wire),
                hydrations: hydrated,
                fragmentReads,
                artifacts: 1,
            }),
        );
});

test("campaign preparation freezes Sources replay bytes and refuses a changed corpus", async () => {
    const root = mkdtempSync(join(tmpdir(), "qualification-sources-replay-"));
    const materialPath = join(root, "sources.json");
    const documents = [
        {
            url: "https://example.org/report",
            title: "Retained report",
            acquisition: {
                status: "partial",
                text: "An incomplete independent report.",
            },
        },
    ];
    const material = JSON.stringify({ documents });
    writeFileSync(materialPath, material);
    const draft = configurableCampaign();
    draft.scenarios[0].sourcesReplay = {
        materialPath,
        materialHash: sha256(material),
    };
    const input = join(root, "input.json");
    writeFileSync(input, JSON.stringify(draft));
    await runCampaign("prepare", root, { manifest: input });
    const prepared = JSON.parse(
        readFileSync(join(root, "campaign.json"), "utf8"),
    );
    assert.deepEqual(prepared.manifest.scenarios[0].sourcesReplay, {
        materialHash: sha256(JSON.stringify(documents)),
        documents,
    });
    assert.equal(prepared.campaignId, undefined);
    writeFileSync(materialPath, JSON.stringify({ documents: [] }));
    await assert.rejects(
        runCampaign("prepare", join(root, "changed"), { manifest: input }),
        /Frozen Sources material hash changed/,
    );
});

for (const completedWithoutMaterial of [false, true])
    test(`Sources retained-material pause: terminal without material=${completedWithoutMaterial}`, async () => {
        const root = mkdtempSync(
            join(tmpdir(), "qualification-retained-pause-"),
        );
        const base = configurableCampaign();
        const manifest = campaignManifestSchema.parse({
            ...base,
            executionSurface: "backend",
            batteryHash: "a".repeat(64),
            scenarios: [
                {
                    ...base.scenarios[0],
                    steps: [
                        {
                            id: "retained",
                            action: "wait_for",
                            state: "sources_material_available",
                        },
                        { id: "pause", action: "pause_research" },
                    ],
                },
            ],
            expectations: base.expectations.slice(0, 1),
        });
        writeFileSync(
            join(root, "protocol.json"),
            `${JSON.stringify({ boundary: "backend" }, null, 2)}\n`,
        );
        writeFileSync(
            join(root, "prepared.json"),
            JSON.stringify({
                cases: [
                    {
                        id: base.scenarios[0].id,
                        runId: "fixture",
                        fixtureKey: "fixture",
                    },
                ],
            }),
        );
        let observations = 0,
            paused = false;
        const client = {
            mutation: async (reference) => {
                if (
                    getFunctionName(reference) ===
                    "execution/researchControl:pause"
                ) {
                    assert(observations >= 6, "Pause must wait for material");
                    paused = true;
                }
            },
            query: async (reference) => {
                const name = getFunctionName(reference);
                if (name === "visitors:current") return { status: "active" };
                if (name === "execution/fixtures:qualificationSnapshot") {
                    observations++;
                    return {
                        run: {
                            executionStatus: paused
                                ? "paused"
                                : completedWithoutMaterial
                                  ? "idle"
                                  : "running",
                            executionGeneration: 1,
                        },
                        conversation: { queuedCount: 0 },
                        nativeSettled: true,
                        contextExpiresAt: manifest.expiresAt,
                        sourcesMission: completedWithoutMaterial
                            ? { status: "completed" }
                            : { status: "running" },
                        preparation: {
                            sourcesMission: {
                                captureIds:
                                    !completedWithoutMaterial &&
                                    observations >= 6
                                        ? ["capture"]
                                        : [],
                            },
                        },
                    };
                }
                return {
                    page: [],
                    payloads: [],
                    isDone: true,
                    continueCursor: "",
                };
            },
        };
        const execute = () =>
            runCampaignScenarios(
                null,
                client,
                undefined,
                "http://127.0.0.1:3210",
                root,
                manifest,
                () => completedWithoutMaterial && observations > 4,
                client,
            );
        if (completedWithoutMaterial) {
            await assert.rejects(execute);
            const failure = JSON.parse(
                readFileSync(
                    join(root, base.scenarios[0].id, "failure.json"),
                    "utf8",
                ),
            );
            assert.match(
                failure.reason,
                /Sources ended before retained material/,
            );
            assert.equal(paused, false);
            return;
        }
        await execute();
        assert.equal(paused, true);
        const before = JSON.parse(
            readFileSync(
                join(root, base.scenarios[0].id, "pause-before.json"),
                "utf8",
            ),
        );
        assert.deepEqual(before.preparation.sourcesMission.captureIds, [
            "capture",
        ]);
    });

test("a held-out framing corpus is frozen separately from historical case identities", async () => {
    const root = mkdtempSync(join(tmpdir(), "qualification-heldout-"));
    const draft = configurableCampaign();
    draft.scenarios[0] = {
        ...draft.scenarios[0],
        framingRequest: {
            text: "Does this announcement change review authority?",
            receivedAt: "2026-11-18T09:00:00.000Z",
        },
        framingPublicContext: true,
        framingReplay: {
            case: "heldout",
            materialHash: "c".repeat(64),
            unavailable: false,
            documents: [],
        },
        steps: [
            {
                id: "settled",
                action: "wait_for",
                state: "conversation_settled",
            },
        ],
    };
    const input = join(root, "input.json");
    writeFileSync(input, JSON.stringify(draft));
    await runCampaign("prepare", root, { manifest: input });
    const prepared = JSON.parse(
        readFileSync(join(root, "campaign.json"), "utf8"),
    );
    assert.equal(prepared.manifest.scenarios[0].framingReplay.case, "heldout");
});

for (const { name, requested, resolved, prepared, rejects } of [
    {
        name: "omitted default",
        requested: undefined,
        resolved: "balanced",
        prepared: "balanced",
        rejects: false,
    },
    {
        name: "explicit nondefault",
        requested: "first_party_depth",
        resolved: "first_party_depth",
        prepared: "first_party_depth",
        rejects: false,
    },
    {
        name: "changed default",
        requested: undefined,
        resolved: "balanced",
        prepared: "independent_scrutiny",
        rejects: true,
    },
    {
        name: "changed explicit",
        requested: "first_party_depth",
        resolved: "first_party_depth",
        prepared: "balanced",
        rejects: true,
    },
])
    test(`Sources coverage handoff preserves the following consultation only for matching ${name} coverage`, async () => {
        const root = mkdtempSync(join(tmpdir(), "coverage-handoff-default-"));
        const base = configurableCampaign();
        const scenario = {
            ...base.scenarios[0],
            framingRequest: {
                text: base.scenarios[0].framing.scope,
                receivedAt: "2026-11-21T00:00:00.000Z",
            },
            steps: [
                {
                    id: "handoff",
                    action: "wait_for",
                    state: "sources_prepared",
                },
                {
                    id: "consult",
                    action: "send_message",
                    text: "Explain the prepared evidence.",
                },
            ],
        };
        if (requested) scenario.coveragePreset = requested;
        else delete scenario.coveragePreset;
        const manifest = campaignManifestSchema.parse({
            ...base,
            mode: "deterministic",
            executionSurface: "backend",
            scenarios: [scenario],
            expectations: base.expectations.slice(0, 1),
            perLot: { model: 0, search: 0, acquisition: 0, costUsd: 0 },
            total: { model: 0, search: 0, acquisition: 0, costUsd: 0 },
            batteryHash: "a".repeat(64),
        });
        writeFileSync(
            join(root, "protocol.json"),
            `${JSON.stringify({ boundary: "backend" }, null, 2)}\n`,
        );
        writeFileSync(
            join(root, "prepared.json"),
            JSON.stringify({
                cases: [
                    { id: scenario.id, runId: "run", fixtureKey: "fixture" },
                ],
            }),
        );
        const snapshot = {
            nativeSettled: true,
            conversation: { queuedCount: 0 },
            framing: {
                _id: "framing",
                origin: "workbench",
                revision: 2,
                content: scenario.framing,
            },
            run: {
                lifecycleState: "sources_prepared",
                executionStatus: "idle",
                coveragePreset: resolved,
                fixedFramingRevisionId: "framing",
            },
            preparation: {
                sourcesMission: {
                    coveragePolicy: {
                        preset: prepared,
                        version: "sources_coverage_v1",
                    },
                    needs: [
                        ...scenario.framing.questions.map((q) => ({
                            questionIds: [q.id],
                            information: q.text,
                        })),
                        {
                            commonContext: true,
                            questionIds: [],
                            information: scenario.framing.scope,
                        },
                    ],
                },
            },
            sourcesMission: { status: "completed" },
            lastMessage: { _id: "initial" },
        };
        const submitted = [];
        const client = {
            query: async (reference) =>
                getFunctionName(reference) ===
                "execution/fixtures:qualificationSnapshot"
                    ? structuredClone(snapshot)
                    : {
                          page: [],
                          payloads: [],
                          downloads: [],
                          isDone: true,
                          continueCursor: "",
                      },
            mutation: async (reference) => {
                assert.equal(
                    getFunctionName(reference),
                    "execution/fixtures:activateWorkbench",
                );
            },
        };
        const execute = async () => {
            try {
                await runCampaignScenarios(
                    null,
                    client,
                    undefined,
                    "http://127.0.0.1:3210",
                    root,
                    manifest,
                    () => false,
                    {
                        query: async () => ({ status: "active" }),
                        mutation: async (reference, args) => {
                            assert.equal(
                                getFunctionName(reference),
                                "execution/conversations:submit",
                            );
                            submitted.push(args.text);
                            snapshot.lastMessage = { _id: "consultation" };
                        },
                    },
                );
            } catch (error) {
                const path = join(root, scenario.id, "failure.json");
                if (existsSync(path))
                    throw new Error(
                        JSON.parse(readFileSync(path, "utf8")).reason,
                        { cause: error },
                    );
                throw error;
            }
        };
        if (rejects) {
            await assert.rejects(
                execute,
                /Expected values to be strictly equal/,
            );
            assert.deepEqual(submitted, []);
            const failure = JSON.parse(
                readFileSync(join(root, scenario.id, "failure.json"), "utf8"),
            );
            assert.equal(failure.step, "handoff");
            assert.equal(
                existsSync(
                    join(root, scenario.id, "actual-start-handoff.json"),
                ),
                false,
            );
            return;
        }
        await execute();
        assert.deepEqual(submitted, ["Explain the prepared evidence."]);
        assert.deepEqual(
            JSON.parse(
                readFileSync(
                    join(root, scenario.id, "actual-start-handoff.json"),
                    "utf8",
                ),
            ).coveragePolicy,
            snapshot.preparation.sourcesMission.coveragePolicy,
        );
        assert.equal(
            JSON.parse(
                readFileSync(
                    join(root, scenario.id, "consult-after.json"),
                    "utf8",
                ),
            ).lastMessage._id,
            "consultation",
        );
        assert.equal(
            existsSync(join(root, scenario.id, "failure.json")),
            false,
        );
    });
