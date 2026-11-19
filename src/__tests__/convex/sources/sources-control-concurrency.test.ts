import { internal } from "@convex/_generated/api";
import { completeSources } from "@convex/domain/sources";
import type { SourcesOperation } from "@convex/domain/sourcesContracts";
import { afterEach, assert, expect, test, vi } from "vitest";
import { installModel } from "@/__tests__/setup/model-configuration";
import {
    dispatchSourcesOperation,
    recordDocumentaryRead,
    seedObservedSources,
    startSourcesOperation,
} from "@/__tests__/setup/sources-mission";

const examiner = vi.hoisted(() => vi.fn());
vi.mock("@convex/integrations/documentaryControl", () => ({
    examineDocumentaryContributions: examiner,
}));
afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    examiner.mockReset();
});

test.each([
    ["qualification", "qualification"],
    ["qualification", "check"],
    ["check", "qualification"],
    ["check", "check"],
] as const)("native %s and %s share one unsettled control per preparation without spending a refused allowance", async (first, second) => {
    const f = await seedObservedSources();
    const input = (
        kind: "qualification" | "check",
        statement: string,
        readRequestId: typeof f.readRequestId,
    ): SourcesOperation => {
        const evidence = [
            {
                readRequestId,
                passageOrder: f.passage.order,
            },
        ];
        return kind === "check"
            ? {
                  kind: "request_documentary_check",
                  needId: "common-context",
                  sourceId: f.sourceId,
                  proposition: statement,
                  evidence,
              }
            : {
                  kind: "submit_documentary_qualification",
                  sourceId: f.sourceId,
                  captureId: f.captureId,
                  expectedTaskId: null,
                  changes: [
                      {
                          contribution: {
                              needIds: ["common-context"],
                              statement,
                              period: "undated",
                              modality: "reported",
                              attribution: "publisher",
                              kind: "context",
                              evidence,
                          },
                      },
                  ],
              };
    };
    const firstId = await f.t.mutation(
        internal.execution.operations.enqueueNative,
        {
            runId: f.runId,
            expectedGeneration: 4,
            cause: "first-control",
            input: input(first, "First contribution", f.nativeReadRequestId),
        },
    );
    const secondId = await f.t.mutation(internal.execution.operations.enqueue, {
        missionId: f.missionId,
        expectedGeneration: 4,
        cause: "second-control",
        input: input(second, "Second contribution", f.readRequestId),
    });
    for (const requestId of [firstId, secondId])
        await startSourcesOperation(f.t, {
            requestId,
            expectedGeneration: 4,
        });
    await f.t.mutation(internal.sourcesMission.reserve, {
        requestId: firstId,
        expectedGeneration: 4,
    });
    await expect(
        f.t.mutation(internal.sourcesMission.reserve, {
            requestId: secondId,
            expectedGeneration: 4,
        }),
    ).rejects.toThrow("documentary_control_in_progress");
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.preparationId)))?.sourcesMission
            ?.controls,
    ).toBe(1);
    await f.t.run((ctx) =>
        ctx.db.patch(firstId, {
            status: "completed",
            outcome: { kind: "unavailable", code: "missing_configuration" },
        }),
    );
    await f.t.mutation(internal.sourcesMission.reserve, {
        requestId: secondId,
        expectedGeneration: 4,
    });
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.preparationId)))?.sourcesMission
            ?.controls,
    ).toBe(2);
});

test("overlapping native qualifications cannot admit material that exceeds final handoff capacity", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.stubEnv("OPENROUTER_API_KEY", "fixture-only");
    const f = await seedObservedSources();
    await installModel(
        f.t,
        { model: "z-ai/glm-5.3-flash", reasoningEffort: "low" },
        "sources",
    );
    const needIds = Array.from(
        { length: 80 },
        (_, i) => `instruction:${String(i).padStart(32, "0")}`,
    );
    const documents = await f.t.run(async (ctx) => {
        const preparation = await ctx.db.get(f.preparationId);
        const original = await ctx.db.get(f.captureId);
        assert(preparation?.sourcesMission && original);
        const { _id, _creationTime, ...capture } = original;
        const {
            _id: _passageId,
            _creationTime: _passageTime,
            ...passage
        } = f.passage;
        const documents = [{ sourceId: f.sourceId, captureId: f.captureId }];
        for (let i = 1; i < 6; i++) {
            const sourceId = await ctx.db.insert("sources", {
                runId: f.runId,
                canonicalUrl: `https://example.com/control-${i}`,
                title: `Document ${i}`,
                origin: "exa",
                category: "research_lead",
                createdAt: 1,
            });
            const captureId = await ctx.db.insert("sourceCaptures", {
                ...capture,
                sourceId,
                captureKey: `control-${i}`,
            });
            await ctx.db.insert("sourceSearchPassages", {
                ...passage,
                sourceId,
                captureId,
            });
            documents.push({ sourceId, captureId });
        }
        await ctx.db.patch(f.preparationId, {
            sourcesMission: {
                ...preparation.sourcesMission,
                envelope: {
                    ...preparation.sourcesMission.envelope,
                    maxNeeds: 80,
                },
                needs: needIds.map((id) => ({
                    id,
                    version: 1,
                    information: "Documentary request",
                    questionIds: [],
                    commonContext: false,
                })),
                captureIds: documents.map((d) => d.captureId),
            },
        });
        return documents;
    });
    let enter: () => void = () => {};
    let release: () => void = () => {};
    let allEnter: () => void = () => {};
    const entered = new Promise<void>((resolve) => {
        enter = resolve;
    });
    const held = new Promise<void>((resolve) => {
        release = resolve;
    });
    const allEntered = new Promise<void>((resolve) => {
        allEnter = resolve;
    });
    let arrivals = 0;
    examiner.mockImplementation(async (input, route, dependencies) => {
        await dependencies.beforeDispatch(
            JSON.stringify({ model: route.model, fixture: true }),
            { effectiveMaxOutputTokens: route.descriptor.maxTokens },
        );
        enter();
        if (++arrivals === 6) allEnter();
        await held;
        return {
            status: "succeeded",
            model: route.model,
            latencyMs: 1,
            dispatchOutcome: "response_received",
            output: {
                coherence: true,
                limitations: [],
                findings: input.contributions.map((c: { id: string }) => ({
                    contributionId: c.id,
                    conclusion: "supported",
                    permittedUse: "context_only",
                    diagnostic: "Controlled context.",
                })),
            },
        };
    });
    const requestIds = [];
    for (const document of documents) {
        const readRequestId = await f.t.run((ctx) =>
            recordDocumentaryRead(ctx, {
                runId: f.runId,
                captureId: document.captureId,
                evidence: [
                    {
                        passageOrder: f.passage.order,
                        quotation: f.passage.quotation,
                    },
                ],
            }),
        );
        requestIds.push(
            await f.t.mutation(internal.execution.operations.enqueueNative, {
                runId: f.runId,
                expectedGeneration: 4,
                cause: `control-${document.sourceId}`,
                input: {
                    kind: "submit_documentary_qualification",
                    ...document,
                    expectedTaskId: null,
                    changes: Array.from({ length: 15 }, (_, i) => ({
                        contribution: {
                            needIds,
                            statement: `Context ${i}`,
                            period: "2026",
                            modality: "reported",
                            attribution: "publisher",
                            kind: "context" as const,
                            evidence: [
                                {
                                    readRequestId,
                                    passageOrder: f.passage.order,
                                },
                            ],
                        },
                    })),
                },
            }),
        );
    }
    const firstId = requestIds[0];
    assert(firstId);
    const first = dispatchSourcesOperation(f.t, {
        requestId: firstId,
        expectedGeneration: 4,
    });
    await entered;
    const remaining = Promise.all(
        requestIds.slice(1).map((requestId) =>
            dispatchSourcesOperation(f.t, {
                requestId,
                expectedGeneration: 4,
            }),
        ),
    );
    await Promise.race([remaining, allEntered]);
    release();
    const outcomes = await remaining;
    expect(await first).toMatchObject({ kind: "success" });
    expect(outcomes).toEqual(
        Array.from({ length: 5 }, () =>
            expect.objectContaining({
                kind: "unavailable",
                code: "documentary_control_in_progress",
            }),
        ),
    );
    expect(examiner).toHaveBeenCalledTimes(1);
    const material = await f.t.run((ctx) =>
        completeSources(ctx, f.preparationId, {
            kind: "complete",
            needsRevision: 1,
            needs: needIds.map((needId) => ({
                needId,
                unfinished: [],
                workRequestIds: [firstId],
            })),
        }),
    );
    expect(material.documents).toHaveLength(1);
});
