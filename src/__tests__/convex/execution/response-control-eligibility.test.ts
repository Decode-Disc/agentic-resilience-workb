import { api, internal } from "@convex/_generated/api";
import { stableStringify } from "@convex/domain/sourcePassages";
import { getAgentDefinition } from "@convex/execution/agentCatalog";
import { preparePiReply } from "@convex/integrations/piInvocation";
import { afterEach, assert, expect, test, vi } from "vitest";
import {
    beginFixtureInvocation,
    dispatchFixtureOperation,
    retainFixtureOutput,
} from "@/__tests__/setup/pi-mission";
import { readConversationPageWithBodies } from "@/__tests__/setup/retained-messages";
import {
    seedWorkbench,
    workbenchAdmissionInput,
} from "@/__tests__/setup/workbench";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

async function begin(
    f: Awaited<ReturnType<typeof seedWorkbench>>,
    key: string,
) {
    const active = await f.t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId: f.runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: true,
        },
    );
    assert(active);
    const invocation = await beginFixtureInvocation(f.t, {
        missionId: active.missionId,
        expectedGeneration: 1,
        taskKey: key,
        provenance: "simulation",
        nativeInput: await workbenchAdmissionInput(f.t, active.missionId),
    });
    assert(invocation.kind === "ready");
    return { ...active, invocation };
}

test.each([
    "framing",
    "research",
] as const)("a changed %s triggers review of a tool-free follow-up", async (change) => {
    const f = await seedWorkbench(true);
    await f.t.run((ctx) => ctx.db.patch(f.runId, { agentExecutionVersion: 3 }));
    const first = await begin(f, "baseline");
    expect(
        await f.t.mutation(internal.execution.invocations.finish, {
            invocationId: first.invocation.invocationId,
            expectedGeneration: 1,
            response: { kind: "complete", text: "Your dossier is available." },
        }),
    ).toMatchObject({ kind: "completed" });
    const baseline = await f.t.run((ctx) =>
        ctx.db
            .query("agentConversations")
            .withIndex("by_run", (q) => q.eq("runId", f.runId))
            .unique(),
    );
    assert(baseline);
    expect(baseline.responseFactsRevisionHash).toMatch(/^[a-f0-9]{64}$/);
    if (change === "framing") {
        const framing = await f.client.query(api.framing.get, {
            runId: f.runId,
        });
        assert(framing);
        await f.client.mutation(api.framing.save, {
            runId: f.runId,
            expectedRevision: framing.revision,
            requestKey: "analyst-framing",
            content: {
                scope: "Creative production",
                questions: [
                    {
                        id: "integration",
                        shortLabel: "Integration",
                        text: "What establishes integration?",
                        rationale: "Inspect the documented mechanism.",
                    },
                ],
            },
        });
    } else
        await f.t.run((ctx) =>
            ctx.db.patch(f.runId, {
                lifecycleState: "sources_prepared",
                researchStartedAt: 1,
            }),
        );
    await f.t.run((ctx) =>
        ctx.db.insert("responseControlSettings", {
            key: "global",
            revision: 1,
            updatedAt: 1,
            enabled: true,
            model: "typesafe/jev-1.14",
            contradictionThreshold: 0.95,
            supportThreshold: 0.7,
        }),
    );
    await f.client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        requestKey: "follow-up",
        text: "What material is available?",
        delivery: "queue",
    });
    const next = await begin(f, "changed-facts");
    const args = {
        invocationId: next.invocation.invocationId,
        expectedGeneration: 1,
        response: {
            kind: "complete" as const,
            text: "Review the four earlier questions and click Start research when ready.",
        },
    };
    expect(
        await f.t.mutation(internal.execution.invocations.finish, args),
    ).toMatchObject({ kind: "blocked", code: "pending_operations" });
    expect(
        await f.t.mutation(internal.execution.invocations.finish, args),
    ).toMatchObject({ kind: "blocked", code: "pending_operations" });
    const requests = await f.t.run((ctx) =>
        ctx.db
            .query("agentOperationRequests")
            .withIndex("by_mission", (q) => q.eq("missionId", next.missionId))
            .take(10),
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
        actor: "system",
        input: { kind: "check_response_coherence" },
    });
    const pendingConversation = await f.t.run((ctx) =>
        ctx.db.get(baseline._id),
    );
    expect(pendingConversation?.responseFactsRevisionHash).toBe(
        baseline?.responseFactsRevisionHash,
    );
    const pendingMission = await f.t.run((ctx) => ctx.db.get(next.missionId));
    assert(pendingMission?.conversationTurnId);
    await f.client.mutation(api.execution.conversations.stopResponse, {
        runId: f.runId,
        turnId: pendingMission.conversationTurnId,
    });
    expect(
        (await f.t.run((ctx) => ctx.db.get(baseline._id)))
            ?.responseFactsRevisionHash,
    ).toBe(baseline?.responseFactsRevisionHash);
});

test("unchanged dossier facts exempt a tool-free reply but retain operation review", async () => {
    const f = await seedWorkbench(true);
    await f.t.run((ctx) => ctx.db.patch(f.runId, { agentExecutionVersion: 3 }));
    const first = await begin(f, "initial");
    await f.t.mutation(internal.execution.invocations.finish, {
        invocationId: first.invocation.invocationId,
        expectedGeneration: 1,
        response: { kind: "complete", text: "Your dossier is available." },
    });
    await f.t.run((ctx) =>
        ctx.db.insert("responseControlSettings", {
            key: "global",
            revision: 1,
            updatedAt: 1,
            enabled: true,
            model: "typesafe/jev-1.14",
            contradictionThreshold: 0.95,
            supportThreshold: 0.7,
        }),
    );
    await f.client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        requestKey: "unchanged",
        text: "Explain that distinction.",
        delivery: "queue",
    });
    const second = await begin(f, "unchanged");
    expect(
        await f.t.mutation(internal.execution.invocations.finish, {
            invocationId: second.invocation.invocationId,
            expectedGeneration: 1,
            response: {
                kind: "complete",
                text: "The saved program is unchanged.",
            },
        }),
    ).toMatchObject({ kind: "completed" });
    expect(
        await f.t.run((ctx) =>
            ctx.db
                .query("agentOperationRequests")
                .withIndex("by_mission", (q) =>
                    q.eq("missionId", second.missionId),
                )
                .take(10),
        ),
    ).toHaveLength(0);
    await f.client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        requestKey: "consult",
        text: "Inspect the dossier state.",
        delivery: "queue",
    });
    const third = await begin(f, "with-operation");
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: third.missionId,
            expectedGeneration: 1,
            cause: "inspect",
            input: { kind: "consult_run_state" },
        },
    );
    await dispatchFixtureOperation(f.t, {
        requestId,
        expectedGeneration: 1,
    });
    expect(
        await f.t.mutation(internal.execution.invocations.finish, {
            invocationId: third.invocation.invocationId,
            expectedGeneration: 1,
            response: { kind: "complete", text: "The dossier is available." },
        }),
    ).toMatchObject({ kind: "blocked", code: "pending_operations" });
});

test("a code-owned confirmation does not consume a changed-facts review", async () => {
    const f = await seedWorkbench(true);
    await f.t.run((ctx) => ctx.db.patch(f.runId, { agentExecutionVersion: 3 }));
    const first = await begin(f, "baseline");
    await f.t.mutation(internal.execution.invocations.finish, {
        invocationId: first.invocation.invocationId,
        expectedGeneration: 1,
        response: { kind: "complete", text: "Your dossier is available." },
    });
    const baseline = await f.t.run((ctx) =>
        ctx.db
            .query("agentConversations")
            .withIndex("by_run", (q) => q.eq("runId", f.runId))
            .unique(),
    );
    assert(baseline);
    await f.t.run(async (ctx) => {
        await ctx.db.patch(f.runId, {
            lifecycleState: "sources_prepared",
            researchStartedAt: 1,
        });
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
    await f.client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        requestKey: "confirmation",
        text: "Resume research",
        delivery: "queue",
    });
    const confirmation = await begin(f, "confirmation");
    expect(
        await f.t.mutation(internal.execution.invocations.finish, {
            invocationId: confirmation.invocation.invocationId,
            expectedGeneration: 1,
            response: {
                kind: "complete",
                text: "Placeholder ignored by the code-owned confirmation.",
            },
        }),
    ).toMatchObject({ kind: "completed" });
    const transcript = await readConversationPageWithBodies(f.client, {
        runId: f.runId,
        paginationOpts: { numItems: 20, cursor: null },
    });
    expect(
        transcript.page
            .filter((message) => message.role === "assistant")
            .map((message) => message.text),
    ).toEqual([
        "Your dossier is available.",
        "No resume was executed. Sources preparation has ended. Inspect the retained material and its limits. Question-led Investigation is not available yet.",
    ]);
    expect(
        (await f.t.run((ctx) => ctx.db.get(baseline._id)))
            ?.responseFactsRevisionHash,
    ).toBe(baseline.responseFactsRevisionHash);
    expect(
        await f.t.run((ctx) =>
            ctx.db
                .query("agentOperationRequests")
                .withIndex("by_mission", (q) =>
                    q.eq("missionId", confirmation.missionId),
                )
                .collect(),
        ),
    ).toHaveLength(0);
    await f.client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        requestKey: "substantive",
        text: "What material is available?",
        delivery: "queue",
    });
    const followup = await begin(f, "substantive");
    expect(
        await f.t.mutation(internal.execution.invocations.finish, {
            invocationId: followup.invocation.invocationId,
            expectedGeneration: 1,
            response: {
                kind: "complete",
                text: "The retained material is available for inspection.",
            },
        }),
    ).toMatchObject({ kind: "blocked", code: "pending_operations" });
});

test("a prepared reply is refused after facts change and every attempt stays reachable for purge", async () => {
    const f = await seedWorkbench(true);
    const active = await begin(f, "prepared-facts");
    const args = {
        invocationId: active.invocation.invocationId,
        expectedGeneration: 1,
    };
    const response = {
        kind: "complete" as const,
        text: "Your dossier is available.",
    };
    const responseJson = stableStringify(response);
    await retainFixtureOutput(f.t, {
        ...args,
        responseJson,
    });
    const mission = await f.t.run((ctx) => ctx.db.get(active.missionId));
    assert(mission);
    const definition = getAgentDefinition(
        mission.definitionId,
        mission.definitionVersion,
    );
    const prepare = () =>
        f.t.action((ctx) =>
            preparePiReply(ctx, args, response, responseJson, definition),
        );
    const prepared = await prepare();
    assert(prepared && "textId" in prepared && prepared.reviewDraft);
    await expect(
        f.t.mutation(internal.execution.invocations.finish, {
            ...args,
            response,
            preparedReply: {
                ...prepared,
                reviewDraft: {
                    ...prepared.reviewDraft,
                    claimedStatuses: ["running"],
                },
            },
        }),
    ).rejects.toThrow("invocation_result_invalid");
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, {
            lifecycleState: "sources_prepared",
            researchStartedAt: 1,
        }),
    );
    const revised = await prepare();
    assert(revised && "textId" in revised);
    expect(revised.basisHash).not.toBe(prepared.basisHash);
    expect(revised.textId).not.toBe(prepared.textId);
    await expect(
        f.t.mutation(internal.execution.invocations.finish, {
            ...args,
            response,
            preparedReply: prepared,
        }),
    ).resolves.toMatchObject({
        kind: "blocked",
        code: "mission_context_changed",
    });
    const history = await readConversationPageWithBodies(f.client, {
        runId: f.runId,
        paginationOpts: { numItems: 20, cursor: null },
    });
    expect(
        history.page.filter((message) => message.role === "assistant"),
    ).toEqual([]);
    // Simulation uses a browser-test dossier. Purge exercises the analyst dossier path.
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, {
            purpose: "research",
            browserTestContextId: undefined,
        }),
    );
    await f.t.action(internal.dossierPurge.purgeResearchDossiers, {
        runIds: [f.runId],
        reason: "Verify retained reply preparation cleanup",
    });
    await f.t.run(async (ctx) => {
        for (const id of [prepared.textId, revised.textId]) {
            expect(await ctx.db.get(id)).toBeNull();
            expect(
                await ctx.db
                    .query("retainedTextFragments")
                    .withIndex("by_text_and_index", (q) => q.eq("textId", id))
                    .first(),
            ).toBeNull();
        }
    });
});
