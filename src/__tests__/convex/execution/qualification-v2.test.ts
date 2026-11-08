import { api, internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { sha256Hex } from "@convex/domain/sourcePassages";
import { retainInvocationPayload } from "@convex/execution/journal";
import {
    campaignManifestSchema,
    emptyCampaignLimits,
} from "@convex/qualificationCampaignPolicy";
import { makeFunctionReference } from "convex/server";
import { afterEach, assert, expect, test, vi } from "vitest";
import { configurableCampaign } from "@/__tests__/setup/qualification-v2";
import { seedWorkbench } from "@/__tests__/setup/workbench";

const admit = makeFunctionReference<
    "mutation",
    {
        campaignId: Id<"qualificationCampaigns">;
        key: string;
        candidateHash: string;
        changedPaths: string[];
        correction?: string;
        configurationId?: string;
    },
    Id<"qualificationLots">
>("qualificationCampaigns:admit");
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
});
const manifest = () =>
    campaignManifestSchema.parse({
        ...configurableCampaign(),
        mode: "deterministic",
        perLot: emptyCampaignLimits(),
        total: emptyCampaignLimits(),
        maximumLots: 8,
        batteryHash: "a".repeat(64),
    });
test("a passed profile does not finish a matrix and a correction requires both profiles on the new candidate", async () => {
    const { t } = await seedWorkbench(true);
    const campaignId = await t.mutation(
        internal.qualificationCampaigns.authorize,
        { manifest: manifest() },
    );
    const run = async (
        key: string,
        candidateHash: string,
        configurationId?: string,
        correction?: string,
    ) =>
        t.mutation(admit, {
            campaignId,
            key,
            candidateHash,
            configurationId,
            correction,
            changedPaths: correction ? ["convex/sourcesMission.ts"] : [],
        });
    const finish = async (
        lotId: Id<"qualificationLots">,
        verdict: "passed" | "failed",
    ) => {
        await t.mutation(internal.qualificationCampaigns.reconcile, {
            lotId,
            cleanupCompleted: true,
        });
        await t.mutation(internal.qualificationCampaigns.assess, {
            lotId,
            verdict,
            assessmentHash: "e".repeat(64),
        });
    };
    await expect(run("unknown", "b".repeat(64), "undeclared")).rejects.toThrow(
        "Undeclared",
    );
    const first = await run("first", "b".repeat(64), "first");
    await finish(first, "passed");
    const second = await run("second", "b".repeat(64));
    expect((await t.run((ctx) => ctx.db.get(second)))?.configurationId).toBe(
        "second",
    );
    await finish(second, "failed");
    const corrected = await run(
        "corrected-first",
        "c".repeat(64),
        undefined,
        "Correct the authorized Sources path",
    );
    expect((await t.run((ctx) => ctx.db.get(corrected)))?.configurationId).toBe(
        "first",
    );
    await finish(corrected, "passed");
    const last = await run("corrected-second", "c".repeat(64));
    expect((await t.run((ctx) => ctx.db.get(last)))?.configurationId).toBe(
        "second",
    );
    await finish(last, "passed");
    await expect(run("after-success", "c".repeat(64))).rejects.toThrow(
        "satisfied",
    );
});

import { installModel } from "@/__tests__/setup/model-configuration";

const grant = makeFunctionReference<
    "mutation",
    {
        runId: Id<"researchRuns">;
        fixtureKey: string;
        maximumRequests: number;
        maximumCostUsd: number;
        reasoningSelection?: { workbench: "low"; sources: "high" };
        sourcesLot: {
            runId: Id<"researchRuns">;
            fixtureKey: string;
            scenarioId: string;
        }[];
    },
    null
>("execution/fixtures:authorizeWorkbenchQualification");
async function liveFixture(
    cap = 23,
    shared = false,
    costAccountingPolicy?: "known_final_v1" | "conservative_v1",
) {
    const f = await seedWorkbench(true);
    const raw = configurableCampaign();
    raw.configurations = raw.configurations.slice(0, 1);
    const profile = raw.configurations[0];
    if (!profile) throw new Error("Missing profile");
    if (shared) {
        profile.purpose = "harness_stress";
        profile.models.workbench = {
            model: profile.models.sources.model,
            reasoning: "low",
        };
        profile.models.sources.reasoning = "high";
        const installed = await installModel(
            f.t,
            { model: profile.models.sources.model, reasoningEffort: "high" },
            "sources",
            { reasoningEfforts: ["low", "high"], reasoningDefault: "high" },
        );
        const configured = await installed.admin.query(
            api.modelConfiguration.list,
            {},
        );
        const assignment = configured.assignments.find(
            (a) => a.agent === "workbench",
        );
        await installed.admin.mutation(api.modelConfiguration.assign, {
            agent: "workbench",
            catalogId: installed.catalogId,
            expectedRevision: assignment?.revision ?? 0,
            requestKey: "shared-workbench",
        });
    } else {
        await installModel(
            f.t,
            { model: profile.models.workbench.model },
            "workbench",
        );
        await installModel(
            f.t,
            { model: profile.models.sources.model },
            "sources",
        );
    }
    const m = campaignManifestSchema.parse({
        ...raw,
        ...(costAccountingPolicy ? { costAccountingPolicy } : {}),
        scenarios: raw.scenarios.map((s, index) =>
            index === 0 ? { ...s, limits: { model: cap } } : s,
        ),
        batteryHash: "a".repeat(64),
    });
    const campaignId = await f.t.mutation(
        internal.qualificationCampaigns.authorize,
        { manifest: m },
    );
    const lotId = await f.t.mutation(admit, {
        campaignId,
        key: "first",
        candidateHash: "b".repeat(64),
        changedPaths: [],
    });
    const original = await f.t.run((ctx) => ctx.db.get(f.runId));
    if (!original?.companySnapshot || !original.browserTestContextId)
        throw new Error("Missing context");
    const contextId = original.browserTestContextId;
    await f.t.mutation(internal.qualificationCampaigns.bind, {
        lotId,
        contextId,
    });
    const companySnapshot = original.companySnapshot;
    const bindings = await f.t.run(async (ctx) => {
        const entries = [];
        const { _id, _creationTime, ...fields } = original;
        for (const [index, scenario] of raw.scenarios.entries()) {
            const fixtureKey = `qualification-${scenario.id}`;
            const values = {
                ...fields,
                reservationKey: `browser:${fixtureKey}`,
                companySnapshot: {
                    ...companySnapshot,
                    cik: scenario.company.cik,
                    legalName: scenario.company.name,
                    ticker: scenario.company.ticker,
                    websiteUrl: scenario.company.websiteUrl,
                },
            };
            const runId =
                index === 0
                    ? f.runId
                    : await ctx.db.insert("researchRuns", values);
            if (index === 0) await ctx.db.patch(runId, values);
            entries.push({ runId, fixtureKey, scenarioId: scenario.id });
        }
        return entries;
    });
    const first = bindings[0];
    if (!first) throw new Error("Missing scenario");
    await f.t.mutation(grant, {
        runId: first.runId,
        fixtureKey: first.fixtureKey,
        maximumRequests: 60,
        maximumCostUsd: 3,
        sourcesLot: bindings,
        ...(shared
            ? {
                  reasoningSelection: {
                      workbench: "low" as const,
                      sources: "high" as const,
                  },
              }
            : {}),
    });
    const context = await f.t.run((ctx) => ctx.db.get(contextId));
    expect(context?.paidQualification).toMatchObject({
        maximumRequests: 60,
        maximumCostUsd: 3,
        sourcesLot: bindings.map((b) => b.runId),
    });
    expect(
        await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
    vi.stubEnv("WORKBENCH_AGENT_ENABLED", "true");
    const missions = new Map<
        Id<"researchRuns">,
        import("@convex/_generated/dataModel").Doc<"agentMissions">
    >();
    for (const binding of bindings) {
        await f.client.mutation(api.execution.conversations.submit, {
            runId: binding.runId,
            requestKey: "counter-mission",
            text: "Inspect the declared documentary workflow",
            delivery: "queue",
        });
        await f.t.mutation(internal.execution.conversations.startTurn, {
            runId: binding.runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: false,
        });
        const mission = await f.t.run((ctx) =>
            ctx.db
                .query("agentMissions")
                .withIndex("by_run_and_request_key", (q) =>
                    q.eq("runId", binding.runId),
                )
                .first(),
        );
        if (!mission) throw new Error("No real mission");
        missions.set(binding.runId, mission);
    }
    const attempt = async (index: number, runId = f.runId) => {
        const mission = missions.get(runId);
        if (!mission) throw new Error("No admitted mission");
        const inputJson = JSON.stringify({ fixture: index });
        const invocationId = await f.t.run((ctx) =>
            ctx.db.insert("agentInvocations", {
                missionId: mission._id,
                runId,
                generation: mission.generation,
                definitionVersion: mission.definitionVersion,
                taskKey: `counter-${index}`,
                provenance: "live",
                status: "started",
                inputJson,
                createdAt: Date.now(),
            }),
        );
        return {
            runId,
            missionId: mission._id,
            invocationId,
            executionGeneration: mission.generation,
            workflowVersion: mission.definitionVersion,
            stepKey: "agent_reasoning",
            service: "model" as const,
            operation: "agent_reasoning",
            operationKey: `mission:${mission._id}:invocation:${invocationId}:attempt:1`,
            attempt: 1,
            inputHash: sha256Hex(inputJson),
            status: "started" as const,
        };
    };
    return { ...f, contextId, lotId, campaignId, bindings, attempt };
}
test("the backend grants and enforces shared three-dossier budgets above historical caps", async () => {
    const f = await liveFixture();
    const { attempt } = f;
    for (let index = 0; index < 23; index++) {
        const args = await attempt(index);
        const started = await f.t.mutation(
            internal.providerCalls.recordAttempt,
            args,
        );
        expect(started.shouldExecute).toBe(true);
        expect(
            (await f.t.mutation(internal.providerCalls.recordAttempt, args))
                .shouldExecute,
        ).toBe(false);
        await f.t.mutation(internal.providerCalls.recordAttempt, {
            ...args,
            status: "succeeded",
            reportedCost: 0,
            dispatchOutcome: "response_received",
        });
    }
    await expect(
        f.t.mutation(internal.providerCalls.recordAttempt, await attempt(23)),
    ).rejects.toThrow("qualification_budget_exhausted");
    expect(
        await f.t.run((ctx) =>
            ctx.db
                .query("providerCalls")
                .withIndex("by_run", (q) => q.eq("runId", f.runId))
                .collect(),
        ),
    ).toHaveLength(23);
    for (const [index, binding] of f.bindings.slice(1).entries()) {
        for (let n = 0; n < (index === 0 ? 19 : 18); n++) {
            const args = await attempt(100 + index * 20 + n, binding.runId);
            await f.t.mutation(internal.providerCalls.recordAttempt, args);
            await f.t.mutation(internal.providerCalls.recordAttempt, {
                ...args,
                status: "succeeded",
                reportedCost: 0,
                dispatchOutcome: "response_received",
            });
        }
    }
    const second = f.bindings[1];
    if (!second) throw new Error("Missing second dossier");
    await expect(
        f.t.mutation(
            internal.providerCalls.recordAttempt,
            await attempt(999, second.runId),
        ),
    ).rejects.toThrow("qualification_budget_exhausted");

    await f.t.mutation(internal.qualificationCampaigns.beginCleanup, {
        lotId: f.lotId,
    });
    await f.t.mutation(internal.runWorkspace.closeBrowserTestContext, {
        slotKey: "analyst-4",
        contextKey: "native-workbench",
    });
    expect(
        await f.t.mutation(internal.qualificationCampaigns.reconcile, {
            lotId: f.lotId,
            cleanupCompleted: true,
        }),
    ).toMatchObject({
        reconciled: true,
        usage: { model: 60, search: 0, acquisition: 0 },
    });
});

test("late billing updates retained consumption without reopening an unknown attempt", async () => {
    const f = await liveFixture(2);
    const args = await f.attempt(0);
    const started = await f.t.mutation(
        internal.providerCalls.recordAttempt,
        args,
    );
    await f.t.run(async (ctx) => {
        const invocation = await ctx.db.get(args.invocationId);
        if (!invocation) throw new Error("Missing admitted invocation");
        await retainInvocationPayload(
            ctx,
            invocation,
            "request",
            JSON.stringify({ model: "fixture/first-workbench", messages: [] }),
        );
    });
    await f.t.mutation(internal.providerCalls.observeGeneration, {
        invocationId: args.invocationId,
        generationId: "fixture-generation",
    });
    await f.t.mutation(internal.providerCalls.recordAttempt, {
        ...args,
        status: "failed",
        errorCode: "network_error",
        dispatchOutcome: "unknown",
    });
    await f.t.mutation(internal.providerCalls.requestBilling, {
        invocationId: args.invocationId,
    });
    await f.t.mutation(internal.providerCalls.claimBilling, {
        providerCallId: started.providerCallId,
        attempt: 1,
    });
    await f.t.mutation(internal.providerCalls.settleBilling, {
        providerCallId: started.providerCallId,
        attempt: 1,
        generationId: "fixture-generation",
        cost: 1,
    });
    const retained = await f.t.run((ctx) =>
        ctx.db
            .query("qualificationUsage")
            .withIndex("by_context_and_run", (q) =>
                q.eq("contextId", f.contextId).eq("runId", undefined),
            )
            .unique(),
    );
    expect(retained).toMatchObject({
        usage: { model: 1, costUsd: 1 },
        pending: 0,
        unknown: 1,
        overruns: 1,
    });
    await expect(
        f.t.mutation(internal.providerCalls.recordAttempt, await f.attempt(1)),
    ).rejects.toThrow("qualification_budget_exhausted");
});

test("simulation binds every declared scenario once and inspection pages retain more than legacy limits", async () => {
    const f = await seedWorkbench(true);
    const m = manifest();
    if (m.version !== 2) throw new Error("v2 required");
    const campaignId = await f.t.mutation(
        internal.qualificationCampaigns.authorize,
        { manifest: m },
    );
    const lotId = await f.t.mutation(admit, {
        campaignId,
        key: "paged",
        candidateHash: "d".repeat(64),
        changedPaths: [],
    });
    const original = await f.t.run((ctx) => ctx.db.get(f.runId));
    if (!original?.companySnapshot || !original.browserTestContextId)
        throw new Error("Missing context");
    await f.t.mutation(internal.qualificationCampaigns.bind, {
        lotId,
        contextId: original.browserTestContextId,
    });
    const companySnapshot = original.companySnapshot;
    const bindings = await f.t.run(async (ctx) => {
        const entries = [];
        const { _id, _creationTime, ...fields } = original;
        for (const [index, s] of m.scenarios.entries()) {
            const fixtureKey = `page-${s.id}`;
            const values = {
                ...fields,
                reservationKey: `browser:${fixtureKey}`,
                companySnapshot: {
                    ...companySnapshot,
                    cik: s.company.cik,
                },
            };
            const runId =
                index === 0
                    ? f.runId
                    : await ctx.db.insert("researchRuns", values);
            if (index === 0) await ctx.db.patch(runId, values);
            entries.push({ runId, fixtureKey, scenarioId: s.id });
        }
        return entries;
    });
    const bind = makeFunctionReference<
        "mutation",
        { dossiers: typeof bindings },
        null
    >("execution/fixtures:bindCampaignScenarios");
    await expect(
        f.t.mutation(bind, { dossiers: bindings.slice(0, 2) }),
    ).rejects.toThrow("scenario");
    await f.t.mutation(bind, { dossiers: bindings });
    await expect(
        f.t.mutation(bind, {
            dossiers: bindings.map((b, index) => ({
                ...b,
                scenarioId: index === 0 ? "outside" : b.scenarioId,
            })),
        }),
    ).rejects.toThrow("scenario");
    const first = bindings[0];
    if (!first) throw new Error("Missing binding");
    const snapshot = await f.t.query(
        internal.execution.fixtures.qualificationSnapshot,
        {
            runId: first.runId,
            fixtureKey: first.fixtureKey,
        },
    );
    expect(snapshot.accounting).toMatchObject({
        pending: 0,
        unknown: 0,
        overruns: 0,
    });
    const accounting = snapshot.accounting;
    if (!accounting) throw new Error("Missing simulation accounting");
    await f.t.run((ctx) => ctx.db.patch(accounting._id, { pending: 1 }));
    await f.t.mutation(bind, { dossiers: bindings });
    expect(await f.t.run((ctx) => ctx.db.get(accounting._id))).toMatchObject({
        pending: 1,
    });
    await f.t.run(async (ctx) => {
        for (let i = 0; i < 135; i++)
            await ctx.db.insert("providerCalls", {
                runId: f.runId,
                operationKey: `page-${i}`,
                stepKey: "inspection",
                service: "model",
                operation: "inspection",
                attempt: 1,
                inputHash: "f".repeat(64),
                status: "succeeded",
                executionGeneration: 0,
                workflowVersion: 1,
                createdAt: Date.now(),
            });
    });
    const inspect = makeFunctionReference<
        "query",
        {
            runId: Id<"researchRuns">;
            fixtureKey: string;
            kind: "receipts";
            paginationOpts: { numItems: number; cursor: string | null };
        },
        { page: unknown[]; isDone: boolean; continueCursor: string }
    >("execution/fixtures:inspectQualificationPage");
    let cursor: string | null = null;
    const rows: unknown[] = [];
    do {
        const result: {
            page: unknown[];
            isDone: boolean;
            continueCursor: string;
        } = await f.t.query(inspect, {
            runId: first.runId,
            fixtureKey: first.fixtureKey,
            kind: "receipts",
            paginationOpts: { numItems: 32, cursor },
        });
        rows.push(...result.page);
        if (result.isDone) break;
        cursor = result.continueCursor;
    } while (cursor);
    expect(rows).toHaveLength(135);
});

test("one catalogue model can serve different declared Workbench and Sources efforts", async () => {
    const f = await liveFixture(2, true);
    const context = await f.t.run((ctx) => ctx.db.get(f.contextId));
    expect(context?.paidQualification?.reasoningSelection).toEqual({
        workbench: "low",
        sources: "high",
    });
});

test("backend execution surface is retained in the immutable authorization and cannot replace browser authority", async () => {
    const { t } = await seedWorkbench(true);
    const input = manifest();
    assert(input.version === 2);
    const campaignId = await t.mutation(
        internal.qualificationCampaigns.authorize,
        {
            manifest: { ...input, executionSurface: "backend" },
        },
    );
    const retained = await t.run((ctx) => ctx.db.get(campaignId));
    expect(retained?.manifest).toMatchObject({ executionSurface: "backend" });
    await expect(
        t.mutation(internal.qualificationCampaigns.authorize, {
            manifest: input,
        }),
    ).rejects.toThrow("Campaign authorization conflict");
});

test("future policy settles a final known cost and retains reservations for unknown or partial observations", async () => {
    const f = await liveFixture(23, false, "known_final_v1");
    const first = await f.attempt(0);
    const admitted = await f.t.mutation(
        internal.providerCalls.recordAttempt,
        first,
    );
    const pending = await f.t.run((ctx) => ctx.db.get(admitted.providerCallId));
    expect(pending?.qualificationReservationUsd).toBeGreaterThan(0);
    await f.t.mutation(internal.providerCalls.recordAttempt, {
        ...first,
        status: "succeeded",
        reportedCost: 0.00001,
        dispatchOutcome: "response_received",
    });
    const usage = await f.t.run((ctx) =>
        ctx.db
            .query("qualificationUsage")
            .withIndex("by_context_and_run", (q) =>
                q.eq("contextId", f.contextId).eq("runId", f.runId),
            )
            .unique(),
    );
    expect(usage?.usage.costUsd).toBeCloseTo(0.00001, 10);
    expect(usage?.usage.model).toBe(1);
    const second = await f.attempt(1);
    const uncertain = await f.t.mutation(
        internal.providerCalls.recordAttempt,
        second,
    );
    await f.t.mutation(internal.providerCalls.recordAttempt, {
        ...second,
        status: "partial",
        reportedCost: 0,
        dispatchOutcome: "response_received",
    });
    const receipt = await f.t.run((ctx) =>
        ctx.db.get(uncertain.providerCallId),
    );
    const after = await f.t.run((ctx) =>
        ctx.db
            .query("qualificationUsage")
            .withIndex("by_context_and_run", (q) =>
                q.eq("contextId", f.contextId).eq("runId", f.runId),
            )
            .unique(),
    );
    expect(after?.usage.costUsd).toBeCloseTo(
        0.00001 + (receipt?.qualificationReservationUsd ?? 0),
        10,
    );
    expect(after?.usage.model).toBe(2);
});

test.each([
    undefined,
    "conservative_v1",
    "known_final_v1",
] as const)("native reservation and capacity preserve the explicitly selected policy (%s)", async (policy) => {
    const f = await liveFixture(23, false, policy);
    const args = await f.attempt(0);
    await f.t.run(async (ctx) => {
        const mission = await ctx.db.get(args.missionId);
        const invocation = await ctx.db.get(args.invocationId);
        assert(mission?.modelRevisionId && invocation);
        const model = await ctx.db.get(mission.modelRevisionId);
        assert(model);
        await ctx.db.patch(model._id, {
            descriptor: { ...model.descriptor, contextWindow: 32768 },
        });
        await ctx.db.patch(invocation._id, {
            generationBackend: { id: "pi-durable", version: 1 },
        });
        const native = await ctx.db.get(invocation._id);
        assert(native);
        await retainInvocationPayload(
            ctx,
            native,
            "request",
            JSON.stringify({ input: "small" }),
            undefined,
            { effectiveMaxOutputTokens: 6144 },
        );
    });
    const admitted = await f.t.mutation(
        internal.providerCalls.recordAttempt,
        args,
    );
    const receipt = await f.t.run((ctx) => ctx.db.get(admitted.providerCallId));
    expect(receipt?.qualificationReservationUsd).toBeCloseTo(
        policy === "known_final_v1" ? 0.0086016 : 0.0239616,
        10,
    );
    await f.t.mutation(internal.providerCalls.recordAttempt, {
        ...args,
        status: "succeeded",
        reportedCost: 0.00001,
        dispatchOutcome: "response_received",
    });
    const expanded = await f.attempt(1);
    await f.t.run(async (ctx) => {
        await ctx.db.patch(expanded.invocationId, {
            generationBackend: { id: "pi-durable", version: 1 },
        });
        const invocation = await ctx.db.get(expanded.invocationId);
        assert(invocation);
        await retainInvocationPayload(
            ctx,
            invocation,
            "request",
            JSON.stringify({ input: "x".repeat(140000) }),
            undefined,
            { effectiveMaxOutputTokens: 6144 },
        );
    });
    const reserve = f.t.mutation(
        internal.providerCalls.recordAttempt,
        expanded,
    );
    if (policy === "known_final_v1")
        expect((await reserve).shouldExecute).toBe(true);
    else {
        await expect(reserve).rejects.toThrow(
            "qualification_native_capacity_not_authorized",
        );
        expect(
            await f.t.run((ctx) =>
                ctx.db
                    .query("providerCalls")
                    .withIndex("by_run", (q) => q.eq("runId", expanded.runId))
                    .filter((q) =>
                        q.eq(q.field("invocationId"), expanded.invocationId),
                    )
                    .collect(),
            ),
        ).toEqual([]);
    }
});

test.each([
    "succeeded",
    "partial",
] as const)("late %s cost settlement preserves finality and counts the attempt once", async (status) => {
    const f = await liveFixture(23, false, "known_final_v1");
    const attempt = await f.attempt(0);
    const admitted = await f.t.mutation(
        internal.providerCalls.recordAttempt,
        attempt,
    );
    await f.t.mutation(internal.providerCalls.recordAttempt, {
        ...attempt,
        status,
        dispatchOutcome: "response_received",
    });
    const late = {
        ...attempt,
        status,
        dispatchOutcome: "response_received" as const,
        reportedCost: 0.00001,
    };
    await f.t.mutation(internal.providerCalls.recordAttempt, late);
    await f.t.mutation(internal.providerCalls.recordAttempt, late);
    await f.t.mutation(internal.providerCalls.recordAttempt, {
        ...attempt,
        status,
        dispatchOutcome: "response_received",
    });
    const receipt = await f.t.run((ctx) => ctx.db.get(admitted.providerCallId));
    assert(receipt);
    const usage = await f.t.run((ctx) =>
        ctx.db
            .query("qualificationUsage")
            .withIndex("by_context_and_run", (q) =>
                q.eq("contextId", f.contextId).eq("runId", f.runId),
            )
            .unique(),
    );
    expect(receipt.reportedCost).toBe(0.00001);
    expect(receipt.reportedCostFinal ?? false).toBe(status === "succeeded");
    expect(usage?.usage.costUsd).toBeCloseTo(
        status === "succeeded"
            ? 0.00001
            : (receipt.qualificationReservationUsd ?? 0),
        10,
    );
    expect(usage?.usage.model).toBe(1);
    expect(
        await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toHaveLength(1);
});
