import { internal } from "@convex/_generated/api";
import { expect, test } from "vitest";
import { seedInspectedEvidence } from "@/__tests__/setup/source-preparation";

test("an unconfigured Pi mission stops with a typed outcome before creating a provider attempt", async () => {
    const { vi } = await import("vitest");
    vi.useFakeTimers();
    try {
        const { t, args } = await seedInspectedEvidence();
        const missionId = await t.mutation(internal.execution.missions.start, {
            runId: args.runId,
            corpusRevisionId: args.corpusRevisionId,
            expectedGeneration: 4,
            definitionId: "saved_material_inspection_v1",
            requestKey: "pi-unconfigured",
        });
        await t.mutation(internal.execution.missions.resume, {
            missionId,
            expectedGeneration: 4,
            simulation: false,
        });
        await t.finishAllScheduledFunctions(
            () => vi.advanceTimersByTime(10),
            500,
        );
        expect(await t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
            status: "blocked",
            blockCode: "missing_authorized_route",
        });
        expect(
            await t.run((ctx) => ctx.db.query("providerCalls").take(1)),
        ).toEqual([]);
    } finally {
        vi.useRealTimers();
    }
});
