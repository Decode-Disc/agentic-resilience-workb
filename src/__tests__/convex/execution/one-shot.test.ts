import { internal } from "@convex/_generated/api";
import { sha256Hex } from "@convex/domain/sourcePassages";
import { expect, test } from "vitest";
import { seedSourcePreparation } from "@/__tests__/setup/source-preparation";

test("an existing authorized preparation attempt retains its one-shot context and late result", async () => {
    const { t, runId, corpusRevisionId, sourceId } =
        await seedSourcePreparation();
    await t.mutation(internal.researchPlanning.createForRun, {
        runId,
        expectedExecutionGeneration: 3,
    });
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        { runId, corpusRevisionId, expectedExecutionGeneration: 3 },
    );
    const preparation = await t.run((ctx) => ctx.db.get(preparationId));
    if (!preparation) throw new Error("Missing preparation");
    const inputJson = JSON.stringify({
        instructions: "Inspect the retained source.",
        protocolVersion: "test-v1",
        sourceId,
    });
    const inputHash = sha256Hex(inputJson);
    const attempt = {
        runId,
        corpusRevisionId,
        sourceId,
        preparationId,
        executionGeneration: 3,
        workflowVersion: preparation.workflowVersion,
        stepKey: "source_preparation",
        service: "model" as const,
        operation: "source_qualification",
        operationKey: `${preparation.operationKey}:step:source_preparation:input:${inputHash}:attempt:1`,
        inputHash,
        attempt: 1,
    };
    const claimed = await t.mutation(internal.providerCalls.recordAttempt, {
        ...attempt,
        status: "started",
    });
    const invocationId = await t.mutation(
        internal.execution.invocations.beginOneShot,
        { providerCallId: claimed.providerCallId, inputJson },
    );
    expect(
        await t.mutation(internal.execution.invocations.beginOneShot, {
            providerCallId: claimed.providerCallId,
            inputJson,
        }),
    ).toBe(invocationId);
    await t.run((ctx) =>
        ctx.db.patch(runId, {
            executionStatus: "cancelled",
            executionGeneration: 4,
        }),
    );
    await t.mutation(internal.providerCalls.recordAttempt, {
        ...attempt,
        status: "failed",
        errorCode: "invalid_output",
        dispatchOutcome: "response_received",
    });
    await t.mutation(internal.execution.invocations.finishOneShot, {
        invocationId,
        outputJson: JSON.stringify({
            status: "failed",
            errorCode: "invalid_output",
            diagnostic: "Retained observable output. ".repeat(12_000),
        }),
    });
    expect(await t.run((ctx) => ctx.db.get(invocationId))).toMatchObject({
        inputJson,
        generationBackend: { id: "ai-sdk", version: 1 },
        status: "returned",
        provenance: "live",
        providerCallId: claimed.providerCallId,
    });
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
        executionStatus: "cancelled",
        executionGeneration: 4,
    });
});
