import { api, internal } from "@convex/_generated/api";
import { afterEach, expect, test, vi } from "vitest";
import { seedInspectedEvidence } from "@/__tests__/setup/source-preparation";
import { seedCapturedSources } from "@/__tests__/setup/sources-mission";

afterEach(() => vi.unstubAllEnvs());

test("direct admission refuses the retired backend and defaults new work to Pi", async () => {
    const { t, args } = await seedInspectedEvidence();
    const network = vi.fn(() => {
        throw new Error("Unexpected external I/O");
    });
    vi.stubGlobal("fetch", network);
    try {
        const input = {
            runId: args.runId,
            corpusRevisionId: args.corpusRevisionId,
            definitionId: "saved_material_inspection_v1" as const,
            requestKey: "inspect-material",
            expectedGeneration: args.executionGeneration,
        };
        const snapshot = () =>
            t.run(async (ctx) => ({
                run: await ctx.db.get(args.runId),
                missions: await ctx.db.query("agentMissions").collect(),
                receipts: await ctx.db.query("providerCalls").collect(),
                scheduled: await ctx.db.system
                    .query("_scheduled_functions")
                    .collect(),
            }));
        const before = await snapshot();
        await expect(
            t.mutation(internal.execution.missions.start, {
                ...input,
                generationBackend: { id: "convex-agent", version: 2 },
            }),
        ).rejects.toThrow("generation_backend_unknown");
        expect(await snapshot()).toEqual(before);
        const missionId = await t.mutation(
            internal.execution.missions.start,
            input,
        );
        expect(await t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
            definitionVersion: 5,
            executionRuntime: "pi-durable",
            generationBackend: { id: "pi-durable", version: 1 },
        });
        expect(network).not.toHaveBeenCalled();
    } finally {
        vi.unstubAllGlobals();
    }
});

test("resume refuses a retired mission before recovering its blocked state", async () => {
    const { t, args } = await seedInspectedEvidence();
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "retired-recovery",
        expectedGeneration: args.executionGeneration,
    });
    await t.run((ctx) =>
        ctx.db.patch(missionId, {
            executionRuntime: undefined,
            generationBackend: { id: "convex-agent", version: 2 },
            status: "blocked",
            blockCode: "execution_interrupted",
        }),
    );
    const snapshot = () =>
        t.run(async (ctx) => ({
            mission: await ctx.db.get(missionId),
            run: await ctx.db.get(args.runId),
            invocations: await ctx.db.query("agentInvocations").collect(),
            receipts: await ctx.db.query("providerCalls").collect(),
            scheduled: await ctx.db.system
                .query("_scheduled_functions")
                .collect(),
        }));
    const before = await snapshot();
    await expect(
        t.mutation(internal.execution.missions.resume, {
            missionId,
            expectedGeneration: args.executionGeneration,
        }),
    ).rejects.toThrow("generation_backend_unknown");
    expect(await snapshot()).toEqual(before);
});

test("analyst Resume refuses a retired Sources mission before taking the research slot", async () => {
    const f = await seedCapturedSources();
    await f.t.run(async (ctx) => {
        await ctx.db.patch(f.runId, {
            startMode: "framed",
            agentExecutionVersion: 3,
            executionStatus: "paused",
            pauseReason: "analyst",
        });
        await ctx.db.patch(f.missionId, {
            generationBackend: { id: "convex-agent", version: 2 },
            executionRuntime: undefined,
        });
    });
    const snapshot = () =>
        f.t.run(async (ctx) => ({
            run: await ctx.db.get(f.runId),
            mission: await ctx.db.get(f.missionId),
            preparation: await ctx.db.get(f.preparationId),
            calls: await ctx.db.query("providerCalls").collect(),
            scheduled: await ctx.db.system
                .query("_scheduled_functions")
                .collect(),
        }));
    const before = await snapshot();
    await expect(
        f.t
            .withIdentity({ subject: f.userId })
            .mutation(api.execution.researchControl.resume, {
                runId: f.runId,
                expectedGeneration: 4,
            }),
    ).rejects.toThrow("generation_backend_unknown");
    expect(await snapshot()).toEqual(before);
});
