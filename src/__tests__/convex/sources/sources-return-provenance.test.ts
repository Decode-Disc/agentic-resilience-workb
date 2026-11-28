import { internal } from "@convex/_generated/api";
import {
    completeSources,
    projectPreparedMaterial,
} from "@convex/domain/sources";
import { readWorkbenchFacts } from "@convex/domain/workbenchContext";
import { assert, expect, test } from "vitest";
import { beginFixtureInvocation } from "@/__tests__/setup/pi-mission";
import { readRetainedBody } from "@/__tests__/setup/retained-history";
import { seedCapturedSources } from "@/__tests__/setup/sources-mission";

test("the handoff attributes a false resource explanation to Sources while retaining the actual allowance", async () => {
    const f = await seedCapturedSources();
    await f.t.run(async (ctx) => {
        const preparation = await ctx.db.get(f.preparationId);
        assert(preparation?.sourcesMission);
        await ctx.db.patch(f.preparationId, {
            sourcesMission: {
                ...preparation.sourcesMission,
                searches: 2,
                envelope: {
                    ...preparation.sourcesMission.envelope,
                    initialSearches: 6,
                },
            },
        });
    });
    const invocation = await beginFixtureInvocation(f.t, {
        missionId: f.missionId,
        expectedGeneration: 4,
        taskKey: "source-return-provenance",
        provenance: "simulation",
    });
    assert(invocation.kind === "ready");
    const declaredReason =
        "Search allowance for saved material was exhausted (6/6).";
    const result = await f.t.mutation(internal.execution.invocations.finish, {
        invocationId: invocation.invocationId,
        expectedGeneration: 4,
        response: {
            kind: "complete",
            needs: JSON.parse(invocation.inputJson).activeWork.needs.map(
                (need: { id: string }) => ({
                    needId: need.id,
                    unfinished: [declaredReason],
                    readRequestIds: [f.readRequestId],
                }),
            ),
        },
    });
    expect(result.kind).toBe("completed");
    await f.t.mutation(internal.sourcesMission.finish, {
        preparationId: f.preparationId,
        missionId: f.missionId,
        expectedGeneration: 4,
    });
    const handoffTextId = await f.t.run(async (ctx) => {
        const entries = await ctx.db
            .query("agentExecutionEvents")
            .withIndex("by_run_and_native_input_sequence", (q) =>
                q.eq("runId", f.runId),
            )
            .collect();
        const event = entries.find((entry) =>
            entry.cause.startsWith("sources-handoff:"),
        );
        assert(event?.contextObservation);
        return event.contextObservation.textId;
    });
    const handoff = JSON.parse(await readRetainedBody(f.t, handoffTextId));
    expect(handoff.material).toMatchObject({
        documentaryAssessment: {
            author: {
                type: "agent",
                missionId: f.missionId,
                invocationId: invocation.invocationId,
            },
            verification: "not_semantically_reviewed",
        },
        needs: [{ unfinished: [declaredReason] }],
    });
    expect(handoff.allowance.searches).toMatchObject({
        used: 2,
        limit: 6,
        blockCode: null,
    });
    const context = await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        assert(run);
        return readWorkbenchFacts(ctx, run);
    });
    assert(context.kind === "ready");
    expect(context.context).toMatchObject({
        documentaryPreparation: {
            documentaryAssessment: handoff.material.documentaryAssessment,
            allowance: handoff.allowance,
        },
    });
});

test("analyst-requested fallback finalization keeps its system authorship and the actual interrupted mission status", async () => {
    const f = await seedCapturedSources();
    await f.t.run((ctx) =>
        ctx.db.patch(f.missionId, {
            status: "blocked",
            blockCode: "repetition_stop",
        }),
    );
    await f.t.run((ctx) =>
        ctx.db.patch(f.preparationId, { settlementRequestedAt: Date.now() }),
    );
    await f.t.mutation(internal.sourcesMission.finish, {
        preparationId: f.preparationId,
        missionId: f.missionId,
        expectedGeneration: 4,
    });
    const preparation = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    expect(preparation?.sourcesMission?.result).toMatchObject({
        documentaryAssessment: {
            author: { type: "system" },
            verification: "not_semantically_reviewed",
        },
    });
    expect(await f.t.run((ctx) => ctx.db.get(f.missionId))).toMatchObject({
        status: "blocked",
        blockCode: "repetition_stop",
    });
});

test("historical material has explicitly unknown assessment authorship without rewriting its result", async () => {
    const f = await seedCapturedSources();
    await f.t.run(async (ctx) => {
        const preparation = await ctx.db.get(f.preparationId);
        assert(preparation?.sourcesMission);
        await completeSources(ctx, f.preparationId, {
            kind: "complete",
            needsRevision: preparation.sourcesMission.needsRevision,
            needs: preparation.sourcesMission.needs.map((need) => ({
                needId: need.id,
                unfinished: ["Historical documentary assessment."],
                workRequestIds: [],
            })),
        });
    });
    const before = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    assert(before);
    expect(before.sourcesMission?.result).not.toHaveProperty(
        "documentaryAssessment",
    );
    expect(projectPreparedMaterial(before)?.documentaryAssessment).toEqual({
        author: { type: "unrecorded" },
        verification: "not_semantically_reviewed",
    });
    expect(await f.t.run((ctx) => ctx.db.get(f.preparationId))).toEqual(before);
});

test("a model completion cannot supply system assessment provenance", async () => {
    const f = await seedCapturedSources();
    const invocation = await beginFixtureInvocation(f.t, {
        missionId: f.missionId,
        expectedGeneration: 4,
        taskKey: "forged-assessment-provenance",
        provenance: "simulation",
    });
    assert(invocation.kind === "ready");
    const forged = {
        kind: "complete" as const,
        needs: [
            {
                needId: "common-context",
                unfinished: ["Unfinished examination."],
            },
        ],
        documentaryAssessment: {
            author: { type: "system" },
            verification: "not_semantically_reviewed",
        },
    };
    await expect(
        f.t.mutation(internal.execution.invocations.finish, {
            invocationId: invocation.invocationId,
            expectedGeneration: 4,
            response: forged,
        }),
    ).rejects.toThrow("Validator error");
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.preparationId)))?.sourcesMission
            ?.result,
    ).toBeUndefined();
});
