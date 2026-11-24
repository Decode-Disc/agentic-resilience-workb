import { internal } from "@convex/_generated/api";
import { readInContextResult } from "@convex/domain/savedMaterialOperations";
import { getAgentDefinition } from "@convex/execution/agentCatalog";
import { afterEach, expect, test, vi } from "vitest";
import { seedPiMission } from "@/__tests__/setup/pi-mission";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

test.each([
    "retained",
    "current",
] as const)("simulation inspection recognizes returned quotation in %s model context", async (binding) => {
    const { t, missionId, captureId } = await seedPiMission();
    await t.run(async (ctx) => {
        const mission = await ctx.db.get(missionId);
        if (!mission) throw new Error("Missing inspection fixture");
        await ctx.db.patch(missionId, {
            requestKey: "local-simulation",
            ...(binding === "current"
                ? {
                      definitionVersion: getAgentDefinition(
                          mission.definitionId,
                      ).version,
                  }
                : {}),
        });
    });
    await t.mutation(internal.execution.missions.resume, {
        missionId,
        expectedGeneration: 4,
        simulation: true,
    });
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    expect(await t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
        status: "completed",
        result: { captureIds: [captureId] },
    });
    expect(
        await t.query(internal.execution.fixtures.inspect, { missionId }),
    ).toMatchObject({
        status: "completed",
        contextIncludesReturnedQuotation: true,
        providerCallCount: 0,
        completionCount: 1,
    });
    const reading = await t.run(async (ctx) => {
        const requests = await ctx.db
            .query("agentOperationRequests")
            .withIndex("by_mission", (q) => q.eq("missionId", missionId))
            .collect();
        return requests.find(
            (request) => request.input.kind === "read_in_context",
        );
    });
    if (reading?.outcome?.kind !== "success")
        throw new Error("Missing successful retained reading");
    const value = readInContextResult.parse(
        JSON.parse(reading.outcome.valueJson),
    );
    if ("passage" in value)
        value.passage.exactQuote = "A quotation never delivered to this model.";
    else value.text = "Document text never delivered to this model.";
    await t.run((ctx) =>
        ctx.db.patch(reading._id, {
            outcome: {
                ...reading.outcome,
                kind: "success",
                valueJson: JSON.stringify(value),
            },
        }),
    );
    expect(
        await t.query(internal.execution.fixtures.inspect, { missionId }),
    ).toMatchObject({ contextIncludesReturnedQuotation: false });
    await t.run((ctx) =>
        ctx.db.patch(reading._id, {
            outcome: { ...reading.outcome, kind: "success", valueJson: "{}" },
        }),
    );
    await expect(
        t.query(internal.execution.fixtures.inspect, { missionId }),
    ).rejects.toThrow("Invalid retained simulation result");
    await t.run(async (ctx) => {
        await ctx.db.patch(reading._id, { outcome: reading.outcome });
        const invocation = await ctx.db
            .query("agentInvocations")
            .withIndex("by_mission", (q) => q.eq("missionId", missionId))
            .first();
        if (!invocation) throw new Error("Missing retained invocation");
        const request = await ctx.db
            .query("agentInvocationPayloads")
            .withIndex("by_invocation_and_part", (q) =>
                q.eq("invocationId", invocation._id).eq("part", "request"),
            )
            .unique();
        if (!request) throw new Error("Missing retained model request");
        await ctx.db.patch(request._id, { json: "{invalid" });
    });
    await expect(
        t.query(internal.execution.fixtures.inspect, { missionId }),
    ).rejects.toThrow("Invalid retained simulation input");
}, 30_000);
