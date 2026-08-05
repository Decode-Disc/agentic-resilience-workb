import type { Id } from "@convex/_generated/dataModel";
import schema from "@convex/schema";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import rateLimiterTest from "./rate-limiter-test-register.js";

const modules = import.meta.glob("/convex/**/*.ts");
const reserveSecRateLimit = makeFunctionReference<
    "mutation",
    Record<string, never>,
    { retryAfter?: number }
>("providerCalls:reserveSecRateLimit");
const recordAttempt = makeFunctionReference<
    "mutation",
    {
        runId?: Id<"researchRuns">;
        executionGeneration?: number;
        service: "sec";
        operation: string;
        operationKey: string;
        status: "started" | "succeeded";
        attempt: number;
        latencyMs?: number;
    },
    {
        providerCallId: Id<"providerCalls">;
        shouldExecute: boolean;
        status: "started" | "succeeded";
    }
>("providerCalls:recordAttempt");

test("reserves SEC call slots through the rate-limiter component", async () => {
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);

    const reservations = await Promise.all([
        t.mutation(reserveSecRateLimit, {}),
        t.mutation(reserveSecRateLimit, {}),
        t.mutation(reserveSecRateLimit, {}),
    ]);

    // Token bucket with 8 tokens/sec — three calls should all succeed immediately
    expect(
        reservations.every(
            (r) =>
                typeof r.retryAfter === "number" || r.retryAfter === undefined,
        ),
    ).toBe(true);
    expect(reservations.filter((r) => (r.retryAfter ?? 0) > 0).length).toBe(0);
});

test("enforces SEC rate limit when bucket is exhausted", async () => {
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);

    // Exhaust the 8-token bucket with 9 concurrent calls
    const reservations = await Promise.all(
        Array.from({ length: 9 }, () => t.mutation(reserveSecRateLimit, {})),
    );

    // At least one call should have retryAfter > 0 (rate-limited)
    const rateLimited = reservations.filter((r) => (r.retryAfter ?? 0) > 0);
    expect(rateLimited.length).toBeGreaterThanOrEqual(1);
});

test("completes one persisted provider attempt", async () => {
    const t = convexTest(schema, modules);
    const input = {
        service: "sec" as const,
        operation: "resolve_company",
        operationKey: "resolve:CCCS",
        attempt: 1,
    };

    const started = await t.mutation(recordAttempt, {
        ...input,
        status: "started",
    });
    expect(started.shouldExecute).toBe(true);
    const replay = await t.mutation(recordAttempt, {
        ...input,
        status: "started",
    });
    expect(replay).toEqual({
        providerCallId: started.providerCallId,
        shouldExecute: false,
        status: "started",
    });
    await expect(
        t.mutation(recordAttempt, {
            ...input,
            status: "succeeded",
            latencyMs: 42,
        }),
    ).resolves.toEqual({
        providerCallId: started.providerCallId,
        shouldExecute: false,
        status: "succeeded",
    });
    await expect(
        t.run(async (ctx) => ctx.db.get(started.providerCallId)),
    ).resolves.toMatchObject({
        status: "succeeded",
        latencyMs: 42,
    });
});

test("separates runs and retry attempts", async () => {
    const t = convexTest(schema, modules);
    const [runA, runB] = await t.run(async (ctx) =>
        Promise.all([
            ctx.db.insert("researchRuns", {
                lifecycleState: "discovering_sources",
                executionStatus: "running",
                executionGeneration: 1,
                nextEventSequence: 1,
                createdAt: 1,
                updatedAt: 1,
            }),
            ctx.db.insert("researchRuns", {
                lifecycleState: "discovering_sources",
                executionStatus: "running",
                executionGeneration: 1,
                nextEventSequence: 1,
                createdAt: 1,
                updatedAt: 1,
            }),
        ]),
    );

    const starts = await Promise.all([
        t.mutation(recordAttempt, {
            runId: runA,
            executionGeneration: 1,
            service: "sec",
            operation: "revalidate_company",
            operationKey: "shared-logical-key",
            status: "started",
            attempt: 1,
        }),
        t.mutation(recordAttempt, {
            runId: runB,
            executionGeneration: 1,
            service: "sec",
            operation: "revalidate_company",
            operationKey: "shared-logical-key",
            status: "started",
            attempt: 1,
        }),
        t.mutation(recordAttempt, {
            runId: runA,
            executionGeneration: 1,
            service: "sec",
            operation: "revalidate_company",
            operationKey: "shared-logical-key",
            status: "started",
            attempt: 2,
        }),
    ]);

    expect(
        new Set(starts.map(({ providerCallId }) => providerCallId)).size,
    ).toBe(3);
    expect(starts.every(({ shouldExecute }) => shouldExecute)).toBe(true);
});

test("refuses a new provider lease after execution cancellation", async () => {
    const t = convexTest(schema, modules);
    const runId = await t.run((ctx) =>
        ctx.db.insert("researchRuns", {
            lifecycleState: "discovering_sources",
            executionStatus: "cancelled",
            executionGeneration: 2,
            nextEventSequence: 1,
            createdAt: 1,
            updatedAt: 2,
        }),
    );

    await expect(
        t.mutation(recordAttempt, {
            runId,
            executionGeneration: 1,
            service: "sec",
            operation: "discover_sources",
            operationKey: "cancelled-generation",
            status: "started",
            attempt: 2,
        }),
    ).rejects.toThrow("no longer active");
});
