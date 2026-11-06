import { api, internal } from "@convex/_generated/api";
import { getAgentDefinition } from "@convex/execution/agentCatalog";
import { researchStateSummary } from "@convex/execution/researchControl";
import { afterEach, assert, expect, test, vi } from "vitest";
import { seedPiHistory } from "@/__tests__/setup/pi-mission";
import { nativePiFixtureRoute } from "@/__tests__/setup/pi-native";
import { seedWorkbench } from "@/__tests__/setup/workbench";

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

test.each([
    ["completed", "Research is complete."],
    ["cancelled", "Research has been cancelled."],
    ["failed", "Research has stopped because a problem needs attention."],
] as const)("terminal %s state takes precedence over retained review metadata", (executionStatus, summary) => {
    expect(
        researchStateSummary({
            lifecycleState: "awaiting_source_review",
            executionStatus,
            pauseReason: "source_review",
        }),
    ).toBe(summary);
});

test("post-preparation guidance preserves current state without an unstarted-research example", async () => {
    const { t, runId } = await seedWorkbench(true);
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
    await t.run(async (ctx) => {
        await ctx.db.patch(runId, {
            lifecycleState: "sources_prepared",
            executionStatus: "idle",
        });
        const mission = await ctx.db.get(active.missionId);
        const run = await ctx.db.get(runId);
        assert(mission && run);
        const projected = await getAgentDefinition("workbench_v1").context(
            ctx,
            mission,
            run,
        );
        assert(projected.kind === "ready");
        expect(projected.context.research).toMatchObject({
            phase: "sources_prepared",
            controlAvailable: false,
            summary:
                "Sources preparation has ended. Inspect the retained material and its limits. Question-led Investigation is not available yet.",
        });
        expect(getAgentDefinition("workbench_v1").instructions).not.toContain(
            "Research has not started.",
        );
        expect(getAgentDefinition("workbench_v1").instructions).not.toContain(
            "Choose Start research when ready.",
        );
        expect(getAgentDefinition("workbench_v1").instructions).toContain(
            "research.summary",
        );
    });
});

test("Workbench context distinguishes unstarted, running, requested pause and effective pause in one dossier", async () => {
    const { t, client, runId } = await seedWorkbench(true);
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
    const research = () =>
        t.run(async (ctx) => {
            const mission = await ctx.db.get(active.missionId),
                run = await ctx.db.get(runId);
            assert(mission && run);
            const projected = await getAgentDefinition("workbench_v1").context(
                ctx,
                mission,
                run,
            );
            assert(projected.kind === "ready");
            expect(getAgentDefinition("workbench_v1").instructions).toEqual(
                expect.stringContaining(
                    "does not establish documentary support",
                ),
            );
            return projected.context.research;
        });
    expect(await research()).toMatchObject({
        phase: "framing",
        status: "idle",
        summary: "Research has not started.",
    });
    await client.mutation(api.framing.save, {
        runId,
        expectedRevision: 1,
        requestKey: "wording-program",
        content: {
            scope: "Claims coordination",
            questions: [
                {
                    id: "control",
                    shortLabel: "Control",
                    text: "Who controls coordination?",
                    rationale: "Examine the workflow.",
                },
            ],
        },
    });
    await client.mutation(api.framing.startResearch, {
        runId,
        expectedRevision: 2,
        requestKey: "wording-start",
    });
    expect(await research()).toMatchObject({
        status: "running",
        summary: "Research is running.",
    });
    await client.mutation(api.execution.researchControl.pause, {
        runId,
        expectedGeneration: 1,
    });
    expect(await research()).toMatchObject({
        status: "running",
        pauseRequested: true,
        summary:
            "Pause requested. Research will pause after the work already in progress finishes.",
    });
    await t.mutation(internal.execution.researchControl.checkpoint, { runId });
    expect(await research()).toMatchObject({
        status: "paused",
        summary: "Research is paused.",
    });
    await client.mutation(api.execution.researchControl.resume, {
        runId,
        expectedGeneration: 2,
    });
    expect(await research()).toMatchObject({
        status: "running",
        pauseRequested: false,
        summary: "Research is running.",
    });
});

test("the real native compaction request receives Workbench provenance and approval guidance", async () => {
    const requests: string[] = [];
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
    vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (_url, init) => {
            const body = String(init?.body);
            requests.push(body);
            const text = body.includes("context summarization assistant")
                ? "The analyst retained an assistant hypothesis for investigation; it is not documentary evidence."
                : "The saved program is unchanged; research has not started.";
            return new Response(
                `data: ${JSON.stringify({ id: "wording-fixture", choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } })}\n\ndata: [DONE]\n\n`,
                { headers: { "content-type": "text/event-stream" } },
            );
        }),
    );
    const { t, runId } = await seedWorkbench(false, nativePiFixtureRoute);
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
    await seedPiHistory(t, active.missionId, 1, 8, 16250);
    await t.mutation(internal.execution.missions.resume, {
        missionId: active.missionId,
        expectedGeneration: 1,
        simulation: false,
    });
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    const summary = requests.find((body) =>
        body.includes("context summarization assistant"),
    );
    assert(summary);
    expect(summary).toContain("author of each claim");
    expect(summary).toContain("does not establish documentary support");
    expect(summary).toContain("superseded instructions");
    expect(summary).toContain(
        "An assistant acknowledgment does not change who first introduced an idea",
    );
    expect(summary).toContain(
        "Keep proposals retained only in conversation separate from saved framing",
    );
    const continuation = requests.find(
        (body) => !body.includes("context summarization assistant"),
    );
    assert(continuation);
    const payload = JSON.parse(continuation) as {
        messages: { role: string; content: string }[];
    };
    const required = payload.messages.find(
        (message) => message.role === "system",
    )?.content;
    expect(required).toContain(
        "Only current framing describes what is saved in the research program",
    );
    expect(required).toContain(
        "Explain research status using domain.research.summary and the analyst's next action",
    );
    expect(required).not.toContain("Choose Start research when ready.");
    expect(required).toContain(
        "Do not quote internal state fields, enum values, tool names or implementation mechanics",
    );
    expect(required).toContain(
        "When only a summary is available, use consult_conversation before attributing a historical idea",
    );
    expect(await t.run((ctx) => ctx.db.get(active.missionId))).toMatchObject({
        status: "completed",
    });
});
