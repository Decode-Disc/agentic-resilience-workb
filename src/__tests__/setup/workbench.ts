import { api, internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { getAgentDefinition } from "@convex/execution/agentCatalog";
import { agentToolSchemas } from "@convex/execution/agentDefinition";
import { buildMissionContext } from "@convex/execution/context";
import { conversationInstructions } from "@convex/execution/conversations";
import { agentToolSetKey } from "@convex/integrations/modelInput";
import type { ModelRoute } from "@convex/integrations/modelRouting";
import schema from "@convex/schema";
import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { assert, vi } from "vitest";
import workflowTest from "@/__tests__/convex/workflows/workflow-test-register.js";
import { installModel } from "./model-configuration";
import { createAdmittedPreflight } from "./research-launch";
import { SOURCES_TEST_WINDOW_MINUTES } from "./sources-mission";

/** A real admitted framing dossier, with scheduled execution controlled by each test. */
export async function seedWorkbench(
    local = false,
    route?: ModelRoute,
    contextDurationMs = 60000,
    researchAngle?: string,
    company?: Parameters<typeof createAdmittedPreflight>[1],
    definitionVersion: 4 | 5 | 6 | 7 | 10 | 11 | 12 | null = 5,
    coveragePreset:
        | "balanced"
        | "first_party_depth"
        | "independent_scrutiny" = "balanced",
    transactionLimits = false,
) {
    vi.useFakeTimers();
    const t = convexTest({
        schema,
        modules: import.meta.glob("/convex/**/*.ts"),
        transactionLimits,
    });
    agentTest.register(t);
    workflowTest.register(t);
    const { userId, preflightId } = await createAdmittedPreflight(t, company);
    const client = t.withIdentity({ subject: userId });
    const { runId } = await client.mutation(api.framing.confirmCompany, {
        preflightId,
        idempotencyKey: "native-workbench",
        coveragePreset,
        ...(researchAngle ? { researchAngle } : {}),
    });
    if (definitionVersion) {
        await t.run(async (ctx) => {
            const conversation = await ctx.db
                .query("agentConversations")
                .withIndex("by_run", (q) => q.eq("runId", runId))
                .unique();
            assert(conversation);
            await ctx.db.patch(conversation._id, { definitionVersion });
            for (const mission of await ctx.db
                .query("agentMissions")
                .filter((q) => q.eq(q.field("runId"), runId))
                .collect()) {
                if (mission.definitionId === "workbench_v1")
                    await ctx.db.patch(mission._id, { definitionVersion });
            }
        });
    }
    if (local) {
        vi.stubEnv(
            "SOURCES_PREPARATION_WINDOW_MINUTES",
            String(SOURCES_TEST_WINDOW_MINUTES),
        );
        vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
        vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
        const run = await t.run((ctx) => ctx.db.get(runId));
        const ownerVisitorId = run?.ownerVisitorId;
        assert(ownerVisitorId);
        const visitor = await t.run((ctx) => ctx.db.get(ownerVisitorId));
        assert(visitor);
        await t.run((ctx) =>
            ctx.db.patch(visitor.invitationId, { slotKey: "analyst-4" }),
        );
        const contextId = await t.mutation(
            internal.runWorkspace.openBrowserTestContext,
            {
                slotKey: "analyst-4",
                contextKey: "native-workbench",
                durationMs: contextDurationMs,
            },
        );
        await t.run((ctx) =>
            ctx.db.patch(runId, {
                purpose: "browser_test",
                browserTestContextId: contextId,
            }),
        );
    }
    if (route) {
        vi.stubEnv("WORKBENCH_AGENT_ENABLED", "true");
        await installModel(t, route);
    }
    return { t, client, runId };
}

/** Canonical manifest for lifecycle unit tests; Pi integration tests use actual retained submissions. */
export async function workbenchAdmissionInput(
    t: Awaited<ReturnType<typeof seedWorkbench>>["t"],
    missionId: Id<"agentMissions">,
    generation = 1,
) {
    return t.run(async (ctx) => {
        const mission = await ctx.db.get(missionId);
        assert(mission);
        const instructions = await conversationInstructions(ctx, mission);
        assert(instructions);
        const context = await buildMissionContext(ctx, mission._id, generation);
        assert(context.kind === "ready");
        return {
            messageIds: instructions.messages.map(
                (message) => message.messageId,
            ),
            toolSetKey: await agentToolSetKey(
                agentToolSchemas(
                    getAgentDefinition(
                        mission.definitionId,
                        mission.definitionVersion,
                    ),
                    JSON.parse(context.inputJson),
                ),
            ),
        };
    });
}
