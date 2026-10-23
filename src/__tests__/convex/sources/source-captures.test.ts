import { api, internal } from "@convex/_generated/api";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { seedSourcePreparation } from "@/__tests__/setup/source-preparation";

const { lookupMock } = vi.hoisted(() => ({
    lookupMock: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));

vi.mock("node:dns/promises", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:dns/promises")>();
    return {
        ...actual,
        default: { ...actual, lookup: lookupMock },
        lookup: lookupMock,
    };
});

beforeEach(() => {
    lookupMock
        .mockReset()
        .mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
});

test("claims one preparation for active discovery without accepting the corpus", async () => {
    const { t, runId, corpusRevisionId } = await seedSourcePreparation();
    const args = { runId, corpusRevisionId, expectedExecutionGeneration: 3 };
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        args,
    );
    expect(
        await t.mutation(internal.sourcePreparation.claimForDiscovery, args),
    ).toBe(preparationId);
    const state = await t.run(async (ctx) => ({
        preparation: await ctx.db.get(preparationId),
        revision: await ctx.db.get(corpusRevisionId),
        sourceVersions: await ctx.db
            .query("sourceVersions")
            .withIndex("by_run", (q) => q.eq("runId", runId))
            .take(2),
    }));
    expect(state.preparation).toMatchObject({
        kind: "preparation",
        status: "started",
        executionGeneration: 3,
    });
    expect(state.revision?.status).toBe("draft");
    expect(state.sourceVersions).toHaveLength(0);
});

test("captures public candidate bytes once without an accepted decision or analytical passages", async () => {
    const { t, runId, corpusRevisionId, sourceId } =
        await seedSourcePreparation();
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        {
            runId,
            corpusRevisionId,
            expectedExecutionGeneration: 3,
        },
    );
    vi.stubEnv("EXA_API_KEY", "test-exa-key");
    const fetch = vi.fn(
        async () =>
            new Response(
                JSON.stringify({
                    results: [
                        {
                            id: "exa-capture",
                            url: "https://www.servicenow.com/products/workflows.html",
                            text: "ServiceNow provides workflow software.",
                        },
                    ],
                }),
                { headers: { "Content-Type": "application/json" } },
            ),
    );
    vi.stubGlobal("fetch", fetch);
    const result = await t.action(
        internal.sourcePreparationActions.inspectSource,
        { preparationId, sourceId },
    );
    expect(result.status).toBe("complete");
    expect(result.sourceCaptureId).toBeDefined();
    const repeated = await t.action(
        internal.sourcePreparationActions.inspectSource,
        { preparationId, sourceId },
    );
    expect(repeated.sourceCaptureId).toBe(result.sourceCaptureId);
    expect(fetch).toHaveBeenCalledTimes(1);
    const state = await t.run(async (ctx) => ({
        capture: result.sourceCaptureId
            ? await ctx.db.get(result.sourceCaptureId)
            : null,
        versions: await ctx.db
            .query("sourceVersions")
            .withIndex("by_run", (q) => q.eq("runId", runId))
            .take(2),
        passages: await ctx.db.query("sourcePassages").take(2),
        revision: await ctx.db.get(corpusRevisionId),
    }));
    expect(state.capture).toMatchObject({
        status: "committed",
        readingCompleteness: "complete",
    });
    expect(state.versions).toHaveLength(0);
    expect(state.passages).toHaveLength(0);
    expect(state.revision?.status).toBe("draft");
});

test.each([
    "cancelled",
    "rejected",
    "revoked",
] as const)("does no retrieval when preparation is %s", async (condition) => {
    const { t, runId, corpusRevisionId, sourceId, userId, visitorId } =
        await seedSourcePreparation();
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        {
            runId,
            corpusRevisionId,
            expectedExecutionGeneration: 3,
        },
    );
    if (condition === "rejected") {
        await t
            .withIdentity({ subject: `${userId}|test` })
            .mutation(api.sources.decide, {
                runId,
                corpusRevisionId,
                sourceId,
                decision: "rejected",
                decisionKey: "reject-before-inspection",
            });
    } else {
        await t.run(async (ctx) => {
            if (condition === "cancelled")
                await ctx.db.patch(runId, {
                    executionStatus: "cancelled",
                    executionGeneration: 4,
                });
            else await ctx.db.patch(visitorId, { status: "revoked" });
        });
    }
    vi.stubEnv("EXA_API_KEY", "test-exa-key");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(
        await t.action(internal.sourcePreparationActions.inspectSource, {
            preparationId,
            sourceId,
        }),
    ).toMatchObject({
        status: "unavailable",
        reasonCode:
            condition === "rejected" ? "source_rejected" : "stale_execution",
    });
    expect(fetch).not.toHaveBeenCalled();
});

test("reports missing retrieval configuration without a provider request", async () => {
    const { t, runId, corpusRevisionId, sourceId } =
        await seedSourcePreparation();
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        {
            runId,
            corpusRevisionId,
            expectedExecutionGeneration: 3,
        },
    );
    vi.stubEnv("EXA_API_KEY", undefined);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(
        await t.action(internal.sourcePreparationActions.inspectSource, {
            preparationId,
            sourceId,
        }),
    ).toMatchObject({
        status: "unavailable",
        reasonCode: "missing_configuration",
    });
    expect(fetch).not.toHaveBeenCalled();
});

test("artifact cleanup retains an inspected capture after the orphan safety window", async () => {
    const { t, runId, corpusRevisionId, sourceId } =
        await seedSourcePreparation();
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        {
            runId,
            corpusRevisionId,
            expectedExecutionGeneration: 3,
        },
    );
    vi.stubEnv("EXA_API_KEY", "test-exa-key");
    vi.stubGlobal(
        "fetch",
        vi.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        results: [
                            {
                                id: "exa-cleanup",
                                url: "https://www.servicenow.com/products/workflows.html",
                                text: "ServiceNow provides workflow software.",
                            },
                        ],
                    }),
                    { headers: { "Content-Type": "application/json" } },
                ),
        ),
    );
    const result = await t.action(
        internal.sourcePreparationActions.inspectSource,
        { preparationId, sourceId },
    );
    const capture = await t.run(async (ctx) =>
        result.sourceCaptureId ? ctx.db.get(result.sourceCaptureId) : null,
    );
    if (!capture?.storageId)
        throw new Error("Expected committed capture storage");
    const storageId = capture.storageId;
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000);
    await t.mutation(internal.evidenceArtifacts.reconcileArtifactStorage, {});
    expect(
        await t.run(async (ctx) => ctx.db.system.get(storageId)),
    ).not.toBeNull();
});

test("late retrieval cannot commit after its execution generation is cancelled", async () => {
    const { t, runId, corpusRevisionId, sourceId } =
        await seedSourcePreparation();
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        {
            runId,
            corpusRevisionId,
            expectedExecutionGeneration: 3,
        },
    );
    vi.stubEnv("EXA_API_KEY", "test-exa-key");
    const fetch = vi.fn(async () => {
        await t.run(async (ctx) =>
            ctx.db.patch(runId, {
                executionStatus: "cancelled",
                executionGeneration: 4,
            }),
        );
        return new Response(
            JSON.stringify({
                results: [
                    {
                        id: "late",
                        url: "https://www.servicenow.com/products/workflows.html",
                        text: "ServiceNow provides workflow software.",
                    },
                ],
            }),
        );
    });
    vi.stubGlobal("fetch", fetch);
    expect(
        await t.action(internal.sourcePreparationActions.inspectSource, {
            preparationId,
            sourceId,
        }),
    ).toMatchObject({ status: "unavailable", reasonCode: "stale_execution" });
    const captures = await t.run(async (ctx) =>
        ctx.db
            .query("sourceCaptures")
            .withIndex("by_preparation_and_source", (q) =>
                q.eq("preparationId", preparationId),
            )
            .take(2),
    );
    expect(captures).toHaveLength(1);
    expect(captures[0]?.status).toBe("unavailable");
    expect(captures[0]?.storageId).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
});

test("an expired provider attempt is recorded as unknown and never dispatched again", async () => {
    const { t, runId, corpusRevisionId, sourceId } =
        await seedSourcePreparation();
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        {
            runId,
            corpusRevisionId,
            expectedExecutionGeneration: 3,
        },
    );
    const attempt = {
        runId,
        corpusRevisionId,
        sourceId,
        preparationId,
        executionGeneration: 3,
        workflowVersion: 1,
        stepKey: "source_preparation",
        service: "exa" as const,
        operation: "get_contents",
        operationKey: "expired-source-preparation-attempt",
        status: "started" as const,
        attempt: 1,
    };
    const started = await t.mutation(
        internal.providerCalls.recordAttempt,
        attempt,
    );
    expect(started.shouldExecute).toBe(true);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 151000);
    const duplicate = await t.mutation(
        internal.providerCalls.recordAttempt,
        attempt,
    );
    expect(duplicate.shouldExecute).toBe(false);
    expect(
        await t.run(async (ctx) => ctx.db.get(started.providerCallId)),
    ).toMatchObject({
        status: "failed",
        errorCode: "attempt_outcome_unknown",
        retryable: false,
    });
});

test("rejects a non-public candidate URL before contacting the retrieval provider", async () => {
    const { t, runId, corpusRevisionId, sourceId } =
        await seedSourcePreparation();
    await t.run(async (ctx) =>
        ctx.db.patch(sourceId, { canonicalUrl: "https://127.0.0.1/private" }),
    );
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        {
            runId,
            corpusRevisionId,
            expectedExecutionGeneration: 3,
        },
    );
    vi.stubEnv("EXA_API_KEY", "test-exa-key");
    const fetch = vi.fn(
        async () =>
            new Response(
                JSON.stringify({
                    results: [
                        {
                            id: "private",
                            url: "https://127.0.0.1/private",
                            text: "ServiceNow provides workflow software.",
                        },
                    ],
                }),
            ),
    );
    vi.stubGlobal("fetch", fetch);
    expect(
        await t.action(internal.sourcePreparationActions.inspectSource, {
            preparationId,
            sourceId,
        }),
    ).toMatchObject({
        status: "unavailable",
        reasonCode: "source_url_not_public",
    });
    expect(fetch).not.toHaveBeenCalled();
});

test("keeps a provider-truncated capture partial even when cleanup leaves a short document", async () => {
    const { t, runId, corpusRevisionId, sourceId } =
        await seedSourcePreparation();
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        {
            runId,
            corpusRevisionId,
            expectedExecutionGeneration: 3,
        },
    );
    const prefix = "![chart](data:image/png;base64,";
    const suffix = ")\n\nServiceNow provides workflow software.\n\n";
    const text =
        prefix + "A".repeat(1_000_000 - prefix.length - suffix.length) + suffix;
    vi.stubEnv("EXA_API_KEY", "test-exa-key");
    vi.stubGlobal(
        "fetch",
        vi.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        results: [
                            {
                                id: "bounded",
                                url: "https://www.servicenow.com/products/workflows.html",
                                text,
                            },
                        ],
                    }),
                ),
        ),
    );
    expect(
        await t.action(internal.sourcePreparationActions.inspectSource, {
            preparationId,
            sourceId,
        }),
    ).toMatchObject({ status: "partial" });
});

test("reconciles abandoned capture uploads after the safety window", async () => {
    const { t, runId, corpusRevisionId, sourceId } =
        await seedSourcePreparation();
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        {
            runId,
            corpusRevisionId,
            expectedExecutionGeneration: 3,
        },
    );
    const reservation = await t.mutation(
        internal.sourceCaptures.reserveUpload,
        { preparationId, sourceId },
    );
    const storageId = await t.run((ctx) =>
        ctx.storage.store(new Blob(["abandoned capture"])),
    );
    await t.mutation(internal.sourceCaptures.attachStorage, {
        preparationId,
        captureId: reservation.capture._id,
        storageId,
    });
    await t.mutation(internal.sourceCaptures.markUnavailable, {
        preparationId,
        captureId: reservation.capture._id,
        failureCode: "stale_execution",
    });
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000);
    await t.mutation(internal.evidenceArtifacts.reconcileArtifactStorage, {});
    expect(await t.run((ctx) => ctx.db.system.get(storageId))).toBeNull();
    expect(
        await t.run((ctx) => ctx.db.get(reservation.capture._id)),
    ).toMatchObject({ status: "reconciled" });
});

test("paid-work disablement blocks candidate retrieval before the provider request", async () => {
    const { t, runId, corpusRevisionId, sourceId } =
        await seedSourcePreparation();
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        {
            runId,
            corpusRevisionId,
            expectedExecutionGeneration: 3,
        },
    );
    await t.run((ctx) =>
        ctx.db.insert("paidWorkControls", {
            key: "global",
            enabled: false,
            updatedAt: 1,
        }),
    );
    vi.stubEnv("EXA_API_KEY", "test-exa-key");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(
        await t.action(internal.sourcePreparationActions.inspectSource, {
            preparationId,
            sourceId,
        }),
    ).toMatchObject({
        status: "unavailable",
        reasonCode: "paid_work_disabled",
    });
    expect(fetch).not.toHaveBeenCalled();
});

test("a stalled DNS lookup ends preparation for that source without a provider request", async () => {
    const { t, runId, corpusRevisionId, sourceId } =
        await seedSourcePreparation();
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        {
            runId,
            corpusRevisionId,
            expectedExecutionGeneration: 3,
        },
    );
    vi.stubEnv("EXA_API_KEY", "test-exa-key");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    lookupMock.mockImplementationOnce(() => new Promise(() => {}));
    vi.useFakeTimers();
    let outcome: unknown;
    const inspection = t
        .action(internal.sourcePreparationActions.inspectSource, {
            preparationId,
            sourceId,
        })
        .then((result) => {
            outcome = result;
        });
    await vi.waitFor(() => expect(lookupMock).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(10_001);
    expect(outcome).toMatchObject({
        status: "unavailable",
        reasonCode: "source_url_unavailable",
    });
    expect(fetch).not.toHaveBeenCalled();
    await inspection;
});

test("a new generation cannot repeat an unfinished retrieval of the same logical document", async () => {
    const { t, runId, corpusRevisionId, sourceId } =
        await seedSourcePreparation();
    const first = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        { runId, corpusRevisionId, expectedExecutionGeneration: 3 },
    );
    await t.mutation(internal.sourceCaptures.reserveUpload, {
        preparationId: first,
        sourceId,
    });
    await t.run((ctx) =>
        ctx.db.patch(runId, {
            executionGeneration: 4,
            sourcePreparationId: undefined,
        }),
    );
    const next = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        { runId, corpusRevisionId, expectedExecutionGeneration: 4 },
    );
    vi.stubEnv("EXA_API_KEY", "test-exa-key");
    const fetch = vi.fn(() => {
        throw new Error("Unexpected repeated retrieval");
    });
    vi.stubGlobal("fetch", fetch);
    const result = await t.action(
        internal.sourcePreparationActions.inspectSource,
        { preparationId: next, sourceId },
    );
    expect(result).toMatchObject({
        status: "unavailable",
        reasonCode: "attempt_outcome_unknown",
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(
        await t.run((ctx) => ctx.db.query("sourceCaptures").collect()),
    ).toHaveLength(1);
});

test("a new generation can inspect a document previously blocked before provider configuration", async () => {
    const { t, runId, corpusRevisionId, sourceId } =
        await seedSourcePreparation();
    const first = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        { runId, corpusRevisionId, expectedExecutionGeneration: 3 },
    );
    vi.stubEnv("EXA_API_KEY", "");
    expect(
        await t.action(internal.sourcePreparationActions.inspectSource, {
            preparationId: first,
            sourceId,
        }),
    ).toMatchObject({
        status: "unavailable",
        reasonCode: "missing_configuration",
    });
    await t.run((ctx) =>
        ctx.db.patch(runId, {
            executionGeneration: 4,
            sourcePreparationId: undefined,
        }),
    );
    const next = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        { runId, corpusRevisionId, expectedExecutionGeneration: 4 },
    );
    vi.stubEnv("EXA_API_KEY", "test-exa-key");
    const fetch = vi.fn(
        async () =>
            new Response(
                JSON.stringify({
                    results: [
                        {
                            id: "configured-capture",
                            url: "https://www.servicenow.com/products/workflows.html",
                            text: "ServiceNow provides workflow software.",
                        },
                    ],
                }),
                { headers: { "Content-Type": "application/json" } },
            ),
    );
    vi.stubGlobal("fetch", fetch);
    expect(
        await t.action(internal.sourcePreparationActions.inspectSource, {
            preparationId: next,
            sourceId,
        }),
    ).toMatchObject({ status: "complete" });
    expect(fetch).toHaveBeenCalledTimes(1);
});
