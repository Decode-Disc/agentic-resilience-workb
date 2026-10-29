import { internal } from "@convex/_generated/api";
import agentTest from "@convex-dev/agent/test";
import { afterEach, expect, test, vi } from "vitest";
import { seedInspectedEvidence } from "@/__tests__/setup/source-preparation";

vi.mock("@convex/integrations/modelRouting", async (original) => ({
    ...(await original<typeof import("@convex/integrations/modelRouting")>()),
    missionRoutes: {
        saved_material_inspection_v1: {
            model: "test/agent",
            provider: "test",
            authorizedForAgent: true,
        },
    },
}));
afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

for (const legacy of [false, true]) {
    test(`changing the configured default ${legacy ? "preserves historical direct invocations" : "selects the actual Agent implementation"}`, async () => {
        vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
        const network = vi.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        id: "default-backend",
                        created: 1,
                        model: "test/agent",
                        choices: [
                            {
                                index: 0,
                                message: {
                                    role: "assistant",
                                    content:
                                        '{"kind":"blocked","code":"fixture_done"}',
                                },
                                finish_reason: "stop",
                            },
                        ],
                        usage: {
                            prompt_tokens: 8,
                            completion_tokens: 4,
                            total_tokens: 12,
                        },
                    }),
                    { headers: { "Content-Type": "application/json" } },
                ),
        );
        vi.stubGlobal("fetch", network);
        const { t, args } = await seedInspectedEvidence();
        agentTest.register(t);
        const missionId = await t.mutation(internal.execution.missions.start, {
            runId: args.runId,
            corpusRevisionId: args.corpusRevisionId,
            definitionId: "saved_material_inspection_v1",
            requestKey: "changed-default",
            expectedGeneration: args.executionGeneration,
        });
        const begun = await t.mutation(internal.execution.invocations.begin, {
            missionId,
            expectedGeneration: args.executionGeneration,
            taskKey: "turn",
            provenance: "live",
        });
        if (begun.kind !== "ready") throw new Error("Expected invocation");
        if (legacy)
            await t.run((ctx) =>
                ctx.db.patch(begun.invocationId, {
                    generationBackend: undefined,
                }),
            );
        await t.action(internal.execution.modelActions.invoke, {
            invocationId: begun.invocationId,
            expectedGeneration: args.executionGeneration,
        });
        const invocation = await t.run((ctx) => ctx.db.get(begun.invocationId));
        if (legacy)
            expect(invocation).not.toHaveProperty("generationStorageRef");
        else {
            expect(invocation?.generationBackend).toEqual({
                id: "convex-agent",
                version: 2,
            });
            expect(invocation?.generationStorageRef).toBeTypeOf("string");
        }
        expect(network).toHaveBeenCalledOnce();
    });
}
