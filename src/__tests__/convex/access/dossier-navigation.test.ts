import { api } from "@convex/_generated/api";
import schema from "@convex/schema";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
const modules = import.meta.glob("/convex/**/*.ts");
test("search finds an older dossier by its persisted scope before pagination", async () => {
    const t = convexTest(schema, modules);
    const user = await t.run(async (ctx) => {
        const user = await ctx.db.insert("users", { isAnonymous: true });
        const invitation = await ctx.db.insert("invitations", {
            slotKey: "navigation",
            role: "analyst",
            codeDigest: "fixture",
            status: "claimed",
            createdAt: 1,
        });
        const owner = await ctx.db.insert("visitors", {
            authUserId: user,
            invitationId: invitation,
            role: "analyst",
            status: "active",
            analysesReserved: 0,
            admittedAt: 1,
        });
        await ctx.db.patch(invitation, { claimedByVisitorId: owner });
        for (let i = 0; i < 15; i++) {
            const run = await ctx.db.insert("researchRuns", {
                purpose: "research",
                ownerVisitorId: owner,
                lifecycleState: "framing",
                executionStatus: "idle",
                executionGeneration: 0,
                nextEventSequence: 1,
                createdAt: i,
                updatedAt: i,
            });
            const revision = await ctx.db.insert("framingRevisions", {
                runId: run,
                revision: 1,
                content: {
                    scope:
                        i === 0
                            ? "Distinctive claims coordination"
                            : "Other workflow",
                    questions: [],
                },
                requestKey: "fixture",
                contentHash: "fixture",
                origin: "initial",
                createdAt: 1,
            });
            await ctx.db.patch(run, { currentFramingRevisionId: revision });
        }
        return user;
    });
    const workspace = (
        await t.withIdentity({ subject: user }).query(api.visitors.current, {})
    )?.workspace;
    if (!workspace) throw new Error("Missing fixture workspace");
    const result = await t
        .withIdentity({ subject: user })
        .query(api.researchRuns.listMine, {
            workspaceKey: workspace.key,
            search: "claims distinctive",
            paginationOpts: { numItems: 12, cursor: null },
        });
    expect(result.page).toHaveLength(1);
    expect(result.page[0]?.framingScope).toBe(
        "Distinctive claims coordination",
    );
    const first = result.page[0];
    if (!first) throw new Error("Missing result");
    const id = first.runId;
    await t.run(async (ctx) => {
        const run = await ctx.db.get(id);
        if (!run?.currentFramingRevisionId)
            throw new Error("Missing fixture framing");
        const fixed = run.currentFramingRevisionId;
        const newer = await ctx.db.insert("framingRevisions", {
            runId: id,
            revision: 2,
            content: { scope: "A later editable scope", questions: [] },
            requestKey: "newer",
            contentHash: "newer",
            origin: "analyst",
            createdAt: 20,
        });
        await ctx.db.patch(id, {
            fixedFramingRevisionId: fixed,
            currentFramingRevisionId: newer,
        });
        for (const withdrawn of [false, true]) {
            const other = await ctx.db.insert("researchRuns", {
                purpose: "research",
                ownerVisitorId: withdrawn ? run.ownerVisitorId : undefined,
                withdrawnAt: withdrawn ? 10 : undefined,
                researchAngle: "Distinctive claims coordination",
                lifecycleState: "framing",
                executionStatus: "idle",
                executionGeneration: 0,
                nextEventSequence: 1,
                createdAt: 20,
                updatedAt: 20,
            });
            expect(other).toBeTruthy();
        }
    });
    const identity = t.withIdentity({ subject: user });
    const context = workspace;
    const filtered = await identity.query(api.researchRuns.listMine, {
        workspaceKey: context.key,
        search: "claims distinctive",
        paginationOpts: { numItems: 12, cursor: null },
    });
    expect(filtered.page.map((run) => run.runId)).toEqual([id]);
    expect(
        (await identity.query(api.researchRuns.getMine, { runId: id }))
            .framingScope,
    ).toBe("Distinctive claims coordination");
});
