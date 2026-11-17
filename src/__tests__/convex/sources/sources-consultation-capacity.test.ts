import { internal } from "@convex/_generated/api";
import { SourceReviewReads } from "@convex/domain/sourceReviewReads";
import {
    assertSourcesCompletionCapacity,
    reconstructQualification,
} from "@convex/domain/sources";
import { getAgentDefinition } from "@convex/execution/agentCatalog";
import { agentToolSchemas } from "@convex/execution/agentDefinition";
import { agentInputByteLength } from "@convex/integrations/modelInput";
import { SIMULATION_MODEL_ROUTE } from "@convex/integrations/modelRouting";
import { SOURCES_HANDOFF_READ_CAPACITY } from "@convex/resourcePolicy";
import { getDocumentSize } from "convex/values";
import { afterEach, assert, expect, test, vi } from "vitest";
import { seedCapturedSources } from "@/__tests__/setup/sources-mission";

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

test.each([
    { count: 48, character: "a" },
    { count: 48, character: "🦉" },
    { count: 60, character: "a" },
])("admitted distinct documentary dependencies keep consultation available (%j)", async ({
    count,
    character,
}) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const f = await seedCapturedSources();
    const seeded = await f.t.run(async (ctx) => {
        const preparation = await ctx.db.get(f.preparationId);
        const source = await ctx.db.get(f.sourceId);
        const capture = await ctx.db.get(f.captureId);
        assert(preparation?.sourcesMission && source && capture);
        const { _id: _s, _creationTime: _st, ...sourceValue } = source;
        const { _id: _c, _creationTime: _ct, ...captureValue } = capture;
        const { _id: _p, _creationTime: _pt, ...passageValue } = f.passage;
        const data = {
            ...preparation.sourcesMission,
            envelope: {
                ...preparation.sourcesMission.envelope,
                controls: 60,
                acquisitions: 60,
            },
        };
        for (let index = 0; index < count; index++) {
            const sourceId =
                index === 0
                    ? f.sourceId
                    : await ctx.db.insert("sources", {
                          ...sourceValue,
                          canonicalUrl: `https://example.com/perf-${index}`,
                      });
            const captureId =
                index === 0
                    ? f.captureId
                    : await ctx.db.insert("sourceCaptures", {
                          ...captureValue,
                          sourceId,
                          captureKey: `perf-${index}`,
                      });
            if (index) data.captureIds.push(captureId);
            for (let order = 0; order < 90; order++) {
                if (index === 0 && order === 0) continue;
                await ctx.db.insert("sourceSearchPassages", {
                    ...passageValue,
                    sourceId,
                    captureId,
                    order: f.passage.order + order,
                });
            }
            const contributions = reconstructQualification(
                {
                    sourceId,
                    captureId,
                    expectedTaskId: null,
                    changes: Array.from(
                        { length: 15 },
                        (_, contributionIndex) => ({
                            contribution: {
                                needIds: ["common-context"],
                                statement: character.repeat(160),
                                period: "current",
                                modality: "reported",
                                attribution: "publisher",
                                kind: "context" as const,
                                evidence: Array.from(
                                    { length: 6 },
                                    (_, evidenceIndex) => ({
                                        captureId,
                                        passageOrder:
                                            f.passage.order +
                                            contributionIndex * 6 +
                                            evidenceIndex,
                                        quotation: f.passage.quotation,
                                    }),
                                ),
                            },
                        }),
                    ),
                },
                null,
                data,
                `perf-qualification-${index}`,
            );
            const base = {
                runId: f.runId,
                corpusRevisionId: f.corpusRevisionId,
                sourceId,
                executionMode: "live" as const,
                schemaVersion: "fixture",
                adapterVersion: "fixture",
                createdAt: 1,
            };
            const controlTaskId = await ctx.db.insert("aiTaskResults", {
                ...base,
                inputHash: `control-${index}`,
                taskType: "documentary_control",
                output: {
                    kind: "documentary_control",
                    preparationId: f.preparationId,
                    evidence: contributions.flatMap((c) => c.evidence),
                    inputHash: `control-${index}`,
                    control: {
                        coherence: true,
                        limitations: [],
                        findings: contributions.map((c) => ({
                            contributionId: c.id,
                            conclusion: "supported" as const,
                            permittedUse: "context_only" as const,
                            diagnostic: "Controlled context.",
                        })),
                    },
                },
            });
            const qualificationTaskId = await ctx.db.insert("aiTaskResults", {
                ...base,
                inputHash: `qualification-${index}`,
                taskType: "documentary_qualification",
                output: {
                    kind: "documentary_qualification",
                    preparationId: f.preparationId,
                    captureId,
                    contentHash: capture.contentHash ?? "",
                    version: 1,
                    contributions,
                    controlTaskId,
                },
            });
            data.qualifications.push(qualificationTaskId);
        }
        await ctx.db.patch(f.preparationId, { sourcesMission: data });
        const request = await ctx.db
            .query("agentOperationRequests")
            .withIndex("by_mission", (q) => q.eq("missionId", f.missionId))
            .first();
        assert(request);
        const current = await ctx.db.get(f.preparationId);
        assert(current);
        await assertSourcesCompletionCapacity(
            new SourceReviewReads(
                ctx.db,
                f.runId,
                SOURCES_HANDOFF_READ_CAPACITY,
            ),
            current,
            data,
            null,
            request._id,
        );
        return {
            preparationBytes: getDocumentSize(current),
            qualificationCount: data.qualifications.length,
            distinctPassages: count * 90,
        };
    });
    const input = await f.t.run(async (ctx) => {
        const built = await ctx.runQuery(
            internal.execution.context.build,
            { missionId: f.missionId, expectedGeneration: 4 },
            {
                transactionLimits: {
                    bytesRead: 16 * 1024 * 1024,
                    databaseQueries: 4096,
                },
            },
        );
        return built;
    });
    assert(input.kind === "ready");
    const snapshot = JSON.parse(input.inputJson);
    const definition = getAgentDefinition("sources_v1");
    const requestBytes = await agentInputByteLength({
        instructions: definition.instructions,
        operations: agentToolSchemas(definition, snapshot),
        prompt: input.inputJson,
        definitionVersion: definition.version,
        nativeRoute: SIMULATION_MODEL_ROUTE,
        contextRendering: definition.contextRendering,
    });
    expect(requestBytes).toBeGreaterThan(128 * 1024);
    expect(seeded.distinctPassages).toBe(count * 90);
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 4,
            cause: "perf-consult",
            input: { kind: "consult_mission_state" },
        },
    );
    const outcome = await f.t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 4,
    });
    expect(outcome).toMatchObject({ kind: "success" });
    assert(outcome.kind === "success");
    const page = JSON.parse(outcome.valueJson);
    expect(
        new TextEncoder().encode(outcome.valueJson).length,
    ).toBeLessThanOrEqual(48 * 1024);
    expect(page.state.requiredState).toMatchObject({
        section: "workbench_current_state",
        contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(page.state).not.toHaveProperty("activeWork");
    expect(snapshot.activeWork.contributionObservations).toHaveLength(count);
    expect(page.history.entries.length).toBeGreaterThan(0);
});
