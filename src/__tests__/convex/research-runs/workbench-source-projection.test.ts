import { api } from "@convex/_generated/api";
import { expect, test } from "vitest";
import { seedSourcePreparation } from "@/__tests__/setup/source-preparation";

test("source cards describe a public reference without exposing an internal intake key", async () => {
    const { t, runId, sourceId, userId } = await seedSourcePreparation();
    await t.run((ctx) => ctx.db.patch(sourceId, { origin: "analyst_url" }));
    const snapshot = await t
        .withIdentity({ subject: userId })
        .query(api.workbench.snapshot, { runId });
    expect(snapshot.sources[0]?.format).toBe("URL");
    expect(snapshot.sources[0]?.format).not.toContain("ANALYST_URL");
});

test("a retained committed capture takes priority over newer failed and orphaned attempts", async () => {
    const { seedInspectedEvidence } = await import(
        "@/__tests__/setup/source-preparation"
    );
    const { t, runId, userId, captureId } = await seedInspectedEvidence();
    await t.run(async (ctx) => {
        const retained = await ctx.db.get(captureId);
        if (!retained) throw new Error("Expected capture");
        const { _id, _creationTime, ...fields } = retained;
        for (const [i, status] of (
            ["unavailable", "orphaned"] as const
        ).entries())
            await ctx.db.insert("sourceCaptures", {
                ...fields,
                captureKey: `new-${status}`,
                status,
                mediaType: undefined,
                updatedAt: retained.updatedAt + i + 1,
            });
    });
    const result = await t
        .withIdentity({ subject: userId })
        .query(api.workbench.snapshot, { runId });
    expect(result.sources[0]).toMatchObject({
        state: "captured",
        format: "Text",
        unavailable: false,
    });
});
