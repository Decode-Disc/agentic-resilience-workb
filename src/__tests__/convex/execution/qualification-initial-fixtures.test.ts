import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { api, internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { sha256Hex } from "@convex/domain/sourcePassages";
import {
    campaignManifestSchema,
    emptyCampaignLimits,
} from "@convex/qualificationCampaignPolicy";
import {
    initialDocumentaryMaterial,
    initialFixtureContent,
    initialFixtureIds,
} from "@convex/qualificationInitialFixtures";
import { prepareCampaignScenarios } from "@evaluations/workbench-browser/scenarios";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import {
    CommitTsPlaceholder,
    convexToJson,
    type JSONValue,
    jsonToConvex,
    type Value,
} from "convex/values";
import { afterEach, assert, expect, test, vi } from "vitest";
import { configurableCampaign } from "@/__tests__/setup/qualification-v2";
import { sourcesTestEnvelope } from "@/__tests__/setup/sources-mission";
import { seedWorkbench } from "@/__tests__/setup/workbench";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
});

const install = makeFunctionReference<
    "action",
    { runId: Id<"researchRuns">; fixtureKey: string; scenarioId: string },
    {
        preparationId: Id<"sourceSelectionProposalRebuilds">;
        missionId: Id<"agentMissions">;
        captureId: Id<"sourceCaptures">;
    }
>("qualificationInitialFixtureSetup:install");

async function fixture(
    id: (typeof initialFixtureIds)[number],
    presets: readonly (
        | "balanced"
        | "first_party_depth"
        | "independent_scrutiny"
        | undefined
    )[] = [undefined],
) {
    const f = await seedWorkbench(true);
    const raw = configurableCampaign();
    const baseline = raw.scenarios[0];
    assert(baseline);
    const scenarios = presets.map((coveragePreset) => ({
        ...baseline,
        ...(coveragePreset
            ? {
                  coveragePreset,
                  id: `coverage-${coveragePreset.replaceAll("_", "-")}`,
                  sourcesEnvelope: sourcesTestEnvelope,
              }
            : {}),
        steps: coveragePreset
            ? baseline.steps
            : [
                  {
                      id: "prepared",
                      action: "wait_for",
                      state: "sources_prepared",
                  },
              ],
        ...(coveragePreset
            ? {}
            : {
                  initialFixture: {
                      id,
                      hash: sha256Hex(initialFixtureContent(id)),
                  },
              }),
    }));
    const manifest = campaignManifestSchema.parse({
        ...raw,
        mode: "deterministic",
        configurations: raw.configurations.slice(0, 1),
        scenarios,
        expectations: scenarios.map((scenario) => ({
            id: scenario.id,
            checks: ["documentary-handoff"],
        })),
        batteryHash: "a".repeat(64),
        perLot: emptyCampaignLimits(),
        total: emptyCampaignLimits(),
    });
    const campaignId = await f.t.mutation(
        internal.qualificationCampaigns.authorize,
        { manifest },
    );
    const lotId = await f.t.mutation(internal.qualificationCampaigns.admit, {
        campaignId,
        key: "first",
        candidateHash: "b".repeat(64),
        changedPaths: [],
    });
    const original = await f.t.run((ctx) => ctx.db.get(f.runId));
    assert(original?.browserTestContextId);
    await f.t.mutation(internal.runWorkspace.closeBrowserTestContext, {
        slotKey: "analyst-4",
        contextKey: "native-workbench",
    });
    assert(manifest.version !== 1);
    const root = mkdtempSync(join(tmpdir(), "workbench-campaign-fixture-"));
    const client = new ConvexHttpClient("http://127.0.0.1:3210", {
        fetch: async (_url, options) => {
            assert(typeof options?.body === "string");
            const request: { path: string; args: [JSONValue] } = JSON.parse(
                options.body,
            );
            const args = jsonToConvex(request.args[0]);
            assert(
                args &&
                    typeof args === "object" &&
                    !Array.isArray(args) &&
                    !(args instanceof ArrayBuffer) &&
                    !(args instanceof CommitTsPlaceholder),
            );
            const result = await f.t.mutation(
                makeFunctionReference<
                    "mutation",
                    Record<string, Value | undefined>,
                    Value
                >(request.path),
                args,
            );
            return Response.json({
                status: "success",
                value: convexToJson(result),
            });
        },
    });
    let dossiers: {
        runId: Id<"researchRuns">;
        fixtureKey: string;
        scenarioId: string;
    }[];
    try {
        await prepareCampaignScenarios(client, root, manifest, lotId, "first");
        const prepared = JSON.parse(
            readFileSync(join(root, "prepared.json"), "utf8"),
        );
        dossiers = prepared.cases.map(
            (entry: {
                runId: Id<"researchRuns">;
                fixtureKey: string;
                id: string;
            }) => ({
                runId: entry.runId,
                fixtureKey: entry.fixtureKey,
                scenarioId: entry.id,
            }),
        );
    } finally {
        rmSync(root, { recursive: true });
    }
    const first = dossiers[0];
    assert(first);
    const firstRun = await f.t.run((ctx) => ctx.db.get(first.runId));
    assert(firstRun?.browserTestContextId);
    return {
        ...f,
        campaignId,
        contextId: firstRun.browserTestContextId,
        runId: first.runId,
        args: first,
        framing: baseline.framing,
        dossiers,
    };
}

test("campaign coverage presets reach genuine Start pins on fresh dossiers", async () => {
    const presets = [
        "balanced",
        "first_party_depth",
        "independent_scrutiny",
    ] as const;
    const f = await fixture("sources_correction", presets);
    expect(new Set(f.dossiers.map(({ runId }) => runId)).size).toBe(3);
    const records = [];
    for (const { runId, fixtureKey } of f.dossiers) {
        await f.t.mutation(internal.execution.fixtures.activateWorkbench, {
            runId,
            fixtureKey,
            researchAngle: f.framing.scope,
        });
        const before = await f.client.query(api.framing.get, { runId });
        assert(before);
        const revision = await f.client.mutation(api.framing.save, {
            runId,
            expectedRevision: before.revision,
            requestKey: "frozen-framing",
            content: f.framing,
        });
        await f.client.mutation(api.framing.startResearch, {
            runId,
            expectedRevision: revision,
            requestKey: "coverage-start",
        });
        const run = await f.t.run((ctx) => ctx.db.get(runId));
        expect(run).toMatchObject({
            sourcesCoveragePolicyVersion: "sources_coverage_v1",
            sourcesEnvelope: sourcesTestEnvelope,
            researchStartRequestKey: "coverage-start",
        });
        expect(
            (await f.client.query(api.framing.get, { runId }))?.content,
        ).toEqual(f.framing);
        for (let step = 0; step < 50; step++) {
            const current = await f.t.run((ctx) => ctx.db.get(runId));
            if (current?.sourcePreparationId) break;
            await vi.advanceTimersByTimeAsync(20);
            await f.t.finishInProgressScheduledFunctions();
        }
        const applied = await f.t.run(async (ctx) => {
            const current = await ctx.db.get(runId);
            return current?.sourcePreparationId
                ? (await ctx.db.get(current.sourcePreparationId))
                      ?.sourcesMission?.coveragePolicy
                : undefined;
        });
        expect(applied).toEqual({
            version: "sources_coverage_v1",
            preset: run?.coveragePreset,
        });
        records.push(applied?.preset);
        await f.client.mutation(api.workflowControls.cancel, { runId });
    }
    expect(records).toEqual(presets);
});

test("initial fixture retention refuses cancellation after the adopted documentary read", async () => {
    const f = await fixture("sources_correction");
    const state = await f.t.mutation(
        internal.qualificationInitialFixtureSetup.seed,
        f.args,
    );
    const text = initialDocumentaryMaterial.text;
    const storageId = await f.t.run((ctx) =>
        ctx.storage.store(
            new Blob([text], { type: "text/plain; charset=utf-8" }),
        ),
    );
    await f.t.mutation(internal.sourceCaptures.attachStorage, {
        preparationId: state.preparationId,
        captureId: state.captureId,
        storageId,
    });
    await f.t.mutation(internal.sourceCaptures.finalize, {
        preparationId: state.preparationId,
        captureId: state.captureId,
        contentHash: sha256Hex(text),
        byteCount: new TextEncoder().encode(text).length,
        resolvedUrl: initialDocumentaryMaterial.url,
        retrievalVersion: "retained-documentary-fixture-v1",
        normalizerVersion: state.normalizerVersion,
        retrievedAt: Date.now(),
        readingCompleteness: "complete",
        representationCompleteness: "complete",
        omittedPassageCount: 0,
    });
    await f.t.action(internal.sourceRetrievalActions.indexCapture, {
        preparationId: state.preparationId,
        captureId: state.captureId,
        mode: "lexical",
        allowProviderCalls: false,
    });
    const readRequestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: state.missionId,
            expectedGeneration: state.generation,
            cause: "fixture-read-before-cancel",
            input: {
                kind: "search_available_material",
                sourceId: state.sourceId,
                query: "documentary workflow",
            },
        },
    );
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId: readRequestId,
            expectedGeneration: state.generation,
        }),
    ).toMatchObject({ kind: "success" });
    expect(
        await f.client.mutation(api.workflowControls.cancel, {
            runId: f.runId,
        }),
    ).toEqual({ cancelled: true });
    await expect(
        f.t.mutation(internal.qualificationInitialFixtureSetup.retain, {
            ...f.args,
            readRequestId,
        }),
    ).rejects.toThrow(/stale_execution|mission_cancelled|not_running/);
    expect(
        (await f.t.run((ctx) => ctx.db.get(state.preparationId)))
            ?.sourcesMission?.qualifications,
    ).toEqual([]);
    expect(
        await f.t.run((ctx) =>
            ctx.db
                .query("aiTaskResults")
                .withIndex("by_run", (q) => q.eq("runId", f.runId))
                .collect(),
        ),
    ).toEqual([]);
});

test.each(
    initialFixtureIds,
)("%s reconstructs bounded labelled material through the real local fixture owner", async (id) => {
    const f = await fixture(id);
    const seeded = await f.t.action(install, f.args);
    const preparation = await f.t.run((ctx) =>
        ctx.db.get(seeded.preparationId),
    );
    const mission = await f.t.run((ctx) => ctx.db.get(seeded.missionId));
    const tasks = await f.t.run((ctx) =>
        ctx.db
            .query("aiTaskResults")
            .withIndex("by_run", (q) => q.eq("runId", f.runId))
            .take(10),
    );
    expect(
        tasks.some(
            (task) =>
                task.executionMode === "showcase" && task.fixtureId === id,
        ),
    ).toBe(true);
    expect(
        await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
    if (id === "sources_correction") {
        expect(preparation?.sourcesMission?.qualifications).toHaveLength(1);
        expect(preparation?.sourcesMission?.result).toBeUndefined();
        expect(mission?.status).toBe("ready");
    } else {
        expect(mission?.status).toBe(
            id === "sources_completed_partial" ? "completed" : "blocked",
        );
        const material = await f.client.query(
            api.sourcesMission.getPreparedMaterial,
            { runId: f.runId },
        );
        expect(material?.material?.outcome).toBe("partial");
        expect(material?.material?.documents).toHaveLength(1);
        expect(
            (await f.t.run((ctx) => ctx.db.get(f.runId)))?.lifecycleState,
        ).toBe("sources_prepared");
    }
    const snapshot = await f.t.query(
        internal.execution.fixtures.qualificationSnapshot,
        { runId: f.runId, fixtureKey: f.args.fixtureKey },
    );
    expect(snapshot.nativeSettled).toBe(true);
    const conversation = snapshot.conversation;
    assert(conversation);
    await f.t.run((ctx) =>
        ctx.db.insert("agentConversationTurns", {
            runId: f.runId,
            conversationId: conversation._id,
            status: "interrupted",
            instructionVersion: 1,
            generation: 1,
            messageCount: 1,
            createdAt: Date.now(),
        }),
    );
    expect(
        (
            await f.t.query(internal.execution.fixtures.qualificationSnapshot, {
                runId: f.runId,
                fixtureKey: f.args.fixtureKey,
            })
        ).nativeSettled,
    ).toBe(false);
    await expect(f.t.action(install, f.args)).rejects.toThrow(
        /already|renew|initial/i,
    );
});

test.each([
    "disabled",
    "cloud",
    "foreign-key",
    "undeclared",
    "expired",
    "changed-digest",
] as const)("initial fixture refuses %s before creating captured material", async (variant) => {
    const f = await fixture("sources_completed_partial");
    if (variant === "disabled") vi.stubEnv("E2E_FIXTURES_ENABLED", "false");
    if (variant === "cloud")
        vi.stubEnv("CONVEX_CLOUD_URL", "https://example.convex.cloud");
    if (variant === "expired")
        await f.t.run((ctx) =>
            ctx.db.patch(f.contextId, { expiresAt: Date.now() - 1 }),
        );
    if (variant === "changed-digest")
        await f.t.run(async (ctx) => {
            const campaign = await ctx.db.get(f.campaignId);
            assert(campaign?.manifest.version === 2);
            await ctx.db.patch(campaign._id, {
                manifest: {
                    ...campaign.manifest,
                    scenarios: campaign.manifest.scenarios.map((scenario) => ({
                        ...scenario,
                        initialFixture: {
                            id: "sources_completed_partial" as const,
                            hash: "0".repeat(64),
                        },
                    })),
                },
            });
        });
    await expect(
        f.t.action(install, {
            ...f.args,
            ...(variant === "foreign-key"
                ? { fixtureKey: "another-fixture" }
                : {}),
            ...(variant === "undeclared"
                ? { scenarioId: "another-scenario" }
                : {}),
        }),
    ).rejects.toThrow();
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.runId)))?.sourcePreparationId,
    ).toBeUndefined();
    expect(
        await f.t.run((ctx) => ctx.db.query("sourceCaptures").take(1)),
    ).toEqual([]);
});
