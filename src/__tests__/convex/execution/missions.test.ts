import { internal } from "@convex/_generated/api";
import { expect, test } from "vitest";
import { seedInspectedEvidence } from "@/__tests__/setup/source-preparation";

test("an active authorized run retains one mission for repeated start requests", async () => {
    const { t, args, visitorId } = await seedInspectedEvidence();
    const input = {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1" as const,
        requestKey: "inspect-retained-evidence",
        expectedGeneration: args.executionGeneration,
    };
    const id = await t.mutation(internal.execution.missions.start, input);
    expect(await t.mutation(internal.execution.missions.start, input)).toBe(id);
    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
        ownerVisitorId: visitorId,
        generation: 4,
        status: "ready",
        noProgressTurns: 0,
    });
    await t.run((ctx) => ctx.db.patch(visitorId, { status: "revoked" }));
    await expect(
        t.mutation(internal.execution.missions.start, input),
    ).rejects.toThrow("not_authorized");
});

test("mission creation cannot cross an unapproved corpus or an inactive generation", async () => {
    const { t, args } = await seedInspectedEvidence();
    const input = {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1" as const,
        requestKey: "inspect-retained-evidence",
        expectedGeneration: args.executionGeneration,
    };
    await expect(
        t.mutation(internal.execution.missions.start, {
            ...input,
            expectedGeneration: 3,
        }),
    ).rejects.toThrow("stale_execution");
    await t.run((ctx) =>
        ctx.db.patch(args.corpusRevisionId, { status: "draft" }),
    );
    await expect(
        t.mutation(internal.execution.missions.start, input),
    ).rejects.toThrow("corpus_not_approved");
});
