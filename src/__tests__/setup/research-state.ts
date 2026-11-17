import { api, internal } from "@convex/_generated/api";
import { getAgentDefinition } from "@convex/execution/agentCatalog";
import {
    type ResearchStateFixtureOptions,
    seedHistoricalResearchState,
} from "@convex/fixtures/researchState";
import type { ModelRoute } from "@convex/integrations/modelRouting";
import { assert, vi } from "vitest";
import { installModel } from "./model-configuration";
import { seedCapturedSources } from "./sources-mission";

/** Reconstructs historical persisted material in an isolated database, then admits a real current Workbench turn. */
export async function seedResearchStateScenario(
    options: ResearchStateFixtureOptions,
    execution: { simulation?: boolean; route?: ModelRoute } = {},
) {
    const simulation = execution.simulation ?? false;
    vi.useFakeTimers();
    const f = await seedCapturedSources();
    const material = await f.t.run((ctx) =>
        seedHistoricalResearchState(ctx, f, options),
    );
    if (execution.route) await installModel(f.t, execution.route);
    if (simulation) {
        vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
        vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
        await f.t.run((ctx) =>
            ctx.db.patch(f.invitationId, { slotKey: "analyst-4" }),
        );
        const contextId = await f.t.mutation(
            internal.runWorkspace.openBrowserTestContext,
            {
                slotKey: "analyst-4",
                contextKey: "research-state-simulation",
                durationMs: 60000,
            },
        );
        await f.t.run((ctx) =>
            ctx.db.patch(f.runId, {
                purpose: "browser_test",
                browserTestContextId: contextId,
            }),
        );
    }
    await f.t
        .withIdentity({ subject: f.userId })
        .mutation(api.execution.conversations.submit, {
            runId: f.runId,
            requestKey: "research-state",
            text: "What stopped preparation and which documents were retained?",
            delivery: "queue",
        });
    await f.t.run(async (ctx) => {
        const conversation = await ctx.db
            .query("agentConversations")
            .withIndex("by_run", (q) => q.eq("runId", f.runId))
            .unique();
        assert(conversation);
        await ctx.db.patch(conversation._id, {
            definitionId: "workbench_v1",
            definitionVersion: getAgentDefinition("workbench_v1").version,
        });
    });
    const active = await f.t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId: f.runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation,
        },
    );
    assert(active);
    return { ...f, ...material, workbenchMissionId: active.missionId };
}
