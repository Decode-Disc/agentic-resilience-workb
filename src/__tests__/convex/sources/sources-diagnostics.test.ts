import { internal } from "@convex/_generated/api";
import { getAgentDefinition } from "@convex/execution/agentCatalog";
import { modelOperationOutcome } from "@convex/execution/agentDefinition";
import { afterEach, assert, expect, test, vi } from "vitest";
import {
    recordDocumentaryRead,
    seedCapturedSources,
} from "@/__tests__/setup/sources-mission";

afterEach(() => vi.unstubAllEnvs());

test.each([
    "mission",
    "native",
] as const)("%s qualification identifies the contribution missing primary-capture evidence before consuming work", async (caller) => {
    const f = await seedCapturedSources();
    const otherCaptureId = await f.t.run(async (ctx) => {
        const capture = await ctx.db.get(f.captureId);
        assert(capture);
        const { _id, _creationTime, ...fields } = capture;
        return ctx.db.insert("sourceCaptures", {
            ...fields,
            captureKey: "other",
        });
    });
    const readRequestId = await f.t.run(async (ctx) => {
        const preparation = await ctx.db.get(f.preparationId);
        assert(preparation?.sourcesMission);
        await ctx.db.patch(f.preparationId, {
            sourcesMission: {
                ...preparation.sourcesMission,
                captureIds: [
                    ...preparation.sourcesMission.captureIds,
                    otherCaptureId,
                ],
            },
        });
        return recordDocumentaryRead(ctx, {
            runId: f.runId,
            missionId: caller === "mission" ? f.missionId : undefined,
            captureId: otherCaptureId,
            evidence: [{ passageOrder: 0, quotation: "Context." }],
        });
    });
    const input = {
        kind: "submit_documentary_qualification" as const,
        sourceId: f.sourceId,
        captureId: f.captureId,
        expectedTaskId: null,
        changes: [
            {
                contribution: {
                    needIds: ["common-context"],
                    statement: "Attributed context.",
                    attribution: "Publisher",
                    period: "undated",
                    modality: "description",
                    kind: "context" as const,
                    evidence: [
                        {
                            readRequestId,
                            passageOrder: 0,
                        },
                    ],
                },
            },
        ],
    };
    const requestId =
        caller === "mission"
            ? await f.t.mutation(internal.execution.operations.enqueue, {
                  missionId: f.missionId,
                  expectedGeneration: 4,
                  cause: "diagnose",
                  input,
              })
            : await f.t.mutation(internal.execution.operations.enqueueNative, {
                  runId: f.runId,
                  expectedGeneration: 4,
                  cause: "diagnose",
                  input,
              });
    const outcome = await f.t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 4,
    });
    expect(outcome).toMatchObject({
        kind: "unavailable",
        code: "qualification_invalid",
        validation: {
            path: "changes[0].contribution.evidence",
            expected:
                "At least one exact evidence reference from the submission's primary captureId; submit contributions supported only by another capture separately.",
        },
    });
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.preparationId)))?.sourcesMission
            ?.controls,
    ).toBe(0);
    expect(
        await f.t.run((ctx) =>
            ctx.db
                .query("aiTaskResults")
                .withIndex("by_run", (q) => q.eq("runId", f.runId))
                .take(2),
        ),
    ).toEqual([]);
    expect(
        JSON.parse(
            modelOperationOutcome(getAgentDefinition("sources_v1"), outcome),
        ).validation.path,
    ).toBe("changes[0].contribution.evidence");
});
