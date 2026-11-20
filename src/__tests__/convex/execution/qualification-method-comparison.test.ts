import { internal } from "@convex/_generated/api";
import { campaignManifestSchema } from "@convex/qualificationCampaignPolicy";
import { afterEach, expect, test, vi } from "vitest";
import {
    admitMethodComparison,
    methodComparisonManifest as comparison,
} from "@/__tests__/setup/qualification-method-comparison";
import { seedWorkbench } from "@/__tests__/setup/workbench";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
});

test("campaign authorization retains an explicit task-method comparison with identical routes", async () => {
    const f = await seedWorkbench(true);
    const manifest = campaignManifestSchema.parse(comparison());
    const campaignId = await f.t.mutation(
        internal.qualificationCampaigns.authorize,
        { manifest },
    );
    const stored = await f.t.run((ctx) => ctx.db.get(campaignId));
    expect(stored?.manifest).toEqual(manifest);
    expect(manifest.version).toBe(2);
    if (manifest.version === 1)
        throw new Error("Configurable campaign required");
    expect(
        manifest.configurations.map((profile) => profile.taskMethods),
    ).toEqual(["retained_control", "native_skills"]);
});

test("method comparison rejects unequal routes and missing arms before authorization", () => {
    const unequal = comparison();
    const treatment = unequal.configurations[1];
    if (!treatment) throw new Error("Treatment required");
    treatment.models = {
        ...treatment.models,
        workbench: {
            ...treatment.models.workbench,
            model: "fixture/different-model",
        },
    };
    expect(() => campaignManifestSchema.parse(unequal)).toThrow(/identical/);
    expect(() =>
        campaignManifestSchema.parse({
            ...comparison(),
            configurations: comparison().configurations.slice(0, 1),
        }),
    ).toThrow(/both/);
});

test("the authorized control pins prior methods with current tools before the first framing turn", async () => {
    const { getAgentDefinition } = await import(
        "@convex/execution/agentCatalog"
    );
    const { agentToolSchemas } = await import(
        "@convex/execution/agentDefinition"
    );
    const f = await seedWorkbench(
        true,
        undefined,
        60000,
        "Inspect routing authority.",
        undefined,
        null,
    );
    const original = await f.t.run((ctx) => ctx.db.get(f.runId));
    if (!original?.browserTestContextId || !original.companySnapshot)
        throw new Error("Fixture required");
    const { scenarioId } = await admitMethodComparison(f.t, f.runId);
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, { reservationKey: "browser:method-control" }),
    );
    await f.t.mutation(internal.execution.fixtures.bindCampaignScenarios, {
        dossiers: [
            { runId: f.runId, fixtureKey: "method-control", scenarioId },
        ],
    });
    await f.t.mutation(internal.execution.fixtures.activateWorkbench, {
        runId: f.runId,
        fixtureKey: "method-control",
    });
    const turn = await f.t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId: f.runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: true,
        },
    );
    if (!turn) throw new Error("Turn required");
    const mission = await f.t.run((ctx) => ctx.db.get(turn.missionId));
    expect(mission?.definitionVersion).toBe(8);
    const control = getAgentDefinition("workbench_v1", 8);
    const treatment = getAgentDefinition("workbench_v1", 7);
    expect(agentToolSchemas(control)).toEqual(agentToolSchemas(treatment));
    expect(control.operations.read).toBe(treatment.operations.read);
    const observations = await f.t.run(async (ctx) => {
        if (!mission) throw new Error("Mission required");
        return [
            await control.context(ctx, mission, original),
            await treatment.context(
                ctx,
                { ...mission, definitionVersion: 7 },
                original,
            ),
        ];
    });
    expect(observations[0]).toEqual(observations[1]);
    expect(control.instructions).not.toContain("<available_skills>");
    expect(control.method?.(original)).toBe(
        getAgentDefinition("workbench_v1", 6).method?.(original),
    );
    expect(getAgentDefinition("workbench_v1").version).toBe(9);
    expect(getAgentDefinition("sources_v1").version).toBe(5);
});

test.each([
    "ordinary",
    "other-arm",
    "expired",
    "closed",
] as const)("control operations refuse %s authority", async (boundary) => {
    const f = await seedWorkbench(
        true,
        undefined,
        60000,
        "Inspect routing authority.",
        undefined,
        null,
    );
    const lot = await admitMethodComparison(
        f.t,
        f.runId,
        boundary === "other-arm" ? "native_skills" : "retained_control",
    );
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, { reservationKey: "browser:method-control" }),
    );
    await f.t.mutation(internal.execution.fixtures.bindCampaignScenarios, {
        dossiers: [
            {
                runId: f.runId,
                fixtureKey: "method-control",
                scenarioId: lot.scenarioId,
            },
        ],
    });
    await f.t.mutation(internal.execution.fixtures.activateWorkbench, {
        runId: f.runId,
        fixtureKey: "method-control",
    });
    const turn = await f.t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId: f.runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: true,
        },
    );
    if (!turn) throw new Error("Turn required");
    // Exercise the executor's authority check against a retained control mission.
    await f.t.run(async (ctx) => {
        await ctx.db.patch(turn.missionId, { definitionVersion: 8 });
        if (boundary === "ordinary")
            await ctx.db.patch(f.runId, {
                purpose: "research",
                browserTestContextId: undefined,
            });
        if (boundary === "expired")
            await ctx.db.patch(lot.contextId, { expiresAt: Date.now() - 1 });
        if (boundary === "closed")
            await ctx.db.patch(lot.campaignId, { status: "closed" });
    });
    await expect(
        f.t.mutation(internal.execution.operations.enqueue, {
            missionId: turn.missionId,
            expectedGeneration: 1,
            cause: "outside-authority",
            input: {
                kind: "read",
                path: "/agent-skills/research-methods-v1/workbench-framing/SKILL.md",
            },
        }),
    ).rejects.toThrow(
        boundary === "closed"
            ? /Campaign lot is not active/
            : boundary === "other-arm"
              ? /task_method_comparison_not_authorized/
              : /"code":"not_authorized"/,
    );
    const effects = await f.t.run((ctx) =>
        ctx.db
            .query("agentOperationRequests")
            .filter((q) => q.eq(q.field("missionId"), turn.missionId))
            .collect(),
    );
    expect(effects).toEqual([]);
});
