import { readFileSync } from "node:fs";
import { api, internal } from "@convex/_generated/api";
import { sha256Hex } from "@convex/domain/sourcePassages";
import { pauseResearchAtBoundary } from "@convex/execution/researchControl";
import {
    campaignManifestSchema,
    type QualificationScenario,
    sourcesReplaySchema,
} from "@convex/qualificationCampaignPolicy";
import { afterEach, assert, expect, test, vi } from "vitest";
import { methodComparisonManifest } from "@/__tests__/setup/qualification-method-comparison";
import { sourcesTestEnvelope } from "@/__tests__/setup/sources-mission";
import { seedWorkbench } from "@/__tests__/setup/workbench";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});
const documents = [
    {
        url: "https://issuer.example.org/release",
        title: "Issuer pilot report",
        publishedAt: "2026-11-10T00:00:00.000Z",
        acquisition: {
            status: "complete",
            text: "Published: November 10, 2026\n\nThe issuer reports that its claims pilot reduced initial estimate preparation time.\n\nThe report excludes review and settlement time. Adjusters retained approval authority.",
        },
    },
    {
        url: "https://journal.example.org/customer",
        title: "Independent customer interview",
        publishedAt: "2026-11-12T00:00:00.000Z",
        acquisition: {
            status: "partial",
            text: "Published: November 12, 2026\n\nA customer described faster initial estimates. The remainder of the interview was not captured.",
        },
    },
    {
        url: "https://journal.example.org/comparison",
        title: "Customer comparison",
        acquisition: { status: "unavailable", code: "execution_interrupted" },
    },
];

async function fixture(
    method: "retained_control" | "native_skills" = "retained_control",
    corpus: unknown = documents,
    framingOverride?: QualificationScenario["framing"],
) {
    const f = await seedWorkbench(
        true,
        undefined,
        60000,
        undefined,
        undefined,
        null,
    );
    const run = await f.t.run((ctx) => ctx.db.get(f.runId));
    assert(run?.browserTestContextId && run.companySnapshot);
    const base = methodComparisonManifest();
    const scenario = base.scenarios[0];
    assert(scenario);
    if (framingOverride) scenario.framing = framingOverride;
    const manifest = campaignManifestSchema.parse({
        ...base,
        scenarios: [
            {
                ...scenario,
                company: { ...scenario.company, cik: run.companySnapshot.cik },
                sourcesEnvelope: sourcesTestEnvelope,
                sourcesReplay: {
                    materialHash: sha256Hex(JSON.stringify(corpus)),
                    documents: corpus,
                },
            },
        ],
        expectations: [{ id: scenario.id, checks: ["frozen-preparation"] }],
    });
    const campaignId = await f.t.mutation(
        internal.qualificationCampaigns.authorize,
        { manifest },
    );
    const lotId = await f.t.mutation(internal.qualificationCampaigns.admit, {
        campaignId,
        key: "frozen",
        candidateHash: "b".repeat(64),
        changedPaths: [],
        configurationId: method.replaceAll("_", "-"),
    });
    await f.t.mutation(internal.qualificationCampaigns.bind, {
        lotId,
        contextId: run.browserTestContextId,
    });
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, { reservationKey: "browser:frozen-sources" }),
    );
    await f.t.mutation(internal.execution.fixtures.bindCampaignScenarios, {
        dossiers: [
            {
                runId: f.runId,
                fixtureKey: "frozen-sources",
                scenarioId: scenario.id,
            },
        ],
    });
    await f.t.mutation(internal.execution.fixtures.activateWorkbench, {
        runId: f.runId,
        fixtureKey: "frozen-sources",
    });
    const framing = await f.client.query(api.framing.get, { runId: f.runId });
    assert(framing);
    const revision = await f.client.mutation(api.framing.save, {
        runId: f.runId,
        expectedRevision: framing.revision,
        requestKey: "frozen-framing",
        content: scenario.framing,
    });
    // Keep native workers idle while the test exercises the real operation boundary.
    await f.t.mutation(internal.execution.piControl.holdPublication, {
        held: true,
    });
    await f.client.mutation(api.framing.startResearch, {
        runId: f.runId,
        expectedRevision: revision,
        requestKey: "frozen-start",
    });
    for (let i = 0; i < 50; i++) {
        const missions = await f.t.run((ctx) =>
            ctx.db
                .query("agentMissions")
                .withIndex("by_run_and_status", (q) => q.eq("runId", f.runId))
                .collect(),
        );
        const mission = missions.find((m) => m.definitionId === "sources_v1");
        if (mission) {
            const current = await f.t.run((ctx) => ctx.db.get(f.runId));
            assert(current?.sourcePreparationId);
            return {
                ...f,
                campaignId,
                contextId: run.browserTestContextId,
                mission,
                preparationId: current.sourcePreparationId,
            };
        }
        await vi.advanceTimersByTimeAsync(20);
        await f.t.finishInProgressScheduledFunctions();
    }
    throw new Error("Sources mission did not start");
}

test("a frozen Sources corpus reaches genuine Start without becoming an initial illustrative fixture", async () => {
    const f = await fixture();
    expect(f.mission.definitionVersion).toBe(6);
    expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toMatchObject({
        researchStartRequestKey: "frozen-start",
        fixedFramingRevisionId: expect.any(String),
        sourcesProtocol: "sources_mission_v1",
    });
    expect(
        await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
});

test.each([
    "retained_control",
    "native_skills",
] as const)("%s discovers and captures the same frozen documents, preserving partial and interrupted outcomes without network", async (method) => {
    const { dispatchSourcesOperation } = await import(
        "@/__tests__/setup/sources-mission"
    );
    const f = await fixture(method);
    const prep = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    const need = prep?.sourcesMission?.needs[0];
    assert(need);
    const network = vi.fn<typeof fetch>(async () => {
        throw new Error("Frozen retrieval must not access the network");
    });
    vi.stubGlobal("fetch", network);
    const execute = async (
        input: import("convex/server").FunctionArgs<
            typeof internal.execution.operations.enqueue
        >["input"],
    ) => {
        const requestId = await f.t.mutation(
            internal.execution.operations.enqueue,
            {
                missionId: f.mission._id,
                expectedGeneration: f.mission.generation,
                cause: `frozen-${input.kind}`,
                input,
            },
        );
        return {
            requestId,
            outcome: await dispatchSourcesOperation(f.t, {
                requestId,
                expectedGeneration: f.mission.generation,
            }),
        };
    };
    const found = await execute({
        kind: "discover_sources_for_need",
        needId: need.id,
        query: "claims pilot customer outcomes",
    });
    assert(found.outcome.kind === "success", JSON.stringify(found.outcome));
    const sources = await f.t.run((ctx) =>
        ctx.db
            .query("sources")
            .withIndex("by_run_and_url", (q) => q.eq("runId", f.runId))
            .collect(),
    );
    expect(sources.map((s) => s.canonicalUrl).sort()).toEqual(
        documents.map((d) => d.url).sort(),
    );
    for (const document of documents) {
        const source = sources.find((s) => s.canonicalUrl === document.url);
        assert(source);
        expect(source.providerReference).toContain("sources-replay:");
        const acquired = await execute({
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
        assert(capture);
        if (document.acquisition.status === "unavailable") {
            expect(acquired.outcome).toMatchObject({
                kind: "unavailable",
                code: "execution_interrupted",
            });
            expect(capture).toMatchObject({
                status: "unavailable",
                failureCode: "execution_interrupted",
            });
        } else {
            assert(
                acquired.outcome.kind === "success",
                JSON.stringify(acquired.outcome),
            );
            expect(capture).toMatchObject({
                status: "committed",
                representationCompleteness: document.acquisition.status,
                readingCompleteness: document.acquisition.status,
                retrievalVersion: expect.stringContaining("sources-replay:"),
            });
            const read = await execute({
                kind: "search_available_material",
                sourceId: source._id,
                query: "estimate",
            });
            assert(read.outcome.kind === "success");
            expect(read.outcome.valueJson).toContain("2026-11-");
        }
    }
    const retained = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    expect(retained?.sourcesMission?.captureIds).toHaveLength(2);
    expect(network).not.toHaveBeenCalled();
    expect(
        await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
});

test("revoked replay cannot finalize an uploaded capture", async () => {
    const { dispatchSourcesOperation } = await import(
        "@/__tests__/setup/sources-mission"
    );
    const f = await fixture("native_skills");
    const prep = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    const need = prep?.sourcesMission?.needs[0];
    assert(need);
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.mission._id,
            expectedGeneration: f.mission.generation,
            cause: "replay-search",
            input: {
                kind: "discover_sources_for_need",
                needId: need.id,
                query: "claims pilot",
            },
        },
    );
    const result = await dispatchSourcesOperation(f.t, {
        requestId,
        expectedGeneration: f.mission.generation,
    });
    assert(result.kind === "success", JSON.stringify(result));
    const firstDocument = documents[0];
    assert(firstDocument);
    const source = await f.t.run((ctx) =>
        ctx.db
            .query("sources")
            .withIndex("by_run_and_url", (q) =>
                q.eq("runId", f.runId).eq("canonicalUrl", firstDocument.url),
            )
            .unique(),
    );
    assert(source);
    const reserved = await f.t.mutation(internal.sourceCaptures.reserveUpload, {
        preparationId: f.preparationId,
        sourceId: source._id,
    });
    const text = "Retained bytes pending adoption.";
    const storageId = await f.t.run((ctx) =>
        ctx.storage.store(new Blob([text], { type: "text/plain" })),
    );
    await f.t.mutation(internal.sourceCaptures.attachStorage, {
        preparationId: f.preparationId,
        captureId: reserved.capture._id,
        storageId,
    });
    await f.t.mutation(internal.qualificationCampaigns.close, {
        campaignId: f.campaignId,
    });
    assert(reserved.capture.normalizerVersion);
    await expect(
        f.t.mutation(internal.sourceCaptures.finalize, {
            preparationId: f.preparationId,
            captureId: reserved.capture._id,
            contentHash: sha256Hex(text),
            byteCount: text.length,
            resolvedUrl: source.canonicalUrl,
            retrievalVersion: `sources-replay:${sha256Hex(JSON.stringify(documents))}`,
            normalizerVersion: reserved.capture.normalizerVersion,
            retrievedAt: Date.now(),
            readingCompleteness: "complete",
            representationCompleteness: "complete",
            omittedPassageCount: 0,
        }),
    ).rejects.toThrow(/not active/);
    expect(
        (await f.t.run((ctx) => ctx.db.get(reserved.capture._id)))?.status,
    ).toBe("uploaded");
});

test("tampered Sources corpus is rejected before discovery and never falls through to the network", async () => {
    const { dispatchSourcesOperation } = await import(
        "@/__tests__/setup/sources-mission"
    );
    const f = await fixture("native_skills");
    const prep = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    const need = prep?.sourcesMission?.needs[0];
    assert(need);
    await f.t.run(async (ctx) => {
        const campaign = await ctx.db.get(f.campaignId);
        assert(campaign && campaign.manifest.version !== 1);
        const scenario = campaign.manifest.scenarios[0];
        assert(scenario?.sourcesReplay);
        const doc = scenario.sourcesReplay.documents[0];
        assert(doc);
        doc.title = "Altered after authorization";
        await ctx.db.patch(campaign._id, { manifest: campaign.manifest });
    });
    const network = vi.fn<typeof fetch>(async () => {
        throw new Error("Unexpected network");
    });
    vi.stubGlobal("fetch", network);
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.mission._id,
            expectedGeneration: f.mission.generation,
            cause: "tampered-replay",
            input: {
                kind: "discover_sources_for_need",
                needId: need.id,
                query: "claims pilot",
            },
        },
    );
    const result = await dispatchSourcesOperation(f.t, {
        requestId,
        expectedGeneration: f.mission.generation,
    });
    expect(result).toMatchObject({
        kind: "unavailable",
        code: "sources_replay_hash_mismatch",
    });
    expect(
        await f.t.run((ctx) =>
            ctx.db
                .query("sources")
                .withIndex("by_run_and_url", (q) => q.eq("runId", f.runId))
                .collect(),
        ),
    ).toEqual([]);
    expect(
        await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
    expect(network).not.toHaveBeenCalled();
});

for (const caseId of [
    "sources-partial-reading",
    "sources-attribution-independence",
    "sources-counterevidence-scope",
    "sources-interrupted-preparation",
]) {
    test.each([
        "retained_control",
        "native_skills",
    ] as const)(`${caseId}: %s starts and retains the frozen corpus through real operations`, async (method) => {
        const { dispatchSourcesOperation } = await import(
            "@/__tests__/setup/sources-mission"
        );
        const raw = JSON.parse(
            readFileSync(
                `scripts/evaluations/workbench-browser/fixtures/native-task-methods-20261119/${caseId}.json`,
                "utf8",
            ),
        );
        const material = {
            documents: sourcesReplaySchema.shape.documents.parse(raw.documents),
        };
        const cases: {
            scenarios: Array<Pick<QualificationScenario, "id" | "framing">>;
        } = JSON.parse(
            readFileSync(
                "scripts/evaluations/workbench-browser/fixtures/native-task-methods-20261119/cases.json",
                "utf8",
            ),
        );
        const scenario = cases.scenarios.find((s) => s.id === caseId);
        assert(scenario);
        const f = await fixture(method, material.documents, scenario.framing);
        const prep = await f.t.run((ctx) => ctx.db.get(f.preparationId));
        const need = prep?.sourcesMission?.needs[0];
        assert(need);
        const execute = async (
            input: import("convex/server").FunctionArgs<
                typeof internal.execution.operations.enqueue
            >["input"],
        ) => {
            const requestId = await f.t.mutation(
                internal.execution.operations.enqueue,
                {
                    missionId: f.mission._id,
                    expectedGeneration: f.mission.generation,
                    cause: `corpus-${input.kind}`,
                    input,
                },
            );
            return dispatchSourcesOperation(f.t, {
                requestId,
                expectedGeneration: f.mission.generation,
            });
        };
        const network = vi.fn<typeof fetch>(async () => {
            throw new Error("Replay network fallback");
        });
        vi.stubGlobal("fetch", network);
        const discovery = await execute({
            kind: "discover_sources_for_need",
            needId: need.id,
            query: "CCC estimate review and independent outcomes",
        });
        assert(discovery.kind === "success", JSON.stringify(discovery));
        const sources = await f.t.run((ctx) =>
            ctx.db
                .query("sources")
                .withIndex("by_run_and_url", (q) => q.eq("runId", f.runId))
                .collect(),
        );
        expect(sources.map((s) => s.canonicalUrl).sort()).toEqual(
            material.documents.map((d: { url: string }) => d.url).sort(),
        );
        for (const source of sources) {
            const acquisition = await execute({
                kind: "make_source_consultable",
                sourceId: source._id,
                needId: need.id,
            });
            const document = material.documents.find(
                (d: { url: string }) => d.url === source.canonicalUrl,
            );
            assert(document);
            if (document.acquisition.status === "unavailable")
                expect(acquisition).toMatchObject({
                    kind: "unavailable",
                    code: document.acquisition.code,
                });
            else {
                assert(
                    acquisition.kind === "success",
                    JSON.stringify(acquisition),
                );
                const reading = await execute({
                    kind: "search_available_material",
                    sourceId: source._id,
                    query: "review",
                });
                assert(reading.kind === "success", JSON.stringify(reading));
                expect(reading.valueJson).toContain(source.canonicalUrl);
            }
        }
        const before = await f.t.run((ctx) => ctx.db.get(f.preparationId));
        assert(before?.sourcesMission);
        expect(before.sourcesMission.captureIds.length).toBe(
            material.documents.filter(
                (d: { acquisition: { status: string } }) =>
                    d.acquisition.status !== "unavailable",
            ).length,
        );
        if (caseId === "sources-interrupted-preparation") {
            const run = await f.t.run((ctx) => ctx.db.get(f.runId));
            assert(run);
            await f.client.mutation(api.execution.researchControl.pause, {
                runId: f.runId,
                expectedGeneration: run.executionGeneration,
            });
            await f.t.run((ctx) =>
                pauseResearchAtBoundary(ctx, f.runId, f.mission),
            );
            expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toMatchObject({
                executionStatus: "paused",
            });
            const after = await f.t.run((ctx) => ctx.db.get(f.preparationId));
            expect(after?.sourcesMission?.captureIds).toEqual(
                before.sourcesMission.captureIds,
            );
            expect(after?.sourcesMission?.qualifications).toEqual([]);
            expect(after?.sourcesMission?.result).toBeUndefined();
        }
        expect(network).not.toHaveBeenCalled();
        expect(
            await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
        ).toEqual([]);
    });
}
