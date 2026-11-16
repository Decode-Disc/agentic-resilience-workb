import { api, internal } from "@convex/_generated/api";
import { getAgentDefinition } from "@convex/execution/agentCatalog";
import { agentToolSchemas } from "@convex/execution/agentDefinition";
import { validate } from "convex-helpers/validators";
import { afterEach, assert, expect, test, vi } from "vitest";
import {
    seedWorkbench,
    workbenchAdmissionInput,
} from "@/__tests__/setup/workbench";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
});

test("native documentary registration requires an explicit routing choice", () => {
    const tools = agentToolSchemas(getAgentDefinition("workbench_v1"), {
        framing: { fixed: true },
        conversationInstructions: {
            messages: [
                {
                    messageId: "observed-message",
                    text: "Inspect public commercial terms.",
                },
            ],
        },
    });
    const operation = tools.transmit_source_request;
    assert(operation);
    expect(
        validate(operation.inputValidator, {
            interpretedNeed: "Public commercial terms.",
        }),
    ).toBe(false);
    expect(
        validate(operation.inputValidator, {
            interpretedNeed: "Public commercial terms.",
            coverageRole: "official_commercial_terms",
        }),
    ).toBe(true);
    expect(
        validate(operation.inputValidator, {
            interpretedNeed: "An unsupported documentary request.",
            coverageRole: null,
        }),
    ).toBe(true);
});

test("native research actions use approval requests bound to active messages", async () => {
    const { t, client, runId } = await seedWorkbench(true);
    const queued = await t.run((ctx) =>
        ctx.db
            .query("agentMessageDeliveries")
            .withIndex("by_run_and_status", (q) =>
                q.eq("runId", runId).eq("status", "queued"),
            )
            .first(),
    );
    assert(queued);
    await client.mutation(api.execution.conversations.removeQueued, {
        runId,
        messageId: queued._id,
    });
    await client.mutation(api.execution.conversations.submit, {
        runId,
        requestKey: "documentary",
        text: "Please inspect public commercial terms that constrain switching.",
        delivery: "queue",
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
    const context = await t.query(internal.execution.context.build, {
        missionId: active.missionId,
        expectedGeneration: 1,
    });
    assert(context.kind === "ready");
    const state = JSON.parse(context.inputJson);
    // Exercise phase availability independently from explicit message authority.
    state.domain.research.controlAvailable = true;
    state.domain.framing.fixed = true;
    const tools = agentToolSchemas(getAgentDefinition("workbench_v1"), state);
    expect(tools).toHaveProperty("transmit_source_request");
    expect(tools).not.toHaveProperty("control_research");
    expect(tools).toHaveProperty("request_approval");
});

test.each([
    "question",
    "scope",
    "deletion",
    "independent",
    "renewed",
    "replayed",
    "missing-baseline",
    "analyst-deletion",
    "analyst-order",
    "later-model",
])("framing authority after an analyst edit: %s", async (scenario) => {
    const { t, client, runId } = await seedWorkbench(true);
    const initial = await t.run((ctx) =>
        ctx.db
            .query("agentMessageDeliveries")
            .withIndex("by_run_and_status", (q) =>
                q.eq("runId", runId).eq("status", "queued"),
            )
            .first(),
    );
    assert(initial);
    await client.mutation(api.execution.conversations.removeQueued, {
        runId,
        messageId: initial._id,
    });
    const originalQuestion = {
        id: "switching",
        shortLabel: "Switching",
        text: "What constrains switching?",
        rationale: "Inspect dependencies.",
    };
    const otherQuestion = {
        ...originalQuestion,
        id: "capture",
        text: "Who captures value?",
    };
    await client.mutation(api.framing.save, {
        runId,
        expectedRevision: 1,
        requestKey: "baseline",
        content: {
            scope: "Claims intake",
            questions:
                scenario === "analyst-order"
                    ? [originalQuestion, otherQuestion]
                    : [originalQuestion],
        },
    });
    await client.mutation(api.execution.conversations.submit, {
        runId,
        requestKey: "original-request",
        text: "Refine the switching question to examine repairer dependency.",
        delivery: "queue",
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
    let message = await t.run((ctx) =>
        ctx.db
            .query("agentMessageDeliveries")
            .withIndex("by_turn", (q) => q.eq("turnId", active.turnId))
            .first(),
    );
    assert(message);
    const question = {
        id: "switching",
        shortLabel: "Switching",
        text: "Which insurer-specific relationships constrain repairer switching?",
        rationale: "Preserve the analyst's economic relationship.",
    };
    const analystContent = {
        scope: "Analyst-defined claims intake",
        questions:
            scenario === "analyst-deletion"
                ? []
                : scenario === "analyst-order"
                  ? [otherQuestion, question]
                  : [question],
    };
    await client.mutation(api.framing.save, {
        runId,
        expectedRevision: 2,
        requestKey: "concurrent-analyst",
        content: analystContent,
    });
    if (scenario === "renewed") {
        const messageId = await client.mutation(
            api.execution.conversations.submit,
            {
                runId,
                turnId: active.turnId,
                requestKey: "later-request",
                text: "Now refine the switching question to examine repairer dependency.",
                delivery: "steer",
            },
        );
        message = await t.run((ctx) => ctx.db.get(messageId));
        assert(message);
        expect(message.framingBaseRevisionId).not.toBeUndefined();
    }
    if (scenario === "replayed") {
        const replayId = await client.mutation(
            api.execution.conversations.submit,
            {
                runId,
                requestKey: "original-request",
                text: "Refine the switching question to examine repairer dependency.",
                delivery: "queue",
            },
        );
        expect(replayId).toBe(message._id);
        expect(
            (await t.run((ctx) => ctx.db.get(replayId)))?.framingBaseRevisionId,
        ).toBe(message.framingBaseRevisionId);
    }
    if (scenario === "missing-baseline")
        await t.run((ctx) =>
            ctx.db.patch(message._id, { framingBaseRevisionId: undefined }),
        );
    const proposal = {
        scope: "Analyst-defined claims intake",
        questions: [
            {
                ...question,
                text: "Which repairer-specific relationships constrain repairer switching?",
            },
        ],
    };
    if (scenario === "scope") {
        proposal.scope = "Overwritten analyst scope";
        proposal.questions = [question];
    }
    if (scenario === "deletion") proposal.questions = [];
    if (scenario === "analyst-order")
        proposal.questions = [question, otherQuestion];
    if (scenario === "independent")
        proposal.questions = [
            question,
            {
                ...originalQuestion,
                id: "economics",
                text: "Who captures the workflow economics?",
            },
        ];
    const missionId = active.missionId;
    const activeMessageId = message._id;
    async function edit(content: typeof proposal, taskKey: string) {
        const invocation = await t.mutation(
            internal.execution.invocations.begin,
            {
                missionId: missionId,
                expectedGeneration: 1,
                taskKey,
                provenance: "simulation",
                nativeInput: await workbenchAdmissionInput(t, missionId),
            },
        );
        assert(invocation.kind === "ready");
        const result = await t.mutation(internal.execution.invocations.finish, {
            invocationId: invocation.invocationId,
            expectedGeneration: 1,
            response: {
                kind: "operations",
                requests: [
                    {
                        callId: taskKey,
                        name: "adjust_framing",
                        inputJson: JSON.stringify({
                            ...(scenario === "renewed"
                                ? { messageId: activeMessageId }
                                : {}),
                            content,
                        }),
                    },
                ],
            },
        });
        expect(result.requestIds).toHaveLength(1);
        const requestId = result.requestIds[0];
        assert(requestId);
        return t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 1,
        });
    }
    let retained = analystContent;
    let revision = 3;
    if (scenario === "later-model") {
        retained = { ...analystContent, questions: [question, otherQuestion] };
        expect(
            await edit(retained, "independent-before-conflict"),
        ).toMatchObject({ kind: "success" });
        revision = 4;
        proposal.questions.push(otherQuestion);
    }
    const allowed = scenario === "independent" || scenario === "renewed";
    expect(await edit(proposal, "fresh-proposal")).toMatchObject(
        allowed
            ? { kind: "success" }
            : {
                  kind: "refused",
                  code:
                      scenario === "missing-baseline"
                          ? "framing_authority_unavailable"
                          : "framing_analyst_conflict",
              },
    );
    expect(await client.query(api.framing.get, { runId })).toMatchObject({
        revision: allowed ? revision + 1 : revision,
        content: allowed ? proposal : retained,
    });
});
