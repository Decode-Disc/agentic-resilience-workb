import { internal } from "@convex/_generated/api";
import { assert, expect, test } from "vitest";
import { seedCapturedSources } from "@/__tests__/setup/sources-mission";

test("required context carries a compact outcome and an exact recoverable observation", async () => {
    const f = await seedCapturedSources();
    const context = await f.t.query(internal.execution.context.build, {
        missionId: f.missionId,
        expectedGeneration: 4,
    });
    assert(context.kind === "ready");
    const input = JSON.parse(context.inputJson);
    const observed = input.triggeringRequestsAndResults.find(
        (r: { input: { kind: string } }) =>
            r.input.kind === "search_available_material",
    );
    expect(observed.outcome.kind).toBe("success");
    expect(observed.outcome.captureId).toBe(f.captureId);
    expect(observed.outcome).not.toHaveProperty("valueJson");
    expect(observed.input).toEqual({ kind: "search_available_material" });
    expect(observed.historyReference).toBeTruthy();
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 4,
            cause: "recover-full-outcome",
            input: {
                kind: "consult_mission_state",
                reference: observed.historyReference,
            },
        },
    );
    const result = await f.t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 4,
    });
    assert(result.kind === "success");
    expect(result.valueJson).toContain(f.passage.quotation.slice(0, 30));
});

test("Sources candidate projection omits persistence metadata while retaining selection references", async () => {
    const f = await seedCapturedSources();
    const context = await f.t.query(internal.execution.context.build, {
        missionId: f.missionId,
        expectedGeneration: 4,
    });
    assert(context.kind === "ready");
    const candidate = JSON.parse(context.inputJson).activeWork.candidates.find(
        (c: { sourceId: string }) => c.sourceId === f.sourceId,
    );
    expect(candidate).toBeDefined();
    expect(candidate.canonicalUrl).toEqual(expect.any(String));
    for (const key of [
        "_creationTime",
        "_id",
        "runId",
        "createdAt",
        "providerReference",
        "providerResultPosition",
        "discoveryQueryIndex",
    ])
        expect(candidate).not.toHaveProperty(key);
});

test("structured completion requirements come from the registered contract in required state", async () => {
    const f = await seedCapturedSources();
    const context = await f.t.query(internal.execution.context.build, {
        missionId: f.missionId,
        expectedGeneration: 4,
    });
    assert(context.kind === "ready");
    const completion = JSON.parse(context.inputJson).constraints.completion;
    expect(completion.format).toBe("json");
    expect(JSON.stringify(completion.schema)).toContain("workRequestIds");
    expect(JSON.stringify(completion.schema)).toContain("needsRevision");
});

test("every compact successful observation points to its retained result rather than only admission", async () => {
    const f = await seedCapturedSources();
    const context = await f.t.query(internal.execution.context.build, {
        missionId: f.missionId,
        expectedGeneration: 4,
    });
    assert(context.kind === "ready");
    const input = JSON.parse(context.inputJson);
    for (const observed of input.triggeringRequestsAndResults) {
        if (observed.outcome?.kind !== "success") continue;
        const event = await f.t.run((ctx) =>
            ctx.db.get(observed.historyReference),
        );
        expect(event).toMatchObject({
            kind: expect.stringMatching(/^operation_(completed|observed)$/),
        });
    }
});
