import { internal } from "@convex/_generated/api";
import { completeSources } from "@convex/domain/sources";
import { afterEach, assert, expect, test, vi } from "vitest";
import { installModel } from "@/__tests__/setup/model-configuration";
import {
    dispatchSourcesOperation,
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

test("a fresh contextual read advances Sources once and repeats only increment the diagnostic", async () => {
    const f = await seedCapturedSources();
    for (let turn = 0; turn < 4; turn++) {
        const begun = await f.t.mutation(internal.execution.invocations.begin, {
            missionId: f.missionId,
            expectedGeneration: 4,
            taskKey: `read-${turn}`,
            provenance: "simulation",
        });
        assert(begun.kind === "ready");
        const finished = await f.t.mutation(
            internal.execution.invocations.finish,
            {
                invocationId: begun.invocationId,
                expectedGeneration: 4,
                response: {
                    kind: "operations",
                    requests: [
                        {
                            callId: `read-${turn}`,
                            name: "read_in_context",
                            inputJson: JSON.stringify({
                                sourceId: f.sourceId,
                                passageOrder: f.passage.order,
                            }),
                        },
                    ],
                },
            },
        );
        assert(finished.kind === "waiting");
        for (const requestId of finished.requestIds)
            await dispatchSourcesOperation(f.t, {
                requestId,
                expectedGeneration: 4,
            });
        await f.t.mutation(internal.execution.invocations.settle, {
            invocationId: begun.invocationId,
            expectedGeneration: 4,
        });
        const mission = await f.t.run((ctx) => ctx.db.get(f.missionId));
        expect(mission?.noProgressTurns).toBe(turn);
        expect(mission).toMatchObject({ status: "ready" });
        expect(mission?.blockCode).toBeUndefined();
    }
});

test.each([
    "prefix",
    "interior",
    "full",
    "altered",
    "joined",
    "empty",
    "corrupt-hash",
] as const)("observed selection or attempted quotation %s preserves evidence admission and handoff integrity", async (variant) => {
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
            output: {
                coherence: true,
                limitations: [],
                findings: input.contributions.map((c: { id: string }) => ({
                    contributionId: c.id,
                    conclusion: "supported",
                    permittedUse: "context_only",
                    diagnostic: "Supported excerpt.",
                })),
            },
        };
    });
    const full = f.passage.quotation;
    if (variant === "corrupt-hash")
        await f.t.run((ctx) =>
            ctx.db.patch(f.passage._id, {
                quotationHash: "corrupted-fixture-hash",
            }),
        );
    const quotation =
        variant === "full" || variant === "corrupt-hash"
            ? full
            : variant === "interior"
              ? full.slice(15, 35)
              : variant === "prefix"
                ? full.slice(0, 20)
                : variant === "empty"
                  ? ""
                  : variant === "joined"
                    ? `${full.slice(0, 10)}...${full.slice(-10)}`
                    : `${full.slice(0, 20)}[altered]`;
    const pending = f.t.mutation(internal.execution.operations.enqueue, {
        missionId: f.missionId,
        expectedGeneration: 4,
        cause: "quote-granularity",
        input: {
            kind: "submit_documentary_qualification",
            sourceId: f.sourceId,
            captureId: f.captureId,
            expectedTaskId: null,
            changes: [
                {
                    contribution: {
                        needIds: ["common-context"],
                        statement: "The publisher describes workflow software.",
                        period: "undated",
                        modality: "publisher statement",
                        attribution: "ServiceNow",
                        kind: "context",
                        evidence: [
                            {
                                readRequestId: f.readRequestId,
                                passageOrder: f.passage.order,
                                ...(variant === "full" ||
                                variant === "corrupt-hash"
                                    ? {}
                                    : { quotation }),
                            },
                        ],
                    },
                },
            ],
        },
    });
    if (variant !== "full" && variant !== "corrupt-hash") {
        await expect(pending).rejects.toThrow("Validator error");
        expect(examiner).not.toHaveBeenCalled();
        expect(
            (await f.t.run((ctx) => ctx.db.get(f.preparationId)))
                ?.sourcesMission?.controls,
        ).toBe(0);
        return;
    }
    const requestId = await pending;
    const result = await dispatchSourcesOperation(f.t, {
        requestId,
        expectedGeneration: 4,
    });
    if (variant !== "full") {
        expect(result.kind).not.toBe("success");
        expect(examiner).not.toHaveBeenCalled();
        expect(
            (await f.t.run((ctx) => ctx.db.get(f.preparationId)))
                ?.sourcesMission?.controls,
        ).toBe(0);
        return;
    }
    expect(result.kind).toBe("success");
    const preparation = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    assert(preparation?.sourcesMission);
    const workRequestIds = preparation.sourcesMission.work.map(
        (w) => w.requestId,
    );
    const handoff = await f.t.run((ctx) =>
        completeSources(ctx, f.preparationId, {
            kind: "complete",
            needsRevision: 1,
            needs: [
                {
                    needId: "common-context",
                    unfinished: [],
                    workRequestIds,
                },
            ],
        }),
    );
    expect(handoff.documents).toHaveLength(1);
    expect(handoff.documents[0]?.captureId).toBe(f.captureId);
    expect(handoff.outcome).toBe("complete");
});
