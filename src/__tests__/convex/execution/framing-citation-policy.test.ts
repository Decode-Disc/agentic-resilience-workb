import { api, internal } from "@convex/_generated/api";
import { afterEach, assert, expect, test, vi } from "vitest";
import { nativePiFixtureRoute } from "@/__tests__/setup/pi-native";
import { seedWorkbench } from "@/__tests__/setup/workbench";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
});

test("claims the default citation policy without exposing configuration to the analyst", async () => {
    const { t, client, runId } = await seedWorkbench(
        false,
        nativePiFixtureRoute,
        60000,
        "Investigate insurer estimate review.",
        undefined,
        10,
    );
    const turnId = await t.mutation(
        internal.execution.conversations.claimTurn,
        {
            runId,
        },
    );
    assert(turnId);
    expect(await t.run((ctx) => ctx.db.get(turnId))).toMatchObject({
        framingCitationPolicy: { revision: 0, requireContextRead: false },
    });
    const current = await client.query(api.execution.conversations.get, {
        runId,
    });
    expect(current.activeTurn?._id).toBe(turnId);
    expect(current.activeTurn).not.toHaveProperty("framingCitationPolicy");
});

test("restricts policy writes and applies a new revision to the next turn", async () => {
    const { t, client, runId } = await seedWorkbench(
        false,
        nativePiFixtureRoute,
        60000,
        "Investigate insurer estimate review.",
        undefined,
        10,
    );
    const adminUserId = await t.run(async (ctx) => {
        const adminInvitation = await ctx.db
            .query("invitations")
            .withIndex("by_slot_key", (q) => q.eq("slotKey", "admin"))
            .unique();
        const visitor = adminInvitation?.claimedByVisitorId
            ? await ctx.db.get(adminInvitation.claimedByVisitorId)
            : null;
        assert(visitor?.authUserId);
        return visitor.authUserId;
    });
    const admin = t.withIdentity({ subject: adminUserId });
    await expect(
        client.query(api.framingCitationPolicy.get, {}),
    ).rejects.toThrow("Unauthorized");
    await expect(
        client.mutation(api.framingCitationPolicy.set, {
            expectedRevision: 0,
            requireContextRead: true,
        }),
    ).rejects.toThrow("Unauthorized");
    const active = await t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: false,
        },
    );
    assert(active);
    await expect(
        admin.mutation(api.framingCitationPolicy.set, {
            expectedRevision: 0,
            requireContextRead: true,
        }),
    ).resolves.toEqual({ revision: 1, requireContextRead: true });
    await expect(
        admin.mutation(api.framingCitationPolicy.set, {
            expectedRevision: 0,
            requireContextRead: false,
        }),
    ).rejects.toThrow("version_conflict");
    await client.mutation(api.execution.conversations.submit, {
        runId,
        turnId: active.turnId,
        requestKey: "steer-before-policy-applies",
        text: "Focus on the carrier's rules.",
        delivery: "steer",
    });
    expect(await t.run((ctx) => ctx.db.get(active.turnId))).toMatchObject({
        framingCitationPolicy: { revision: 0, requireContextRead: false },
    });
    await client.mutation(api.execution.conversations.stopResponse, {
        runId,
        turnId: active.turnId,
    });
    await client.mutation(api.execution.conversations.submit, {
        runId,
        requestKey: "ask-under-new-policy",
        text: "Check the insurer's rules.",
        delivery: "queue",
    });
    const nextTurn = await t.mutation(
        internal.execution.conversations.claimTurn,
        { runId },
    );
    assert(nextTurn && nextTurn !== active.turnId);
    expect(await t.run((ctx) => ctx.db.get(nextTurn))).toMatchObject({
        framingCitationPolicy: { revision: 1, requireContextRead: true },
    });
    await t.run((ctx) =>
        ctx.db.patch(nextTurn, { framingCitationPolicy: undefined }),
    );
    await expect(
        t.mutation(internal.execution.conversations.startTurn, {
            runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: false,
        }),
    ).rejects.toThrow("framing_citation_policy_unavailable");
});
