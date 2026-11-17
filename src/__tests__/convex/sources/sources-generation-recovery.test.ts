import { api, internal } from "@convex/_generated/api";
import { afterEach, assert, expect, test, vi } from "vitest";
import { installModel } from "@/__tests__/setup/model-configuration";
import { nativePiFixtureRoute } from "@/__tests__/setup/pi-native";
import { seedCapturedSources } from "@/__tests__/setup/sources-mission";
import { client } from "@/__tests__/setup/sources-time-limit";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

test.each([
    "invalid_output",
    "repetition_stop",
])("public Resume continues Sources after %s through the worker and documentary handoff", async (code) => {
    vi.useFakeTimers();
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
    const f = await seedCapturedSources();
    await installModel(f.t, nativePiFixtureRoute, "sources");
    await f.t.run(async (ctx) => {
        const fixedFramingRevisionId = await ctx.db.insert("framingRevisions", {
            runId: f.runId,
            revision: 1,
            content: { scope: "Fixed workflow", questions: [] },
            requestKey: "recovery",
            contentHash: "fixture",
            origin: "analyst",
            createdAt: 1,
        });
        await ctx.db.patch(f.runId, {
            agentExecutionVersion: 3,
            startMode: "framed",
            fixedFramingRevisionId,
        });
    });
    const preparation = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    assert(preparation?.sourcesMission);
    const completion = {
        kind: "complete",
        needs: preparation.sourcesMission.needs.map((need) => ({
            needId: need.id,
            unfinished: ["Preparation remains unfinished."],
        })),
    };
    let resumed = false;
    const network = vi.fn(
        async () =>
            new Response(
                [
                    `data: ${JSON.stringify({ id: "reply", choices: [{ index: 0, delta: { role: "assistant", content: resumed ? JSON.stringify(completion) : "Malformed completion" }, finish_reason: null }] })}`,
                    `data: ${JSON.stringify({ id: "reply", choices: [{ index: 0, delta: {}, finish_reason: !resumed && code === "invalid_output" ? "content_filter" : "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}`,
                    "data: [DONE]",
                    "",
                ].join("\n\n"),
                { headers: { "content-type": "text/event-stream" } },
            ),
    );
    vi.stubGlobal("fetch", network);
    await f.t.mutation(internal.execution.missions.resume, {
        missionId: f.missionId,
        expectedGeneration: 4,
        simulation: false,
    });
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    expect(await f.t.run((ctx) => ctx.db.get(f.missionId))).toMatchObject({
        status: "blocked",
        blockCode: code,
    });
    await f.t.mutation(internal.execution.handoffs.finishChild, {
        missionId: f.missionId,
    });
    const run = await f.t.run((ctx) => ctx.db.get(f.runId));
    assert(run?.executionStatus === "paused");
    const callsBefore = network.mock.calls.length;
    const originals = await f.t.run((ctx) =>
        ctx.db.query("providerCalls").collect(),
    );
    resumed = true;
    const generation = await client(f).mutation(
        api.execution.researchControl.resume,
        { runId: f.runId, expectedGeneration: run.executionGeneration },
    );
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    expect(await f.t.run((ctx) => ctx.db.get(f.missionId))).toMatchObject({
        status: "completed",
        generation,
    });
    expect(network).toHaveBeenCalledTimes(callsBefore + 1);
    expect(await f.t.run((ctx) => ctx.db.get(f.preparationId))).toMatchObject({
        deadlineAt: preparation.deadlineAt,
    });
    for (const receipt of originals)
        expect(await f.t.run((ctx) => ctx.db.get(receipt._id))).toEqual(
            receipt,
        );
    await f.t.mutation(internal.sourcesMission.finish, {
        missionId: f.missionId,
        preparationId: f.preparationId,
        expectedGeneration: generation,
    });
    expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toMatchObject({
        lifecycleState: "sources_prepared",
        executionStatus: "idle",
    });
});
