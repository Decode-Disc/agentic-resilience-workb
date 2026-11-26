import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { api, internal } from "@convex/_generated/api";
import { framingEventBasis } from "@convex/domain/framingContracts";
import { savedFramingReceipt } from "@convex/domain/framingProvenance";
import { sha256Hex } from "@convex/domain/sourcePassages";
import { readWorkbenchFacts } from "@convex/domain/workbenchContext";
import { coherenceRequest } from "@convex/domain/workbenchResponseControlContracts";
import {
    operationOutcomeValidator,
    requestInputValidator,
} from "@convex/execution/executionProtocol";
import { validate } from "convex-helpers/validators";
import { afterEach, assert, expect, test, vi } from "vitest";
import retained from "@/__tests__/setup/fixtures/nvidia-citation-review.json";
import { nativePiFixtureRoute } from "@/__tests__/setup/pi-native";
import { readConversationPageWithBodies } from "@/__tests__/setup/retained-messages";
import { workbenchAdmissionInput } from "@/__tests__/setup/workbench";
import { seedWorkbenchMaterials } from "@/__tests__/setup/workbench-materials";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

test.each([
    false,
    true,
])("retained NVIDIA framing preserves publication with controller enabled=%s", async (enabled) => {
    const { t, client, runId, sourceId, captureId } =
        await seedWorkbenchMaterials(1, 0, nativePiFixtureRoute);
    vi.stubGlobal(
        "fetch",
        vi.fn(() => {
            throw new Error("Network forbidden");
        }),
    );
    await t.run(async (ctx) => {
        const originalRun = await ctx.db.get(runId);
        assert(originalRun?.companyId);
        await ctx.db.patch(originalRun.companyId, retained.company);
        await ctx.db.patch(runId, {
            lifecycleState: "framing",
            executionStatus: "idle",
            fixedFramingRevisionId: undefined,
            researchAngle: retained.request,
            companySnapshot: retained.company,
        });
        await ctx.db.insert("responseControlSettings", {
            key: "global",
            revision: 1,
            updatedAt: 1,
            enabled,
            model: "typesafe/jev-1.14",
            contradictionThreshold: 0.9,
            supportThreshold: 0.8,
        });
    });
    await client.mutation(api.execution.conversations.submit, {
        runId,
        requestKey: "retained-analyst-request",
        text: retained.request,
        delivery: "queue",
    });
    await t.run(async (ctx) => {
        const conversation = await ctx.db
            .query("agentConversations")
            .withIndex("by_run", (q) => q.eq("runId", runId))
            .unique();
        assert(conversation);
        await ctx.db.patch(conversation._id, { definitionVersion: 11 });
    });
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
    await t.run(async (ctx) => {
        const turn = await ctx.db.get(active.turnId);
        assert(turn);
        const revisionId = await ctx.db.insert("framingRevisions", {
            runId,
            revision: retained.framing.revision,
            content: retained.framing.content,
            origin: "workbench",
            requestKey: "retained-framing",
            contentHash: "f".repeat(64),
            createdAt: 1,
        });
        const message = await ctx.db
            .query("agentMessageDeliveries")
            .withIndex("by_turn", (q) => q.eq("turnId", active.turnId))
            .first();
        assert(message);
        const firstReading = retained.readings[0];
        assert(firstReading);
        const replacements = new Map<string, string>([
            [firstReading.sourceId, sourceId],
            [firstReading.captureId, captureId],
            [firstReading.messageId, message._id],
        ]);
        for (const operation of retained.operations) {
            const id = await ctx.db.insert("agentOperationRequests", {
                runId,
                missionId: active.missionId,
                actor: "agent",
                cause: "retained-operation",
                input: { kind: "consult_run_state" },
                operationVersion: operation.operationVersion,
                expectedGeneration: 1,
                logicalKey: operation.id,
                status: "completed",
                createdAt: 1,
                completedAt: 1,
                adoptedAt: 1,
            });
            replacements.set(operation.id, id);
        }
        const remap = (value: unknown): unknown => {
            let json = JSON.stringify(value);
            for (const [old, current] of replacements)
                json = json.replaceAll(old, current);
            return JSON.parse(json);
        };
        for (const operation of retained.operations) {
            const input = remap(operation.input);
            const outcome = remap(operation.outcome);
            assert(
                validate(requestInputValidator, input, { db: ctx.db }),
                `Invalid retained input ${operation.input.kind}`,
            );
            assert(
                validate(operationOutcomeValidator, outcome, { db: ctx.db }),
            );
            const remappedId = replacements.get(operation.id);
            assert(remappedId);
            const id = ctx.db.normalizeId("agentOperationRequests", remappedId);
            assert(id);
            const reading = retained.readings.find(
                (r) => r.id === operation.id,
            );
            const admissionEventId = await ctx.db.insert(
                "agentExecutionEvents",
                {
                    runId,
                    missionId: active.missionId,
                    requestId: id,
                    kind: "operation_requested",
                    cause: "retained-operation",
                    sequence: retained.operations.indexOf(operation) + 1,
                    occurredAt: 1,
                },
            );
            await ctx.db.patch(id, {
                input,
                outcome,
                admissionEventId,
                ...(input.kind === "adjust_framing" &&
                outcome.kind === "success"
                    ? {
                          effect: {
                              pin: {
                                  kind: "framing_revision" as const,
                                  revisionId,
                              },
                              outcome,
                          },
                      }
                    : {}),
                ...(reading
                    ? {
                          pin: {
                              kind: "documentary_v1" as const,
                              scope: {
                                  kind: "framing" as const,
                                  revisionId,
                                  cause: {
                                      messageId: message._id,
                                      instructionVersion: 1,
                                  },
                              },
                              target: {
                                  kind: "capture" as const,
                                  sourceId,
                                  captureId,
                                  contentHash: reading.contentHash,
                              },
                          },
                      }
                    : {}),
            });
        }
        const eventBasis = remap(retained.framing.eventBasis);
        assert(validate(framingEventBasis, eventBasis, { db: ctx.db }));
        await ctx.db.patch(revisionId, { eventBasis });
        await ctx.db.patch(runId, { currentFramingRevisionId: revisionId });
    });
    const begun = await t.mutation(internal.execution.invocations.begin, {
        missionId: active.missionId,
        expectedGeneration: 1,
        taskKey: "retained-draft",
        provenance: "live",
        nativeInput: await workbenchAdmissionInput(t, active.missionId),
    });
    assert(begun.kind === "ready");
    const invocation = await t.run((ctx) => ctx.db.get(begun.invocationId));
    assert(invocation);
    const identity = {
        missionId: active.missionId,
        invocationId: invocation._id,
        runId,
        executionGeneration: 1,
        workflowVersion: invocation.definitionVersion,
        service: "model" as const,
        operation: "agent_reasoning",
        stepKey: "agent_reasoning",
        operationKey: `mission:${active.missionId}:invocation:${invocation._id}:attempt:1`,
        attempt: 1,
        inputHash: sha256Hex(invocation.inputJson),
        corpusRevisionId: invocation.corpusRevisionId,
    };
    await t.mutation(internal.providerCalls.recordAttempt, {
        ...identity,
        status: "started",
    });
    await t.mutation(internal.providerCalls.recordAttempt, {
        ...identity,
        status: "succeeded",
        dispatchOutcome: "response_received",
        reportedCost: 0,
    });
    const measured = await t.run(async (ctx) => {
        const run = await ctx.db.get(runId);
        const mission = await ctx.db.get(active.missionId);
        assert(run?.currentFramingRevisionId && mission);
        const frame = await ctx.db.get(run.currentFramingRevisionId);
        assert(frame);
        const facts = await readWorkbenchFacts(ctx, run, mission);
        assert(facts.kind === "ready");
        const framing = facts.context.framing;
        assert(
            framing &&
                typeof framing === "object" &&
                "conditionReferences" in framing,
        );
        expect(framing.conditionReferences).toHaveLength(2);
        const request = coherenceRequest(
            "typesafe/jev-1.14",
            JSON.stringify({
                ...facts.context,
                framingWrite: { saved: savedFramingReceipt(frame) },
            }),
            retained.draft,
        );
        return {
            minimumRequestBytes: new TextEncoder().encode(request).length,
        };
    });
    const result = await t.mutation(internal.execution.invocations.finish, {
        invocationId: begun.invocationId,
        expectedGeneration: 1,
        response: { kind: "complete", text: retained.draft },
    });
    const turn = await t.run((ctx) => ctx.db.get(active.turnId));
    if (process.env.FRAMING_CAPACITY_REPORT_DIRECTORY)
        writeFileSync(
            join(
                process.env.FRAMING_CAPACITY_REPORT_DIRECTORY,
                `capacity-${enabled}.json`,
            ),
            JSON.stringify(
                {
                    enabled,
                    ...measured,
                    result,
                    summary: turn?.responseControl?.summary,
                    publicationReason: turn?.responseControl?.publicationReason,
                    checks: turn?.responseControl?.checks.map((check) => ({
                        factsBytes: new TextEncoder().encode(check.factsJson)
                            .length,
                        requestBytes: new TextEncoder().encode(
                            coherenceRequest(
                                "typesafe/jev-1.14",
                                check.factsJson,
                                retained.draft,
                            ),
                        ).length,
                        result: check.result,
                    })),
                },
                null,
                2,
            ),
        );
    expect(result.kind).toBe("completed");
    expect(turn?.responseControl?.summary).toEqual({
        status: enabled ? "unavailable" : "not_checked",
    });
    expect(turn?.responseControl?.publicationReason).toBe(
        enabled ? "context_capacity" : "controller_disabled",
    );
    if (enabled) {
        const check = turn?.responseControl?.checks[0];
        assert(check);
        const facts = JSON.parse(check.factsJson);
        expect(facts.framingWrite.latestAttempt).toBe("saved");
        expect(
            facts.framingWrite.saved.publicCitations.conditions.map(
                (condition: { questionId: string }) => condition.questionId,
            ),
        ).toEqual(["q1", "q2", "q4", "q5"]);
        expect(
            new TextEncoder().encode(
                coherenceRequest(
                    "typesafe/jev-1.14",
                    check.factsJson,
                    retained.draft,
                ),
            ).length,
        ).toBeGreaterThan(32768);
        expect(check.result).toEqual({
            status: "unavailable",
            reason: "context_capacity",
        });
        expect(check.requestId).toBeUndefined();
    }
    const history = await readConversationPageWithBodies(client, {
        runId,
        paginationOpts: { cursor: null, numItems: 20 },
    });
    expect(history.page.find((m) => m.role === "assistant")?.text).toContain(
        retained.draft,
    );
    expect(fetch).not.toHaveBeenCalled();
});
