import { internal } from "@convex/_generated/api";
import { vi } from "vitest";
import { seedInspectedEvidence } from "./source-preparation";

export async function seedPiMission() {
    vi.useFakeTimers();
    vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3212");
    const fixture = await seedInspectedEvidence();
    const { t, args, invitationId } = fixture;
    await t.run((ctx) => ctx.db.patch(invitationId, { slotKey: "analyst-4" }));
    const contextId = await t.mutation(
        internal.runWorkspace.openBrowserTestContext,
        {
            slotKey: "analyst-4",
            contextKey: "harness-workflow",
            durationMs: 2 * 60 * 60 * 1000,
        },
    );
    await t.run((ctx) =>
        ctx.db.patch(args.runId, {
            purpose: "browser_test",
            browserTestContextId: contextId,
        }),
    );
    vi.stubGlobal(
        "fetch",
        vi.fn(() => {
            throw new Error("Unexpected provider I/O");
        }),
    );
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "pi-workflow",
        generationBackend: { id: "pi-durable", version: 1 },
        expectedGeneration: 4,
    });
    return { ...fixture, missionId };
}

/** Retains real Pi context before starting the application mission; no model or provider is invoked. */
export async function seedPiHistory(
    t: Awaited<ReturnType<typeof seedInspectedEvidence>>["t"],
    missionId: import("@convex/_generated/dataModel").Id<"agentMissions">,
    generation: number,
    count: number,
    textLength: number,
) {
    const { openMissionPiStorage } = await import(
        "@convex/integrations/piStorage"
    );
    const { BACKGROUND_CONTEXT } = await import(
        "@earendil-works/chord/context"
    );
    const { Harness, createRegistry } = await import(
        "@earendil-works/pi-durable"
    );
    const { createModels } = await import("@earendil-works/pi-ai");
    await t.action(async (ctx) => {
        const storage = await openMissionPiStorage(
            ctx,
            missionId,
            generation,
            "seed-history",
            BACKGROUND_CONTEXT,
        );
        const harness = await Harness.open(
            storage,
            { models: createModels(), registry: createRegistry() },
            BACKGROUND_CONTEXT,
        );
        try {
            const root = await harness.root(BACKGROUND_CONTEXT);
            for (let i = 0; i < count; i++)
                await root.submit(
                    {
                        type: "write",
                        requestId: `history-${i}`,
                        entry: {
                            kind: "workbench.original",
                            data: { index: i },
                            model: [
                                {
                                    role: "user",
                                    content: [
                                        {
                                            type: "text",
                                            text:
                                                `EXACT-ORIGINAL-${i}:` +
                                                "x".repeat(textLength),
                                        },
                                    ],
                                    timestamp: Date.now(),
                                },
                            ],
                        },
                    },
                    BACKGROUND_CONTEXT,
                );
        } finally {
            await harness.close(BACKGROUND_CONTEXT);
        }
        await ctx.runMutation(internal.execution.piControl.closeWorker, {
            missionId,
            expectedGeneration: generation,
            writer: "seed-history",
        });
    });
}
