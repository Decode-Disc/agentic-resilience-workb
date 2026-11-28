import { internal } from "@convex/_generated/api";
import { extractObservedDestinations } from "@convex/integrations/evidenceNormalization";
import { afterEach, assert, expect, test, vi } from "vitest";
import { installModel } from "@/__tests__/setup/model-configuration";
import { scopedFixtureControl } from "@/__tests__/setup/model-stream";
import { beginFixtureInvocation } from "@/__tests__/setup/pi-mission";
import {
    dispatchSourcesOperation,
    prepareSourcesResult,
    recordDocumentaryRead,
    seedCapturedSources,
} from "@/__tests__/setup/sources-mission";

const examiner = vi.hoisted(() => vi.fn());
vi.mock("@convex/integrations/documentaryControl", () => ({
    examineDocumentaryContributions: examiner,
}));
afterEach(() => {
    vi.unstubAllEnvs();
    examiner.mockReset();
});

test("admission stops before control I/O while every previously admitted qualification completes under transaction limits", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "fixture-only");
    const f = await seedCapturedSources();
    await installModel(
        f.t,
        { model: "z-ai/glm-5.3-flash", reasoningEffort: "low" },
        "sources",
    );
    examiner.mockImplementation(async (input, route, dependencies) => {
        await dependencies.beforeDispatch(
            JSON.stringify({ model: route.model, fixture: true }),
            { effectiveMaxOutputTokens: route.descriptor.maxTokens },
        );
        return {
            status: "succeeded",
            model: route.model,
            latencyMs: 1,
            dispatchOutcome: "response_received",
            output: scopedFixtureControl(
                input.contributions,
                input.contributions.map((c: { id: string }) => ({
                    contributionId: c.id,
                    conclusion: "supported",
                    permittedUse: "context_only",
                    diagnostic: "Controlled context.",
                })),
            ),
        };
    });
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
        const observedDestinations = extractObservedDestinations(
            Array.from(
                { length: 64 },
                (_, i) =>
                    `<a href="https://example.com/${i}/${"a".repeat(1990)}">Guide</a>`,
            ).join("\n"),
            "https://example.com",
        );
        const documents = [];
        for (let i = 0; i < 48; i++) {
            const sourceId =
                i === 0
                    ? f.sourceId
                    : await ctx.db.insert("sources", {
                          runId: f.runId,
                          canonicalUrl: `https://example.com/${i}`,
                          title: `Document ${i}`,
                          origin: "exa",
                          category: "research_lead",
                          createdAt: 1,
                      });
            const captureId =
                i === 0
                    ? f.captureId
                    : await ctx.db.insert("sourceCaptures", {
                          ...capture,
                          sourceId,
                          captureKey: `capture-${i}`,
                          observedDestinations,
                      });
            if (i === 0)
                await ctx.db.patch(captureId, { observedDestinations });
            if (i !== 0)
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
                captureIds: documents.map((d) => d.captureId),
                envelope: {
                    ...preparation.sourcesMission.envelope,
                    controls: 48,
                },
            },
        });
        return documents;
    });
    let admitted = 0;
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
        const requestId = await f.t.mutation(
            internal.execution.operations.enqueueNative,
            {
                runId: f.runId,
                expectedGeneration: 4,
                cause: `qualify-${document.sourceId}`,
                input: {
                    kind: "submit_documentary_qualification",
                    ...document,
                    expectedTaskId: null,
                    changes: Array.from({ length: 15 }, (_, i) => ({
                        contribution: {
                            needIds: ["common-context"],
                            statement: `Publisher context ${i}`,
                            period: "undated",
                            modality: "reported",
                            attribution: "publisher",
                            kind: "context" as const,
                            evidence: Array.from({ length: 8 }, () => ({
                                readRequestId,
                                passageOrder: f.passage.order,
                            })),
                        },
                    })),
                },
            },
        );
        const callsBefore = examiner.mock.calls.length;
        const outcome = await dispatchSourcesOperation(f.t, {
            requestId,
            expectedGeneration: 4,
        });
        if (outcome.kind !== "success") {
            expect(outcome).toMatchObject({
                kind: "unavailable",
                code: "source_review_capacity",
            });
            expect(examiner).toHaveBeenCalledTimes(callsBefore);
            break;
        }
        admitted++;
    }
    expect(admitted).toBeGreaterThan(1);
    expect(admitted).toBeLessThan(48);
    expect(examiner).toHaveBeenCalledTimes(admitted);
    const preparation = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    assert(preparation?.sourcesMission);
    expect(preparation.sourcesMission.qualifications).toHaveLength(admitted);
    const invocation = await beginFixtureInvocation(f.t, {
        missionId: f.missionId,
        expectedGeneration: 4,
        taskKey: "complete-admitted-material",
        provenance: "simulation",
    });
    assert(invocation.kind === "ready");
    const preparedResult = await prepareSourcesResult(
        f.t,
        { invocationId: invocation.invocationId, expectedGeneration: 4 },
        {
            kind: "complete",
            needs: [{ needId: "common-context", unfinished: [] }],
        },
    );
    const completed = await f.t.run((ctx) =>
        ctx.runMutation(
            internal.execution.invocations.finish,
            {
                invocationId: invocation.invocationId,
                expectedGeneration: 4,
                preparedResult,
            },
            {
                transactionLimits: {
                    bytesRead: 16 * 1024 * 1024,
                    databaseQueries: 4096,
                },
            },
        ),
    );
    expect(completed.kind).toBe("completed");
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.preparationId)))?.sourcesMission
            ?.result?.documents,
    ).toHaveLength(admitted);
}, 60_000);
