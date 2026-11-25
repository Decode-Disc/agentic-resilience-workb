import { internal } from "@convex/_generated/api";
import { sha256Hex } from "@convex/domain/sourcePassages";
import { executePreparationModel } from "@convex/sources/preparationModel";
import { makeFunctionReference } from "convex/server";
import { assert, expect, test } from "vitest";
import { seedSourcePreparation } from "@/__tests__/setup/source-preparation";

const advanceStreamUpgrade = makeFunctionReference<
    "mutation",
    { phase: "draining" | "frozen" | "active" },
    null
>("execution/retainedText:advanceStreamUpgrade");

test("claiming a recovery preserves the existing preparation protocol and engaged model", async () => {
    const { t, runId, corpusRevisionId } = await seedSourcePreparation({
        models: true,
    });
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        { runId, corpusRevisionId, expectedExecutionGeneration: 3 },
    );
    const model = await t.mutation(internal.modelConfiguration.forPreparation, {
        preparationId,
        expectedGeneration: 3,
    });
    await t.run(async (ctx) => {
        await ctx.db.patch(preparationId, {
            executionPlanVersion: "source_actions_v3",
        });
        await ctx.db.patch(runId, { executionGeneration: 4 });
    });
    const resumedId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        { runId, corpusRevisionId, expectedExecutionGeneration: 4 },
    );
    expect(resumedId).not.toBe(preparationId);
    expect(await t.run((ctx) => ctx.db.get(resumedId))).toMatchObject({
        executionPlanVersion: "source_actions_v3",
        modelRevisionId: model._id,
    });
});

test.each([
    "sealed",
    "abandoned",
    "reserved",
] as const)("one-shot drain handles %s work across activation", async (mode) => {
    const { t, runId, corpusRevisionId, sourceId } =
        await seedSourcePreparation({ models: true });
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
    await t.mutation(internal.modelConfiguration.forPreparation, {
        preparationId,
        expectedGeneration: 3,
    });
    await t.run((ctx) =>
        ctx.db.patch(preparationId, {
            executionPlanVersion: "source_actions_v3",
        }),
    );
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
    if (mode === "reserved") {
        await t.mutation(advanceStreamUpgrade, { phase: "draining" });
        expect(
            await t.run((ctx) => ctx.db.get(claimed.providerCallId)),
        ).toMatchObject({
            status: "started",
        });
        expect(
            (await t.run((ctx) => ctx.db.get(claimed.providerCallId)))
                ?.invocationId,
        ).toBeUndefined();
        const status = internal.execution.retainedText.streamUpgradeStatus;
        await expect(t.query(status, {})).resolves.toEqual({
            phase: "draining",
            blocker: {
                kind: "provider_receipt",
                providerCallId: claimed.providerCallId,
            },
        });
        await expect(
            t.mutation(advanceStreamUpgrade, { phase: "frozen" }),
        ).rejects.toThrow("retained_stream_writers_active");
        await t.mutation(internal.providerCalls.recordAttempt, {
            ...attempt,
            status: "failed",
            errorCode: "retained_stream_upgrade_held",
            dispatchOutcome: "not_dispatched",
        });
        await expect(t.query(status, {})).resolves.toEqual({
            phase: "draining",
            blocker: null,
        });
        await t.mutation(advanceStreamUpgrade, { phase: "frozen" });
        await t.mutation(advanceStreamUpgrade, { phase: "active" });
        await expect(t.query(status, {})).resolves.toEqual({
            phase: "active",
            blocker: null,
        });
        return;
    }
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
    const dispatch = { invocationId, expectedGeneration: 3 };
    const providerCall = await t.run((ctx) =>
        ctx.db.get(claimed.providerCallId),
    );
    await t.mutation(internal.execution.invocationLifecycle.retainRequest, {
        ...dispatch,
        requestJson: '{"model":"fixture"}',
        effectiveMaxOutputTokens: providerCall?.reservedMaxOutputTokens,
    });
    await expect(
        t.query(
            internal.execution.invocationLifecycle.authorizeDispatch,
            dispatch,
        ),
    ).resolves.toBeNull();
    await t.mutation(
        internal.execution.invocationLifecycle.appendVisibleOutput,
        { invocationId, sequence: 0, text: "partial diagnostic" },
    );
    await t.mutation(advanceStreamUpgrade, { phase: "draining" });
    await expect(
        t.query(internal.execution.retainedText.streamUpgradeStatus, {}),
    ).resolves.toEqual({
        phase: "draining",
        blocker: { kind: "invocation", invocationId },
    });
    await expect(
        t.mutation(internal.providerCalls.recordAttempt, {
            ...attempt,
            status: "started",
        }),
    ).resolves.toMatchObject({
        providerCallId: claimed.providerCallId,
        shouldExecute: false,
    });
    const newAttempt = {
        ...attempt,
        inputHash: sha256Hex("new one-shot input during the hold"),
        status: "started" as const,
    };
    newAttempt.operationKey = `${preparation.operationKey}:step:source_preparation:input:${newAttempt.inputHash}:attempt:1`;
    await expect(
        t.mutation(internal.providerCalls.recordAttempt, newAttempt),
    ).rejects.toThrow("retained_stream_upgrade_held");
    expect(
        await t.run((ctx) =>
            ctx.db
                .query("providerCalls")
                .withIndex("by_operation_key", (q) =>
                    q.eq("operationKey", newAttempt.operationKey),
                )
                .first(),
        ),
    ).toBeNull();

    await expect(
        t.action((ctx) =>
            executePreparationModel(ctx, {
                preparation,
                sourceId,
                operation: "source_qualification",
                inputHash: newAttempt.inputHash,
                invocationInputJson: inputJson,
                executionDeadlineAt: Date.now() + 60_000,
                execute: async () => {
                    throw new Error(
                        "The held provider boundary must not be reached",
                    );
                },
            }),
        ),
    ).resolves.toMatchObject({ reasonCode: "retained_stream_upgrade_held" });
    await expect(
        t.mutation(advanceStreamUpgrade, { phase: "frozen" }),
    ).rejects.toThrow("retained_stream_writers_active");
    await expect(
        t.query(internal.execution.invocationLifecycle.authorizeDispatch, {
            invocationId,
            expectedGeneration: 3,
        }),
    ).rejects.toThrow("retained_stream_upgrade_held");
    await t.mutation(
        internal.execution.invocationLifecycle.appendVisibleOutput,
        { invocationId, sequence: 1, text: " received after admission closed" },
    );
    if (mode === "sealed")
        await t.mutation(
            internal.execution.invocationLifecycle.sealVisibleOutput,
            {
                invocationId,
                complete: false,
                terminalReason: "invalid_output",
            },
        );
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
    if (mode === "abandoned")
        await t.run(async (ctx) => {
            const invocation = await ctx.db.get(invocationId);
            assert(invocation?.visibleOutput);
            await ctx.db.patch(invocation.visibleOutput.textId, {
                streamManifestReady: undefined,
            });
        });
    await t.mutation(advanceStreamUpgrade, { phase: "frozen" });
    if (mode === "sealed")
        await expect(
            t.mutation(
                internal.execution.invocationLifecycle.sealVisibleOutput,
                {
                    invocationId,
                    complete: true,
                },
            ),
        ).rejects.toThrow("retained_stream_upgrade_held");
    if (mode === "abandoned") {
        const before = await t.run((ctx) => ctx.db.get(invocationId));
        assert(before?.visibleOutput);
        const { textId } = before.visibleOutput;
        await expect(
            t.query(internal.execution.retainedText.streamUpgradeStatus, {}),
        ).resolves.toEqual({
            phase: "frozen",
            blocker: { kind: "unresolved_manifest", textId },
        });
        expect(before.visibleOutput).toEqual({
            textId: expect.any(String),
            complete: false,
        });
        await expect(
            t.mutation(internal.execution.retainedText.backfillNextStream, {}),
        ).resolves.toMatchObject({ ready: true });
        await t.mutation(advanceStreamUpgrade, { phase: "active" });
        await expect(
            t.mutation(
                internal.execution.invocationLifecycle.sealVisibleOutput,
                {
                    invocationId,
                    complete: true,
                },
            ),
        ).rejects.toThrow("invocation_unavailable");
        expect(await t.run((ctx) => ctx.db.get(invocationId))).toEqual(before);
        expect(await t.run((ctx) => ctx.db.get(textId))).toMatchObject({
            streamManifestReady: true,
            stream: {
                sealed: false,
                nextSequence: 2,
                tail: "partial diagnostic received after admission closed",
            },
        });
        return;
    }
    await t.mutation(advanceStreamUpgrade, { phase: "active" });
    await expect(
        t.mutation(internal.execution.invocationLifecycle.sealVisibleOutput, {
            invocationId,
            complete: false,
            terminalReason: "invalid_output",
        }),
    ).resolves.toBeNull();
    expect(await t.run((ctx) => ctx.db.get(invocationId))).toMatchObject({
        inputJson,
        generationBackend: { id: "ai-sdk", version: 1 },
        visibleOutput: {
            complete: false,
            terminalReason: "invalid_output",
            contentHash: sha256Hex(
                "partial diagnostic received after admission closed",
            ),
        },
        status: "returned",
        provenance: "live",
        providerCallId: claimed.providerCallId,
    });
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
        executionStatus: "cancelled",
        executionGeneration: 4,
    });
});
