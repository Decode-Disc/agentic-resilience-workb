import { internal } from "@convex/_generated/api";
import {
    appendRetainedText,
    retainedTextParts,
    sealRetainedText,
    stageOperationObservation,
} from "@convex/execution/retainedText";
import { afterEach, assert, expect, test, vi } from "vitest";
import {
    recordDocumentaryRead,
    seedCapturedSources,
} from "@/__tests__/setup/sources-mission";

import { seedWorkbench } from "@/__tests__/setup/workbench";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
});

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

test("purging a dossier removes the retained text owned by its operation requests", async () => {
    const f = await seedCapturedSources();
    const { operationId, textId } = await f.t.run(async (ctx) => {
        const operationId = await recordDocumentaryRead(ctx, {
            runId: f.runId,
            captureId: f.captureId,
            evidence: [],
        });
        const retained = retainedTextParts(
            "Retained evidence with a second page. ".repeat(5000),
        );
        for (const [index, content] of retained.parts.entries())
            await stageOperationObservation(ctx, operationId, {
                ...retained.manifest,
                index,
                content,
            });
        const text = await ctx.db
            .query("retainedTexts")
            .withIndex("by_key", (q) =>
                q.eq("key", `operation:${operationId}:observation`),
            )
            .unique();
        if (!text) throw new Error("fixture retained text");
        return { operationId, textId: text._id };
    });
    await f.t.action(internal.dossierPurge.purgeResearchDossiers, {
        runIds: [f.runId],
        reason: "Remove operation-owned retained evidence",
    });
    await f.t.run(async (ctx) => {
        expect(await ctx.db.get(operationId)).toBeNull();
        expect(await ctx.db.get(textId)).toBeNull();
        expect(
            await ctx.db
                .query("retainedTextFragments")
                .withIndex("by_text_and_index", (q) => q.eq("textId", textId))
                .first(),
        ).toBeNull();
    });
});

test("purging an invocation removes its private diagnostic fragments and preserves shared immutable text", async () => {
    const f = await seedCapturedSources();
    const diagnostic = await f.t.run(async (ctx) => {
        const invocationId = await ctx.db.insert("agentInvocations", {
            runId: f.runId,
            generation: 4,
            definitionVersion: 1,
            taskKey: "purge-capture",
            status: "started",
            provenance: "live",
            inputJson: "{}",
            createdAt: Date.now(),
        });
        const textId = await appendRetainedText(
            ctx,
            `${invocationId}:visible`,
            0,
            "private prefix",
        );
        const text = await sealRetainedText(ctx, textId);
        await ctx.db.patch(invocationId, {
            visibleOutput: {
                textId,
                complete: false,
                contentHash: text.contentHash,
                sizeBytes: text.sizeBytes,
            },
        });
        const sharedId = await appendRetainedText(
            ctx,
            "other-owner",
            0,
            "preserved",
        );
        return { textId, sharedId };
    });
    await f.t.action(internal.dossierPurge.purgeResearchDossiers, {
        runIds: [f.runId],
        reason: "Remove private diagnostic ownership",
    });
    await f.t.run(async (ctx) => {
        expect(await ctx.db.get(diagnostic.textId)).toBeNull();
        expect(
            await ctx.db
                .query("retainedTextFragments")
                .withIndex("by_text_and_index", (q) =>
                    q.eq("textId", diagnostic.textId),
                )
                .collect(),
        ).toEqual([]);
        expect(await ctx.db.get(diagnostic.sharedId)).not.toBeNull();
    });
});

test("a purge fences an idle framing turn immediately and restores its quota only once", async () => {
    const { t, runId } = await seedWorkbench();
    const turn = await t.mutation(internal.execution.conversations.startTurn, {
        runId,
        definitionId: "workbench_v1",
        scope: { kind: "workbench_v1" },
        simulation: false,
    });
    assert(turn);
    const ownerId = await t.run(async (ctx) => {
        const run = await ctx.db.get(runId);
        assert(run?.ownerVisitorId);
        expect(run.executionStatus).toBe("idle");
        await ctx.db.patch(runId, { reservationStatus: "consumed" });
        await ctx.db.patch(run.ownerVisitorId, { analysesReserved: 2 });
        return run.ownerVisitorId;
    });
    const args = { runId, reason: "Retire this active framing dossier" };
    await t.mutation(internal.dossierPurge.beginPurge, args);
    await expect(
        t.query(internal.execution.context.build, {
            missionId: turn.missionId,
            expectedGeneration: 1,
        }),
    ).rejects.toThrow("not_authorized");
    await t.mutation(internal.dossierPurge.beginPurge, args);
    expect(await t.run((ctx) => ctx.db.get(ownerId))).toMatchObject({
        analysesReserved: 1,
    });
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
        withdrawnAt: expect.any(Number),
    });
});

test("purge finishes a maximum-size retained observation within transaction limits", async () => {
    const { t, runId } = await seedWorkbench(
        false,
        undefined,
        60000,
        undefined,
        undefined,
        5,
        "balanced",
        true,
    );
    const operationId = await t.run((ctx) =>
        ctx.db.insert("agentOperationRequests", {
            runId,
            actor: "system",
            cause: "old-public-observation",
            logicalKey: "old-public-observation",
            input: { kind: "consult_run_state" },
            operationVersion: 1,
            expectedGeneration: 1,
            status: "completed",
            createdAt: 1,
        }),
    );
    const retained = retainedTextParts("界".repeat(5592405) + "x");
    expect(retained.manifest.sizeBytes).toBe(16 * 1024 * 1024);
    for (const [index, content] of retained.parts.entries())
        await t.run((ctx) =>
            stageOperationObservation(ctx, operationId, {
                ...retained.manifest,
                index,
                content,
            }),
        );
    const textId = await t.run(async (ctx) => {
        const stored = await ctx.db
            .query("retainedTexts")
            .withIndex("by_key", (q) =>
                q.eq("key", `operation:${operationId}:observation`),
            )
            .unique();
        assert(stored);
        return stored._id;
    });
    await t.action(internal.dossierPurge.purgeResearchDossiers, {
        runIds: [runId],
        reason: "Remove all retained fragments",
    });
    await t.run(async (ctx) => {
        expect(await ctx.db.get(runId)).toBeNull();
        expect(await ctx.db.get(operationId)).toBeNull();
        expect(await ctx.db.get(textId)).toBeNull();
        expect(
            await ctx.db
                .query("retainedTextFragments")
                .withIndex("by_text_and_index", (q) => q.eq("textId", textId))
                .first(),
        ).toBeNull();
    });
}, 30000);
