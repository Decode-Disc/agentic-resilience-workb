import "@convex/execution/agentCatalog";
import { internal } from "@convex/_generated/api";
import { sourcesDefinition } from "@convex/domain/sourcesAgent";
import type { SourcesPreparation } from "@convex/domain/sourcesContracts";
import { afterEach, assert, expect, test, vi } from "vitest";
import { seedCapturedSources } from "@/__tests__/setup/sources-mission";

afterEach(() => {
    delete sourcesDefinition.simulate;
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

test.each([
    false,
    true,
])("Pi corrects missing need accounting, bounded when repeated: %s", async (repeat) => {
    vi.useFakeTimers();
    vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3212");
    const network = vi.fn(() => {
        throw new Error("Provider forbidden");
    });
    vi.stubGlobal("fetch", network);
    const f = await seedCapturedSources();
    await f.t.run(async (ctx) => {
        const id = await ctx.db.insert("framingRevisions", {
            runId: f.runId,
            revision: 1,
            content: { scope: "Workflow", questions: [] },
            requestKey: "correction",
            contentHash: "fixture",
            origin: "analyst",
            createdAt: 1,
        });
        await ctx.db.patch(f.runId, {
            startMode: "framed",
            agentExecutionVersion: 3,
            fixedFramingRevisionId: id,
        });
        await ctx.db.patch(f.invitationId, { slotKey: "analyst-4" });
    });
    const contextId = await f.t.mutation(
        internal.runWorkspace.openBrowserTestContext,
        { slotKey: "analyst-4", contextKey: "correction", durationMs: 120000 },
    );
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, {
            purpose: "browser_test",
            browserTestContextId: contextId,
        }),
    );
    sourcesDefinition.simulate = (input: unknown) => {
        const { activeWork } = input as {
            activeWork: SourcesPreparation & { noProgressTurns: number };
        };
        return {
            kind: "complete",
            needsRevision: activeWork.needsRevision,
            workingNotes: "Completion note.",
            needs:
                repeat || activeWork.noProgressTurns === 0
                    ? []
                    : activeWork.needs.map((n) => ({
                          needId: n.id,
                          unfinished: ["Not yet examined"],
                          workRequestIds: activeWork.work
                              .filter((w) => w.needIds.includes(n.id))
                              .map((w) => w.requestId),
                      })),
        };
    };
    await f.t.mutation(internal.execution.missions.resume, {
        missionId: f.missionId,
        expectedGeneration: 4,
        simulation: true,
    });
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    const mission = await f.t.run((ctx) => ctx.db.get(f.missionId));
    assert(mission);
    const invocations = await f.t.run((ctx) =>
        ctx.db
            .query("agentInvocations")
            .withIndex("by_mission", (q) => q.eq("missionId", f.missionId))
            .collect(),
    );
    expect(mission.status).toBe(repeat ? "blocked" : "completed");
    expect(invocations).toHaveLength(repeat ? 3 : 2);
    assert(invocations[0]);
    expect(invocations[0].outputJson).toContain('"needs":[]');
    expect(mission.workingNotes).toBe(repeat ? "" : "Completion note.");
    if (repeat) expect(mission.blockCode).toBe("repetition_stop");
    expect(network).not.toHaveBeenCalled();
});
