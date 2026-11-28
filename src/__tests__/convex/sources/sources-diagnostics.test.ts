import { internal } from "@convex/_generated/api";
import { getAgentDefinition } from "@convex/execution/agentCatalog";
import { modelOperationOutcome } from "@convex/execution/agentDefinition";
import { afterEach, assert, expect, test, vi } from "vitest";
import { beginFixtureInvocation } from "@/__tests__/setup/pi-mission";
import {
    dispatchSourcesOperation,
    recordDocumentaryRead,
    seedCapturedSources,
    seedObservedSources,
} from "@/__tests__/setup/sources-mission";

afterEach(() => vi.unstubAllEnvs());

test.each([
    "mission",
    "native",
] as const)("%s qualification locates the unreturned passage in a multi-contribution batch without adopting any contribution", async (caller) => {
    const f = await seedObservedSources();
    const readRequestId =
        caller === "mission" ? f.readRequestId : f.nativeReadRequestId;
    const contribution = {
        needIds: ["common-context"],
        statement: "Attributed context.",
        attribution: "Publisher",
        period: "undated",
        modality: "description",
        kind: "context" as const,
        evidence: [{ readRequestId, passageOrder: f.passage.order }],
    };
    const input = {
        kind: "submit_documentary_qualification" as const,
        sourceId: f.sourceId,
        captureId: f.captureId,
        expectedTaskId: null,
        changes: [
            { contribution },
            {
                contribution: {
                    ...contribution,
                    statement: "Another context claim.",
                    evidence: [
                        ...contribution.evidence,
                        { readRequestId, passageOrder: 999 },
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
                  cause: "diagnose-passage",
                  input,
              })
            : await f.t.mutation(internal.execution.operations.enqueueNative, {
                  runId: f.runId,
                  expectedGeneration: 4,
                  cause: "diagnose-passage",
                  input,
              });
    const outcome = await dispatchSourcesOperation(f.t, {
        requestId,
        expectedGeneration: 4,
    });
    expect(outcome).toMatchObject({
        kind: "unavailable",
        code: "documentary_quote_invalid",
        validation: {
            path: "changes[1].contribution.evidence[1].passageOrder",
            expected:
                "A passageOrder actually returned by the selected adopted readRequestId; use its returned passages or search/read again.",
        },
    });
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.preparationId)))?.sourcesMission,
    ).toMatchObject({ controls: 0, qualifications: [] });
    expect(
        JSON.parse(
            modelOperationOutcome(getAgentDefinition("sources_v1"), outcome),
        ).validation.path,
    ).toBe("changes[1].contribution.evidence[1].passageOrder");
    expect(
        await f.t.run((ctx) =>
            ctx.db
                .query("aiTaskResults")
                .withIndex("by_run", (q) => q.eq("runId", f.runId))
                .take(2),
        ),
    ).toEqual([]);
});

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
    const outcome = await dispatchSourcesOperation(f.t, {
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

test("Sources normalization refusal preserves qualification_observation_unavailable and its diagnostic", async () => {
    const f = await seedObservedSources();
    await f.t.run(async (ctx) => {
        const preparation = await ctx.db.get(f.preparationId);
        const capture = await ctx.db.get(f.captureId);
        assert(preparation?.sourcesMission && capture?.contentHash);
        const controlTaskId = await ctx.db.insert("aiTaskResults", {
            runId: f.runId,
            corpusRevisionId: preparation.corpusRevisionId,
            taskType: "documentary_control",
            schemaVersion: "1",
            adapterVersion: "1",
            inputHash: "fixture-control",
            output: {
                kind: "documentary_control",
                preparationId: f.preparationId,
                evidence: [],
                inputHash: "fixture-control",
                examination: {
                    state: "examined",
                    contractVersion: 2,
                    control: { findings: {}, objections: [] },
                },
            },
            executionMode: "showcase",
            createdAt: 1,
        });
        const qualificationTaskId = await ctx.db.insert("aiTaskResults", {
            runId: f.runId,
            corpusRevisionId: preparation.corpusRevisionId,
            taskType: "documentary_qualification",
            schemaVersion: "1",
            adapterVersion: "1",
            inputHash: "fixture-qualification",
            output: {
                kind: "documentary_qualification",
                preparationId: f.preparationId,
                captureId: f.captureId,
                contentHash: capture.contentHash,
                version: 1,
                contributions: [],
                controlTaskId,
            },
            executionMode: "showcase",
            createdAt: 1,
        });
        await ctx.db.patch(f.preparationId, {
            sourcesMission: {
                ...preparation.sourcesMission,
                qualifications: [qualificationTaskId, qualificationTaskId],
            },
        });
    });
    const begun = await beginFixtureInvocation(f.t, {
        missionId: f.missionId,
        expectedGeneration: 4,
        taskKey: "sources-normalization-refusal",
        provenance: "simulation",
    });
    assert(begun.kind === "ready");
    const finished = await f.t.mutation(internal.execution.invocations.finish, {
        invocationId: begun.invocationId,
        expectedGeneration: 4,
        response: {
            kind: "operations",
            requests: [
                {
                    callId: "ambiguous-qualification-observation",
                    name: "submit_documentary_qualification",
                    inputJson: JSON.stringify({
                        sourceId: f.sourceId,
                        captureId: f.captureId,
                        changes: [
                            {
                                contribution: {
                                    needIds: ["common-context"],
                                    statement: "Attributed context.",
                                    attribution: "Publisher",
                                    period: "undated",
                                    modality: "description",
                                    kind: "context",
                                    evidence: [
                                        {
                                            readRequestId: f.readRequestId,
                                            passageOrder: f.passage.order,
                                        },
                                    ],
                                },
                            },
                        ],
                    }),
                },
            ],
        },
    });
    const requestId = finished.requestIds[0];
    assert(requestId);
    const outcome = await dispatchSourcesOperation(f.t, {
        requestId,
        expectedGeneration: 4,
    });
    expect(outcome).toMatchObject({
        kind: "refused",
        code: "qualification_observation_unavailable",
    });
    expect(
        JSON.parse(
            modelOperationOutcome(getAgentDefinition("sources_v1"), outcome),
        ).diagnostic,
    ).toContain("qualification");
});
