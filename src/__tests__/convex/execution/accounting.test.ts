import { internal } from "@convex/_generated/api";
import { sha256Hex } from "@convex/domain/sourcePassages";
import { getAgentDefinition } from "@convex/execution/agentCatalog";
import { expect, test } from "vitest";
import { seedInspectedEvidence } from "@/__tests__/setup/source-preparation";

async function reasoningFixture() {
    const fixture = await seedInspectedEvidence();
    const { t, args } = fixture;
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "reasoning-test",
        expectedGeneration: 4,
    });
    async function attempt(taskKey: string) {
        const inputJson = JSON.stringify({ missionId, taskKey });
        const invocationId = await t.run((ctx) =>
            ctx.db.insert("agentInvocations", {
                missionId,
                runId: args.runId,
                corpusRevisionId: args.corpusRevisionId,
                generation: 4,
                definitionVersion: getAgentDefinition(
                    "saved_material_inspection_v1",
                ).version,
                taskKey,
                provenance: "live",
                status: "started",
                inputJson,
                createdAt: Date.now(),
            }),
        );
        return {
            missionId,
            invocationId,
            runId: args.runId,
            corpusRevisionId: args.corpusRevisionId,
            executionGeneration: 4,
            workflowVersion: getAgentDefinition("saved_material_inspection_v1")
                .version,
            stepKey: "agent_reasoning",
            service: "model" as const,
            operation: "agent_reasoning",
            operationKey: `mission:${missionId}:invocation:${invocationId}:attempt:1`,
            attempt: 1,
            inputHash: sha256Hex(inputJson),
        };
    }
    return { ...fixture, missionId, attempt };
}

test("reasoning reserves the same final dossier budget unit atomically", async () => {
    const { t, args, attempt } = await reasoningFixture();
    await t.run((ctx) =>
        ctx.db.patch(args.runId, {
            sourcePreparationBudget: {
                version: 1,
                work: 119,
                incidents: 0,
                reserved: 0,
                dispatches: 119,
            },
        }),
    );
    const first = await attempt("first");
    const second = await attempt("second");
    const outcomes = await Promise.allSettled(
        [first, second].map((input) =>
            t.mutation(internal.providerCalls.recordAttempt, {
                ...input,
                status: "started",
            }),
        ),
    );
    expect(
        outcomes.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.get(args.runId))).toMatchObject({
        sourcePreparationBudget: { work: 119, reserved: 1, dispatches: 120 },
    });
});

test("a late factual reasoning receipt closes without reviving cancelled work", async () => {
    const { t, args, attempt } = await reasoningFixture();
    const input = await attempt("late-response");
    const admitted = await t.mutation(internal.providerCalls.recordAttempt, {
        ...input,
        status: "started",
    });
    await t.run((ctx) =>
        ctx.db.patch(args.runId, {
            executionStatus: "cancelled",
            executionGeneration: 5,
        }),
    );
    await t.mutation(internal.providerCalls.recordAttempt, {
        ...input,
        status: "succeeded",
        dispatchOutcome: "response_received",
        usage: { inputTokens: 10, outputTokens: 4 },
    });
    expect(
        await t.run((ctx) => ctx.db.get(admitted.providerCallId)),
    ).toMatchObject({ status: "succeeded" });
    expect(await t.run((ctx) => ctx.db.get(args.runId))).toMatchObject({
        executionStatus: "cancelled",
        executionGeneration: 5,
        sourcePreparationBudget: { work: 1, reserved: 0 },
    });
});

test("unknown reasoning outcomes retain capacity and refuse a blind lease replay", async () => {
    const { t, args, attempt } = await reasoningFixture();
    const input = await attempt("unknown-response");
    const admitted = await t.mutation(internal.providerCalls.recordAttempt, {
        ...input,
        status: "started",
    });
    await t.run((ctx) =>
        ctx.db.patch(admitted.providerCallId, {
            leaseExpiresAt: Date.now() - 1,
        }),
    );
    expect(
        await t.mutation(internal.providerCalls.recordAttempt, {
            ...input,
            status: "started",
        }),
    ).toMatchObject({
        shouldExecute: false,
        errorCode: "attempt_outcome_unknown",
    });
    expect(await t.run((ctx) => ctx.db.get(args.runId))).toMatchObject({
        sourcePreparationBudget: { reserved: 1, dispatches: 1 },
    });
    await t.run((ctx) =>
        ctx.db.patch(args.runId, {
            executionStatus: "cancelled",
            executionGeneration: 5,
        }),
    );
    await t.mutation(internal.providerCalls.recordAttempt, {
        ...input,
        status: "succeeded",
        dispatchOutcome: "response_received",
    });
    expect(await t.run((ctx) => ctx.db.get(args.runId))).toMatchObject({
        executionStatus: "cancelled",
        sourcePreparationBudget: { reserved: 0, work: 1, dispatches: 1 },
    });
});
