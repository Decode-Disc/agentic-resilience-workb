import { internal } from "@convex/_generated/api";
import { getAgentDefinition } from "@convex/execution/agentCatalog";
import { domainSnapshot } from "@convex/execution/agentDefinition";
import { afterEach, assert, expect, test, vi } from "vitest";
import { seedPiHistory } from "@/__tests__/setup/pi-mission";
import { seedCapturedSources } from "@/__tests__/setup/sources-mission";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

test("native Sources compaction retains adopted reading handles in the subsequent model request", async () => {
    vi.useFakeTimers();
    const f = await seedCapturedSources();
    vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
    await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        assert(run?.ownerVisitorId);
        const visitor = await ctx.db.get(run.ownerVisitorId);
        assert(visitor);
        await ctx.db.patch(visitor.invitationId, { slotKey: "analyst-4" });
    });
    const contextId = await f.t.mutation(
        internal.runWorkspace.openBrowserTestContext,
        {
            slotKey: "analyst-4",
            contextKey: "sources-compaction",
            durationMs: 3_600_000,
        },
    );
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, {
            purpose: "browser_test",
            browserTestContextId: contextId,
        }),
    );
    // Only model output is scripted; the journal, compaction, context and executor remain real.
    vi.spyOn(getAgentDefinition("sources_v1"), "simulate").mockImplementation(
        (input) => {
            const domain = domainSnapshot(input) as {
                activeWork: { needs: { id: string }[] };
            };
            return {
                kind: "complete",
                needs: domain.activeWork.needs.map((need) => ({
                    needId: need.id,
                    unfinished: [
                        "Scripted compaction check; documentary preparation remains incomplete.",
                    ],
                })),
            };
        },
    );
    await seedPiHistory(f.t, f.missionId, 4, 8, 16_250);
    await f.t.mutation(internal.execution.missions.resume, {
        missionId: f.missionId,
        expectedGeneration: 4,
        simulation: true,
    });
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    const invocations = await f.t.run((ctx) =>
        ctx.db
            .query("agentInvocations")
            .withIndex("by_mission", (q) => q.eq("missionId", f.missionId))
            .collect(),
    );
    expect(
        invocations.some(
            (invocation) =>
                invocation.purpose === "compaction" &&
                invocation.status === "returned",
        ),
    ).toBe(true);
    const reasoning = invocations.find(
        (invocation) => !invocation.purpose && invocation.status === "returned",
    );
    assert(reasoning);
    const request = await f.t.run((ctx) =>
        ctx.db
            .query("agentInvocationPayloads")
            .withIndex("by_invocation_and_part", (q) =>
                q.eq("invocationId", reasoning._id).eq("part", "request"),
            )
            .unique(),
    );
    assert(request?.state === "complete" && request.json);
    expect(request.json).toContain("readingReferences");
    expect(request.json).toContain(f.readRequestId);
    expect(request.json).toContain(f.captureId);
}, 30_000);
