import { api, internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import { getAgentDefinition } from "@convex/execution/agentCatalog";
import { domainSnapshot } from "@convex/execution/agentDefinition";
import { readMissionState } from "@convex/execution/missionHistory";
import { stageObservedBody } from "@convex/execution/observedReply";
import {
    retainedTextParts,
    stageRetainedText,
} from "@convex/execution/retainedText";
import { preparePiReply } from "@convex/integrations/piInvocation";
import { recoverCorrectionDraft } from "@convex/responseControl";
import { afterEach, assert, expect, test, vi } from "vitest";
import {
    beginFixtureInvocation,
    claimFixtureOperation,
    dispatchFixtureOperation,
    recordFixtureAttempt,
    retainFixtureOutput,
} from "@/__tests__/setup/pi-mission";
import { readRetainedBody } from "@/__tests__/setup/retained-history";
import {
    readConversationPageWithBodies,
    readWorkbenchPageWithBodies,
} from "@/__tests__/setup/retained-messages";
import {
    seedWorkbench,
    workbenchAdmissionInput,
} from "@/__tests__/setup/workbench";

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

test("native correction reconstructs an exact draft above the transaction read limit", async () => {
    const { t, runId } = await seedWorkbench(
        true,
        undefined,
        undefined,
        undefined,
        undefined,
        5,
        "balanced",
        { bytesRead: 128 * 1024 },
    );
    await t.run((ctx) => ctx.db.patch(runId, { agentExecutionVersion: 3 }));
    const active = await t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: true,
        },
    );
    assert(active);
    const scope = { missionId: active.missionId, expectedGeneration: 1 };
    const begun = await beginFixtureInvocation(t, {
        ...scope,
        taskKey: "large-correction",
        provenance: "simulation",
        nativeInput: await workbenchAdmissionInput(t, active.missionId),
    });
    assert(begun.kind === "ready");
    await t.run(async (ctx) => {
        const delivery = await ctx.db
            .query("agentMessageDeliveries")
            .withIndex("by_turn", (q) => q.eq("turnId", active.turnId))
            .first();
        assert(delivery?.bodyTextId);
        const old = await ctx.db.get(delivery.bodyTextId);
        assert(old);
        const { manifest, parts } = retainedTextParts("a".repeat(30_000));
        const [content] = parts;
        assert(content && parts.length === 1);
        const replacement = await stageRetainedText(
            ctx,
            "large-correction-instruction",
            {
                ...manifest,
                index: 0,
                content,
            },
        );
        await ctx.db.patch(old._id, { key: "small-correction-fixture" });
        await ctx.db.patch(replacement, { key: old.key });
        await ctx.db.patch(delivery._id, {
            bodyTextId: replacement,
            bodyContentHash: manifest.contentHash,
        });
    });
    await expect(
        t.mutation(internal.execution.invocations.finish, {
            invocationId: begun.invocationId,
            expectedGeneration: 1,
            response: { kind: "complete", text: "Research is running." },
        }),
    ).resolves.toMatchObject({
        kind: "blocked",
        code: "mission_context_changed",
    });
    expect(await t.run((ctx) => ctx.db.get(active.turnId))).toMatchObject({
        responseControl: {
            correction: {
                invocationId: begun.invocationId,
                instructionVersion: 1,
            },
        },
    });
    const draft = `Research is running. ${"x".repeat(175_000)} 🧭`;
    const { manifest, parts } = retainedTextParts(
        JSON.stringify({ kind: "complete", text: draft }),
    );
    let textId: Id<"retainedTexts"> | undefined;
    for (const [index, content] of parts.entries())
        textId = await t.run((ctx) =>
            stageRetainedText(
                ctx,
                `${begun.invocationId}:response:${manifest.contentHash}`,
                { ...manifest, index, content },
            ),
        );
    assert(textId);
    await t.run((ctx) =>
        ctx.db.patch(begun.invocationId, {
            receivedOutputTextId: textId,
            receivedOutputJson: undefined,
        }),
    );
    const defaultContext = await t.query(
        internal.execution.context.build,
        scope,
    );
    assert(defaultContext.kind === "ready");
    expect(
        JSON.parse(defaultContext.inputJson).domain.responseControl,
    ).toMatchObject({ draftResponseHash: manifest.contentHash });
    expect(
        JSON.parse(defaultContext.inputJson).domain.responseControl,
    ).not.toHaveProperty("draft");
    const admitted = await t.query(internal.execution.context.build, {
        ...scope,
        correctionAdmission: true,
    });
    assert(admitted.kind === "ready");
    const { draftResponseHash } = JSON.parse(admitted.inputJson).domain
        .responseControl;
    expect(draftResponseHash).toBe(manifest.contentHash);
    await expect(
        t.run((ctx) => readMissionState(ctx, scope, 8_192)),
    ).resolves.toMatchObject({
        kind: "ready",
        state: {
            version: 2,
            requiredState: {
                contentHash: sha256Hex(admitted.inputJson),
                generation: scope.expectedGeneration,
            },
        },
    });
    const recover = () =>
        t.action((ctx) =>
            recoverCorrectionDraft(ctx, {
                ...scope,
                contentHash: draftResponseHash,
            }),
        );
    expect(await recover()).toBe(draft);
    const retainedId = textId;
    const last = await t.run(async (ctx) => {
        const fragment = await ctx.db
            .query("retainedTextFragments")
            .withIndex("by_text_and_index", (q) =>
                q.eq("textId", retainedId).eq("index", parts.length - 1),
            )
            .unique();
        assert(fragment);
        await ctx.db.patch(fragment._id, { content: "Corrupted tail" });
        return fragment;
    });
    await expect(recover()).rejects.toThrow("retained_text_invalid");
    await t.run((ctx) => ctx.db.patch(last._id, { content: last.content }));
    expect(await recover()).toBe(draft);
});

async function prepareDraft(
    t: Awaited<ReturnType<typeof seedWorkbench>>["t"],
    invocationId: Id<"agentInvocations">,
    text: string,
) {
    const authority = { invocationId, expectedGeneration: 1 };
    const response = { kind: "complete" as const, text };
    const json = stableStringify(response);
    const responseTextId = await t.action((ctx) =>
        stageObservedBody(ctx, authority, "response", json),
    );
    const envelope = stableStringify({
        version: 1,
        provenance: "simulation",
        response,
    });
    const observableReplyTextId = await t.action((ctx) =>
        stageObservedBody(ctx, authority, "reply", envelope),
    );
    await retainFixtureOutput(t, {
        ...authority,
        ...(responseTextId ? { responseTextId } : { responseJson: json }),
        ...(observableReplyTextId
            ? { observableReplyTextId }
            : { observableReplyJson: envelope }),
    });
    const { mission } = await t.query(
        internal.execution.invocationLifecycle.forExecution,
        authority,
    );
    const prepared = await t.action((ctx) =>
        preparePiReply(
            ctx,
            authority,
            response,
            json,
            getAgentDefinition(mission.definitionId, mission.definitionVersion),
        ),
    );
    assert(prepared && "textId" in prepared);
    return prepared;
}

test.each([
    "Research is running.",
    `Research is running. ${"Supporting explanation. ".repeat(3500)}`,
])("a closed status conflict preserves its draft through contextual correction (%#)", async (draft) => {
    const { t, client, runId } = await seedWorkbench(true);
    await t.run((ctx) => ctx.db.patch(runId, { agentExecutionVersion: 3 }));
    const active = await t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: true,
        },
    );
    assert(active);
    const invocation = await beginFixtureInvocation(t, {
        missionId: active.missionId,
        expectedGeneration: 1,
        taskKey: "conflicting-draft",
        provenance: "simulation",
        nativeInput: await workbenchAdmissionInput(t, active.missionId),
    });
    assert(invocation.kind === "ready");
    const preparedDraft = await prepareDraft(t, invocation.invocationId, draft);
    const pending = await t.mutation(internal.execution.invocations.finish, {
        invocationId: invocation.invocationId,
        expectedGeneration: 1,
        preparedReply: preparedDraft,
    });
    expect(pending).toMatchObject({
        kind: "blocked",
        code: "mission_context_changed",
    });
    expect(
        (
            await readConversationPageWithBodies(client, {
                runId,
                paginationOpts: { numItems: 20, cursor: null },
            })
        ).page.filter((m) => m.role === "assistant"),
    ).toHaveLength(0);
    const originalAdopted = await t.run(async (ctx) => {
        const original = await ctx.db.get(invocation.invocationId);
        assert(original);
        const textId = original.receivedOutputTextId ?? original.outputTextId;
        await ctx.db.patch(original._id, {
            receivedOutputJson:
                original.receivedOutputJson ?? original.outputJson,
            receivedOutputTextId: textId,
            outputTextId: textId,
            outputJson: textId
                ? "unrelated adopted reply"
                : original.outputJson,
        });
        return {
            outputJson: original.outputJson,
            outputTextId: original.outputTextId,
            receivedOutputJson: original.receivedOutputJson,
            receivedOutputTextId: original.receivedOutputTextId,
        };
    });
    const admission = await t.query(internal.execution.context.build, {
        missionId: active.missionId,
        expectedGeneration: 1,
        correctionAdmission: true,
    });
    assert(admission.kind === "ready");
    const admissionInput = JSON.parse(admission.inputJson);
    expect(admissionInput.domain.responseControl.reminder).toContain(
        "Research has not started.",
    );
    expect(admissionInput.domain.responseControl).not.toHaveProperty("draft");
    expect(admissionInput.constraints.operations).toEqual([]);
    await expect(
        t.query(internal.responseControl.correctionFragment, {
            missionId: active.missionId,
            expectedGeneration: 1,
            contentHash: "0".repeat(64),
            index: 0,
        }),
    ).rejects.toThrow("mission_context_changed");
    const context = await t.query(internal.execution.context.build, {
        missionId: active.missionId,
        expectedGeneration: 1,
    });
    assert(context.kind === "ready");
    const input = JSON.parse(context.inputJson);
    expect(input.domain.responseControl.reminder).toContain(
        "Research has not started.",
    );
    if (originalAdopted.receivedOutputTextId) {
        expect(input.domain.responseControl).not.toHaveProperty("draft");
        const contentHash = sha256Hex(
            stableStringify({ kind: "complete", text: draft }),
        );
        expect(input.domain.responseControl.draftResponseHash).toBe(
            contentHash,
        );
        expect(
            await t.action((ctx) =>
                recoverCorrectionDraft(ctx, {
                    missionId: active.missionId,
                    expectedGeneration: 1,
                    contentHash,
                }),
            ),
        ).toBe(draft);
    } else expect(input.domain.responseControl.draft).toBe(draft);
    expect(input.constraints.operations).toEqual([]);
    await t.run((ctx) =>
        ctx.db.patch(invocation.invocationId, {
            outputJson: originalAdopted.outputJson,
            outputTextId: originalAdopted.outputTextId,
            receivedOutputJson: originalAdopted.receivedOutputJson,
            receivedOutputTextId: originalAdopted.receivedOutputTextId,
        }),
    );
    const lease = await t.mutation(internal.execution.piStore.claim, {
        missionId: active.missionId,
        expectedGeneration: 1,
        writer: "historical-correction-anchor",
    });
    await t.run((ctx) =>
        ctx.db.patch(lease.sessionId, {
            observationSequence: undefined,
            observationEntry: undefined,
        }),
    );
    const recovered = await t.mutation(
        internal.execution.piStore.inputSnapshot,
        lease,
    );
    assert(recovered.anchor);
    const anchorControl = JSON.parse(recovered.anchor).domain.responseControl;
    expect(anchorControl).not.toHaveProperty("draft");
    expect(anchorControl.draftResponseHash).toBe(
        admissionInput.domain.responseControl.draftResponseHash,
    );
    const correction = await beginFixtureInvocation(t, {
        missionId: active.missionId,
        expectedGeneration: 1,
        taskKey: "corrected-draft",
        provenance: "simulation",
        nativeInput: await workbenchAdmissionInput(t, active.missionId),
    });
    assert(correction.kind === "ready");
    const preparedCorrection = await prepareDraft(
        t,
        correction.invocationId,
        draft,
    );
    const final = await t.mutation(internal.execution.invocations.finish, {
        invocationId: correction.invocationId,
        expectedGeneration: 1,
        preparedReply: preparedCorrection,
    });
    expect(final.kind).toBe("completed");
    const messages = await readConversationPageWithBodies(client, {
        runId,
        paginationOpts: { numItems: 20, cursor: null },
    });
    expect(messages.page.find((m) => m.role === "assistant")).toMatchObject({
        text: draft,
        responseControl: { status: "review_needed" },
    });
    const stored = await t.run((ctx) => ctx.db.get(invocation.invocationId));
    assert(stored);
    const original = stored.outputTextId
        ? await readRetainedBody(t, stored.outputTextId)
        : stored.outputJson;
    expect(JSON.parse(original ?? "{}").text).toBe(draft);
});

test("an enabled controller defers an operation-bearing reply for a host-owned check", async () => {
    const { t, runId } = await seedWorkbench(true);
    await t.run(async (ctx) => {
        await ctx.db.patch(runId, { agentExecutionVersion: 3 });
        await ctx.db.insert("responseControlSettings", {
            key: "global",
            revision: 1,
            updatedAt: 1,
            enabled: true,
            model: "typesafe/jev-1.14",
            contradictionThreshold: 0.95,
            supportThreshold: 0.7,
        });
    });
    const active = await t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: true,
        },
    );
    assert(active);
    const invocation = await beginFixtureInvocation(t, {
        missionId: active.missionId,
        expectedGeneration: 1,
        taskKey: "operation-bearing",
        provenance: "simulation",
        nativeInput: await workbenchAdmissionInput(t, active.missionId),
    });
    assert(invocation.kind === "ready");
    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        missionId: active.missionId,
        expectedGeneration: 1,
        cause: "inspect-state",
        input: { kind: "consult_run_state" },
    });
    await dispatchFixtureOperation(t, {
        requestId,
        expectedGeneration: 1,
    });
    const finished = await t.mutation(internal.execution.invocations.finish, {
        invocationId: invocation.invocationId,
        expectedGeneration: 1,
        response: { kind: "complete", text: "The dossier remains available." },
    });
    expect(finished).toMatchObject({
        kind: "blocked",
        code: "pending_operations",
    });
    const requests = await t.run((ctx) =>
        ctx.db
            .query("agentOperationRequests")
            .withIndex("by_mission", (q) => q.eq("missionId", active.missionId))
            .take(10),
    );
    expect(
        requests.find((r) => r.input.kind === "check_response_coherence"),
    ).toMatchObject({ actor: "system", status: "pending" });
});

async function liveReviewFixture() {
    const { WORKBENCH_MODEL_ROUTE } = await import(
        "@convex/integrations/modelRouting"
    );
    const { sha256Hex } = await import("@convex/domain/sourcePassages");
    const { t, client, runId } = await seedWorkbench(
        false,
        WORKBENCH_MODEL_ROUTE,
    );
    await t.run(async (ctx) => {
        await ctx.db.patch(runId, { agentExecutionVersion: 3 });
        await ctx.db.insert("responseControlSettings", {
            key: "global",
            revision: 1,
            updatedAt: 1,
            enabled: true,
            model: "typesafe/jev-1.14",
            contradictionThreshold: 0.95,
            supportThreshold: 0.7,
        });
    });
    vi.stubEnv("OPENROUTER_API_KEY", "test-response-control-key");
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
    const missionId = active.missionId;
    async function draft(key: string) {
        const invocation = await beginFixtureInvocation(t, {
            missionId: missionId,
            expectedGeneration: 1,
            taskKey: key,
            provenance: "live",
            nativeInput: await workbenchAdmissionInput(t, missionId),
        });
        assert(invocation.kind === "ready");
        const row = await t.run((ctx) => ctx.db.get(invocation.invocationId));
        assert(row);
        const identity = {
            missionId: missionId,
            invocationId: row._id,
            runId,
            executionGeneration: 1,
            workflowVersion: row.definitionVersion,
            service: "model" as const,
            operation: "agent_reasoning",
            stepKey: "agent_reasoning",
            operationKey: `mission:${missionId}:invocation:${row._id}:attempt:1`,
            attempt: 1,
            inputHash: sha256Hex(row.inputJson),
            corpusRevisionId: row.corpusRevisionId,
        };
        await recordFixtureAttempt(t, {
            ...identity,
            status: "started",
        });
        await recordFixtureAttempt(t, {
            ...identity,
            status: "succeeded",
            dispatchOutcome: "response_received",
            reportedCost: 0,
        });
        return row;
    }
    return { t, client, runId, missionId: active.missionId, draft };
}

test.each([
    "ordinary",
    "sources",
    "ungranted",
    "mismatch",
])("native Jev respects the %s qualification policy", async (qualificationMode) => {
    const { t, client, runId, missionId, draft } = await liveReviewFixture();
    let latestTimeout: number | undefined, decisionTimeout: number | undefined;
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
        latestTimeout = ms;
        return timeout(ms);
    });
    vi.stubGlobal(
        "fetch",
        vi.fn(async (url: unknown) => {
            if (String(url).includes("/models?"))
                return Response.json({
                    data: [
                        {
                            id: "typesafe/jev-1.14",
                            context_length: 262144,
                            pricing: { prompt: "0.000000042", completion: "0" },
                        },
                    ],
                });
            decisionTimeout = latestTimeout;
            expect(String(url)).toBe(
                "https://openrouter.ai/api/alpha/decisions",
            );
            return Response.json({
                model: "typesafe/jev-1.14-test",
                answers: {
                    assessment: {
                        type: "choice",
                        choice: "contradicted",
                        confidence: 0.92,
                        probabilities: {
                            supported: 0.03,
                            contradicted: 0.92,
                            insufficient_information: 0.05,
                        },
                    },
                },
                usage: { cost: 0.00002 },
            });
        }),
    );
    const row = await draft("native-review");
    if (qualificationMode !== "ordinary") {
        vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
        vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
        await t.run(async (ctx) => {
            const run = await ctx.db.get(runId);
            const mission = await ctx.db.get(missionId);
            assert(run?.ownerVisitorId && mission?.modelRevisionId);
            const visitor = await ctx.db.get(run.ownerVisitorId);
            assert(visitor);
            await ctx.db.patch(visitor.invitationId, { slotKey: "analyst-4" });
        });
        const contextId = await t.mutation(
            internal.runWorkspace.openBrowserTestContext,
            {
                slotKey: "analyst-4",
                contextKey: "response-control-lot",
                durationMs: 60000,
            },
        );
        await t.run(async (ctx) => {
            const mission = await ctx.db.get(missionId);
            assert(mission?.modelRevisionId);
            await ctx.db.patch(runId, {
                purpose: "browser_test",
                browserTestContextId: contextId,
            });
            await ctx.db.patch(contextId, {
                paidQualification: {
                    resourcePolicy: "authority_native_v1",
                    costAccountingPolicy: "known_final_v1",
                    runId,
                    modelRevisionId: mission.modelRevisionId,
                    maximumRequests: 40,
                    maximumCostUsd: 2,
                    authorizedAt: Date.now(),
                    sourcesLot: [runId],
                    responseControl:
                        qualificationMode === "ungranted"
                            ? undefined
                            : {
                                  revision: 1,
                                  enabled: true,
                                  model: "typesafe/jev-1.14",
                                  contradictionThreshold: 0.95,
                                  supportThreshold:
                                      qualificationMode === "mismatch"
                                          ? 0.5
                                          : 0.7,
                              },
                },
            });
        });
    }
    const primary = await t.run((ctx) => ctx.db.get(row._id));
    assert(primary?.providerCallId);
    const operation = await t.mutation(internal.execution.operations.enqueue, {
        missionId,
        expectedGeneration: 1,
        cause: "inspect",
        input: { kind: "consult_run_state" },
    });
    await dispatchFixtureOperation(t, {
        requestId: operation,
        expectedGeneration: 1,
    });
    const response = {
        kind: "complete" as const,
        text: "The request remains available for inspection.",
        workingNotes: "once-only note",
    };
    expect(
        await t.mutation(internal.execution.invocations.finish, {
            invocationId: row._id,
            expectedGeneration: 1,
            response,
        }),
    ).toMatchObject({ kind: "blocked", code: "pending_operations" });
    const turn = await t.run(async (ctx) => {
        const mission = await ctx.db.get(missionId);
        return mission?.conversationTurnId
            ? ctx.db.get(mission.conversationTurnId)
            : null;
    });
    const requestId = turn?.responseControl?.checks[0]?.requestId;
    assert(requestId);
    const outcome = await dispatchFixtureOperation(t, {
        requestId,
        expectedGeneration: 1,
    });
    if (["ungranted", "mismatch"].includes(qualificationMode)) {
        expect(outcome.kind).toBe("unavailable");
        const calls = await t.run((ctx) =>
            ctx.db
                .query("providerCalls")
                .withIndex("by_run", (q) => q.eq("runId", runId))
                .collect(),
        );
        expect(
            calls.filter((c) => c.operation === "response_coherence"),
        ).toHaveLength(0);
        expect(
            vi
                .mocked(fetch)
                .mock.calls.some(([url]) => String(url).includes("/decisions")),
        ).toBe(false);
        return;
    }
    expect(outcome.kind).toBe("success");
    expect(
        await t.mutation(internal.execution.invocations.finish, {
            invocationId: row._id,
            expectedGeneration: 1,
            response,
        }),
    ).toMatchObject({ kind: "completed" });
    const reply = (
        await readConversationPageWithBodies(client, {
            runId,
            paginationOpts: { numItems: 20, cursor: null },
        })
    ).page.find((m) => m.role === "assistant");
    expect(reply).toMatchObject({
        text: response.text,
        responseControl: { status: "review_needed", support: 0.03 },
    });
    const history = await readWorkbenchPageWithBodies(client, {
        runId,
        paginationOpts: { numItems: 20, cursor: null },
    });
    expect(history.page.find((m) => m.role === "assistant")).toMatchObject({
        responseControl: { status: "review_needed", support: 0.03 },
    });
    expect(
        history.page.find((m) => m.role === "assistant")?.work?.turn,
    ).not.toHaveProperty("responseControl");
    expect((await t.run((ctx) => ctx.db.get(row._id)))?.providerCallId).toBe(
        primary.providerCallId,
    );
    const mission = await t.run((ctx) => ctx.db.get(missionId));
    expect(mission?.workingNotes).toBe("once-only note");
    const calls = await t.run((ctx) =>
        ctx.db
            .query("providerCalls")
            .withIndex("by_operation_key", (q) =>
                q.eq(
                    "operationKey",
                    `response-coherence:${requestId}:attempt:1`,
                ),
            )
            .take(2),
    );
    expect(calls).toHaveLength(1);
    expect(decisionTimeout).toBeGreaterThan(30000);
    const call = calls[0];
    assert(call?.leaseExpiresAt);
    expect(decisionTimeout).toBeLessThanOrEqual(
        call.leaseExpiresAt - 10000 - call.createdAt,
    );
    if (qualificationMode === "sources")
        expect(calls[0]?.qualificationReservationUsd).toBe(0.0393216);
    expect(calls[0]).toMatchObject({
        status: "succeeded",
        dispatchOutcome: "response_received",
        reportedCost: 0.00002,
    });
    await expect(
        t.action(internal.responseControlActions.execute, {
            requestId,
            expectedGeneration: 1,
        }),
    ).resolves.toMatchObject({ status: "unavailable" });
    expect(
        vi
            .mocked(fetch)
            .mock.calls.filter((c) => String(c[0]).endsWith("/decisions")),
    ).toHaveLength(1);
});

test("an unavailable correction profile preserves the draft with an explicit reserve", async () => {
    const { t, client, runId, draft } = await liveReviewFixture();
    const row = await draft("missing-correction-profile");
    await t.run(async (ctx) => {
        for (const profile of await ctx.db
            .query("nativeInputProfiles")
            .take(200))
            await ctx.db.delete(profile._id);
    });
    const result = await t.mutation(internal.execution.invocations.finish, {
        invocationId: row._id,
        expectedGeneration: 1,
        response: { kind: "complete", text: "Research is running." },
    });
    expect(result.kind).toBe("completed");
    expect(
        (
            await readConversationPageWithBodies(client, {
                runId,
                paginationOpts: { numItems: 20, cursor: null },
            })
        ).page.find((m) => m.role === "assistant"),
    ).toMatchObject({
        text: "Research is running.",
        responseControl: { status: "review_needed" },
    });
});

test("unknown advisory work becomes unavailable without redispatch or refunding its model reservation", async () => {
    const { t, client, runId, missionId, draft } = await liveReviewFixture();
    const row = await draft("unknown-advisory");
    const read = await t.mutation(internal.execution.operations.enqueue, {
        missionId,
        expectedGeneration: 1,
        cause: "inspect",
        input: { kind: "consult_run_state" },
    });
    await dispatchFixtureOperation(t, {
        requestId: read,
        expectedGeneration: 1,
    });
    const response = {
        kind: "complete" as const,
        text: "The dossier remains available.",
    };
    await t.mutation(internal.execution.invocations.finish, {
        invocationId: row._id,
        expectedGeneration: 1,
        response,
    });
    const review = await t.run(async (ctx) => {
        const mission = await ctx.db.get(missionId);
        const turn = mission?.conversationTurnId
            ? await ctx.db.get(mission.conversationTurnId)
            : null;
        return turn?.responseControl?.checks[0];
    });
    assert(review?.requestId && review.requestHash);
    expect(
        (
            await claimFixtureOperation(t, {
                requestId: review.requestId,
                expectedGeneration: 1,
            })
        ).kind,
    ).toBe("execute");
    await recordFixtureAttempt(t, {
        operationRequestId: review.requestId,
        missionId,
        invocationId: row._id,
        runId,
        executionGeneration: 1,
        workflowVersion: row.definitionVersion,
        service: "model",
        operation: "response_coherence",
        stepKey: "response_coherence",
        operationKey: `response-coherence:${review.requestId}:attempt:1`,
        inputHash: review.requestHash,
        attempt: 1,
        status: "started",
    });
    expect(
        await claimFixtureOperation(t, {
            requestId: review.requestId,
            expectedGeneration: 1,
        }),
    ).toMatchObject({
        kind: "outcome",
        outcome: { kind: "unavailable", code: "operation_outcome_unknown" },
    });
    expect((await t.run((ctx) => ctx.db.get(missionId)))?.status).toBe(
        "running",
    );
    expect(
        (
            await t.mutation(internal.execution.invocations.finish, {
                invocationId: row._id,
                expectedGeneration: 1,
                response,
            })
        ).kind,
    ).toBe("completed");
    expect(
        (await t.run((ctx) => ctx.db.get(runId)))?.sourcePreparationBudget
            ?.reserved,
    ).toBe(1);
    expect(
        (
            await readConversationPageWithBodies(client, {
                runId,
                paginationOpts: { numItems: 20, cursor: null },
            })
        ).page.find((m) => m.role === "assistant")?.responseControl?.status,
    ).toBe("unavailable");
});

async function latestReview(
    t: Awaited<ReturnType<typeof liveReviewFixture>>["t"],
    missionId: Awaited<ReturnType<typeof liveReviewFixture>>["missionId"],
) {
    return t.run(async (ctx) => {
        const mission = await ctx.db.get(missionId);
        const turn = mission?.conversationTurnId
            ? await ctx.db.get(mission.conversationTurnId)
            : null;
        return turn?.responseControl?.checks.at(-1);
    });
}

test.each([
    [0.7, "checked"],
    [0.69, "review_needed"],
] as const)("one guided correction checks final support %s against the configured boundary", async (support, status) => {
    const { t, client, runId, missionId, draft } = await liveReviewFixture();
    let decisions = 0;
    vi.stubGlobal(
        "fetch",
        vi.fn(async (url: unknown, init?: RequestInit) => {
            if (String(url).includes("/models?"))
                return Response.json({
                    data: [
                        {
                            id: "typesafe/jev-1.14",
                            context_length: 262144,
                            pricing: { prompt: "0.000000042", completion: "0" },
                        },
                    ],
                });
            const body = JSON.parse(String(init?.body));
            expect(body.provider).toBeUndefined();
            expect(body.state.authoritative_facts.operations).toHaveLength(1);
            decisions++;
            return Response.json({
                answers: {
                    assessment: {
                        type: "choice",
                        choice: decisions === 1 ? "contradicted" : "supported",
                        confidence: 0.9,
                        probabilities:
                            decisions === 1
                                ? {
                                      supported: 0.03,
                                      contradicted: 0.95,
                                      insufficient_information: 0.02,
                                  }
                                : {
                                      supported: support,
                                      contradicted: 0.2,
                                      insufficient_information:
                                          1 - support - 0.2,
                                  },
                    },
                },
                usage: { cost: 0.00002 },
            });
        }),
    );
    const original = await draft("original");
    const op = await t.mutation(internal.execution.operations.enqueue, {
        missionId,
        expectedGeneration: 1,
        cause: "inspect",
        input: { kind: "consult_run_state" },
    });
    await dispatchFixtureOperation(t, {
        requestId: op,
        expectedGeneration: 1,
    });
    const response = {
        kind: "complete" as const,
        text: "The proposed interpretation remains available.",
    };
    await t.mutation(internal.execution.invocations.finish, {
        invocationId: original._id,
        expectedGeneration: 1,
        response,
    });
    const first = await latestReview(t, missionId);
    assert(first?.requestId);
    await dispatchFixtureOperation(t, {
        requestId: first.requestId,
        expectedGeneration: 1,
    });
    expect(
        await t.mutation(internal.execution.invocations.finish, {
            invocationId: original._id,
            expectedGeneration: 1,
            response,
        }),
    ).toMatchObject({ kind: "blocked", code: "mission_context_changed" });
    const state = await client.query(api.execution.conversations.get, {
        runId,
    });
    assert(state.activeTurn);
    expect(state.activeTurn).not.toHaveProperty("responseControl");
    await expect(
        client.query(api.responseControl.audit, {
            turnId: state.activeTurn._id,
        }),
    ).rejects.toThrow("Unauthorized");
    const revised = await draft("revised");
    expect(JSON.parse(revised.inputJson).constraints.operations).toEqual([]);
    const final = {
        kind: "complete" as const,
        text: "The interpretation is tentative; the recorded operation only inspected state.",
    };
    await t.mutation(internal.execution.invocations.finish, {
        invocationId: revised._id,
        expectedGeneration: 1,
        response: final,
    });
    const second = await latestReview(t, missionId);
    assert(second?.requestId);
    await dispatchFixtureOperation(t, {
        requestId: second.requestId,
        expectedGeneration: 1,
    });
    expect(
        (
            await t.mutation(internal.execution.invocations.finish, {
                invocationId: revised._id,
                expectedGeneration: 1,
                response: final,
            })
        ).kind,
    ).toBe("completed");
    const reply = (
        await readConversationPageWithBodies(client, {
            runId,
            paginationOpts: { numItems: 20, cursor: null },
        })
    ).page.find((m) => m.role === "assistant");
    expect(reply).toMatchObject({
        text: final.text,
        responseControl: { status, support },
    });
    expect(decisions).toBe(2);
    const budget = (await t.run((ctx) => ctx.db.get(runId)))
        ?.sourcePreparationBudget;
    expect(budget).toMatchObject({ dispatches: 4, reserved: 0 });
    const retained = await t.run((ctx) => ctx.db.get(original._id));
    expect(JSON.parse(retained?.outputJson ?? "{}").text).toBe(response.text);
});

test("an enabled controller reviews the first reply even without operations", async () => {
    const { t, missionId, draft } = await liveReviewFixture();
    const noNetwork = vi.fn(() => {
        throw new Error("Unexpected external I/O");
    });
    vi.stubGlobal("fetch", noNetwork);
    const row = await draft("no-operation");
    expect(
        await t.mutation(internal.execution.invocations.finish, {
            invocationId: row._id,
            expectedGeneration: 1,
            response: {
                kind: "complete",
                text: "This is a tentative economic question.",
            },
        }),
    ).toMatchObject({ kind: "blocked", code: "pending_operations" });
    expect(noNetwork).not.toHaveBeenCalled();
    const requests = await t.run((ctx) =>
        ctx.db
            .query("agentOperationRequests")
            .withIndex("by_mission", (q) => q.eq("missionId", missionId))
            .take(10),
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]?.input.kind).toBe("check_response_coherence");
});

test("a draft above advisory capacity publishes exact text and retains its review digest without a request", async () => {
    const { sha256Hex } = await import("@convex/domain/sourcePassages");
    const { RESPONSE_CONTROL_MAX_INPUT_BYTES } = await import(
        "@convex/resourcePolicy"
    );
    const { t, client, runId, missionId, draft } = await liveReviewFixture();
    const row = await draft("oversized-advisory-draft");
    const turnId = row.conversationTurnId;
    assert(turnId);
    const text = `${"é".repeat(RESPONSE_CONTROL_MAX_INPUT_BYTES / 2)}!`;
    await expect(
        t.mutation(internal.execution.invocations.finish, {
            invocationId: row._id,
            expectedGeneration: 1,
            response: { kind: "complete", text },
        }),
    ).resolves.toMatchObject({ kind: "completed" });
    const turn = await t.run((ctx) => ctx.db.get(turnId));
    expect(turn?.responseControl).toMatchObject({
        publicationReason: "context_capacity",
        summary: { status: "unavailable" },
        checks: [
            {
                draftHash: sha256Hex(text),
                result: { status: "unavailable", reason: "context_capacity" },
            },
        ],
    });
    const requests = await t.run((ctx) =>
        ctx.db
            .query("agentOperationRequests")
            .withIndex("by_mission", (q) => q.eq("missionId", missionId))
            .take(1),
    );
    expect(requests).toEqual([]);
    const history = await readConversationPageWithBodies(client, {
        runId,
        paginationOpts: { numItems: 20, cursor: null },
    });
    expect(
        history.page
            .filter((entry) => entry.role === "assistant")
            .map((entry) => entry.text),
    ).toEqual([text]);
});

test("the actual Pi worker delivers the reminder and publishes only the revised explanation", async () => {
    const { directedWorkbenchDefinition: workbenchDefinition } = await import(
        "@convex/domain/workbenchAgent"
    );
    const generated = vi
        .spyOn(workbenchDefinition, "simulate")
        .mockImplementation((input) => {
            const snapshot = domainSnapshot(input) as {
                responseControl?: { reminder?: string };
            };
            return {
                kind: "complete",
                text: snapshot.responseControl?.reminder
                    ? "Research has not started. This remains a tentative framing proposal."
                    : "Research is running.",
                workingNotes: "retained observation",
            };
        });
    try {
        const { t, client, runId } = await seedWorkbench(true);
        await t.run((ctx) => ctx.db.patch(runId, { agentExecutionVersion: 3 }));
        const active = await t.mutation(
            internal.execution.conversations.startTurn,
            {
                runId,
                definitionId: "workbench_v1",
                scope: { kind: "workbench_v1" },
                simulation: true,
            },
        );
        assert(active);
        await t.finishAllScheduledFunctions(
            () => vi.advanceTimersByTime(10),
            500,
        );
        expect(
            (await t.run((ctx) => ctx.db.get(active.missionId)))?.status,
        ).toBe("completed");
        const messages = (
            await readConversationPageWithBodies(client, {
                runId,
                paginationOpts: { numItems: 20, cursor: null },
            })
        ).page.filter((m) => m.role === "assistant");
        expect(messages).toHaveLength(1);
        expect(messages[0]?.text).toBe(
            "Research has not started. This remains a tentative framing proposal.",
        );
        const invocations = await t.run((ctx) =>
            ctx.db
                .query("agentInvocations")
                .withIndex("by_mission", (q) =>
                    q.eq("missionId", active.missionId),
                )
                .take(5),
        );
        expect(invocations).toHaveLength(2);
        const corrected = invocations.find(
            (i) => JSON.parse(i.inputJson).domain.responseControl?.reminder,
        );
        assert(corrected);
        const request = await t.run((ctx) =>
            ctx.db
                .query("agentInvocationPayloads")
                .withIndex("by_invocation_and_part", (q) =>
                    q.eq("invocationId", corrected._id).eq("part", "request"),
                )
                .unique(),
        );
        assert(request?.json);
        const serializedRequest = JSON.parse(request.json);
        const actualMessageText = serializedRequest.messages
            .map(
                (message: {
                    content: unknown;
                    sections?: Record<string, string | null>;
                }) =>
                    [
                        typeof message.content === "string"
                            ? message.content
                            : JSON.stringify(message.content),
                        ...Object.values(message.sections ?? {}),
                    ]
                        .filter(Boolean)
                        .join("\n"),
            )
            .join("\n");
        expect(actualMessageText).toContain('"draft":"Research is running."');
        const admittedControl = JSON.parse(corrected.inputJson).domain
            .responseControl;
        expect(admittedControl.draftResponseHash).toMatch(/^[0-9a-f]{64}$/);
        expect(admittedControl).not.toHaveProperty("draft");
        expect(
            invocations.map(
                (i) => JSON.parse(i.receivedOutputJson ?? "{}").text,
            ),
        ).toContain("Research is running.");
    } finally {
        generated.mockRestore();
    }
}, 30000);

test("the native provider request receives the exact rejected draft with current facts and no tools", async () => {
    const { nativePiFixtureRoute } = await import(
        "@/__tests__/setup/pi-native"
    );
    const { t, client, runId } = await seedWorkbench(
        false,
        nativePiFixtureRoute,
    );
    const requests: Array<{
        messages: Array<{ content: unknown }>;
        tools?: unknown[];
    }> = [];
    vi.stubEnv("OPENROUTER_API_KEY", "local-fixture-only");
    vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, init) => {
            requests.push(JSON.parse(init.body));
            if (requests.length > 2)
                throw new Error("Unexpected additional correction");
            const text =
                requests.length === 1
                    ? "Research is running."
                    : "Research has not started. The current framing remains tentative.";
            return new Response(
                [
                    `data: ${JSON.stringify({ id: "draft-correction", choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }] })}`,
                    `data: ${JSON.stringify({ id: "draft-correction", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } })}`,
                    "data: [DONE]",
                    "",
                ].join("\n\n"),
                { headers: { "content-type": "text/event-stream" } },
            );
        }),
    );
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    expect(requests).toHaveLength(2);
    const correctedRequest = requests[1];
    assert(correctedRequest);
    const currentState = correctedRequest.messages
        .map((message) =>
            typeof message.content === "string"
                ? message.content
                : JSON.stringify(message.content),
        )
        .join("\n");
    expect(currentState).toContain('"draft":"Research is running."');
    expect(currentState).toContain('"summary":"Research has not started."');
    expect(correctedRequest.tools ?? []).toEqual([]);
    const messages = await readConversationPageWithBodies(client, {
        runId,
        paginationOpts: { numItems: 20, cursor: null },
    });
    expect(
        messages.page
            .filter((message) => message.role === "assistant")
            .map((message) => message.text),
    ).toEqual([
        "Research has not started. The current framing remains tentative.",
    ]);
    const invocations = await t.run((ctx) =>
        ctx.db
            .query("agentInvocations")
            .withIndex("by_run_and_task_key", (q) => q.eq("runId", runId))
            .take(3),
    );
    expect(invocations).toHaveLength(2);
    expect(
        invocations.some(
            (invocation) =>
                JSON.parse(invocation.receivedOutputJson ?? "{}").text ===
                "Research is running.",
        ),
    ).toBe(true);
});

async function pendingReviewFixture() {
    const fixture = await liveReviewFixture();
    const { t, missionId, draft } = fixture;
    const row = await draft("pending-review");
    const op = await t.mutation(internal.execution.operations.enqueue, {
        missionId,
        expectedGeneration: 1,
        cause: "inspect",
        input: { kind: "consult_run_state" },
    });
    await dispatchFixtureOperation(t, {
        requestId: op,
        expectedGeneration: 1,
    });
    const response = {
        kind: "complete" as const,
        text: "The dossier remains available for inspection.",
    };
    await t.mutation(internal.execution.invocations.finish, {
        invocationId: row._id,
        expectedGeneration: 1,
        response,
    });
    const review = await latestReview(t, missionId);
    assert(review?.requestId);
    return { ...fixture, row, response, requestId: review.requestId };
}
function decisionFetch() {
    return vi.fn(async (url: unknown) =>
        String(url).includes("/models?")
            ? Response.json({
                  data: [
                      {
                          id: "typesafe/jev-1.14",
                          context_length: 262144,
                          pricing: { prompt: "0.000000042", completion: "0" },
                      },
                  ],
              })
            : Response.json({
                  answers: {
                      assessment: {
                          type: "choice",
                          choice: "supported",
                          confidence: 0.9,
                          probabilities: {
                              supported: 0.9,
                              contradicted: 0.05,
                              insufficient_information: 0.05,
                          },
                      },
                  },
                  usage: { cost: 0.00002 },
              }),
    );
}

test.each([
    "disabled",
    "missing_key",
    "missing_capacity",
    "malformed",
    "timeout",
] as const)("unavailable review %s publishes the unchanged reply with a reserve", async (mode) => {
    const { t, client, runId, missionId, row, response, requestId } =
        await pendingReviewFixture();
    const native = decisionFetch();
    vi.stubGlobal(
        "fetch",
        vi.fn(async (url: unknown) => {
            if (String(url).includes("/models?") && mode === "missing_capacity")
                return Response.json({
                    data: [
                        {
                            id: "typesafe/jev-1.14",
                            pricing: { prompt: "0.000000042", completion: "0" },
                        },
                    ],
                });
            if (!String(url).includes("/models?")) {
                if (mode === "malformed") return new Response("not json");
                if (mode === "timeout")
                    throw new DOMException("Timed out", "TimeoutError");
            }
            return native(url);
        }),
    );
    if (mode === "disabled")
        await t.run(async (ctx) => {
            const policy = await ctx.db
                .query("responseControlSettings")
                .first();
            assert(policy);
            await ctx.db.patch(policy._id, { enabled: false });
        });
    if (mode === "missing_key") vi.stubEnv("OPENROUTER_API_KEY", "");
    const outcome = await dispatchFixtureOperation(t, {
        requestId,
        expectedGeneration: 1,
    });
    expect(outcome.kind).toBe("unavailable");
    expect(
        (
            await t.mutation(internal.execution.invocations.finish, {
                invocationId: row._id,
                expectedGeneration: 1,
                response,
            })
        ).kind,
    ).toBe("completed");
    expect(
        (
            await readWorkbenchPageWithBodies(client, {
                runId,
                paginationOpts: { numItems: 20, cursor: null },
            })
        ).page.find((m) => m.role === "assistant"),
    ).toMatchObject({
        text: response.text,
        responseControl: { status: "unavailable" },
    });
    expect((await t.run((ctx) => ctx.db.get(missionId)))?.status).toBe(
        "completed",
    );
    if (mode === "disabled" || mode === "missing_key")
        expect(fetch).not.toHaveBeenCalled();
    if (mode === "missing_capacity") {
        expect(
            vi
                .mocked(fetch)
                .mock.calls.filter(([url]) =>
                    String(url).endsWith("/decisions"),
                ),
        ).toHaveLength(0);
        expect(
            (await t.run((ctx) => ctx.db.get(runId)))?.sourcePreparationBudget
                ?.reserved,
        ).toBe(0);
    }
    if (mode === "timeout")
        expect(
            (await t.run((ctx) => ctx.db.get(runId)))?.sourcePreparationBudget
                ?.reserved,
        ).toBe(1);
});

test("changed facts require a new bounded check and never adopt the stale score", async () => {
    const { t, client, runId, missionId, row, response, requestId } =
        await pendingReviewFixture();
    vi.stubGlobal("fetch", decisionFetch());
    await dispatchFixtureOperation(t, {
        requestId,
        expectedGeneration: 1,
    });
    await t.run((ctx) =>
        ctx.db.patch(runId, { researchAngle: "Newly observed request" }),
    );
    expect(
        await t.mutation(internal.execution.invocations.finish, {
            invocationId: row._id,
            expectedGeneration: 1,
            response,
        }),
    ).toMatchObject({ kind: "blocked", code: "pending_operations" });
    const second = await latestReview(t, missionId);
    assert(second?.requestId);
    expect(second.requestId).not.toBe(requestId);
    await dispatchFixtureOperation(t, {
        requestId: second.requestId,
        expectedGeneration: 1,
    });
    await t.run((ctx) =>
        ctx.db.patch(runId, {
            researchAngle: "Changed again after the last allowed check",
        }),
    );
    expect(
        (
            await t.mutation(internal.execution.invocations.finish, {
                invocationId: row._id,
                expectedGeneration: 1,
                response,
            })
        ).kind,
    ).toBe("completed");
    const reply = (
        await readWorkbenchPageWithBodies(client, {
            runId,
            paginationOpts: { numItems: 20, cursor: null },
        })
    ).page.find((m) => m.role === "assistant");
    expect(reply).toMatchObject({
        text: response.text,
        responseControl: { status: "unavailable" },
    });
    expect(reply?.responseControl).not.toHaveProperty("support");
    expect(
        vi
            .mocked(fetch)
            .mock.calls.filter((c) => String(c[0]).endsWith("/decisions")),
    ).toHaveLength(2);
});

test("cancellation retains received review facts without publishing or adopting the assessment", async () => {
    const { t, client, runId, missionId, requestId } =
        await pendingReviewFixture();
    const mission = await t.run((ctx) => ctx.db.get(missionId));
    assert(mission?.conversationTurnId);
    const turnId = mission.conversationTurnId;
    const native = decisionFetch();
    vi.stubGlobal(
        "fetch",
        vi.fn(async (url: unknown) => {
            if (String(url).endsWith("/decisions"))
                await client.mutation(
                    api.execution.conversations.stopResponse,
                    { runId, turnId },
                );
            return native(url);
        }),
    );
    await dispatchFixtureOperation(t, {
        requestId,
        expectedGeneration: 1,
    });
    const review = await latestReview(t, missionId);
    expect(review?.observation).toMatchObject({
        status: "checked",
        scores: { supported: 0.9 },
    });
    expect(review?.result).toBeUndefined();
    const providerCallId = review?.observation?.providerCallId;
    assert(providerCallId);
    const receipt = await t.run((ctx) => ctx.db.get(providerCallId));
    expect(receipt).toMatchObject({
        status: "succeeded",
        dispatchOutcome: "response_received",
        reportedCost: 0.00002,
    });
    expect(
        (
            await readWorkbenchPageWithBodies(client, {
                runId,
                paginationOpts: { numItems: 20, cursor: null },
            })
        ).page.filter((m) => m.role === "assistant"),
    ).toHaveLength(0);
});

test("a correction refused by the shared model budget publishes the original with a reserve", async () => {
    const { t, client, runId, missionId, draft } = await liveReviewFixture();
    const row = await draft("exhausted-correction");
    await t.run((ctx) =>
        ctx.db.patch(missionId, { modelLimits: { work: 1, incidents: 40 } }),
    );
    const response = {
        kind: "complete" as const,
        text: "Research is running.",
    };
    expect(
        (
            await t.mutation(internal.execution.invocations.finish, {
                invocationId: row._id,
                expectedGeneration: 1,
                response,
            })
        ).kind,
    ).toBe("completed");
    expect(
        (
            await readWorkbenchPageWithBodies(client, {
                runId,
                paginationOpts: { numItems: 20, cursor: null },
            })
        ).page.find((m) => m.role === "assistant"),
    ).toMatchObject({
        text: response.text,
        responseControl: { status: "review_needed" },
    });
    expect(
        (await t.run((ctx) => ctx.db.get(runId)))?.sourcePreparationBudget
            ?.dispatches,
    ).toBe(1);
});

test("a residual closed-status conflict queues host review instead of completing", async () => {
    const { t, missionId, draft } = await liveReviewFixture();
    const row = await draft("closed-conflict");
    const op = await t.mutation(internal.execution.operations.enqueue, {
        missionId,
        expectedGeneration: 1,
        cause: "inspect",
        input: { kind: "consult_run_state" },
    });
    await dispatchFixtureOperation(t, {
        requestId: op,
        expectedGeneration: 1,
    });
    const response = {
        kind: "complete" as const,
        text: "Research is running.",
    };
    expect(
        await t.mutation(internal.execution.invocations.finish, {
            invocationId: row._id,
            expectedGeneration: 1,
            response,
        }),
    ).toMatchObject({ kind: "blocked", code: "mission_context_changed" });
    const final = await draft("closed-conflict-persists");
    expect(
        await t.mutation(internal.execution.invocations.finish, {
            invocationId: final._id,
            expectedGeneration: 1,
            response,
        }),
    ).toMatchObject({ kind: "blocked", code: "pending_operations" });
    const review = await latestReview(t, missionId);
    assert(review?.requestId);
    const requestId = review.requestId;
    expect(await t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
        missionId,
        actor: "system",
        status: "pending",
        input: { kind: "check_response_coherence" },
    });
});

test("oversized saved operation facts cannot expand turn audit or strand publication", async () => {
    const { t, client, runId, missionId, row, response, requestId } =
        await pendingReviewFixture();
    await t.run(async (ctx) => {
        const read = await ctx.db
            .query("agentOperationRequests")
            .withIndex("by_mission", (q) => q.eq("missionId", missionId))
            .filter((q) => q.eq(q.field("input.kind"), "consult_run_state"))
            .first();
        assert(read);
        await ctx.db.patch(read._id, {
            outcome: {
                kind: "success",
                valueJson: JSON.stringify({ material: "x".repeat(40000) }),
            },
        });
    });
    await dispatchFixtureOperation(t, {
        requestId,
        expectedGeneration: 1,
    });
    expect(
        (
            await t.mutation(internal.execution.invocations.finish, {
                invocationId: row._id,
                expectedGeneration: 1,
                response,
            })
        ).kind,
    ).toBe("completed");
    const state = await t.run(async (ctx) => {
        const mission = await ctx.db.get(missionId);
        return mission?.conversationTurnId
            ? ctx.db.get(mission.conversationTurnId)
            : null;
    });
    expect(
        new TextEncoder().encode(JSON.stringify(state?.responseControl)).length,
    ).toBeLessThan(40000);
    expect(
        (
            await readWorkbenchPageWithBodies(client, {
                runId,
                paginationOpts: { numItems: 20, cursor: null },
            })
        ).page.find((m) => m.role === "assistant"),
    ).toMatchObject({
        text: response.text,
        responseControl: { status: "unavailable" },
    });
});

test("a model cannot request the host review operation", async () => {
    const { t, runId } = await seedWorkbench(true);
    await t.run((ctx) => ctx.db.patch(runId, { agentExecutionVersion: 3 }));
    const active = await t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: true,
        },
    );
    assert(active);
    const input = await workbenchAdmissionInput(t, active.missionId);
    const row = await beginFixtureInvocation(t, {
        missionId: active.missionId,
        expectedGeneration: 1,
        taskKey: "forged-host-operation",
        provenance: "simulation",
        nativeInput: input,
    });
    assert(row.kind === "ready");
    await t.mutation(internal.execution.invocations.finish, {
        invocationId: row.invocationId,
        expectedGeneration: 1,
        response: {
            kind: "operations",
            requests: [
                {
                    callId: "forged",
                    name: "check_response_coherence",
                    inputJson: JSON.stringify({
                        invocationId: row.invocationId,
                        requestHash: "forged",
                    }),
                },
            ],
        },
    });
    const requests = await t.run((ctx) =>
        ctx.db
            .query("agentOperationRequests")
            .withIndex("by_mission", (q) => q.eq("missionId", active.missionId))
            .take(5),
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
        actor: "agent",
        status: "completed",
        outcome: { kind: "refused" },
    });
    expect(
        await t.run((ctx) => ctx.db.query("providerCalls").take(1)),
    ).toHaveLength(0);
});

test("a corrective model attempting tools cannot obtain another generation", async () => {
    const { directedWorkbenchDefinition: workbenchDefinition } = await import(
        "@convex/domain/workbenchAgent"
    );
    const generated = vi
        .spyOn(workbenchDefinition, "simulate")
        .mockImplementation((input) => {
            const reminder = (
                domainSnapshot(input) as {
                    responseControl?: { reminder?: string };
                }
            ).responseControl?.reminder;
            return reminder
                ? {
                      kind: "operations",
                      requests: [
                          {
                              callId: "forbidden-correction-tool",
                              name: "consult_run_state",
                              inputJson: "{}",
                          },
                      ],
                  }
                : { kind: "complete", text: "Research is running." };
        });
    try {
        const { t, runId } = await seedWorkbench(true);
        await t.run((ctx) => ctx.db.patch(runId, { agentExecutionVersion: 3 }));
        const active = await t.mutation(
            internal.execution.conversations.startTurn,
            {
                runId,
                definitionId: "workbench_v1",
                scope: { kind: "workbench_v1" },
                simulation: true,
            },
        );
        assert(active);
        await t.finishAllScheduledFunctions(
            () => vi.advanceTimersByTime(10),
            500,
        );
        const invocations = await t.run((ctx) =>
            ctx.db
                .query("agentInvocations")
                .withIndex("by_mission", (q) =>
                    q.eq("missionId", active.missionId),
                )
                .take(10),
        );
        expect(invocations).toHaveLength(2);
        expect(
            (await t.run((ctx) => ctx.db.get(active.missionId)))?.status,
        ).toBe("blocked");
        expect(
            await t.run((ctx) =>
                ctx.db
                    .query("agentOperationRequests")
                    .withIndex("by_mission", (q) =>
                        q.eq("missionId", active.missionId),
                    )
                    .take(1),
            ),
        ).toHaveLength(0);
    } finally {
        generated.mockRestore();
    }
}, 30000);

test("historical turns without a pinned policy remain exempt when the global controller is enabled", async () => {
    const { t, missionId } = await liveReviewFixture();
    await t.run(async (ctx) => {
        const mission = await ctx.db.get(missionId);
        assert(mission?.conversationTurnId);
        await ctx.db.patch(mission.conversationTurnId, {
            responseControl: undefined,
        });
    });
    const context = await t.query(internal.execution.context.build, {
        missionId,
        expectedGeneration: 1,
    });
    assert(context.kind === "ready");
    expect(
        JSON.parse(context.inputJson).domain.responseControl.policy,
    ).toMatchObject({
        enabled: false,
        revision: 0,
    });
});

test.each([
    { enabled: false, conflict: true },
    { enabled: true, conflict: true },
    { enabled: true, conflict: false },
])("large retained material preserves correction or review (controller $enabled, conflict $conflict)", async ({
    enabled,
    conflict,
}) => {
    const { seedWorkbenchMaterials } = await import(
        "@/__tests__/setup/workbench-materials"
    );
    const { sha256Hex } = await import("@convex/domain/sourcePassages");
    const { searchAvailableMaterialResult } = await import(
        "@convex/domain/savedMaterialOperationResults"
    );
    const { t, runId, sourceId, captureId, start } =
        await seedWorkbenchMaterials(1, 1);
    await t.run(async (ctx) => {
        await ctx.db.patch(runId, {
            lifecycleState: "framing",
            executionStatus: "idle",
        });
        await ctx.db.insert("responseControlSettings", {
            key: "global",
            revision: 1,
            updatedAt: 1,
            enabled,
            model: "typesafe/jev-1.14",
            contradictionThreshold: 0.95,
            supportThreshold: 0.7,
        });
    });
    const active = await start();
    assert(active);
    // Valid retained search responses reproduce Adobe's aggregate evidence size without provider I/O.
    const requestIds = await t.run(async (ctx) => {
        const capture = await ctx.db.get(captureId);
        assert(capture?.contentHash);
        const ids = [];
        for (let index = 0; index < 2; index++) {
            const value = {
                kind: "search_available_material" as const,
                sourceId,
                captureId,
                contentHash: capture.contentHash,
                canonicalUrl: capture.requestedUrl,
                retrievedAt: 1,
                passages: Array.from({ length: 12 }, (_, order) => ({
                    passageOrder: order,
                    exactQuote: "Documented workflow economics. ".repeat(50),
                    headingPath: [],
                })),
                omittedPassageCount: 0,
                limitReached: false,
            };
            expect(searchAvailableMaterialResult.safeParse(value).success).toBe(
                true,
            );
            ids.push(
                await ctx.db.insert("agentOperationRequests", {
                    runId,
                    missionId: active.missionId,
                    actor: "agent",
                    cause: "retained-search-fixture",
                    input: {
                        kind: "search_available_material",
                        sourceId,
                        query: `workflow ${index}`,
                    },
                    operationVersion: 1,
                    expectedGeneration: 1,
                    logicalKey: `large-search-${index}`,
                    status: "completed",
                    outcome: {
                        kind: "success",
                        valueJson: JSON.stringify(value),
                    },
                    createdAt: 1,
                    completedAt: 1,
                    adoptedAt: 1,
                }),
            );
        }
        return ids;
    });
    expect(
        await t.run(
            async (ctx) =>
                JSON.stringify(
                    await Promise.all(requestIds.map((id) => ctx.db.get(id))),
                ).length,
        ),
    ).toBeGreaterThan(32768);
    const begun = await beginFixtureInvocation(t, {
        missionId: active.missionId,
        expectedGeneration: 1,
        taskKey: "large-status-draft",
        provenance: "live",
        nativeInput: await workbenchAdmissionInput(t, active.missionId),
    });
    assert(begun.kind === "ready");
    const row = await t.run((ctx) => ctx.db.get(begun.invocationId));
    assert(row);
    const identity = {
        missionId: active.missionId,
        invocationId: row._id,
        runId,
        executionGeneration: 1,
        workflowVersion: row.definitionVersion,
        service: "model" as const,
        operation: "agent_reasoning",
        stepKey: "agent_reasoning",
        operationKey: `mission:${active.missionId}:invocation:${row._id}:attempt:1`,
        attempt: 1,
        inputHash: sha256Hex(row.inputJson),
        corpusRevisionId: row.corpusRevisionId,
    };
    await recordFixtureAttempt(t, {
        ...identity,
        status: "started",
    });
    await recordFixtureAttempt(t, {
        ...identity,
        status: "succeeded",
        dispatchOutcome: "response_received",
        reportedCost: 0,
    });
    expect(
        await t.mutation(internal.execution.invocations.finish, {
            invocationId: row._id,
            expectedGeneration: 1,
            response: {
                kind: "complete",
                text: conflict
                    ? "Research is running."
                    : "The dossier remains available.",
            },
        }),
    ).toMatchObject({
        kind: "blocked",
        code: conflict ? "mission_context_changed" : "pending_operations",
    });
    const turn = await t.run((ctx) => ctx.db.get(active.turnId));
    if (conflict)
        expect(turn?.responseControl?.correction?.invocationId).toBe(row._id);
    else {
        const check = turn?.responseControl?.checks[0];
        assert(check?.requestId);
        expect(
            new TextEncoder().encode(check.factsJson).length,
        ).toBeLessThanOrEqual(32768);
        const facts = JSON.parse(check.factsJson);
        expect(facts.operations).toHaveLength(2);
        for (const operation of facts.operations)
            expect(operation.outcome).toEqual({ kind: "success" });
        expect(check.factsJson).not.toContain("exactQuote");
    }
});

test("closed status verdict does not depend on summary wording", async () => {
    const { conflictsWithResearchStatus } = await import(
        "@convex/domain/workbenchResponseControlContracts"
    );
    expect(
        conflictsWithResearchStatus("Research is running.", {
            lifecycleState: "framing",
            executionStatus: "running",
        }),
    ).toBe(false);
    expect(
        conflictsWithResearchStatus("Research has not started.", {
            lifecycleState: "framing",
            executionStatus: "running",
        }),
    ).toBe(true);
    expect(
        conflictsWithResearchStatus("Research is complete.", {
            lifecycleState: "sources_prepared",
            executionStatus: "idle",
        }),
    ).toBe(true);
    expect(
        conflictsWithResearchStatus(
            "> Research is complete.\n```\nResearch is complete.\n```",
            { lifecycleState: "sources_prepared", executionStatus: "idle" },
        ),
    ).toBe(false);
});

test("disabled advisory control preserves factual status correction without extra paid work", async () => {
    const { seedResearchStateScenario } = await import(
        "@/__tests__/setup/research-state"
    );
    const f = await seedResearchStateScenario(
        {
            outcome: "partial",
            blockCode: "invalid_output",
            retainedDocumentCount: 1,
            capturedDocumentCount: 1,
        },
        { simulation: true },
    );
    const initial = await f.t.run(async (ctx) => ({
        preparation: await ctx.db.get(f.preparationId),
        calls: await ctx.db.query("providerCalls").collect(),
        requests: await ctx.db.query("agentOperationRequests").collect(),
    }));
    const begin = async (taskKey: string) =>
        beginFixtureInvocation(f.t, {
            missionId: f.workbenchMissionId,
            expectedGeneration: 1,
            taskKey,
            provenance: "simulation",
            nativeInput: await workbenchAdmissionInput(
                f.t,
                f.workbenchMissionId,
                1,
            ),
        });
    const admitted = await begin("prepared-status-draft");
    assert(admitted.kind === "ready");
    expect(
        await f.t.mutation(internal.execution.invocations.finish, {
            invocationId: admitted.invocationId,
            expectedGeneration: 1,
            response: { kind: "complete", text: "Research is complete." },
        }),
    ).toMatchObject({ kind: "blocked", code: "mission_context_changed" });
    const context = await f.t.query(internal.execution.context.build, {
        missionId: f.workbenchMissionId,
        expectedGeneration: 1,
    });
    assert(context.kind === "ready");
    const input = JSON.parse(context.inputJson);
    expect(input.domain.research.sources.outcome).toBe("partial");
    expect(input.domain.responseControl.policy.enabled).toBe(false);
    expect(input.constraints.operations).toEqual([]);
    const corrected = await begin("prepared-status-correction");
    assert(corrected.kind === "ready");
    expect(
        await f.t.mutation(internal.execution.invocations.finish, {
            invocationId: corrected.invocationId,
            expectedGeneration: 1,
            response: {
                kind: "complete",
                text: "Sources preparation ended with partial material. The economic investigation remains unfinished.",
            },
        }),
    ).toMatchObject({ kind: "completed" });
    const after = await f.t.run(async (ctx) => ({
        preparation: await ctx.db.get(f.preparationId),
        calls: await ctx.db.query("providerCalls").collect(),
        requests: await ctx.db.query("agentOperationRequests").collect(),
        messages: await ctx.db
            .query("agentMessageDeliveries")
            .withIndex("by_run", (q) => q.eq("runId", f.runId))
            .collect(),
    }));
    expect(after.preparation).toEqual(initial.preparation);
    expect(after.calls).toEqual(initial.calls);
    expect(after.requests).toEqual(initial.requests);
    const messages = await readConversationPageWithBodies(
        f.t.withIdentity({ subject: f.userId }),
        {
            runId: f.runId,
            paginationOpts: { numItems: 20, cursor: null },
        },
    );
    expect(messages.page.filter((m) => m.role === "assistant")).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                text: "Sources preparation ended with partial material. The economic investigation remains unfinished.",
            }),
        ]),
    );
});
