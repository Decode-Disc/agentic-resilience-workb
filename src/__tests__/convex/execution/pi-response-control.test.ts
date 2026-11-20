import { setTimeout as wait } from "node:timers/promises";
import { api, internal } from "@convex/_generated/api";
import { runPiMission } from "@convex/integrations/piMission";
import { nodeActionGenerationDeadline } from "@convex/resourcePolicy";
import { getFunctionName } from "convex/server";
import { afterEach, expect, test, vi } from "vitest";
import {
    nativePiFixtureRoute,
    nativeTextReply,
    nativeToolReply,
} from "@/__tests__/setup/pi-native";
import { seedWorkbench } from "@/__tests__/setup/workbench";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

test.each([
    false,
    true,
])("native Pi retains a draft across an unavailable response check and respects cancellation=%s", async (cancelled) => {
    expect.hasAssertions();
    const angle = "Investigate estimate review.";
    const { t, client, runId } = await seedWorkbench(
        false,
        nativePiFixtureRoute,
        undefined,
        angle,
        undefined,
        7,
    );
    await t.run((ctx) =>
        ctx.db.insert("responseControlSettings", {
            key: "global",
            revision: 1,
            updatedAt: Date.now(),
            enabled: true,
            model: "typesafe/jev-1.14",
            contradictionThreshold: 0.9,
            supportThreshold: 0.8,
        }),
    );
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
    const draft = "The provisional program is saved. Research has not started.";
    let generations = 0;
    let previewStored!: () => void;
    const preview = new Promise<void>((resolve) => {
        previewStored = resolve;
    });
    vi.stubGlobal(
        "fetch",
        vi.fn(async (url: unknown) => {
            if (String(url).includes("/models?"))
                return Response.json({ data: [] });
            generations++;
            if (generations === 1)
                return nativeToolReply("adjust_framing", {
                    eventBasis: { kind: "open", activityExcerpt: angle },
                    content: {
                        scope: angle,
                        questions: [
                            {
                                id: "authority",
                                shortLabel: "Authority",
                                text: "Who controls estimate approval?",
                                rationale: "Locate workflow authority.",
                            },
                        ],
                    },
                });
            if (generations === 2) {
                const original = nativeTextReply(draft);
                const bytes = await original.text();
                const split = bytes.indexOf("\n\n") + 2;
                return new Response(
                    new ReadableStream({
                        async start(controller) {
                            const encoder = new TextEncoder();
                            controller.enqueue(
                                encoder.encode(bytes.slice(0, split)),
                            );
                            await preview;
                            controller.enqueue(
                                encoder.encode(bytes.slice(split)),
                            );
                            controller.close();
                        },
                    }),
                    { headers: original.headers },
                );
            }
            throw new Error("Unexpected generation after the retained draft");
        }),
    );
    const active = await t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: false,
        },
    );
    if (!active) throw new Error("Expected active turn");
    // Keep the real native partial-write timer and delay its RPC acknowledgement
    // past generation completion, reproducing the production shutdown race.
    vi.useRealTimers();
    await t.action((ctx) =>
        runPiMission(
            {
                ...ctx,
                runMutation: async (reference, ...args) => {
                    const result = await ctx.runMutation(reference, ...args);
                    if (
                        getFunctionName(reference) ===
                        "execution/piStore:publishPreview"
                    ) {
                        previewStored();
                        await wait(1000);
                    }
                    return result;
                },
            },
            { missionId: active.missionId, expectedGeneration: 1 },
            "streaming-slice",
            nodeActionGenerationDeadline(Date.now()),
        ),
    );
    vi.useFakeTimers();
    if (cancelled)
        await client.mutation(api.execution.conversations.stopResponse, {
            runId,
            turnId: active.turnId,
        });
    const pending = await t.run((ctx) => ctx.db.query("agentMissions").first());
    if (!pending?.piWakeToken || !pending.piWakeAt)
        throw new Error("Expected native continuation");
    vi.setSystemTime(Math.max(Date.now(), pending.piWakeAt) + 1);
    await t.action(internal.execution.piWorker.run, {
        missionId: pending._id,
        expectedGeneration: pending.generation,
        token: pending.piWakeToken,
    });
    const history = await client.query(
        api.execution.conversations.listMessages,
        {
            runId,
            paginationOpts: { numItems: 20, cursor: null },
        },
    );
    expect(history.page.filter((m) => m.role === "assistant")).toEqual(
        cancelled
            ? []
            : [
                  expect.objectContaining({
                      text: draft,
                      responseControl: { status: "unavailable" },
                  }),
              ],
    );
    expect(await client.query(api.framing.get, { runId })).toMatchObject({
        revision: 2,
    });
    const retained = await t.run(async (ctx) => ({
        missions: await ctx.db.query("agentMissions").collect(),
        operations: await ctx.db.query("agentOperationRequests").collect(),
        calls: await ctx.db.query("providerCalls").collect(),
    }));
    expect(retained.missions).toEqual([
        expect.objectContaining({
            status: cancelled ? "cancelled" : "completed",
        }),
    ]);
    if (!cancelled)
        expect(
            retained.operations.filter(
                (o) => o.input.kind === "check_response_coherence",
            ),
        ).toEqual([
            expect.objectContaining({
                status: "completed",
                outcome: {
                    kind: "unavailable",
                    code: "configuration_unavailable",
                },
            }),
        ]);
    expect(retained.calls).toHaveLength(2);
    expect(generations).toBe(2);
}, 30000);
