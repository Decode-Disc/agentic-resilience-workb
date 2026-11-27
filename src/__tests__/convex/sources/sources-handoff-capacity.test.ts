import { api, internal } from "@convex/_generated/api";
import {
    completeSources,
    reconstructQualification,
} from "@convex/domain/sources";
import { extractObservedDestinations } from "@convex/integrations/evidenceNormalization";
import { getDocumentSize } from "convex/values";
import { afterEach, assert, expect, test, vi } from "vitest";
import {
    dispatchSourcesOperation,
    recordDocumentaryRead,
    seedCapturedSources,
} from "@/__tests__/setup/sources-mission";

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

test.each([
    { needCount: 6, distinct: false, large: false },
    { needCount: 10, distinct: false, large: false },
    { needCount: 2, distinct: true, large: false },
    { needCount: 2, distinct: false, large: true },
    { needCount: 6, distinct: false, large: false, targeted: true },
    { needCount: 2, distinct: true, large: false, sparse: true },
])("a 48-document handoff fits storage and transaction limits or refuses before control I/O: %j", async ({
    needCount,
    distinct,
    large,
    targeted,
    sparse,
}) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const f = await seedCapturedSources();
    const material = await f.t.run(async (ctx) => {
        const preparation = await ctx.db.get(f.preparationId);
        assert(preparation?.sourcesMission);
        const originalSource = await ctx.db.get(f.sourceId);
        const originalCapture = await ctx.db.get(f.captureId);
        assert(originalSource && originalCapture);
        const {
            _id: _sourceId,
            _creationTime: _sourceTime,
            ...sourceValue
        } = originalSource;
        const {
            _id: _captureId,
            _creationTime: _captureTime,
            ...captureValue
        } = originalCapture;
        const {
            _id: _passageId,
            _creationTime: _passageTime,
            ...passageValue
        } = f.passage;
        if (large) {
            captureValue.observedDestinations = extractObservedDestinations(
                Array.from(
                    { length: 64 },
                    (_, i) =>
                        `<a href="https://example.com/${i}/${"a".repeat(1990)}">Guide</a>`,
                ).join("\n"),
                "https://example.com",
            );
            await ctx.db.patch(f.captureId, {
                observedDestinations: captureValue.observedDestinations,
            });
        }
        const needs = Array.from({ length: needCount }, (_, i) => ({
            id: `need-${i}`,
            version: 1,
            information: `Documentary need ${i}`,
            questionIds: [],
            commonContext: i === 0,
        }));
        const data = {
            ...preparation.sourcesMission,
            needs,
            envelope: {
                ...preparation.sourcesMission.envelope,
                acquisitions: 48,
                controls: 48,
            },
        };
        for (let i = 0; i < 48; i++) {
            const sourceId =
                i === 0
                    ? f.sourceId
                    : await ctx.db.insert("sources", {
                          ...sourceValue,
                          canonicalUrl: `https://example.com/document-${i}`,
                      });
            const captureId =
                i === 0
                    ? f.captureId
                    : await ctx.db.insert("sourceCaptures", {
                          ...captureValue,
                          sourceId,
                          captureKey: `capture-${i}`,
                      });
            if (i !== 0) data.captureIds.push(captureId);
            for (let order = 0; order < (distinct ? 90 : 1); order++) {
                if (i === 0 && order === 0) continue;
                await ctx.db.insert("sourceSearchPassages", {
                    ...passageValue,
                    sourceId,
                    captureId,
                    order: f.passage.order + order * (sparse ? 2 : 1),
                });
            }
            const contributions = reconstructQualification(
                {
                    sourceId,
                    captureId,
                    expectedTaskId: null,
                    changes: Array.from({ length: 15 }, (_, j) => ({
                        contribution: {
                            needIds: needs.map((n) => n.id),
                            statement: large
                                ? `Useful context ${j}: ${"x".repeat(3900)}`
                                : `Useful context ${j}`,
                            period: "2026",
                            modality: "reported",
                            attribution: "publisher",
                            kind: "context" as const,
                            evidence: Array.from(
                                { length: distinct ? 6 : large ? 8 : 2 },
                                (_, k) => ({
                                    captureId,
                                    passageOrder:
                                        f.passage.order +
                                        (distinct
                                            ? (j * 6 + k) * (sparse ? 2 : 1)
                                            : 0),
                                    quotation: f.passage.quotation,
                                }),
                            ),
                        },
                    })),
                },
                null,
                data,
                `qualification-${i}`,
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
                inputHash: `control-${i}`,
                taskType: "documentary_control",
                output: {
                    kind: "documentary_control",
                    preparationId: f.preparationId,
                    evidence: contributions.flatMap((c) => c.evidence),
                    inputHash: `control-${i}`,
                    examination: {
                        state: "examined",
                        contractVersion: 2,
                        control: {
                            findings: Object.fromEntries(
                                contributions.map((c) => [
                                    c.id,
                                    {
                                        conclusion: "supported" as const,
                                        permittedUse: "context_only" as const,
                                        diagnostic:
                                            "Controlled contextual contribution.",
                                        needs: Object.fromEntries(
                                            c.needIds.map((needId) => [
                                                needId,
                                                "context_only" as const,
                                            ]),
                                        ),
                                    },
                                ]),
                            ),
                            objections: [],
                        },
                    },
                },
            });
            const taskId = await ctx.db.insert("aiTaskResults", {
                ...base,
                inputHash: `qualification-${i}`,
                taskType: "documentary_qualification",
                output: {
                    kind: "documentary_qualification",
                    preparationId: f.preparationId,
                    captureId,
                    contentHash: captureValue.contentHash ?? "",
                    version: 1,
                    contributions,
                    controlTaskId,
                },
            });
            data.qualifications.push(taskId);
        }
        if (targeted) {
            const taskId = data.qualifications[0];
            assert(taskId);
            const task = await ctx.db.get(taskId);
            assert(task?.output.kind === "documentary_qualification");
            const q = task.output;
            data.restrictedContributions = Array.from(
                { length: 1000 },
                (_, i) => {
                    const contribution =
                        q.contributions[i % q.contributions.length];
                    assert(contribution);
                    return {
                        qualificationTaskId: taskId,
                        contributionId: contribution.id,
                        version: contribution.version,
                        controlTaskId: q.controlTaskId,
                        permittedUse: "context_only" as const,
                    };
                },
            );
        }
        await ctx.db.patch(f.preparationId, { sourcesMission: data });
        if (needCount === 10 || large || targeted || sparse) {
            const taskId = data.qualifications[0];
            assert(taskId);
            const task = await ctx.db.get(taskId);
            assert(task?.output.kind === "documentary_qualification");
            const contribution = task.output.contributions[0];
            assert(contribution);
            const { id, version, ...content } = contribution;
            const readRequestId = await recordDocumentaryRead(ctx, {
                runId: f.runId,
                captureId: f.captureId,
                evidence: contribution.evidence,
            });
            const selectedEvidence = contribution.evidence.map((e) => ({
                readRequestId,
                passageOrder: e.passageOrder,
            }));
            const requestId = await ctx.runMutation(
                internal.execution.operations.enqueueNative,
                {
                    runId: f.runId,
                    expectedGeneration: 4,
                    cause: "handoff-capacity",
                    input: targeted
                        ? {
                              kind: "request_documentary_check",
                              needId: needs[0]?.id ?? "need-0",
                              sourceId: f.sourceId,
                              proposition: contribution.statement,
                              evidence: selectedEvidence,
                              targets: [
                                  {
                                      qualificationTaskId: taskId,
                                      contributionId: id,
                                      version,
                                  },
                              ],
                          }
                        : {
                              kind: "submit_documentary_qualification",
                              sourceId: f.sourceId,
                              captureId: f.captureId,
                              expectedTaskId: taskId,
                              changes: [
                                  {
                                      contributionId: id,
                                      expectedVersion: version,
                                      contribution: {
                                          ...content,
                                          evidence: selectedEvidence,
                                          statement: "Additional context",
                                      },
                                  },
                              ],
                          },
                },
            );
            await ctx.runMutation(internal.execution.operations.claim, {
                requestId,
                expectedGeneration: 4,
            });
            await ctx.runMutation(
                internal.execution.operations.beginScheduledExecution,
                { epoch: 1, requestId, expectedGeneration: 4 },
            );
            await expect(
                ctx.runMutation(internal.sourcesMission.reserve, {
                    epoch: 1,
                    requestId,
                    expectedGeneration: 4,
                }),
            ).rejects.toThrow(
                large || sparse
                    ? "source_review_capacity"
                    : "sources_result_capacity",
            );
            return null;
        }
        const reading = await ctx.db
            .query("agentOperationRequests")
            .withIndex("by_mission", (q) => q.eq("missionId", f.missionId))
            .first();
        assert(reading);
        const get = vi.spyOn(ctx.db, "get");
        const query = vi.spyOn(ctx.db, "query");
        const metadata = vi.spyOn(ctx.db.system, "get");
        const result = await completeSources(ctx, f.preparationId, {
            kind: "complete",
            needsRevision: 1,
            needs: needs.map((n) => ({
                needId: n.id,
                unfinished: [],
                workRequestIds: [reading._id],
            })),
        });
        expect(
            get.mock.calls.length +
                query.mock.calls.length +
                metadata.mock.calls.length,
        ).toBeLessThan(4096);
        const retained = await ctx.db.get(f.preparationId);
        assert(retained);
        expect(getDocumentSize(retained)).toBeLessThan(1_048_576);
        return result;
    });
    if (!material) return;
    expect(material.documents).toHaveLength(48);
    expect(material.needs).toHaveLength(needCount);
    for (const need of material.needs) {
        expect(need.contributions).toHaveLength(720);
        for (const reference of need.contributions)
            expect(
                material.documents.find(
                    (d) =>
                        d.qualificationTaskId === reference.qualificationTaskId,
                )?.contributions,
            ).toContainEqual({
                id: reference.contributionId,
                version: reference.version,
            });
    }
    if (needCount === 6) {
        await f.t.run(async (ctx) => {
            await ctx.db.patch(f.runId, {
                startMode: "framed",
                agentExecutionVersion: 3,
                lifecycleState: "sources_prepared",
                executionStatus: "idle",
            });
            await ctx.db.patch(f.preparationId, { status: "complete" });
        });
        await f.t
            .withIdentity({ subject: f.userId })
            .mutation(api.execution.conversations.submit, {
                runId: f.runId,
                requestKey: "inspect-prepared",
                text: "What material is available?",
                delivery: "queue",
            });
        const turn = await f.t.mutation(
            internal.execution.conversations.startTurn,
            {
                runId: f.runId,
                definitionId: "workbench_v1",
                scope: { kind: "workbench_v1" },
                simulation: false,
            },
        );
        assert(turn);
        const context = await f.t.query(internal.execution.context.build, {
            missionId: turn.missionId,
            expectedGeneration: 1,
        });
        assert(context.kind === "ready");
        const domain = JSON.parse(context.inputJson).domain;
        const status = domain.documentaryPreparation;
        expect(status.result).toMatchObject({
            outcome: "complete",
            documentCount: 48,
        });
        expect(
            new TextEncoder().encode(JSON.stringify(status)).length,
        ).toBeGreaterThan(32 * 1024);
        expect(status.controlledContributions.length).toBeGreaterThan(0);
        const material = domain.availableMaterials.find(
            (item: { sourceId: string }) => item.sourceId === f.sourceId,
        );
        const reference = material?.readingReferences[0]?.reference;
        assert(reference);
        const requestId = await f.t.mutation(
            internal.execution.operations.enqueue,
            {
                missionId: turn.missionId,
                expectedGeneration: 1,
                cause: "inspect-retained",
                input: {
                    kind: "search_available_material",
                    reference,
                    query: "workflow",
                },
            },
        );
        expect(
            await dispatchSourcesOperation(f.t, {
                requestId,
                expectedGeneration: 1,
            }),
        ).toMatchObject({ kind: "success" });
    }
}, 90_000);
