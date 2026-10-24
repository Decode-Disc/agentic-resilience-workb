import { internal } from "@convex/_generated/api";
import { sha256Hex } from "@convex/domain/sourcePassages";
import { afterEach, expect, test, vi } from "vitest";
import { seedSourcePreparation } from "@/__tests__/setup/source-preparation";

afterEach(() => vi.unstubAllEnvs());

async function activePreparation() {
    const fixture = await seedSourcePreparation();
    const { t, runId, corpusRevisionId, sourceId } = fixture;
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        {
            runId,
            corpusRevisionId,
            expectedExecutionGeneration: 3,
        },
    );
    const preparation = await t.run((ctx) => ctx.db.get(preparationId));
    if (!preparation) throw new Error("Missing preparation");
    const attempt = (label: string, number = 1) => {
        const inputHash = sha256Hex(label);
        return {
            runId,
            sourceId,
            corpusRevisionId,
            preparationId,
            executionGeneration: 3,
            workflowVersion: 1,
            stepKey: "source_preparation",
            service: "model" as const,
            operation: "source_qualification",
            inputHash,
            operationKey: `${preparation.operationKey}:step:source_preparation:input:${inputHash}:attempt:${number}`,
            attempt: number,
        };
    };
    return { ...fixture, preparationId, preparation, attempt };
}

test("an explicit recovery can reserve a fourth lifetime attempt", async () => {
    const { t, preparationId, preparation, attempt } =
        await activePreparation();
    const input = attempt("recoverable", 4);
    await t.run(async (ctx) => {
        const { _id, _creationTime, ...previous } = preparation;
        const previousId = await ctx.db.insert(
            "sourceSelectionProposalRebuilds",
            {
                ...previous,
                operationKey: "previous-execution",
                status: "partial",
                createdAt: Date.now() - 30_000,
            },
        );
        await ctx.db.patch(preparationId, { resumesPreparationId: previousId });
        for (let number = 1; number <= 3; number++) {
            await ctx.db.insert("providerCalls", {
                ...attempt("recoverable", number),
                preparationId: previousId,
                status: "failed",
                errorCode: "transport_unavailable",
                dispatchOutcome: "response_received",
                httpStatus: 503,
                createdAt: Date.now() - 25_000,
                completedAt: Date.now() - 20_000,
            });
        }
    });
    expect(
        await t.query(internal.providerCalls.nextPreparationAttemptForInput, {
            preparationId,
            sourceId: input.sourceId,
            operation: input.operation,
            inputHash: input.inputHash,
            now: Date.now(),
        }),
    ).toMatchObject({ attempt: 4 });
    expect(
        await t.mutation(internal.providerCalls.recordAttempt, {
            ...input,
            status: "started",
        }),
    ).toMatchObject({ shouldExecute: true });
});

test("settlement is idempotent and technical failures do not consume work", async () => {
    vi.stubEnv("SOURCE_PREPARATION_WORK_LIMIT", "1");
    vi.stubEnv("SOURCE_PREPARATION_INCIDENT_LIMIT", "2");
    const { t, runId, attempt } = await activePreparation();
    const first = attempt("first");
    await t.mutation(internal.providerCalls.recordAttempt, {
        ...first,
        status: "started",
    });
    const failure = {
        ...first,
        status: "failed" as const,
        errorCode: "transport_unavailable",
        dispatchOutcome: "response_received" as const,
        httpStatus: 503,
    };
    await t.mutation(internal.providerCalls.recordAttempt, failure);
    await t.mutation(internal.providerCalls.recordAttempt, failure);
    const second = attempt("first", 2);
    await t.mutation(internal.providerCalls.recordAttempt, {
        ...second,
        status: "started",
    });
    await t.mutation(internal.providerCalls.recordAttempt, {
        ...second,
        status: "succeeded",
    });
    await t.mutation(internal.providerCalls.recordAttempt, {
        ...second,
        status: "succeeded",
    });
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
        sourcePreparationBudget: {
            work: 1,
            incidents: 1,
            reserved: 0,
            dispatches: 2,
        },
    });
    await expect(
        t.mutation(internal.providerCalls.recordAttempt, {
            ...attempt("next"),
            status: "started",
        }),
    ).rejects.toThrow("work_budget_exhausted");
});

test("a pending or unknown call retains capacity and cannot be replayed", async () => {
    vi.stubEnv("SOURCE_PREPARATION_WORK_LIMIT", "1");
    const { t, runId, attempt } = await activePreparation();
    const input = attempt("unknown");
    await t.mutation(internal.providerCalls.recordAttempt, {
        ...input,
        status: "started",
    });
    await expect(
        t.mutation(internal.providerCalls.recordAttempt, {
            ...attempt("other"),
            status: "started",
        }),
    ).rejects.toThrow("work_budget_exhausted");
    await t.mutation(internal.providerCalls.recordAttempt, {
        ...input,
        status: "failed",
        errorCode: "request_timeout",
        dispatchOutcome: "unknown",
    });
    expect(
        await t.mutation(internal.providerCalls.recordAttempt, {
            ...input,
            status: "started",
        }),
    ).toMatchObject({ shouldExecute: false });
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
        sourcePreparationBudget: {
            work: 0,
            incidents: 0,
            reserved: 1,
            dispatches: 1,
        },
    });
});

test("two concurrent reservations cannot spend the same final unit", async () => {
    vi.stubEnv("SOURCE_PREPARATION_WORK_LIMIT", "1");
    const { t, runId, attempt } = await activePreparation();
    const results = await Promise.allSettled(
        ["left", "right"].map((label) =>
            t.mutation(internal.providerCalls.recordAttempt, {
                ...attempt(label),
                status: "started",
            }),
        ),
    );
    expect(
        results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
        results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
        sourcePreparationBudget: { reserved: 1, dispatches: 1 },
    });
});

test("received invalid output exhausts only the technical allowance", async () => {
    vi.stubEnv("SOURCE_PREPARATION_INCIDENT_LIMIT", "1");
    const { t, runId, attempt } = await activePreparation();
    const input = attempt("invalid");
    await t.mutation(internal.providerCalls.recordAttempt, {
        ...input,
        status: "started",
    });
    await t.mutation(internal.providerCalls.recordAttempt, {
        ...input,
        status: "failed",
        errorCode: "invalid_output",
        dispatchOutcome: "response_received",
        httpStatus: 200,
    });
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
        sourcePreparationBudget: {
            work: 0,
            incidents: 1,
            reserved: 0,
            dispatches: 1,
        },
    });
    await expect(
        t.mutation(internal.providerCalls.recordAttempt, {
            ...attempt("other"),
            status: "started",
        }),
    ).rejects.toThrow("incident_budget_exhausted");
});

test("proved non-dispatch releases capacity and configuration is frozen per execution", async () => {
    vi.stubEnv("SOURCE_PREPARATION_WORK_LIMIT", "1");
    vi.stubEnv("SOURCE_PREPARATION_INCIDENT_LIMIT", "1");
    const { t, runId, attempt } = await activePreparation();
    vi.stubEnv("SOURCE_PREPARATION_WORK_LIMIT", "10");
    const input = attempt("not-sent");
    await t.mutation(internal.providerCalls.recordAttempt, {
        ...input,
        status: "started",
    });
    await t.mutation(internal.providerCalls.recordAttempt, {
        ...input,
        status: "failed",
        errorCode: "missing_configuration",
        dispatchOutcome: "not_dispatched",
    });
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
        sourcePreparationBudget: {
            work: 0,
            incidents: 0,
            reserved: 0,
            dispatches: 0,
        },
    });
    const other = attempt("other");
    await t.mutation(internal.providerCalls.recordAttempt, {
        ...other,
        status: "started",
    });
    await t.mutation(internal.providerCalls.recordAttempt, {
        ...other,
        status: "succeeded",
    });
    await expect(
        t.mutation(internal.providerCalls.recordAttempt, {
            ...attempt("beyond-snapshot"),
            status: "started",
        }),
    ).rejects.toThrow("work_budget_exhausted");
});

test.each([
    "0",
    "-1",
    "1.2",
    "broken",
    "9007199254740992",
])("invalid limit %s prevents claiming an execution", async (value) => {
    vi.stubEnv("SOURCE_PREPARATION_WORK_LIMIT", value);
    await expect(activePreparation()).rejects.toThrow(
        "preparation_configuration_invalid",
    );
});

test("a clipped legacy history cannot create fresh allowance without a counter", async () => {
    const { t, runId, corpusRevisionId, sourceId } =
        await seedSourcePreparation();
    await t.run(async (ctx) => {
        for (let index = 0; index < 122; index++) {
            const sent = index === 121;
            await ctx.db.insert("providerCalls", {
                runId,
                sourceId,
                service: "model",
                operation: "source_qualification",
                operationKey: `legacy:${index}`,
                inputHash: (sent ? "f" : "0").repeat(64),
                attempt: 1,
                status: sent ? "succeeded" : "failed",
                createdAt: 1,
                completedAt: 2,
                dispatchOutcome: sent ? "response_received" : "not_dispatched",
            });
        }
    });
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        {
            runId,
            corpusRevisionId,
            expectedExecutionGeneration: 3,
        },
    );
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
        sourcePreparationBudget: { reserved: 120, dispatches: 120 },
    });
    const preparation = await t.run((ctx) => ctx.db.get(preparationId));
    const inputHash = sha256Hex("new-input");
    await expect(
        t.mutation(internal.providerCalls.recordAttempt, {
            runId,
            sourceId,
            corpusRevisionId,
            preparationId,
            executionGeneration: 3,
            workflowVersion: 1,
            stepKey: "source_preparation",
            service: "model",
            operation: "source_qualification",
            inputHash,
            operationKey: `${preparation?.operationKey}:step:source_preparation:input:${inputHash}:attempt:1`,
            attempt: 1,
            status: "started",
        }),
    ).rejects.toThrow("work_budget_exhausted");
});

test("historical technical failures leave the productive allowance available", async () => {
    const { t, runId, sourceId, corpusRevisionId } =
        await seedSourcePreparation();
    await t.run(async (ctx) => {
        for (let index = 0; index < 120; index++) {
            await ctx.db.insert("providerCalls", {
                runId,
                sourceId,
                service: "model",
                operation: "source_qualification",
                operationKey: `historical:${index}`,
                inputHash: sha256Hex(`historical:${index}`),
                attempt: 1,
                status: index < 100 ? "succeeded" : "failed",
                dispatchOutcome: "response_received",
                ...(index < 100
                    ? {}
                    : { httpStatus: 429, errorCode: "transport_unavailable" }),
                createdAt: 1,
                completedAt: 2,
            });
        }
        await ctx.db.patch(runId, { sourceQualificationAttemptCount: 120 });
    });
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        {
            runId,
            corpusRevisionId,
            expectedExecutionGeneration: 3,
        },
    );
    const preparation = await t.run((ctx) => ctx.db.get(preparationId));
    const inputHash = sha256Hex("unfinished-input");
    const result = await t.mutation(internal.providerCalls.recordAttempt, {
        runId,
        sourceId,
        corpusRevisionId,
        preparationId,
        executionGeneration: 3,
        workflowVersion: 1,
        stepKey: "source_preparation",
        service: "model",
        operation: "source_qualification",
        inputHash,
        operationKey: `${preparation?.operationKey}:step:source_preparation:input:${inputHash}:attempt:1`,
        attempt: 1,
        status: "started",
    });
    expect(result.shouldExecute).toBe(true);
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
        sourceQualificationAttemptCount: 121,
        sourcePreparationBudget: {
            work: 100,
            incidents: 20,
            reserved: 1,
            dispatches: 121,
        },
    });
});
