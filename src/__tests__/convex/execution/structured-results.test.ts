import { internal } from "@convex/_generated/api";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import { getAgentDefinition } from "@convex/execution/agentCatalog";
import { stageObservedBody } from "@convex/execution/observedReply";
import {
    completeRetainedText,
    retainedTextParts,
} from "@convex/execution/retainedText";
import { preparePiResult } from "@convex/integrations/piInvocation";
import { CONVEX_MAX_DOCUMENT_BYTES } from "@convex/resourcePolicy";
import { getDocumentSize } from "convex/values";
import { afterEach, assert, expect, test, vi } from "vitest";
import { beginFixtureInvocation } from "@/__tests__/setup/pi-mission";
import { readRetainedBody } from "@/__tests__/setup/retained-history";
import { seedCapturedSources } from "@/__tests__/setup/sources-mission";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
});

async function sourceCompletion(text = "Unfinished 😀 ".repeat(12_500)) {
    const f = await seedCapturedSources();
    const before = await f.t.run(async (ctx) => {
        const preparation = await ctx.db.get(f.preparationId);
        const mission = await ctx.db.get(f.missionId);
        assert(preparation?.sourcesMission && mission);
        await ctx.db.patch(preparation._id, {
            sourcesMission: {
                ...preparation.sourcesMission,
                coveragePolicy: {
                    version: "sources_coverage_v1",
                    preset: "balanced",
                },
            },
        });
        return {
            needs: preparation.sourcesMission.needs,
            mission,
            calls: await ctx.db.query("providerCalls").collect(),
        };
    });
    const begun = await beginFixtureInvocation(f.t, {
        missionId: f.missionId,
        expectedGeneration: 4,
        taskKey: "structured-result",
        provenance: "simulation",
    });
    assert(begun.kind === "ready");
    const authority = {
        invocationId: begun.invocationId,
        expectedGeneration: 4,
    };
    const response = {
        kind: "complete" as const,
        needs: before.needs.map((need, index) => ({
            needId: need.id,
            unfinished: [
                index === 0 ? text : "No controlled material is available.",
            ],
        })),
    };
    const original = stableStringify(response);
    const responseTextId = await f.t.action((ctx) =>
        stageObservedBody(ctx, authority, "response", original),
    );
    const envelope = stableStringify({
        version: 1,
        provenance: "simulation",
        response,
    });
    const observableReplyTextId = await f.t.action((ctx) =>
        stageObservedBody(ctx, authority, "reply", envelope),
    );
    await f.t.mutation(internal.execution.invocations.retainOutput, {
        ...authority,
        ...(responseTextId ? { responseTextId } : { responseJson: original }),
        ...(observableReplyTextId
            ? { observableReplyTextId }
            : { observableReplyJson: envelope }),
    });
    const definition = getAgentDefinition(
        before.mission.definitionId,
        before.mission.definitionVersion,
    );
    const prepared = await f.t.action((ctx) =>
        preparePiResult(ctx, authority, response, original, definition),
    );
    return {
        ...f,
        authority,
        response,
        original,
        definition,
        prepared,
        before,
    };
}

test("Sources adopts staged material once and preserves its original normalized response", async () => {
    const f = await sourceCompletion();
    const preparedResult = f.prepared?.preparedResult;
    assert(preparedResult);
    const manifest = await f.t.run((ctx) =>
        completeRetainedText(ctx, preparedResult.textId),
    );
    expect(manifest.fragmentHashes.length).toBeGreaterThan(2);
    const beforeAdoption = await f.t.run(async (ctx) => ({
        mission: await ctx.db.get(f.missionId),
        preparation: await ctx.db.get(f.preparationId),
    }));
    expect(beforeAdoption.mission?.status).not.toBe("completed");
    expect(beforeAdoption.preparation?.sourcesMission?.result).toBeUndefined();
    const args = { ...f.authority, preparedResult };
    await expect(
        f.t.mutation(internal.execution.invocations.finish, args),
    ).resolves.toMatchObject({ kind: "completed" });
    await expect(
        f.t.mutation(internal.execution.invocations.finish, args),
    ).resolves.toMatchObject({ kind: "completed" });
    const state = await f.t.run(async (ctx) => ({
        mission: await ctx.db.get(f.missionId),
        invocation: await ctx.db.get(f.authority.invocationId),
        preparation: await ctx.db.get(f.preparationId),
        completions: await ctx.db
            .query("agentExecutionEvents")
            .withIndex("by_mission_and_kind", (q) =>
                q.eq("missionId", f.missionId).eq("kind", "mission_completed"),
            )
            .collect(),
        calls: await ctx.db.query("providerCalls").collect(),
    }));
    expect(state.mission).toMatchObject({
        status: "completed",
        resultTextId: preparedResult.textId,
    });
    expect(state.mission).not.toHaveProperty("result");
    expect(state.completions).toHaveLength(1);
    expect(state.calls).toEqual(f.before.calls);
    const persisted = JSON.parse(
        await readRetainedBody(f.t, preparedResult.textId),
    );
    expect(persisted).toEqual({
        kind: "sources_v1",
        preparationId: f.preparationId,
        material: state.preparation?.sourcesMission?.result,
    });
    expect(persisted.material.outcome).toBe("blocked");
    expect(persisted.material.needs[0].unfinished).toEqual(
        f.response.needs[0]?.unfinished,
    );
    assert(state.invocation?.receivedOutputTextId);
    expect(state.invocation.outputTextId).toBe(
        state.invocation.receivedOutputTextId,
    );
    expect(
        await readRetainedBody(f.t, state.invocation.receivedOutputTextId),
    ).toBe(f.original);
}, 30_000);

test("a result reference cannot authorize another completion proposal", async () => {
    const f = await sourceCompletion();
    const preparedResult = f.prepared?.preparedResult;
    assert(preparedResult);
    await expect(
        f.t.mutation(internal.execution.invocations.finish, {
            ...f.authority,
            preparedResult: {
                ...preparedResult,
                proposal: { ...f.response, needs: [] },
            },
        }),
    ).rejects.toThrow("invocation_result_invalid");
    const state = await f.t.run(async (ctx) => ({
        mission: await ctx.db.get(f.missionId),
        preparation: await ctx.db.get(f.preparationId),
    }));
    expect(state.mission?.status).not.toBe("completed");
    expect(state.preparation?.sourcesMission?.result).toBeUndefined();
});

test("Sources rechecks material facts before adopting a prepared result", async () => {
    const f = await sourceCompletion();
    assert(f.prepared?.preparedResult);
    await f.t.run(async (ctx) => {
        const p = await ctx.db.get(f.preparationId);
        assert(p?.sourcesMission);
        await ctx.db.patch(p._id, {
            sourcesMission: {
                ...p.sourcesMission,
                coveragePolicy: {
                    version: "sources_coverage_v1",
                    preset: "independent_scrutiny",
                },
            },
        });
    });
    await expect(
        f.t.mutation(internal.execution.invocations.finish, {
            ...f.authority,
            preparedResult: f.prepared.preparedResult,
        }),
    ).resolves.toMatchObject({
        kind: "blocked",
        code: "mission_context_changed",
    });
    const p = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    expect(p?.sourcesMission?.coveragePolicy?.preset).toBe(
        "independent_scrutiny",
    );
    expect(p?.sourcesMission?.result).toBeUndefined();
    expect((await f.t.run((ctx) => ctx.db.get(f.missionId)))?.status).not.toBe(
        "completed",
    );
});

test("dossier purge finds staged result bytes from the first fragment", async () => {
    const f = await sourceCompletion();
    assert(f.prepared?.preparedResult);
    await f.t.run(async (ctx) => {
        const p = await ctx.db.get(f.preparationId);
        assert(p?.sourcesMission);
        await ctx.db.patch(p._id, {
            sourcesMission: {
                ...p.sourcesMission,
                coveragePolicy: {
                    version: "sources_coverage_v1",
                    preset: "first_party_depth",
                },
            },
        });
    });
    const basis = await f.t.query(
        internal.execution.invocationLifecycle.resultPreparation,
        {
            ...f.authority,
            responseHash: sha256Hex(f.original),
            proposal: f.response,
        },
    );
    assert(basis);
    const { parts, manifest } = retainedTextParts(
        stableStringify(basis.result),
    );
    const first = parts[0];
    assert(first);
    const incomplete = await f.t.mutation(
        internal.execution.invocationLifecycle.stagePreparedResult,
        {
            ...f.authority,
            inputHash: basis.inputHash,
            responseHash: sha256Hex(f.original),
            proposalHash: sha256Hex(stableStringify(f.response)),
            fragment: { ...manifest, index: 0, content: first },
        },
    );
    expect((await f.t.run((ctx) => ctx.db.get(incomplete)))?.received).toBe(1);
    await f.t.mutation(internal.dossierPurge.beginPurge, {
        runId: f.runId,
        reason: "Remove unpublished fixture preparation",
    });
    while (
        await f.t.mutation(internal.dossierPurge.purgeStep, {
            runId: f.runId,
            step: "agentInvocations",
        })
    ) {
        /* Resumes the existing bounded owner. */
    }
    for (const id of [incomplete, f.prepared.preparedResult.textId]) {
        expect(await f.t.run((ctx) => ctx.db.get(id))).toBeNull();
        expect(
            await f.t.run((ctx) =>
                ctx.db
                    .query("retainedTextFragments")
                    .withIndex("by_text_and_index", (q) => q.eq("textId", id))
                    .collect(),
            ),
        ).toEqual([]);
    }
});

test("oversized documentary needs retain original bytes and return bounded capacity feedback", async () => {
    const baseline = getDocumentSize({
        needs: [
            { needId: "common-context", unfinished: [""], workRequestIds: [] },
        ],
    });
    const text = "x".repeat(CONVEX_MAX_DOCUMENT_BYTES - baseline + 1);
    const f = await sourceCompletion(text);
    assert(f.prepared?.refusal);
    expect(f.prepared.preparedResult).toBeUndefined();
    expect(f.prepared.refusal.response).toMatchObject({
        kind: "completion_refusal",
        code: "sources_result_capacity",
    });
    expect(getDocumentSize(f.prepared.refusal)).toBeLessThan(1024);
    await expect(
        f.t.mutation(internal.execution.invocations.finish, {
            ...f.authority,
            preparedSubmission: f.prepared.refusal,
        }),
    ).resolves.toMatchObject({
        kind: "blocked",
        code: "sources_result_capacity",
    });
    const invocation = await f.t.run((ctx) =>
        ctx.db.get(f.authority.invocationId),
    );
    assert(invocation?.receivedOutputTextId);
    expect(await readRetainedBody(f.t, invocation.receivedOutputTextId)).toBe(
        f.original,
    );
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.preparationId)))?.sourcesMission
            ?.result,
    ).toBeUndefined();
});
