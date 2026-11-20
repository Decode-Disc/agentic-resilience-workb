import { api, internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
    campaignManifestSchema,
    emptyCampaignLimits,
} from "@convex/qualificationCampaignPolicy";
import { type FunctionArgs, makeFunctionReference } from "convex/server";
import { afterEach, expect, test, vi } from "vitest";
import { dispatchSourcesOperation } from "@/__tests__/setup/sources-mission";
import { seedWorkbench } from "@/__tests__/setup/workbench";

const enabled = makeFunctionReference<
    "query",
    { runId: Id<"researchRuns"> },
    boolean
>("sourcesSimulation:enabled");
const manifest = () => ({
    version: 1,
    key: "sources-simulation",
    objective: "Qualify real Sources execution with simulated external replies",
    capability: "sources",
    mode: "deterministic",
    batteryHash: "a".repeat(64),
    expectations: [{ id: "sources", checks: ["prepared"] }],
    models: {
        workbench: { model: "fixture", reasoning: "recommended" },
        sources: { model: "fixture", reasoning: "recommended" },
    },
    correctionPaths: ["convex"],
    maximumLots: 2,
    repetitionsPerCandidate: 2,
    expiresAt: Date.now() + 60000,
    perLot: emptyCampaignLimits(),
    total: emptyCampaignLimits(),
});
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
});
test("a zero-provider Sources campaign enables only its active owned local fixture and revokes without live fallback", async () => {
    const f = await seedWorkbench(true);
    expect(await f.t.query(enabled, { runId: f.runId })).toBe(false);
    const m = campaignManifestSchema.parse(manifest());
    const campaignId = await f.t.mutation(
        internal.qualificationCampaigns.authorize,
        { manifest: m },
    );
    const lotId = await f.t.mutation(internal.qualificationCampaigns.admit, {
        campaignId,
        key: "first",
        candidateHash: "b".repeat(64),
        changedPaths: [],
    });
    const run = await f.t.run((ctx) => ctx.db.get(f.runId));
    if (!run?.browserTestContextId) throw new Error("Missing browser context");
    await f.t.mutation(internal.qualificationCampaigns.bind, {
        lotId,
        contextId: run.browserTestContextId,
    });
    expect(await f.t.query(enabled, { runId: f.runId })).toBe(true);
    const framing = await f.client.query(api.framing.get, { runId: f.runId });
    if (!framing || !run.ownerVisitorId)
        throw new Error("Missing framing owner");
    const saved = await f.client.mutation(api.framing.save, {
        runId: f.runId,
        expectedRevision: framing.revision,
        requestKey: "simulation-framing",
        content: {
            scope: "Simulation of a documentary workflow",
            questions: [
                {
                    id: "workflow",
                    text: "How does the documentary workflow operate?",
                    shortLabel: "Workflow",
                    rationale: "Exercise documentary preparation.",
                },
            ],
        },
    });
    const ownerVisitorId = run.ownerVisitorId;
    await f.t.run((ctx) =>
        ctx.db.patch(ownerVisitorId, { analysesReserved: 3 }),
    );
    await expect(
        f.client.mutation(api.framing.startResearch, {
            runId: f.runId,
            expectedRevision: saved,
            requestKey: "simulation-start",
        }),
    ).resolves.toBe(f.runId);
    expect(
        (await f.t.run((ctx) => ctx.db.get(ownerVisitorId)))?.analysesReserved,
    ).toBe(3);
    vi.stubEnv("E2E_FIXTURES_ENABLED", "false");
    await expect(f.t.query(enabled, { runId: f.runId })).rejects.toThrow();
    vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
    await f.t.mutation(internal.qualificationCampaigns.close, { campaignId });
    await expect(f.t.query(enabled, { runId: f.runId })).rejects.toThrow(
        "not active",
    );
    expect(
        await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
});

import { sourcesDefinition } from "@convex/domain/sourcesAgent";

test("the registered Sources simulator requests actual discovery instead of manufacturing retained material", () => {
    expect(sourcesDefinition.simulate).toBeTypeOf("function");
    const result = sourcesDefinition.simulate?.({
        activeWork: {
            needs: [{ id: "need", version: 1 }],
            candidates: [],
            work: [],
        },
        triggeringRequestsAndResults: [],
    });
    expect(result).toMatchObject({
        kind: "operations",
        requests: [{ name: "discover_sources_for_need" }],
    });
});

import { seedCapturedSources } from "@/__tests__/setup/sources-mission";

test("simulated discovery, acquisition, reads and control use real operations without paid receipts", async () => {
    vi.useFakeTimers();
    const f = await seedCapturedSources();
    vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
    await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        if (!run?.ownerVisitorId) throw new Error("Missing owner");
        const visitor = await ctx.db.get(run.ownerVisitorId);
        if (!visitor) throw new Error("Missing visitor");
        await ctx.db.patch(visitor.invitationId, { slotKey: "analyst-4" });
    });
    const contextId = await f.t.mutation(
        internal.runWorkspace.openBrowserTestContext,
        {
            slotKey: "analyst-4",
            contextKey: "sources-simulation",
            durationMs: 60000,
        },
    );
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, {
            purpose: "browser_test",
            browserTestContextId: contextId,
        }),
    );
    const campaignId = await f.t.mutation(
        internal.qualificationCampaigns.authorize,
        { manifest: campaignManifestSchema.parse(manifest()) },
    );
    const lotId = await f.t.mutation(internal.qualificationCampaigns.admit, {
        campaignId,
        key: "first",
        candidateHash: "b".repeat(64),
        changedPaths: [],
    });
    await f.t.mutation(internal.qualificationCampaigns.bind, {
        lotId,
        contextId,
    });
    const prep = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    const need = prep?.sourcesMission?.needs[0];
    if (!need) throw new Error("Missing need");
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 4,
            cause: "simulation-discovery",
            input: {
                kind: "discover_sources_for_need",
                needId: need.id,
                query: "simulation documentary workflow",
            },
        },
    );
    const result = await dispatchSourcesOperation(f.t, {
        requestId,
        expectedGeneration: 4,
    });
    expect(result).toMatchObject({ kind: "success" });
    expect(
        await f.t.run((ctx) =>
            ctx.db
                .query("sources")
                .withIndex("by_run_and_url", (q) =>
                    q
                        .eq("runId", f.runId)
                        .eq(
                            "canonicalUrl",
                            `https://example.com/simulation/${f.runId}`,
                        ),
                )
                .unique(),
        ),
    ).toMatchObject({ title: "Simulation only: documentary workflow" });
    const source = await f.t.run((ctx) =>
        ctx.db
            .query("sources")
            .withIndex("by_run_and_url", (q) =>
                q
                    .eq("runId", f.runId)
                    .eq(
                        "canonicalUrl",
                        `https://example.com/simulation/${f.runId}`,
                    ),
            )
            .unique(),
    );
    if (!source) throw new Error("Discovery did not retain its candidate");
    const execute = async (
        input: FunctionArgs<
            typeof internal.execution.operations.enqueue
        >["input"],
    ) => {
        const id = await f.t.mutation(internal.execution.operations.enqueue, {
            missionId: f.missionId,
            expectedGeneration: 4,
            cause: `simulation-${input.kind}`,
            input,
        });
        const outcome = await dispatchSourcesOperation(f.t, {
            requestId: id,
            expectedGeneration: 4,
        });
        if (outcome.kind !== "success")
            throw new Error(JSON.stringify(outcome));
        return { id, outcome };
    };
    const acquisition = await execute({
        kind: "make_source_consultable",
        needId: need.id,
        sourceId: source._id,
    });
    const capture = await f.t.run((ctx) =>
        ctx.db
            .query("sourceCaptures")
            .withIndex("by_preparation_and_source", (q) =>
                q
                    .eq("preparationId", f.preparationId)
                    .eq("sourceId", source._id),
            )
            .unique(),
    );
    if (capture?.status !== "committed")
        throw new Error("Acquisition did not retain its capture");
    const captureId = capture._id;
    expect(JSON.parse(acquisition.outcome.valueJson)).toMatchObject({
        captureId,
    });
    await execute({
        kind: "search_available_material",
        sourceId: source._id,
        query: "workflow",
    });
    const reading = await execute({
        kind: "read_in_context",
        sourceId: source._id,
        passageOrder: 0,
    });
    await execute({
        kind: "submit_documentary_qualification",
        sourceId: source._id,
        captureId,
        expectedTaskId: null,
        changes: [
            {
                contribution: {
                    needIds: [need.id],
                    statement:
                        "This simulated document describes a documentary workflow.",
                    period: "Simulation fixture",
                    modality: "Illustrative description",
                    attribution: "Simulation fixture; not live",
                    kind: "context",
                    evidence: [{ readRequestId: reading.id, passageOrder: 0 }],
                },
            },
        ],
    });
    expect(await f.t.run((ctx) => ctx.db.get(captureId))).toMatchObject({
        status: "committed",
    });
    const tasks = await f.t.run((ctx) =>
        ctx.db
            .query("aiTaskResults")
            .withIndex("by_run", (q) => q.eq("runId", f.runId))
            .collect(),
    );
    expect(tasks).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                taskType: "documentary_control",
                executionMode: "showcase",
                fixtureId: "sources-simulation",
            }),
            expect.objectContaining({
                taskType: "documentary_qualification",
                executionMode: "showcase",
                fixtureId: "sources-simulation",
            }),
        ]),
    );
    expect(
        await f.t.run((ctx) =>
            ctx.db
                .query("providerCalls")
                .withIndex("by_run", (q) => q.eq("runId", f.runId))
                .collect(),
        ),
    ).toEqual([]);
});
