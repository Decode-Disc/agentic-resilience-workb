import { internal } from "@convex/_generated/api";
import { expect, test } from "vitest";
import { seedCapturedSources } from "@/__tests__/setup/sources-mission";

const runOwned = [
    "sources",
    "sourceCaptures",
    "corpusRevisions",
    "sourceSelectionProposalRebuilds",
    "agentMissions",
    "agentOperationRequests",
    "aiTaskResults",
    "runEvents",
] as const;

test("a research dossier purge removes its owned records and stored captures, restores its analysis and keeps an audit trail", async () => {
    const f = await seedCapturedSources();
    const before = await f.t.run(async (ctx) => {
        const capture = await ctx.db.get(f.captureId);
        await ctx.db.patch(f.runId, { reservationStatus: "consumed" });
        const run = await ctx.db.get(f.runId);
        if (!run?.ownerVisitorId) throw new Error("fixture owner");
        await ctx.db.patch(run.ownerVisitorId, { analysesReserved: 1 });
        return { storageId: capture?.storageId, owner: run.ownerVisitorId };
    });
    expect(before.storageId).toBeDefined();

    const result = await f.t.action(
        internal.dossierPurge.purgeResearchDossiers,
        { runIds: [f.runId], reason: "Retired corpus-review dossier cleanup" },
    );
    expect(result).toEqual([expect.objectContaining({ runId: f.runId })]);

    await f.t.run(async (ctx) => {
        expect(await ctx.db.get(f.runId)).toBeNull();
        for (const table of runOwned) {
            const rows = await ctx.db.query(table).collect();
            expect(
                rows.filter((row) => "runId" in row && row.runId === f.runId),
                table,
            ).toEqual([]);
        }
        expect(
            await ctx.db
                .query("sourceSearchPassages")
                .withIndex("by_scope_capture_order", (q) =>
                    q
                        .gte("scopeKey", `${f.runId}:`)
                        .lt("scopeKey", `${f.runId};`),
                )
                .collect(),
        ).toEqual([]);
        if (before.storageId)
            expect(await ctx.storage.get(before.storageId)).toBeNull();
        expect(await ctx.db.get(before.owner)).toMatchObject({
            analysesReserved: 0,
        });
        expect(
            await ctx.db
                .query("auditEvents")
                .withIndex("by_target", (q) =>
                    q.eq("targetType", "research_run").eq("targetId", f.runId),
                )
                .collect(),
        ).toContainEqual(
            expect.objectContaining({
                action: "dossier_purged",
                reason: "Retired corpus-review dossier cleanup",
            }),
        );
    });
});

test("only analyst research dossiers can be purged", async () => {
    const f = await seedCapturedSources();
    await f.t.run((ctx) => ctx.db.patch(f.runId, { purpose: "evaluation" }));
    await expect(
        f.t.action(internal.dossierPurge.purgeResearchDossiers, {
            runIds: [f.runId],
            reason: "Retired corpus-review dossier cleanup",
        }),
    ).rejects.toThrow("Only analyst research dossiers can be purged");
    expect(await f.t.run((ctx) => ctx.db.get(f.runId))).not.toBeNull();
});
