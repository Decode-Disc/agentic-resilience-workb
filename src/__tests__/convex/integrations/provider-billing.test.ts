import { api, internal } from "@convex/_generated/api";
import { afterEach, assert, expect, test, vi } from "vitest";
import { nativePiFixtureRoute } from "@/__tests__/setup/pi-native";
import { seedWorkbench } from "@/__tests__/setup/workbench";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

async function interruptedCall(
    billing: (
        fixture: Awaited<ReturnType<typeof seedWorkbench>>,
    ) => Promise<Response>,
    beforeBilling?: () => void,
) {
    const fixture = await seedWorkbench(false, nativePiFixtureRoute);
    let generations = 0;
    let lookups = 0;
    vi.stubEnv("OPENROUTER_API_KEY", "unpaid-fixture");
    vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, init) => {
            if (init?.method === "GET") {
                expect(String(_url)).toBe(
                    "https://openrouter.ai/api/v1/generation?id=gen-billing",
                );
                expect(init.redirect).toBe("error");
                lookups++;
                return billing(fixture);
            }
            generations++;
            if (generations > 1)
                return new Response(
                    'data: {"id":"gen-new-intent","choices":[{"index":0,"delta":{"role":"assistant","content":"This is a new response."},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"cost":0.000001}}\n\ndata: [DONE]\n\n',
                    { headers: { "content-type": "text/event-stream" } },
                );
            let emitted = false;
            return new Response(
                new ReadableStream<Uint8Array>({
                    pull(controller) {
                        if (emitted) {
                            controller.error(
                                new DOMException(
                                    "Interrupted provider",
                                    "AbortError",
                                ),
                            );
                            return;
                        }
                        emitted = true;
                        controller.enqueue(
                            new TextEncoder().encode(
                                'data: {"id":"gen-billing","choices":[{"index":0,"delta":{"role":"assistant","content":"Partial reply"},"finish_reason":null}]}\n\n',
                            ),
                        );
                    },
                }),
                { headers: { "content-type": "text/event-stream" } },
            );
        }),
    );
    await fixture.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    beforeBilling?.();
    await vi.advanceTimersByTimeAsync(5000);
    await fixture.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    const call = await fixture.t.run((ctx) =>
        ctx.db.query("providerCalls").first(),
    );
    assert(call);
    const adminUser = await fixture.t.run(async (ctx) => {
        const invitation = await ctx.db
            .query("invitations")
            .withIndex("by_slot_key", (q) => q.eq("slotKey", "admin"))
            .unique();
        assert(invitation?.claimedByVisitorId);
        return (await ctx.db.get(invitation.claimedByVisitorId))?.authUserId;
    });
    assert(adminUser);
    return {
        ...fixture,
        call,
        admin: fixture.t.withIdentity({ subject: adminUser }),
        counts: () => ({ generations, lookups }),
    };
}

test("automatically reconciles an incomplete generation once without adopting it or releasing its reservation", async () => {
    const { t, client, admin, runId, call, counts } = await interruptedCall(
        async () =>
            Response.json({
                data: {
                    id: "gen-billing",
                    total_cost: 0.0002137,
                    cancelled: true,
                },
            }),
    );
    expect(call.reportedCost).toBe(0.0002137);
    expect(call.billing).toMatchObject({ state: "confirmed", attempt: 1 });
    expect(call.status).toBe("started");
    expect(call.completedAt).toBeUndefined();
    expect(counts()).toEqual({ generations: 1, lookups: 1 });
    const run = await t.run((ctx) => ctx.db.get(runId));
    expect(run?.sourcePreparationBudget?.reserved).toBe(1);
    expect(
        (await client.query(api.execution.conversations.get, { runId }))
            .execution,
    ).toMatchObject({ status: "blocked", code: "attempt_outcome_unknown" });
    await expect(
        client.query(api.adminOperations.inspectProviderCall, {
            providerCallId: call._id,
        }),
    ).rejects.toThrow("Unauthorized");
    expect(
        await admin.query(api.adminOperations.inspectProviderCall, {
            providerCallId: call._id,
        }),
    ).toMatchObject({ reportedCost: 0.0002137, status: "started" });
    await t.action(internal.integrations.openRouterGeneration.reconcile, {
        providerCallId: call._id,
        attempt: 1,
    });
    expect(counts()).toEqual({ generations: 1, lookups: 1 });
}, 20000);

test("matching cancellation without a price retains termination and the financial reservation", async () => {
    const { call, runId, t, counts } = await interruptedCall(async () =>
        Response.json({ data: { id: "gen-billing", cancelled: true } }),
    );
    expect(call.providerObservation?.termination).toEqual({
        kind: "cancelled",
        source: "generation_lookup",
        generationId: "gen-billing",
        observedAt: expect.any(Number),
    });
    expect(call).toMatchObject({
        status: "started",
        reportedCostFinal: false,
        billing: {
            state: "unavailable",
            attempt: 1,
            reason: "invalid_response",
        },
    });
    expect(call.reportedCost).toBeUndefined();
    expect(
        (await t.run((ctx) => ctx.db.get(runId)))?.sourcePreparationBudget
            ?.reserved,
    ).toBe(1);
    expect(counts()).toEqual({ generations: 1, lookups: 1 });
}, 20000);

test("a failed lookup is explicit and only an administrator can request one bounded retry", async () => {
    const { t, client, admin, call, counts } = await interruptedCall(
        async () => new Response("Unavailable", { status: 404 }),
    );
    expect(call.billing).toMatchObject({
        state: "unavailable",
        reason: "not_found",
        attempt: 1,
    });
    expect(call.reportedCost).toBeUndefined();
    await expect(
        client.mutation(api.providerCalls.retryBilling, {
            providerCallId: call._id,
        }),
    ).rejects.toThrow("Unauthorized");
    expect(
        await admin.mutation(api.providerCalls.retryBilling, {
            providerCallId: call._id,
        }),
    ).toEqual({ scheduled: false });
    await vi.advanceTimersByTimeAsync(30000);
    const results = await Promise.all(
        [1, 2].map(() =>
            admin.mutation(api.providerCalls.retryBilling, {
                providerCallId: call._id,
            }),
        ),
    );
    expect(results.filter((value) => value.scheduled)).toHaveLength(1);
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10));
    expect(counts()).toEqual({ generations: 1, lookups: 2 });
}, 20000);

test("rejects mismatched billing identity without changing the receipt outcome", async () => {
    const { call } = await interruptedCall(async () =>
        Response.json({
            data: { id: "another-generation", total_cost: 99, cancelled: true },
        }),
    );
    expect(call.billing).toMatchObject({
        state: "unavailable",
        reason: "invalid_response",
    });
    expect(call.reportedCost).toBeUndefined();
    expect(call.status).toBe("started");
    expect(call.providerObservation?.termination).toBeUndefined();
}, 20000);

test("later terminal observations preserve a reconciled charge and expose contradictory amounts", async () => {
    const { t, call } = await interruptedCall(async () =>
        Response.json({ data: { id: "gen-billing", total_cost: 0.0002137 } }),
    );
    const attempt = {
        missionId: call.missionId,
        invocationId: call.invocationId,
        inputHash: call.inputHash,
        runId: call.runId,
        corpusRevisionId: call.corpusRevisionId,
        executionGeneration: call.executionGeneration,
        workflowVersion: call.workflowVersion,
        stepKey: call.stepKey,
        service: call.service,
        operation: call.operation,
        operationKey: call.operationKey,
        attempt: call.attempt,
        status: "failed" as const,
        dispatchOutcome: "unknown" as const,
    };
    await t.mutation(internal.providerCalls.recordAttempt, attempt);
    expect((await t.run((ctx) => ctx.db.get(call._id)))?.reportedCost).toBe(
        0.0002137,
    );
    await t.mutation(internal.providerCalls.recordAttempt, {
        ...attempt,
        reportedCost: 0.5,
    });
    expect(await t.run((ctx) => ctx.db.get(call._id))).toMatchObject({
        reportedCost: 0.0002137,
        billing: { state: "conflict", reason: "amount_conflict" },
    });
}, 20000);

test("a late accounting result remains factual after a new analyst intent cancels the original mission", async () => {
    const { t, client, runId, call, counts } = await interruptedCall(
        async (fixture) => {
            await fixture.client.mutation(api.execution.conversations.submit, {
                runId: fixture.runId,
                requestKey: "new-intent-during-billing",
                delivery: "queue",
                text: "Keep the program unchanged and explain what is available.",
            });
            return Response.json({
                data: { id: "gen-billing", total_cost: 0.0002137 },
            });
        },
    );
    expect(call.reportedCost).toBe(0.0002137);
    expect(call.status).toBe("started");
    const missionId = call.missionId;
    assert(missionId);
    expect(await t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
        status: "cancelled",
    });
    expect(
        (await client.query(api.execution.conversations.get, { runId }))
            .activeTurn,
    ).toBeNull();
    expect(counts()).toEqual({ generations: 2, lookups: 1 });
}, 20000);

test.each([
    {
        label: "oversized metadata",
        response: () => new Response("x".repeat(64 * 1024 + 1)),
        reason: "response_too_large",
    },
    {
        label: "negative cost",
        response: () =>
            Response.json({
                data: { id: "gen-billing", total_cost: -1 },
            }),
        reason: "invalid_response",
    },
    {
        label: "malformed metadata",
        response: () => new Response("not JSON"),
        reason: "invalid_response",
    },
    {
        label: "HTTP refusal",
        response: () => new Response("Unavailable", { status: 429 }),
        reason: "http_error",
    },
])("retains an unknown charge for $label", async ({ response, reason }) => {
    const { call, counts } = await interruptedCall(async () => response());
    expect(call.billing).toMatchObject({ state: "unavailable", reason });
    expect(call.reportedCost).toBeUndefined();
    expect(call.providerObservation?.termination).toBeUndefined();
    expect(counts()).toEqual({ generations: 1, lookups: 1 });
}, 20000);

test("missing accounting credentials is explicit and makes no metadata request", async () => {
    const { call, counts } = await interruptedCall(
        async () => {
            throw new Error("Unexpected metadata request");
        },
        () => vi.stubEnv("OPENROUTER_API_KEY", ""),
    );
    expect(call.billing).toMatchObject({
        state: "unavailable",
        reason: "missing_configuration",
    });
    expect(call.reportedCost).toBeUndefined();
    expect(counts()).toEqual({ generations: 1, lookups: 0 });
}, 20000);

test("an expired scheduled lookup can be explicitly recovered without duplicating its dispatch", async () => {
    const { t, admin, call, counts } = await interruptedCall(
        async () => new Response("Unavailable", { status: 404 }),
    );
    await vi.advanceTimersByTimeAsync(30000);
    expect(
        await admin.mutation(api.providerCalls.retryBilling, {
            providerCallId: call._id,
        }),
    ).toEqual({ scheduled: true });
    await t.run(async (ctx) => {
        const jobs = await ctx.db.system
            .query("_scheduled_functions")
            .collect();
        for (const job of jobs)
            if (
                job.name === "integrations/openRouterGeneration:reconcile" &&
                job.state.kind === "pending"
            )
                await ctx.scheduler.cancel(job._id);
    });
    await vi.advanceTimersByTimeAsync(30000);
    expect(
        await admin.mutation(api.providerCalls.retryBilling, {
            providerCallId: call._id,
        }),
    ).toEqual({ scheduled: true });
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10));
    expect(counts()).toEqual({ generations: 1, lookups: 2 });
}, 20000);
