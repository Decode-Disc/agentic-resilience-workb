import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import schema from "@convex/schema";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";

const modules = import.meta.glob("/convex/**/*.ts");
const getOperations = api.adminOperations.get;
const setPaidWorkEnabled = makeFunctionReference<
    "mutation",
    { enabled: boolean; reason: string },
    { enabled: boolean }
>("adminOperations:setPaidWorkEnabled");
const recordAttempt = makeFunctionReference<
    "mutation",
    {
        service: "exa";
        operation: string;
        operationKey: string;
        status: "started";
        attempt: number;
    },
    {
        providerCallId: Id<"providerCalls">;
        shouldExecute: boolean;
        status: string;
    }
>("providerCalls:recordAttempt");

async function createVisitors(t: ReturnType<typeof convexTest>) {
    return t.run(async (ctx) => {
        const adminUserId = await ctx.db.insert("users", {
            isAnonymous: true,
        });
        const analystUserId = await ctx.db.insert("users", {
            isAnonymous: true,
        });
        const adminInvitationId = await ctx.db.insert("invitations", {
            slotKey: "admin",
            role: "admin",
            codeDigest: "admin-ops",
            status: "claimed",
            createdAt: 1,
        });
        const analystInvitationId = await ctx.db.insert("invitations", {
            slotKey: "analyst",
            role: "analyst",
            codeDigest: "analyst-ops",
            status: "claimed",
            createdAt: 1,
        });
        const adminVisitorId = await ctx.db.insert("visitors", {
            authUserId: adminUserId,
            invitationId: adminInvitationId,
            role: "admin",
            status: "active",
            analysesReserved: 0,
            admittedAt: 1,
        });
        await ctx.db.patch(adminInvitationId, {
            claimedByVisitorId: adminVisitorId,
        });
        await ctx.db.insert("visitors", {
            authUserId: analystUserId,
            invitationId: analystInvitationId,
            role: "analyst",
            status: "active",
            analysesReserved: 1,
            admittedAt: 1,
        });
        return { adminUserId, analystUserId };
    });
}

test("admin controls paid work while analysts remain unauthorized", async () => {
    const t = convexTest(schema, modules);
    const { adminUserId, analystUserId } = await createVisitors(t);
    const admin = t.withIdentity({ subject: `${adminUserId}|admin-ops` });
    const analyst = t.withIdentity({
        subject: `${analystUserId}|analyst-ops`,
    });

    await expect(analyst.query(getOperations, {})).rejects.toThrow(
        "Unauthorized",
    );
    await expect(
        analyst.mutation(setPaidWorkEnabled, {
            enabled: false,
            reason: "Provider spend must stop now.",
        }),
    ).rejects.toThrow("Unauthorized");
    await expect(
        admin.mutation(setPaidWorkEnabled, {
            enabled: false,
            reason: "Provider spend must stop now.",
        }),
    ).resolves.toEqual({ enabled: false });
    await expect(admin.query(getOperations, {})).resolves.toMatchObject({
        paidWork: {
            enabled: false,
            reason: "Provider spend must stop now.",
        },
    });
    const attemptResult = await t.mutation(recordAttempt, {
        service: "exa",
        operation: "search",
        operationKey: "blocked-paid-step",
        status: "started",
        attempt: 1,
    });
    expect(attemptResult.shouldExecute).toBe(false);
    expect(attemptResult.status).toBe("failed");
    await expect(
        t.run(async (ctx) =>
            ctx.db
                .query("auditEvents")
                .filter((builder) =>
                    builder.eq(builder.field("action"), "paid_work_toggled"),
                )
                .collect(),
        ),
    ).resolves.toHaveLength(1);
});

test("reads the 50 latest events within a fixed document budget as history grows", async () => {
    const t = convexTest({
        schema,
        modules,
        transactionLimits: { documentsRead: 128 },
    });
    const { adminUserId } = await createVisitors(t);
    await t.run(async (ctx) => {
        const visitor = await ctx.db
            .query("visitors")
            .withIndex("by_auth_user_id", (q) =>
                q.eq("authUserId", adminUserId),
            )
            .unique();
        if (!visitor) throw new Error("Missing administrator fixture");
        const runId = await ctx.db.insert("researchRuns", {
            purpose: "research",
            executionGeneration: 1,
            lifecycleState: "draft",
            executionStatus: "idle",
            nextEventSequence: 1,
            createdAt: 1,
            updatedAt: 1,
        });
        // Insert older events last so insertion order cannot stand in for event time.
        for (let time = 100; time >= 0; time--) {
            await ctx.db.insert("checkpointDecisions", {
                runId,
                checkpoint: "source_review",
                decisionKey: `checkpoint-${time}`,
                reviewerVisitorId: visitor._id,
                decision: "approved",
                occurredAt: time,
            });
            await ctx.db.insert("providerCalls", {
                runId,
                service: "exa",
                operation: `operation-${time}`,
                operationKey: `attempt-${time}`,
                status: "failed",
                errorCode: "exa_not_configured",
                attempt: 1,
                createdAt: time,
            });
        }
    });
    const result = await t
        .withIdentity({ subject: `${adminUserId}|admin-ops` })
        .query(getOperations, {});
    const expectedTimes = Array.from({ length: 50 }, (_, i) => 100 - i);
    expect(result.checkpoints.map((event) => event.occurredAt)).toEqual(
        expectedTimes,
    );
    expect(result.providerCalls.map((event) => event.createdAt)).toEqual(
        expectedTimes,
    );
    expect(result.providerCalls[0]).toMatchObject({
        operation: "operation-100",
        status: "failed",
        errorCode: "exa_not_configured",
    });
    expect(result.reservations).toHaveLength(2);
    expect(result.reservations[0]).toMatchObject({
        admittedAt: expect.any(Number),
    });
    const admin = t.withIdentity({ subject: `${adminUserId}|admin-ops` });
    expect(
        (
            await admin.query(api.adminOperations.listRunsPage, {
                purpose: "research",
                paginationOpts: { numItems: 20, cursor: null },
            })
        ).page,
    ).toEqual([
        expect.objectContaining({
            purpose: "research",
            lifecycleState: "draft",
        }),
    ]);
    expect(
        (
            await admin.query(api.adminOperations.listRestorableRunsPage, {
                paginationOpts: { numItems: 20, cursor: null },
            })
        ).page,
    ).toEqual([]);
});

test("requires an authenticated active administrator to read operational history", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(getOperations, {})).rejects.toThrow(
        "Not authenticated",
    );
    const { adminUserId } = await createVisitors(t);
    await t.run(async (ctx) => {
        const visitor = await ctx.db
            .query("visitors")
            .withIndex("by_auth_user_id", (q) =>
                q.eq("authUserId", adminUserId),
            )
            .unique();
        if (!visitor) throw new Error("Missing administrator fixture");
        await ctx.db.patch(visitor._id, { status: "revoked" });
    });
    await expect(
        t
            .withIdentity({ subject: `${adminUserId}|admin-ops` })
            .query(getOperations, {}),
    ).rejects.toThrow("Unauthorized");
});

test("admin can inspect preparation configuration and dispatch evidence without secrets", async () => {
    const { internal } = await import("@convex/_generated/api");
    const { seedSourcePreparation } = await import(
        "@/__tests__/setup/source-preparation"
    );
    const { t, runId, corpusRevisionId, sourceId } =
        await seedSourcePreparation();
    const { adminUserId } = await createVisitors(t);
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        { runId, corpusRevisionId, expectedExecutionGeneration: 3 },
    );
    await t.mutation(internal.sourcePreparation.recordConfigurationCheck, {
        preparationId,
        available: false,
    });
    await t.run((ctx) =>
        ctx.db.patch(preparationId, {
            executionPlanVersion: "source_actions_v3",
        }),
    );
    const attempt = {
        runId,
        corpusRevisionId,
        sourceId,
        preparationId,
        executionGeneration: 3,
        workflowVersion: 1,
        stepKey: "source_preparation",
        service: "model" as const,
        operation: "source_qualification",
        inputHash: "a".repeat(64),
        operationKey: `${(await t.run((ctx) => ctx.db.get(preparationId)))?.operationKey}:step:source_preparation:input:${"a".repeat(64)}:attempt:1`,
        attempt: 1,
    };
    await t.mutation(internal.providerCalls.recordAttempt, {
        ...attempt,
        status: "started",
    });
    await t.mutation(internal.providerCalls.recordAttempt, {
        ...attempt,
        status: "failed",
        errorCode: "transport_unavailable",
        dispatchOutcome: "response_received",
        httpStatus: 503,
    });
    await t.mutation(internal.sourcePreparation.recordResult, {
        preparationId,
        outcome: {
            sourceId,
            result: {
                status: "unavailable",
                reasonCode: "transport_unavailable",
            },
        },
    });
    const operations = await t
        .withIdentity({ subject: adminUserId })
        .query(getOperations, {});
    await t.run((ctx) => ctx.db.patch(runId, { purpose: "research" }));
    const runs = await t
        .withIdentity({ subject: adminUserId })
        .query(api.adminOperations.listRunsPage, {
            purpose: "research",
            paginationOpts: { numItems: 20, cursor: null },
        });
    expect(runs.page.find((run) => run.runId === runId)).toMatchObject({
        companyLegalName: "ServiceNow, Inc.",
        createdAt: 1,
        preparation: {
            configurationCheck: { available: false },
            failures: [{ sourceId, reasonCode: "transport_unavailable" }],
        },
    });
    await t.run((ctx) =>
        ctx.db.patch(runId, {
            companySnapshot: {
                cik: "1373715",
                legalName: "ServiceNow (archived snapshot)",
                ticker: "NOW",
                exchange: "NYSE",
            },
        }),
    );
    const runsWithSnapshot = await t
        .withIdentity({ subject: adminUserId })
        .query(api.adminOperations.listRunsPage, {
            purpose: "research",
            paginationOpts: { numItems: 20, cursor: null },
        });
    expect(
        runsWithSnapshot.page.find((run) => run.runId === runId)
            ?.companyLegalName,
    ).toBe("ServiceNow (archived snapshot)");
    expect(operations.providerCalls[0]).toMatchObject({
        preparationId,
        sourceId,
        attempt: 1,
        dispatchOutcome: "response_received",
        httpStatus: 503,
    });
    expect(JSON.stringify(operations)).not.toMatch(
        /OPENROUTER_API_KEY|apiKey|test-key/,
    );
});
