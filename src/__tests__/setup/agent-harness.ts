import { internal } from "@convex/_generated/api";
import schema from "@convex/schema";
import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { vi } from "vitest";
import { seedSourcePreparation } from "./source-preparation";

export async function seedConversation(
    local = false,
    transactionLimits: NonNullable<
        Parameters<typeof convexTest>[0]["transactionLimits"]
    > = false,
) {
    const f = await seedSourcePreparation(
        {},
        transactionLimits
            ? convexTest({
                  schema,
                  modules: import.meta.glob("/convex/**/*.ts"),
                  transactionLimits,
              })
            : undefined,
    );
    agentTest.register(f.t);
    const client = f.t.withIdentity({ subject: f.userId });
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, {
            executionStatus: "idle",
            lifecycleState: "draft",
            reservationStatus: undefined,
        }),
    );
    if (local) {
        vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
        vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
        await f.t.run((ctx) =>
            ctx.db.patch(f.invitationId, { slotKey: "analyst-4" }),
        );
        const contextId = await f.t.mutation(
            internal.runWorkspace.openBrowserTestContext,
            {
                slotKey: "analyst-4",
                contextKey: "conversation",
                durationMs: 60_000,
            },
        );
        await f.t.run((ctx) =>
            ctx.db.patch(f.runId, {
                purpose: "browser_test",
                browserTestContextId: contextId,
            }),
        );
    }
    return { ...f, client };
}
