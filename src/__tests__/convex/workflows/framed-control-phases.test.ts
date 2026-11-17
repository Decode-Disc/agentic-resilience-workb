import { api } from "@convex/_generated/api";
import { afterEach, expect, test, vi } from "vitest";
import { seedSourcePreparation } from "@/__tests__/setup/source-preparation";
import workflowTest from "./workflow-test-register.js";

afterEach(() => vi.useRealTimers());
test("framed research refuses a pause at a later analytical stage that has no documentary continuation", async () => {
    vi.useFakeTimers();
    const { t, runId, userId } = await seedSourcePreparation();
    workflowTest.register(t);
    await t.run((ctx) =>
        ctx.db.patch(runId, {
            startMode: "framed",
            agentExecutionVersion: 3,
            lifecycleState: "extracting_evidence",
        }),
    );
    await expect(
        t
            .withIdentity({ subject: userId })
            .mutation(api.execution.researchControl.pause, {
                runId,
                expectedGeneration: 3,
            }),
    ).rejects.toThrow("research_control_not_supported");
    expect(await t.run((ctx) => ctx.db.get(runId))).not.toHaveProperty(
        "researchPauseRequested",
    );
});
