import { SourceReviewReads } from "@convex/domain/sourceReviewReads";
import { assertSourcesCompletionCapacity } from "@convex/domain/sources";
import { registeredAgentDefinitions } from "@convex/execution/agentCatalog";
import { SOURCES_HANDOFF_READ_CAPACITY } from "@convex/resourcePolicy";
import { expect, test } from "vitest";
import { seedCapturedSources } from "@/__tests__/setup/sources-mission";

test("Sources is a research binding using canonical shared reading operations", () => {
    const definitions = registeredAgentDefinitions();
    const sources = definitions.find(
        (definition) => definition.id === "sources_v1",
    );
    expect(sources).toBeDefined();
    expect(sources?.executionScope).toBe("research");
    expect(sources?.nativeConversation).toBeUndefined();
    const inspection = definitions.find(
        (definition) => definition.id === "saved_material_inspection_v1",
    );
    expect(sources?.operations.read_in_context).toBe(
        inspection?.operations.read_in_context,
    );
    expect(Object.keys(sources?.operations ?? {})).toEqual(
        expect.arrayContaining([
            "consult_mission_state",
            "discover_sources_for_need",
            "search_available_material",
            "read_in_context",
            "make_source_consultable",
            "submit_documentary_qualification",
            "request_documentary_check",
        ]),
    );
});

import { internal } from "@convex/_generated/api";
import { seedSourcePreparation } from "@/__tests__/setup/source-preparation";

const envelope = {
    version: 1 as const,
    maxNeeds: 12,
    initialSearches: 4,
    complementSearches: 3,
    acquisitions: 10,
    controls: 20,
};

test("system claims Sources idempotently with common needs and no analyst approval", async () => {
    const f = await seedSourcePreparation();
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, { sourcesProtocol: "sources_mission_v1" }),
    );
    const args = {
        runId: f.runId,
        corpusRevisionId: f.corpusRevisionId,
        expectedGeneration: 3,
        envelope,
    };
    const id = await f.t.mutation(internal.sourcesMission.claim, args);
    expect(await f.t.mutation(internal.sourcesMission.claim, args)).toBe(id);
    const preparation = await f.t.run((ctx) => ctx.db.get(id));
    expect(preparation?.sourcesMission?.needs).toEqual([
        expect.objectContaining({ id: "common-context", commonContext: true }),
    ]);
    expect(
        await f.t.run((ctx) => ctx.db.get(f.corpusRevisionId)),
    ).toMatchObject({ status: "draft" });
    expect(preparation?.sourcesMission?.qualifications).toEqual([]);
});

import { initializeSources } from "@convex/domain/sources";
import { seedInspectedEvidence } from "@/__tests__/setup/source-preparation";

test("Sources reads its prepared capture without fabricating corpus approval", async () => {
    const f = await seedInspectedEvidence();
    const preparationId = await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        if (!run?.sourcePreparationId)
            throw new Error("missing fixture preparation");
        await ctx.db.patch(f.runId, {
            sourcesProtocol: "sources_mission_v1",
            lifecycleState: "discovering_sources",
        });
        await ctx.db.patch(f.corpusRevisionId, { status: "draft" });
        await ctx.db.patch(run.sourcePreparationId, {
            status: "started",
            executionGeneration: 4,
            deadlineAt: Date.now() + 60_000,
            leaseExpiresAt: Date.now() + 60_000,
        });
        const data = await initializeSources(
            ctx,
            run.sourcePreparationId,
            envelope,
        );
        await ctx.db.patch(run.sourcePreparationId, {
            sourcesMission: { ...data, captureIds: [f.captureId] },
        });
        return run.sourcePreparationId;
    });
    const missionId = await f.t.mutation(internal.execution.missions.start, {
        runId: f.runId,
        expectedGeneration: 4,
        definitionId: "sources_v1",
        scope: { kind: "sources_v1", preparationId },
        requestKey: "sources-read",
    });
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId,
            expectedGeneration: 4,
            cause: "read",
            input: {
                kind: "search_available_material",
                sourceId: f.sourceId,
                query: "workflow",
            },
        },
    );
    const outcome = await f.t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 4,
    });
    expect(outcome.kind).toBe("success");
    const nativeId = await f.t.mutation(
        internal.execution.operations.enqueueNative,
        {
            runId: f.runId,
            expectedGeneration: 4,
            cause: "native-read",
            input: {
                kind: "search_available_material",
                sourceId: f.sourceId,
                query: "workflow",
            },
        },
    );
    const native = await f.t.action(internal.execution.operations.dispatch, {
        requestId: nativeId,
        expectedGeneration: 4,
    });
    expect(native.kind).toBe("success");
    if (native.kind === "success")
        expect(JSON.parse(native.valueJson)).toMatchObject({
            captureId: f.captureId,
        });
    if (outcome.kind === "success")
        expect(JSON.parse(outcome.valueJson)).toMatchObject({
            captureId: f.captureId,
        });
    expect(
        await f.t.run((ctx) => ctx.db.get(f.corpusRevisionId)),
    ).toMatchObject({ status: "draft" });
});

import { controlledDocumentaryUse } from "@convex/domain/sourceSelectionPolicy";

test("a coherence objection restricts affected contributions without erasing independently controlled context", () => {
    const contribution = {
        id: "context",
        version: 1,
        needIds: ["common-context"],
        statement: "An attributed context",
        period: "2026",
        modality: "attributed",
        attribution: "publisher",
        kind: "context" as const,
        evidence: [],
    };
    expect(
        controlledDocumentaryUse(contribution, {
            coherence: false,
            limitations: ["A different contribution contradicts itself"],
            findings: [
                {
                    contributionId: "context",
                    conclusion: "supported",
                    permittedUse: "context_only",
                    diagnostic: "Independent context remains supported",
                },
            ],
        }),
    ).toBe("context_only");
});

import { reconstructQualification } from "@convex/domain/sources";
import { assert } from "vitest";

test("a byte-identical correction preserves contribution versions instead of inventing progress", async () => {
    const f = await seedSourcePreparation();
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, { sourcesProtocol: "sources_mission_v1" }),
    );
    const preparationId = await f.t.mutation(internal.sourcesMission.claim, {
        runId: f.runId,
        corpusRevisionId: f.corpusRevisionId,
        expectedGeneration: 3,
        envelope,
    });
    const data = (await f.t.run((ctx) => ctx.db.get(preparationId)))
        ?.sourcesMission;
    assert(data);
    const captureId = await f.t.run((ctx) =>
        ctx.db.insert("sourceCaptures", {
            runId: f.runId,
            corpusRevisionId: f.corpusRevisionId,
            sourceId: f.sourceId,
            preparationId,
            executionGeneration: 3,
            captureKey: "identity",
            requestInputHash: "hash",
            requestedUrl: "https://example.com/",
            normalizerVersion: "fixture",
            status: "reserved",
            createdAt: 1,
            updatedAt: 1,
        }),
    );
    const contribution = {
        id: "stable",
        version: 3,
        needIds: ["common-context"],
        statement: "Attributed context",
        period: "2026",
        modality: "observed",
        attribution: "publisher",
        kind: "context" as const,
        evidence: [
            { captureId, passageOrder: 0, quotation: "Literal evidence" },
        ],
    };
    const controlTaskId = await f.t.run((ctx) =>
        ctx.db.insert("aiTaskResults", {
            runId: f.runId,
            corpusRevisionId: f.corpusRevisionId,
            taskType: "documentary_control",
            executionMode: "showcase",
            fixtureId: "identity",
            schemaVersion: "documentary-control-v1",
            adapterVersion: "fixture",
            inputHash: "identity",
            output: {
                kind: "documentary_control",
                preparationId,
                evidence: contribution.evidence,
                inputHash: "identity",
                control: { findings: [], coherence: true, limitations: [] },
            },
            createdAt: 1,
        }),
    );
    const previous = {
        kind: "documentary_qualification" as const,
        preparationId,
        captureId,
        contentHash: "hash",
        version: 2,
        controlTaskId,
        contributions: [contribution],
    };
    const { id: _id, version: _version, ...content } = contribution;
    expect(
        reconstructQualification(
            {
                sourceId: f.sourceId,
                captureId,
                expectedTaskId: null,
                changes: [
                    {
                        contributionId: "stable",
                        expectedVersion: 3,
                        contribution: content,
                    },
                ],
            },
            previous,
            data,
            "retry",
        ),
    ).toEqual([contribution]);
});

import { completeSources } from "@convex/domain/sources";

test("a need cannot be completed by a successful search that neither supplies material nor records a gap", async () => {
    const f = await seedSourcePreparation();
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, { sourcesProtocol: "sources_mission_v1" }),
    );
    const preparationId = await f.t.mutation(internal.sourcesMission.claim, {
        runId: f.runId,
        corpusRevisionId: f.corpusRevisionId,
        expectedGeneration: 3,
        envelope,
    });
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueueNative,
        {
            runId: f.runId,
            expectedGeneration: 3,
            cause: "empty-search",
            input: {
                kind: "discover_sources_for_need",
                needId: "common-context",
                query: "platform",
            },
        },
    );
    await f.t.run(async (ctx) => {
        const preparation = await ctx.db.get(preparationId);
        assert(preparation?.sourcesMission);
        await ctx.db.patch(requestId, {
            status: "completed",
            outcome: { kind: "success", valueJson: '{"inserted":0}' },
        });
        await ctx.db.patch(preparationId, {
            sourcesMission: {
                ...preparation.sourcesMission,
                work: [
                    {
                        requestId,
                        kind: "discover_sources_for_need",
                        needIds: ["common-context"],
                    },
                ],
            },
        });
    });
    await expect(
        f.t.run((ctx) =>
            completeSources(ctx, preparationId, {
                kind: "complete",
                needsRevision: 1,
                needs: [
                    {
                        needId: "common-context",
                        unfinished: [],
                        workRequestIds: [requestId],
                    },
                ],
            }),
        ),
    ).rejects.toThrow("sources_need_unresolved");
    const examinedGap = await f.t.run((ctx) =>
        completeSources(ctx, preparationId, {
            kind: "complete",
            needsRevision: 1,
            needs: [
                {
                    needId: "common-context",
                    unfinished: [],
                    gap: "No result within this completed search.",
                    workRequestIds: [requestId],
                },
            ],
        }),
    );
    expect(examinedGap).toMatchObject({ outcome: "complete", documents: [] });
});

test("a later adverse check restricts an exact contribution version while independent versions remain usable", () => {
    const c = {
        id: "claim",
        version: 2,
        needIds: ["common-context"],
        statement: "A documentary assertion",
        period: "2026",
        modality: "observed",
        attribution: "publisher",
        kind: "asserted_fact" as const,
        evidence: [],
    };
    const control = {
        coherence: true,
        limitations: [],
        findings: [
            {
                contributionId: "claim",
                conclusion: "supported" as const,
                permittedUse: "documentary" as const,
                diagnostic: "Supported in scope",
            },
        ],
    };
    expect(
        controlledDocumentaryUse(c, control, [
            { contributionId: "claim", version: 2 },
        ]),
    ).toBe("blocked");
    expect(
        controlledDocumentaryUse({ ...c, version: 3 }, control, [
            { contributionId: "claim", version: 2 },
        ]),
    ).toBe("documentary");
});

test("distinct need-bound queries retain distinct provider identities within the same initial allowance", async () => {
    const f = await seedSourcePreparation();
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, { sourcesProtocol: "sources_mission_v1" }),
    );
    const preparationId = await f.t.mutation(internal.sourcesMission.claim, {
        runId: f.runId,
        corpusRevisionId: f.corpusRevisionId,
        expectedGeneration: 3,
        envelope,
    });
    const hashes = [];
    for (const query of ["workflow documentation", "interoperability guide"]) {
        const requestId = await f.t.mutation(
            internal.execution.operations.enqueueNative,
            {
                runId: f.runId,
                expectedGeneration: 3,
                cause: "search",
                input: {
                    kind: "discover_sources_for_need",
                    needId: "common-context",
                    query,
                },
            },
        );
        expect(
            await f.t.mutation(internal.execution.operations.claim, {
                requestId,
                expectedGeneration: 3,
            }),
        ).toMatchObject({ kind: "execute" });
        hashes.push(
            (
                await f.t.mutation(internal.sourcesMission.reserve, {
                    requestId,
                    expectedGeneration: 3,
                })
            ).inputHash,
        );
    }
    expect(new Set(hashes).size).toBe(2);
    expect(
        (await f.t.run((ctx) => ctx.db.get(preparationId)))?.sourcesMission,
    ).toMatchObject({ searches: 2, phase: "initial" });
});

test("the coverage preset orients the reserved query without adding searches", async () => {
    const results = [];
    const query = "workflow documentation";
    for (const preset of [
        "balanced",
        "first_party_depth",
        "independent_scrutiny",
        undefined,
    ] as const) {
        const f = await seedSourcePreparation();
        await f.t.run((ctx) =>
            ctx.db.patch(f.runId, {
                sourcesProtocol: "sources_mission_v1",
                coveragePreset: preset ?? "independent_scrutiny",
                sourcesCoveragePolicyVersion: preset
                    ? "sources_coverage_v1"
                    : undefined,
            }),
        );
        const preparationId = await f.t.mutation(
            internal.sourcesMission.claim,
            {
                runId: f.runId,
                corpusRevisionId: f.corpusRevisionId,
                expectedGeneration: 3,
                envelope,
            },
        );
        const requestId = await f.t.mutation(
            internal.execution.operations.enqueueNative,
            {
                runId: f.runId,
                expectedGeneration: 3,
                cause: "search",
                input: {
                    kind: "discover_sources_for_need",
                    needId: "common-context",
                    query,
                },
            },
        );
        await f.t.mutation(internal.execution.operations.claim, {
            requestId,
            expectedGeneration: 3,
        });
        const reservation = await f.t.mutation(
            internal.sourcesMission.reserve,
            { requestId, expectedGeneration: 3 },
        );
        const preparation = await f.t.run((ctx) => ctx.db.get(preparationId));
        expect(preparation?.sourcesMission?.searches).toBe(1);
        expect(preparation?.sourcesMission?.coveragePolicy).toEqual(
            preset ? { version: "sources_coverage_v1", preset } : undefined,
        );
        expect(preparation?.sourcesMission?.work[0]?.discovery).toEqual(
            reservation.discovery,
        );
        results.push(reservation.discovery);
    }
    expect(results.map((result) => result?.focus)).toEqual([
        "mixed",
        "official",
        "independent",
        undefined,
    ]);
    expect(new Set(results.map((result) => result?.query)).size).toBe(4);
    expect(results.every((result) => result?.query.startsWith(query))).toBe(
        true,
    );
    expect(results[3]?.query).toBe(query);
});

test("Sources receives the confirmed company and fixed framing even without initial candidates", async () => {
    const { seedCapturedSources } = await import(
        "@/__tests__/setup/sources-mission"
    );
    const f = await seedCapturedSources();
    await f.t.run(async (ctx) => {
        const frameId = await ctx.db.insert("framingRevisions", {
            runId: f.runId,
            revision: 1,
            content: { scope: "Enterprise workflows", questions: [] },
            requestKey: "fixed",
            contentHash: "fixture",
            origin: "analyst",
            createdAt: 1,
        });
        const company = await ctx.db.get(f.companyId);
        if (!company) throw new Error("Missing company fixture");
        await ctx.db.patch(f.runId, {
            startMode: "framed",
            fixedFramingRevisionId: frameId,
            companySnapshot: {
                cik: company.cik,
                legalName: company.legalName,
                ticker: company.ticker,
                exchange: company.exchange,
            },
        });
        await ctx.db.delete(f.sourceId);
    });
    const assembled = await f.t.query(internal.execution.context.build, {
        missionId: f.missionId,
        expectedGeneration: 4,
    });
    expect(assembled.kind).toBe("ready");
    if (assembled.kind !== "ready") throw new Error(assembled.code);
    const context = JSON.parse(assembled.inputJson);
    expect(context.domain.company).toMatchObject({
        cik: "1373715",
        legalName: "ServiceNow, Inc.",
    });
    expect(context.domain.framing).toMatchObject({
        scope: "Enterprise workflows",
        fixed: true,
    });
    expect(context.activeWork.candidates).toEqual([]);
});

test("admission reserves the space for attributed coverage readings at handoff", async () => {
    const f = await seedCapturedSources();
    await f.t.run(async (ctx) => {
        const preparation = await ctx.db.get(f.preparationId);
        assert(preparation?.sourcesMission);
        const data = {
            ...preparation.sourcesMission,
            needs: Array.from({ length: 100 }, (_, index) => ({
                id: `need-${index}`,
                version: 1,
                information: "x".repeat(9090),
                questionIds: [],
                commonContext: index === 0,
            })),
            envelope: { ...preparation.sourcesMission.envelope, maxNeeds: 100 },
        };
        const reads = new SourceReviewReads(
            ctx.db,
            f.runId,
            SOURCES_HANDOFF_READ_CAPACITY,
        );
        await expect(
            assertSourcesCompletionCapacity(
                reads,
                preparation,
                data,
                null,
                f.readRequestId,
            ),
        ).resolves.toBeUndefined();
        await expect(
            assertSourcesCompletionCapacity(
                reads,
                preparation,
                {
                    ...data,
                    coveragePolicy: {
                        version: "sources_coverage_v1",
                        preset: "balanced",
                    },
                },
                null,
                f.readRequestId,
            ),
        ).rejects.toThrow("sources_result_capacity");
    });
});
