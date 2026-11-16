import { internal } from "@convex/_generated/api";
import { SOURCE_QUALIFICATION_VERSION } from "@convex/domain/sourceQualification";
import { initializeSources } from "@convex/domain/sources";
import { executionFailureCode } from "@convex/execution/errors";
import { afterEach, expect, test, vi } from "vitest";
import { seedSourcePreparation } from "@/__tests__/setup/source-preparation";
import { sourcesTestEnvelope } from "@/__tests__/setup/sources-mission";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
});

test("Sources does not start without a configured window", async () => {
    vi.useFakeTimers();
    const { t, runId, corpusRevisionId } = await seedSourcePreparation();
    await t.run((ctx) =>
        ctx.db.patch(runId, {
            sourcesProtocol: "sources_mission_v1",
            startMode: "framed",
        }),
    );
    vi.stubEnv("SOURCES_PREPARATION_WINDOW_MINUTES", "");
    const error = await t
        .mutation(internal.sourcePreparation.claimForDiscovery, {
            runId,
            corpusRevisionId,
            expectedExecutionGeneration: 3,
        })
        .catch((caught: unknown) => caught);
    expect(executionFailureCode(error)).toBe(
        "sources_configuration_unavailable",
    );
});

test("a new preparation takes the configured window", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-11-16T10:00:00Z").getTime();
    vi.setSystemTime(now);
    const { t, runId, corpusRevisionId } = await seedSourcePreparation();
    await t.run((ctx) =>
        ctx.db.patch(runId, {
            sourcesProtocol: "sources_mission_v1",
            startMode: "framed",
        }),
    );
    vi.stubEnv("SOURCES_PREPARATION_WINDOW_MINUTES", "30");
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        {
            runId,
            corpusRevisionId,
            expectedExecutionGeneration: 3,
        },
    );
    const preparation = await t.run((ctx) => ctx.db.get(preparationId));
    expect(preparation?.deadlineAt).toBe(now + 30 * 60_000);
});

test("a research mission deadline follows its preparation, not a fixed fifteen minutes", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-11-16T10:00:00Z").getTime();
    vi.setSystemTime(now);
    const { t, runId, corpusRevisionId } = await seedSourcePreparation();
    const deadlineAt = now + 40 * 60_000;
    const preparationId = await t.run(async (ctx) => {
        const id = await ctx.db.insert("sourceSelectionProposalRebuilds", {
            runId,
            corpusRevisionId,
            kind: "preparation",
            resourcePolicy: "authority_native_v1",
            entryPoint: "initial_discovery",
            workflowVersion: 1,
            executionGeneration: 3,
            policyVersion: SOURCE_QUALIFICATION_VERSION,
            qualificationVersion: SOURCE_QUALIFICATION_VERSION,
            executionPlanVersion: "source_actions_v4",
            comparisonVersion: "source-comparison-v1",
            operationKey: `window-test:${runId}`,
            cycle: 1,
            status: "started",
            failedDiscoveryFamilies: [],
            progress: { phase: "reading", updatedAt: now },
            deadlineAt,
            leaseExpiresAt: deadlineAt,
            asOfTime: now,
            modelAttemptCount: 0,
            modelLimits: { work: 120, incidents: 40 },
            maxConcurrentSources: 2,
            createdAt: now,
        });
        const frameId = await ctx.db.insert("framingRevisions", {
            runId,
            revision: 1,
            content: { scope: "Fixed workflow", questions: [] },
            requestKey: "fixed",
            contentHash: "fixture",
            origin: "analyst",
            createdAt: 1,
        });
        await ctx.db.patch(runId, {
            sourcesProtocol: "sources_mission_v1",
            startMode: "framed",
            fixedFramingRevisionId: frameId,
            sourcePreparationId: id,
        });
        const data = await initializeSources(ctx, id, sourcesTestEnvelope);
        await ctx.db.patch(id, { sourcesMission: data });
        return id;
    });
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId,
        expectedGeneration: 3,
        definitionId: "sources_v1",
        scope: { kind: "sources_v1", preparationId },
        requestKey: "sources-window-test",
    });
    const mission = await t.run((ctx) => ctx.db.get(missionId));
    expect(mission?.deadlineAt).toBe(deadlineAt);
});
