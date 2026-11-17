import { api, internal } from "@convex/_generated/api";
import { afterEach, assert, expect, test, vi } from "vitest";
import { seedCapturedSources } from "@/__tests__/setup/sources-mission";
import { workbenchAdmissionInput } from "@/__tests__/setup/workbench";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
});

const fullGap = `${"The filing describes integration mechanisms. ".repeat(8)}Customer-level switching dependency is not established by the examined material.`;
const unfinished =
    "The customer comparison could not be completed; no finding of absence follows.";

async function preparedConversation(control = false) {
    vi.useFakeTimers();
    const f = await seedCapturedSources();
    const begun = await f.t.mutation(internal.execution.invocations.begin, {
        missionId: f.missionId,
        expectedGeneration: 4,
        taskKey: "prepared-material",
        provenance: "simulation",
    });
    assert(begun.kind === "ready");
    expect(
        await f.t.mutation(internal.execution.invocations.finish, {
            invocationId: begun.invocationId,
            expectedGeneration: 4,
            response: {
                kind: "complete",
                needs: [
                    {
                        needId: "common-context",
                        gap: fullGap,
                        unfinished: [unfinished],
                        readRequestIds: [f.readRequestId],
                    },
                ],
            },
        }),
    ).toMatchObject({ kind: "completed" });
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, {
            startMode: "framed",
            agentExecutionVersion: 3,
            lifecycleState: "sources_prepared",
            executionStatus: "idle",
        }),
    );
    await f.t.run((ctx) =>
        ctx.db.patch(f.preparationId, { status: "blocked" }),
    );
    vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
    await f.t.run((ctx) =>
        ctx.db.patch(f.invitationId, { slotKey: "analyst-4" }),
    );
    const contextId = await f.t.mutation(
        internal.runWorkspace.openBrowserTestContext,
        {
            slotKey: "analyst-4",
            contextKey: "prepared-material",
            durationMs: 60_000,
        },
    );
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, {
            purpose: "browser_test",
            browserTestContextId: contextId,
        }),
    );
    const client = f.t.withIdentity({ subject: f.userId });
    await client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        requestKey: "explain-limits",
        text: "Explain the documentary limitation and what remains unfinished.",
        delivery: "queue",
    });
    if (control)
        await f.t.run((ctx) =>
            ctx.db.insert("responseControlSettings", {
                key: "global",
                revision: 1,
                updatedAt: 1,
                enabled: true,
                model: "typesafe/jev-1.14",
                contradictionThreshold: 0.95,
                supportThreshold: 0.7,
            }),
        );
    const turn = await f.t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId: f.runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: true,
        },
    );
    assert(turn);
    return { ...f, turn };
}

test("Workbench can read a full prepared need and unfinished reasons beyond the context preview", async () => {
    const f = await preparedConversation();
    const begun = await f.t.mutation(internal.execution.invocations.begin, {
        missionId: f.turn.missionId,
        expectedGeneration: 1,
        taskKey: "consult-prepared-need",
        provenance: "simulation",
        nativeInput: await workbenchAdmissionInput(f.t, f.turn.missionId),
    });
    assert(begun.kind === "ready");
    const finished = await f.t.mutation(internal.execution.invocations.finish, {
        invocationId: begun.invocationId,
        expectedGeneration: 1,
        response: {
            kind: "operations",
            requests: [
                {
                    callId: "prepared-need",
                    name: "consult_prepared_material",
                    inputJson: JSON.stringify({ needId: "common-context" }),
                },
            ],
        },
    });
    expect(finished, JSON.stringify(finished)).toMatchObject({
        kind: "waiting",
    });
    const requestId = finished.requestIds[0];
    assert(requestId);
    const outcome = await f.t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 1,
    });
    expect(outcome.kind).toBe("success");
    assert(outcome.kind === "success");
    expect(JSON.parse(outcome.valueJson)).toMatchObject({
        preparationId: f.preparationId,
        need: { id: "common-context" },
        outcome: { gap: fullGap, unfinished: [unfinished] },
        nextCapability: "investigation_unavailable",
    });
});

test.each([
    "context_only",
    "blocked",
] as const)("prepared-need reads retain %s restrictions after qualification replacement", async (permittedUse) => {
    const f = await preparedConversation();
    const restriction = await f.t.run(async (ctx) => {
        const preparation = await ctx.db.get(f.preparationId);
        const data = preparation?.sourcesMission;
        const capture = await ctx.db.get(f.captureId);
        assert(data?.result && capture?.contentHash);
        const base = {
            runId: f.runId,
            corpusRevisionId: f.corpusRevisionId,
            executionMode: "showcase" as const,
            schemaVersion: "fixture-v1",
            adapterVersion: "fixture-v1",
            inputHash: "retained-restrictions",
            createdAt: Date.now(),
        };
        const controlTaskId = await ctx.db.insert("aiTaskResults", {
            ...base,
            taskType: "documentary_control",
            output: {
                kind: "documentary_control",
                preparationId: f.preparationId,
                evidence: [],
                inputHash: base.inputHash,
                control: { coherence: true, limitations: [], findings: [] },
            },
        });
        const contribution = {
            id: "retained-context",
            version: 1,
            needIds: ["common-context"],
            statement: "Retained illustrative context.",
            period: "2026",
            modality: "description",
            attribution: "Fixture",
            kind: "context" as const,
            evidence: [
                {
                    captureId: f.captureId,
                    passageOrder: f.passage.order,
                    quotation: f.passage.quotation,
                },
            ],
        };
        const output = {
            kind: "documentary_qualification" as const,
            preparationId: f.preparationId,
            captureId: f.captureId,
            contentHash: capture.contentHash,
            version: 1,
            contributions: [contribution],
            controlTaskId,
        };
        const previousTaskId = await ctx.db.insert("aiTaskResults", {
            ...base,
            taskType: "documentary_qualification",
            output,
        });
        const currentTaskId = await ctx.db.insert("aiTaskResults", {
            ...base,
            taskType: "documentary_qualification",
            output: {
                ...output,
                version: 2,
                previousTaskId,
                contributions: [
                    contribution,
                    {
                        ...contribution,
                        id: "other-context",
                        needIds: ["another-need"],
                    },
                ],
            },
        });
        const retained = {
            qualificationTaskId: previousTaskId,
            contributionId: contribution.id,
            version: 1,
            controlTaskId,
            permittedUse,
        };
        const references =
            permittedUse === "blocked"
                ? []
                : [
                      {
                          qualificationTaskId: currentTaskId,
                          contributionId: contribution.id,
                          version: 1,
                      },
                  ];
        await ctx.db.patch(f.preparationId, {
            sourcesMission: {
                ...data,
                qualifications: [currentTaskId],
                restrictedContributions: [
                    retained,
                    { ...retained, contributionId: "other-context" },
                    { ...retained, version: 2 },
                ],
                result: {
                    ...data.result,
                    documents:
                        permittedUse === "blocked"
                            ? []
                            : [
                                  {
                                      sourceId: f.sourceId,
                                      captureId: f.captureId,
                                      contentHash: capture.contentHash,
                                      qualificationTaskId: currentTaskId,
                                      qualificationVersion: 2,
                                      contributions: [
                                          { id: contribution.id, version: 1 },
                                      ],
                                  },
                              ],
                    needs: data.result.needs.map((need) => ({
                        ...need,
                        contributions: references,
                    })),
                },
            },
        });
        return retained;
    });
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.turn.missionId,
            expectedGeneration: 1,
            cause: "read-effective-restrictions",
            input: {
                kind: "consult_prepared_material",
                needId: "common-context",
            },
        },
    );
    const result = await f.t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 1,
    });
    assert(result.kind === "success");
    expect(JSON.parse(result.valueJson).restrictions).toEqual([restriction]);
});

test("response review receives the exact prepared limitation already consulted by Workbench", async () => {
    const f = await preparedConversation(true);
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.turn.missionId,
            expectedGeneration: 1,
            cause: "read-limitation",
            input: {
                kind: "consult_prepared_material",
                needId: "common-context",
            },
        },
    );
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 1,
        }),
    ).toMatchObject({ kind: "success" });
    const begun = await f.t.mutation(internal.execution.invocations.begin, {
        missionId: f.turn.missionId,
        expectedGeneration: 1,
        taskKey: "explain-prepared-limit",
        provenance: "simulation",
        nativeInput: await workbenchAdmissionInput(f.t, f.turn.missionId),
    });
    assert(begun.kind === "ready");
    expect(
        await f.t.mutation(internal.execution.invocations.finish, {
            invocationId: begun.invocationId,
            expectedGeneration: 1,
            response: {
                kind: "complete",
                text: "The examined material does not establish customer dependency; the comparison remains unfinished.",
            },
        }),
    ).toMatchObject({ kind: "blocked", code: "pending_operations" });
    const turn = await f.t.run((ctx) => ctx.db.get(f.turn.turnId));
    const check = turn?.responseControl?.checks[0];
    assert(check);
    expect(check.factsJson).toContain(fullGap);
    expect(check.factsJson).toContain(unfinished);
});

test("a changed documentary limitation invalidates Workbench facts even when its preview is identical", async () => {
    const f = await preparedConversation();
    const context = async () => {
        const built = await f.t.query(internal.execution.context.build, {
            missionId: f.turn.missionId,
            expectedGeneration: 1,
        });
        assert(built.kind === "ready");
        return JSON.parse(built.inputJson).domain;
    };
    const before = await context();
    await f.t.run(async (ctx) => {
        const preparation = await ctx.db.get(f.preparationId);
        assert(preparation?.sourcesMission?.result);
        const data = preparation.sourcesMission;
        const result = data.result;
        assert(result);
        await ctx.db.patch(preparation._id, {
            sourcesMission: {
                ...data,
                result: {
                    ...result,
                    needs: result.needs.map((need) => ({
                        ...need,
                        gap: `${fullGap} A newly identified limitation affects the proposed use.`,
                    })),
                },
            },
        });
    });
    const after = await context();
    expect(after.documentaryPreparation.needs[0].gapPreview).toBe(
        before.documentaryPreparation.needs[0].gapPreview,
    );
    expect(after.factsRevisionHash).not.toBe(before.factsRevisionHash);
});

test("workspace and Workbench context expose the completed Sources mission independently of its limited result", async () => {
    const f = await preparedConversation();
    const snapshot = await f.t
        .withIdentity({ subject: f.userId })
        .query(api.workbench.snapshot, { runId: f.runId });
    expect(snapshot.preparation).toMatchObject({
        missionStatus: "completed",
        status: "blocked",
    });
    const context = await f.t.query(internal.execution.context.build, {
        missionId: f.turn.missionId,
        expectedGeneration: 1,
    });
    assert(context.kind === "ready");
    expect(
        JSON.parse(context.inputJson).domain.documentaryPreparation,
    ).toMatchObject({ executionStop: null, result: { outcome: "blocked" } });
});

test.each([
    "unknown-need",
    "capacity",
    "changed-result",
    "revoked-owner",
    "stale-generation",
] as const)("prepared-material consultation refuses %s without returning a partial or foreign result", async (variant) => {
    const f = await preparedConversation();
    if (variant === "capacity")
        await f.t.run(async (ctx) => {
            const preparation = await ctx.db.get(f.preparationId);
            assert(preparation?.sourcesMission?.result);
            const data = preparation.sourcesMission;
            const result = data.result;
            assert(result);
            await ctx.db.patch(preparation._id, {
                sourcesMission: {
                    ...data,
                    result: {
                        ...result,
                        needs: result.needs.map((need) => ({
                            ...need,
                            gap: "x".repeat(65_536),
                        })),
                    },
                },
            });
        });
    const enqueue = () =>
        f.t.mutation(internal.execution.operations.enqueue, {
            missionId: f.turn.missionId,
            expectedGeneration: variant === "stale-generation" ? 0 : 1,
            cause: `prepared-${variant}`,
            input: {
                kind: "consult_prepared_material",
                needId:
                    variant === "unknown-need"
                        ? "unobserved"
                        : "common-context",
            },
        });
    if (variant === "stale-generation") {
        await expect(enqueue()).rejects.toThrow("stale_execution");
        return;
    }
    const requestId = await enqueue();
    if (variant === "revoked-owner")
        await f.t.run((ctx) =>
            ctx.db.patch(f.visitorId, { status: "revoked" }),
        );
    if (variant === "changed-result")
        await f.t.run(async (ctx) => {
            const preparation = await ctx.db.get(f.preparationId);
            assert(preparation?.sourcesMission?.result);
            const data = preparation.sourcesMission;
            const result = data.result;
            assert(result);
            await ctx.db.patch(preparation._id, {
                sourcesMission: {
                    ...data,
                    result: {
                        ...result,
                        needs: result.needs.map((need) => ({
                            ...need,
                            gap: "A changed result.",
                        })),
                    },
                },
            });
        });
    const outcome = await f.t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 1,
    });
    expect(outcome).toMatchObject({
        kind: "refused",
        code: {
            "unknown-need": "documentary_need_unavailable",
            capacity: "operation_result_capacity",
            "changed-result": "version_conflict",
            "revoked-owner": "not_authorized",
        }[variant],
    });
});
