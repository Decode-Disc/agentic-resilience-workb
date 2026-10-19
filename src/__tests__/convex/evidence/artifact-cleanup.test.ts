/// <reference types="vite/client" />
import type { Id } from "@convex/_generated/dataModel";
import schema from "@convex/schema";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";

const modules = import.meta.glob("/convex/**/*.ts");

const reconcileArtifactStorage = makeFunctionReference<
    "mutation",
    { cursor?: string; limit?: number },
    {
        processedLeaseCount: number;
        reconciledLeaseCount: number;
        scannedObjectCount: number;
        deletedStorageCount: number;
        referencedStorageCount: number;
        nextCursor: string | null;
        done: boolean;
    }
>("evidenceArtifacts:reconcileArtifactStorage");

const adminReconcileArtifactStorage = makeFunctionReference<
    "mutation",
    { cursor?: string; limit?: number },
    {
        processedLeaseCount: number;
        reconciledLeaseCount: number;
        scannedObjectCount: number;
        deletedStorageCount: number;
        referencedStorageCount: number;
        deletionFailureCount: number;
        nextCursor: string | null;
        done: boolean;
    }
>("evidenceArtifacts:adminReconcileArtifactStorage");

const SAFETY_MS = 24 * 60 * 60 * 1000;

async function createVisitors(t: ReturnType<typeof convexTest>) {
    const admin = await t.run(async (ctx) => {
        const adminUserId = await ctx.db.insert("users", { isAnonymous: true });
        const invitationId = await ctx.db.insert("invitations", {
            slotKey: "admin-cleanup",
            role: "admin",
            codeDigest: "admin-cleanup",
            status: "claimed",
            createdAt: 1,
        });
        const visitorId = await ctx.db.insert("visitors", {
            authUserId: adminUserId,
            invitationId,
            role: "admin",
            status: "active",
            analysesReserved: 0,
            admittedAt: 1,
        });
        return { adminUserId, visitorId };
    });
    const analyst = await t.run(async (ctx) => {
        const analystUserId = await ctx.db.insert("users", {
            isAnonymous: true,
        });
        const invitationId = await ctx.db.insert("invitations", {
            slotKey: "analyst-cleanup",
            role: "analyst",
            codeDigest: "analyst-cleanup",
            status: "claimed",
            createdAt: 1,
        });
        const visitorId = await ctx.db.insert("visitors", {
            authUserId: analystUserId,
            invitationId,
            role: "analyst",
            status: "active",
            analysesReserved: 1,
            admittedAt: 1,
        });
        return { analystUserId, visitorId };
    });
    return {
        asAdmin: t.withIdentity({
            subject: `${admin.adminUserId}|admin-cleanup`,
        }),
        asAnalyst: t.withIdentity({
            subject: `${analyst.analystUserId}|analyst-cleanup`,
        }),
    };
}

test("analyst is unauthorized; admin is authorized", async () => {
    const t = convexTest(schema, modules);
    const { asAdmin, asAnalyst } = await createVisitors(t);
    await expect(
        asAnalyst.mutation(adminReconcileArtifactStorage, {}),
    ).rejects.toThrow(/Unauthorized/);
    await expect(
        asAdmin.mutation(adminReconcileArtifactStorage, {}),
    ).resolves.toMatchObject({ done: true });
});

test("expired unreferenced storage is deleted; referenced object is kept", async () => {
    vi.useFakeTimers();
    const base = 1_000_000;
    vi.setSystemTime(new Date(base));
    const t = convexTest(schema, modules);
    const { asAdmin } = await createVisitors(t);

    const referencedId = await t.run(async (ctx) => {
        const now = Date.now();
        const runId = await ctx.db.insert("researchRuns", {
            lifecycleState: "corpus_approved",
            executionStatus: "idle",
            executionGeneration: 1,
            nextEventSequence: 1,
            createdAt: now,
            updatedAt: now,
        });
        const corpusRevisionId = await ctx.db.insert("corpusRevisions", {
            runId,
            revision: 1,
            status: "approved",
            approvedAt: now,
            createdAt: now,
        });
        const sourceId = await ctx.db.insert("sources", {
            runId,
            canonicalUrl: "https://example.com/doc",
            origin: "sec",
            title: "Doc",
            category: "regulatory",
            createdAt: now,
        });
        const acceptedDecisionId = await ctx.db.insert("sourceDecisions", {
            runId,
            corpusRevisionId,
            sourceId,
            decision: "accepted",
            decisionKey: "decl",
            occurredAt: now,
        });
        const storageId = (await ctx.storage.store(
            new Blob(["referenced"]),
        )) as Id<"_storage">;
        await ctx.db.insert("sourceVersions", {
            runId,
            corpusRevisionId,
            sourceId,
            acceptedDecisionId,
            contentHash: "hash-ref",
            normalizerVersion: "sec-html-v1",
            storageId,
            mediaType: "text/plain",
            byteCount: 9,
            canonicalUrl: "https://example.com/doc",
            retrievalVersion: "sec-v1",
            executionGeneration: 1,
            createdAt: now,
        });
        return storageId;
    });
    const orphanId = await t.run(async (ctx) => {
        return (await ctx.storage.store(
            new Blob(["orphan"]),
        )) as Id<"_storage">;
    });

    vi.setSystemTime(new Date(base + SAFETY_MS + 1));
    const result = await asAdmin.mutation(reconcileArtifactStorage, {
        limit: 100,
    });
    expect(result.deletedStorageCount).toBe(1);
    expect(result.referencedStorageCount).toBe(1);
    await t.run(async (ctx) => {
        expect(await ctx.storage.get(referencedId)).not.toBeNull();
        expect(await ctx.storage.get(orphanId)).toBeNull();
    });
});

test("recent unreferenced storage is kept inside the safety window", async () => {
    vi.useFakeTimers();
    const base = 2_000_000;
    vi.setSystemTime(new Date(base));
    const t = convexTest(schema, modules);
    const { asAdmin } = await createVisitors(t);

    const recentId = await t.run(async (ctx) => {
        return (await ctx.storage.store(
            new Blob(["recent"]),
        )) as Id<"_storage">;
    });

    const result = await asAdmin.mutation(reconcileArtifactStorage, {
        limit: 100,
    });
    expect(result.deletedStorageCount).toBe(0);
    await t.run(async (ctx) => {
        expect(await ctx.storage.get(recentId)).not.toBeNull();
    });
});

test("paginated _storage reconciliation deletes across pages without starving", async () => {
    vi.useFakeTimers();
    const base = 3_000_000;
    vi.setSystemTime(new Date(base));
    const t = convexTest(schema, modules);
    const { asAdmin } = await createVisitors(t);

    await t.run(async (ctx) => {
        for (let i = 0; i < 3; i++) {
            await ctx.storage.store(new Blob([`unref-${i}`]));
        }
    });
    vi.setSystemTime(new Date(base + SAFETY_MS + 1));

    const first = await asAdmin.mutation(reconcileArtifactStorage, {
        limit: 1,
    });
    const second = await asAdmin.mutation(reconcileArtifactStorage, {
        cursor: first.nextCursor ?? undefined,
        limit: 1,
    });
    const third = await asAdmin.mutation(reconcileArtifactStorage, {
        cursor: second.nextCursor ?? undefined,
        limit: 1,
    });
    const deleted =
        first.deletedStorageCount +
        second.deletedStorageCount +
        third.deletedStorageCount;
    expect(deleted).toBe(3);
    await t.run(async (ctx) => {
        const remaining = await ctx.db.system.query("_storage").take(50);
        expect(remaining).toHaveLength(0);
    });
    void third;
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});
