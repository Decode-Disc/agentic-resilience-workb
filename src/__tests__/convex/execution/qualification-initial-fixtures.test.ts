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
import { makeFunctionReference } from "convex/server";
import { afterEach, assert, expect, test, vi } from "vitest";
import { configurableCampaign } from "@/__tests__/setup/qualification-v2";
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

async function fixture(id: (typeof initialFixtureIds)[number]) {
    const f = await seedWorkbench(true);
    const raw = configurableCampaign();
    const scenario = raw.scenarios[0];
    assert(scenario);
    const manifest = campaignManifestSchema.parse({
        ...raw,
        mode: "deterministic",
        configurations: raw.configurations.slice(0, 1),
        scenarios: [
            {
                ...scenario,
                steps: [
                    {
                        id: "prepared",
                        action: "wait_for",
                        state: "sources_prepared",
                    },
                ],
                initialFixture: {
                    id,
                    hash: sha256Hex(initialFixtureContent(id)),
                },
            },
        ],
        expectations: raw.expectations.slice(0, 1),
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
    await f.t.mutation(internal.qualificationCampaigns.bind, {
        lotId,
        contextId: original.browserTestContextId,
    });
    const fixtureKey = "documentary-initial-fixture";
    const seeded = await f.t.mutation(
        internal.e2eFixtures.seedSourceReviewScenario,
        {
            slotKey: "analyst-4",
            fixtureKey,
            emptyDocumentaryMaterial: true,
            recordedScenario: {
                companyCik: scenario.company.cik,
                companyName: scenario.company.name,
                ticker: scenario.company.ticker,
                websiteUrl: scenario.company.websiteUrl,
                researchAngle: scenario.framing.scope,
                sources: [],
            },
        },
    );
    await f.t.mutation(internal.execution.fixtures.bindCampaignScenarios, {
        dossiers: [
            { runId: seeded.runId, fixtureKey, scenarioId: scenario.id },
        ],
    });
    return {
        ...f,
        campaignId,
        contextId: original.browserTestContextId,
        runId: seeded.runId,
        args: { runId: seeded.runId, fixtureKey, scenarioId: scenario.id },
    };
}

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
