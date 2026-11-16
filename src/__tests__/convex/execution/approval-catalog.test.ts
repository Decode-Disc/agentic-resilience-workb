import { approvalCatalog } from "@convex/execution/approvalCatalog";
import type { ApprovalAction } from "@convex/execution/approvalContracts";
import { executionFailureCode } from "@convex/execution/errors";
import { afterEach, assert, expect, test, vi } from "vitest";
import { seedCapturedSources } from "@/__tests__/setup/sources-mission";
import {
    reachTimeLimit,
    seedExpiredPreparation,
} from "@/__tests__/setup/sources-time-limit";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
});

const ALL_ACTIONS: readonly ApprovalAction[] = [
    "pause_research",
    "resume_research",
    "continue_sources_preparation",
    "settle_sources_preparation",
];

test("approval catalogue defines mutual exclusions only between continue and settle", () => {
    expect(Object.keys(approvalCatalog).sort()).toEqual(
        [...ALL_ACTIONS].sort(),
    );
    expect(approvalCatalog.pause_research.exclusiveWith).toEqual([]);
    expect(approvalCatalog.resume_research.exclusiveWith).toEqual([]);
    expect(approvalCatalog.continue_sources_preparation.exclusiveWith).toEqual([
        "settle_sources_preparation",
    ]);
    expect(approvalCatalog.settle_sources_preparation.exclusiveWith).toEqual([
        "continue_sources_preparation",
    ]);
});

test("only continue and settle are available at a Sources time limit with remaining capacity", async () => {
    const f = await seedExpiredPreparation();
    await reachTimeLimit(f);

    await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        assert(run);
        expect(
            await approvalCatalog.pause_research.availability(ctx, run),
        ).toBe("human_prerequisite_required");
        expect(
            await approvalCatalog.resume_research.availability(ctx, run),
        ).toBe("sources_time_limit_decision");
        expect(
            await approvalCatalog.continue_sources_preparation.availability(
                ctx,
                run,
            ),
        ).toBeNull();
        expect(
            await approvalCatalog.settle_sources_preparation.availability(
                ctx,
                run,
            ),
        ).toBeNull();

        await approvalCatalog.continue_sources_preparation.apply(ctx, {
            run,
            actor: { type: "visitor", visitorId: f.visitorId },
        });
    });

    const resumed = await f.t.run((ctx) => ctx.db.get(f.runId));
    expect(resumed).toMatchObject({
        executionStatus: "running",
        executionGeneration: 6,
    });
    expect(resumed?.pauseReason).toBeUndefined();
});

test("pause and resume apply through the catalogue in normal execution", async () => {
    vi.useFakeTimers();
    const f = await seedCapturedSources();
    await f.t.run(async (ctx) => {
        const frameId = await ctx.db.insert("framingRevisions", {
            runId: f.runId,
            revision: 1,
            content: { scope: "Fixed workflow", questions: [] },
            requestKey: "fixed",
            contentHash: "fixture",
            origin: "analyst",
            createdAt: 1,
        });
        await ctx.db.patch(f.runId, {
            startMode: "framed",
            agentExecutionVersion: 3,
            fixedFramingRevisionId: frameId,
        });
    });

    await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        assert(run);
        expect(
            await approvalCatalog.pause_research.availability(ctx, run),
        ).toBeNull();
        expect(
            await approvalCatalog.resume_research.availability(ctx, run),
        ).toBe("human_prerequisite_required");
        expect(
            await approvalCatalog.continue_sources_preparation.availability(
                ctx,
                run,
            ),
        ).toBe("human_prerequisite_required");
        expect(
            await approvalCatalog.settle_sources_preparation.availability(
                ctx,
                run,
            ),
        ).toBe("stale_execution");

        await approvalCatalog.pause_research.apply(ctx, {
            run,
            actor: { type: "visitor", visitorId: f.visitorId },
        });
    });

    await f.t.run(async (ctx) => {
        await ctx.db.patch(f.runId, {
            executionStatus: "paused",
            pauseReason: "analyst",
            researchPauseRequested: false,
            executionGeneration: 5,
        });
        const pausedRun = await ctx.db.get(f.runId);
        assert(pausedRun);
        expect(
            await approvalCatalog.resume_research.availability(ctx, pausedRun),
        ).toBeNull();
        expect(
            await approvalCatalog.continue_sources_preparation.availability(
                ctx,
                pausedRun,
            ),
        ).toBe("human_prerequisite_required");
        expect(
            await approvalCatalog.settle_sources_preparation.availability(
                ctx,
                pausedRun,
            ),
        ).toBe("stale_execution");

        await approvalCatalog.resume_research.apply(ctx, {
            run: pausedRun,
            actor: { type: "visitor", visitorId: f.visitorId },
        });
    });

    const resumed = await f.t.run((ctx) => ctx.db.get(f.runId));
    expect(resumed).toMatchObject({
        executionStatus: "running",
        executionGeneration: 6,
    });
});

test("exhausted capacity refuses continue while settle stays available", async () => {
    const f = await seedExpiredPreparation();
    await reachTimeLimit(f);

    await f.t.run(async (ctx) => {
        const preparation = await ctx.db.get(f.preparationId);
        assert(preparation?.sourcesMission);
        const { envelope } = preparation.sourcesMission;
        await ctx.db.patch(f.preparationId, {
            sourcesMission: {
                ...preparation.sourcesMission,
                searches: envelope.initialSearches,
                acquisitions: envelope.acquisitions,
                controls: envelope.controls,
            },
        });

        const run = await ctx.db.get(f.runId);
        assert(run);
        expect(
            await approvalCatalog.continue_sources_preparation.availability(
                ctx,
                run,
            ),
        ).toBe("sources_capacity_exhausted");
        expect(
            await approvalCatalog.settle_sources_preparation.availability(
                ctx,
                run,
            ),
        ).toBeNull();

        const error = await approvalCatalog.continue_sources_preparation
            .apply(ctx, {
                run,
                actor: { type: "visitor", visitorId: f.visitorId },
            })
            .catch((caught: unknown) => caught);
        expect(executionFailureCode(error)).toBe("sources_capacity_exhausted");
    });
});

test("invalid window refuses continue while settle remains available and applies", async () => {
    const f = await seedExpiredPreparation();
    await reachTimeLimit(f);
    vi.stubEnv("SOURCES_PREPARATION_WINDOW_MINUTES", "");

    await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        assert(run);
        expect(
            await approvalCatalog.continue_sources_preparation.availability(
                ctx,
                run,
            ),
        ).toBe("sources_configuration_unavailable");
        expect(
            await approvalCatalog.resume_research.availability(ctx, run),
        ).toBe("sources_configuration_unavailable");
        expect(
            await approvalCatalog.settle_sources_preparation.availability(
                ctx,
                run,
            ),
        ).toBeNull();

        await approvalCatalog.settle_sources_preparation.apply(ctx, {
            run,
            actor: { type: "visitor", visitorId: f.visitorId },
        });

        expect(
            await approvalCatalog.settle_sources_preparation.availability(
                ctx,
                run,
            ),
        ).toBe("stale_execution");
        expect(
            await approvalCatalog.continue_sources_preparation.availability(
                ctx,
                run,
            ),
        ).toBe("human_prerequisite_required");
    });

    const preparation = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    expect(preparation?.settlementRequestedAt).toBeTypeOf("number");
    const mission = await f.t.run((ctx) => ctx.db.get(f.missionId));
    expect(mission?.blockCode).toBe("execution_deadline");
});
