import { api, internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
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
    vi.unstubAllGlobals();
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
    researchDurationMs?: number,
) {
    const f = await seedWorkbench(
        true,
        undefined,
        researchDurationMs === undefined ? 60000 : 50 * 60_000,
    );
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
        costAccountingPolicy: costAccountingPolicy ?? "known_final_v1",
        ...(researchDurationMs === undefined
            ? {}
            : { researchDurationMs, contextDurationMs: 50 * 60_000 }),
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
        const company = original.companyId
            ? await ctx.db.get(original.companyId)
            : null;
        assert(company);
        const originalCorpus = original.activeCorpusRevisionId
            ? await ctx.db.get(original.activeCorpusRevisionId)
            : null;
        const originalFraming = original.currentFramingRevisionId
            ? await ctx.db.get(original.currentFramingRevisionId)
            : null;
        const {
            _id: _companyId,
            _creationTime: _companyTime,
            ...companyFields
        } = company;
        for (const [index, scenario] of raw.scenarios.entries()) {
            const fixtureKey = `qualification-${scenario.id}`;
            const companyId = await ctx.db.insert("companies", {
                ...companyFields,
                cik: scenario.company.cik,
                legalName: scenario.company.name,
                ticker: scenario.company.ticker,
                websiteUrl: scenario.company.websiteUrl,
            });
            const values = {
                ...fields,
                companyId,
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
            else {
                assert(originalCorpus && originalFraming);
                const {
                    _id: _corpusId,
                    _creationTime: _corpusTime,
                    ...corpus
                } = originalCorpus;
                const {
                    _id: _framingId,
                    _creationTime: _framingTime,
                    ...framing
                } = originalFraming;
                await ctx.db.patch(runId, {
                    activeCorpusRevisionId: await ctx.db.insert(
                        "corpusRevisions",
                        { ...corpus, runId },
                    ),
                    currentFramingRevisionId: await ctx.db.insert(
                        "framingRevisions",
                        { ...framing, runId },
                    ),
                });
            }
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
async function startQualifiedSources(
    f: Awaited<ReturnType<typeof liveFixture>>,
) {
    const scenario = configurableCampaign().scenarios[0];
    assert(scenario);
    await f.client.mutation(api.framing.save, {
        runId: f.runId,
        expectedRevision: 1,
        requestKey: "duration-framing",
        content: scenario.framing,
    });
    await f.client.mutation(api.framing.startResearch, {
        runId: f.runId,
        expectedRevision: 2,
        requestKey: "duration-start",
    });
    const run = await f.t.run((ctx) => ctx.db.get(f.runId));
    assert(
        run?.activeCorpusRevisionId &&
            run.researchStartedAt !== undefined &&
            run.sourcesEnvelope,
    );
    await f.t.mutation(internal.researchRuns.transition, {
        runId: f.runId,
        expectedExecutionGeneration: run.executionGeneration,
        lifecycleState: "checking_public_evidence",
        executionStatus: "running",
        stepKey: "check_public_evidence",
    });
    await f.t.mutation(internal.researchRuns.transition, {
        runId: f.runId,
        expectedExecutionGeneration: run.executionGeneration,
        lifecycleState: "discovering_sources",
        executionStatus: "running",
        stepKey: "prepare_sources",
    });
    await f.t.mutation(internal.researchPlanning.createForRun, {
        runId: f.runId,
        expectedExecutionGeneration: run.executionGeneration,
    });
    const claim = {
        runId: f.runId,
        corpusRevisionId: run.activeCorpusRevisionId,
        expectedGeneration: run.executionGeneration,
        envelope: run.sourcesEnvelope,
    };
    const preparationId = await f.t.mutation(
        internal.sourcesMission.claim,
        claim,
    );
    return {
        run: { ...run, researchStartedAt: run.researchStartedAt },
        claim,
        preparationId,
    };
}

test("a qualified Sources grant still requires the deployment preparation window before Start", async () => {
    const f = await liveFixture();
    const configuredWindow = process.env.SOURCES_PREPARATION_WINDOW_MINUTES;
    assert(configuredWindow);
    vi.stubEnv("SOURCES_PREPARATION_WINDOW_MINUTES", undefined);
    await expect(startQualifiedSources(f)).rejects.toThrow(
        "sources_configuration_unavailable",
    );
    expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toMatchObject({
        lifecycleState: "framing",
        executionStatus: "idle",
    });
    expect(
        await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
    vi.stubEnv("SOURCES_PREPARATION_WINDOW_MINUTES", configuredWindow);
    await f.client.mutation(api.framing.startResearch, {
        runId: f.runId,
        expectedRevision: 2,
        requestKey: "duration-start",
    });
    const started = await f.t.run((ctx) => ctx.db.get(f.runId));
    expect(started?.researchStartedAt).toEqual(expect.any(Number));
    expect(started?.sourcesEnvelope).toBeDefined();
});

test.each([
    25, 75,
])("explicit research authority (%i minutes) reaches preparation, mission and provider beyond the old cutoff without renewal", async (minutes) => {
    const duration = minutes * 60_000;
    const f = await liveFixture(23, false, "known_final_v1", duration);
    const context = await f.t.run((ctx) => ctx.db.get(f.contextId));
    assert(context);
    vi.setSystemTime(Date.now() + 7000);
    const { run, claim, preparationId } = await startQualifiedSources(f);
    const deadline =
        minutes === 25 ? run.researchStartedAt + duration : context.expiresAt;
    expect(
        (await f.t.run((ctx) => ctx.db.get(preparationId)))?.deadlineAt,
    ).toBe(deadline);
    const start = {
        runId: f.runId,
        expectedGeneration: run.executionGeneration,
        definitionId: "sources_v1" as const,
        scope: { kind: "sources_v1" as const, preparationId },
        requestKey: "duration-mission",
    };
    const missionId = await f.t.mutation(
        internal.execution.missions.start,
        start,
    );
    await f.t.mutation(internal.execution.missions.resume, {
        missionId,
        expectedGeneration: run.executionGeneration,
    });
    expect((await f.t.run((ctx) => ctx.db.get(missionId)))?.deadlineAt).toBe(
        deadline,
    );
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId,
            expectedGeneration: run.executionGeneration,
            cause: "duration-state",
            input: { kind: "consult_mission_state" },
        },
    );
    expect((await f.t.run((ctx) => ctx.db.get(requestId)))?.deadlineAt).toBe(
        deadline,
    );
    vi.setSystemTime(run.researchStartedAt + 20 * 60_000);
    expect(
        await f.client.mutation(api.framing.startResearch, {
            runId: f.runId,
            expectedRevision: 2,
            requestKey: "duration-start",
        }),
    ).toBe(f.runId);
    expect(await f.t.mutation(internal.sourcesMission.claim, claim)).toBe(
        preparationId,
    );
    expect(await f.t.mutation(internal.execution.missions.start, start)).toBe(
        missionId,
    );
    expect(
        (await f.t.run((ctx) => ctx.db.get(preparationId)))?.deadlineAt,
    ).toBe(deadline);
    const inputJson = JSON.stringify({
        fixture: "authorized-beyond-old-window",
    });
    const sourceMission = await f.t.run((ctx) => ctx.db.get(missionId));
    assert(sourceMission);
    const invocationId = await f.t.run((ctx) =>
        ctx.db.insert("agentInvocations", {
            missionId,
            runId: f.runId,
            generation: run.executionGeneration,
            definitionVersion: sourceMission.definitionVersion,
            taskKey: "duration-probe",
            provenance: "live",
            status: "started",
            inputJson,
            createdAt: Date.now(),
        }),
    );
    const attempt = {
        runId: f.runId,
        missionId,
        invocationId,
        executionGeneration: run.executionGeneration,
        workflowVersion: sourceMission.definitionVersion,
        stepKey: "agent_reasoning",
        service: "model" as const,
        operation: "agent_reasoning",
        operationKey: `mission:${missionId}:invocation:${invocationId}:attempt:1`,
        attempt: 1,
        inputHash: sha256Hex(inputJson),
    };
    const admitted = await f.t.mutation(internal.providerCalls.recordAttempt, {
        ...attempt,
        status: "started",
    });
    expect(admitted.shouldExecute).toBe(true);
    expect(admitted.deadlineAt).toBe(deadline);
    await f.t.mutation(internal.providerCalls.recordAttempt, {
        ...attempt,
        status: "succeeded",
        reportedCost: 0,
        dispatchOutcome: "response_received",
    });
    vi.setSystemTime(deadline + 1);
    await expect(
        f.t.mutation(internal.providerCalls.recordAttempt, {
            ...attempt,
            operationKey: `${attempt.operationKey}:expired`,
            status: "started",
        }),
    ).rejects.toThrow(/execution_deadline|paid_work_disabled/);
    expect(
        (await f.t.run((ctx) => ctx.db.get(preparationId)))?.deadlineAt,
    ).toBe(deadline);
    expect((await f.t.run((ctx) => ctx.db.get(missionId)))?.deadlineAt).toBe(
        deadline,
    );
});

test("new server authorization requires research duration but an existing legacy grant keeps its identity and clocks", async () => {
    const f = await liveFixture(23, false, "known_final_v1", 25 * 60_000);
    const campaign = await f.t.run((ctx) => ctx.db.get(f.campaignId));
    assert(campaign?.manifest.version !== 1 && campaign);
    const historical = { ...campaign.manifest };
    delete historical.researchDurationMs;
    await expect(
        f.t.mutation(internal.qualificationCampaigns.authorize, {
            manifest: { ...historical, key: "new-without-duration" },
        }),
    ).rejects.toThrow(/Explicit researchDurationMs/);
    // Construct an already-authorized historical record, not a runtime migration.
    const manifestHash = sha256Hex(stableStringify(historical));
    await f.t.run((ctx) =>
        ctx.db.patch(f.campaignId, { manifest: historical, manifestHash }),
    );
    const before = await f.t.run((ctx) => ctx.db.get(f.contextId));
    expect(
        await f.t.mutation(internal.qualificationCampaigns.authorize, {
            manifest: historical,
        }),
    ).toBe(f.campaignId);
    const { run, preparationId } = await startQualifiedSources(f);
    const legacyDeadline = run.researchStartedAt + 15 * 60_000;
    expect(
        (await f.t.run((ctx) => ctx.db.get(preparationId)))?.deadlineAt,
    ).toBe(legacyDeadline);
    const missionId = await f.t.mutation(internal.execution.missions.start, {
        runId: f.runId,
        expectedGeneration: run.executionGeneration,
        definitionId: "sources_v1",
        scope: { kind: "sources_v1", preparationId },
        requestKey: "legacy-duration",
    });
    expect((await f.t.run((ctx) => ctx.db.get(missionId)))?.deadlineAt).toBe(
        legacyDeadline,
    );
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.contextId)))?.paidQualification,
    ).toEqual(before?.paidQualification);
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.campaignId)))?.manifestHash,
    ).toBe(manifestHash);
});

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

test("an expired unresolved attempt fences another dossier without claiming budget exhaustion", async () => {
    const f = await liveFixture(2);
    const args = await f.attempt(0);
    const first = await f.t.mutation(
        internal.providerCalls.recordAttempt,
        args,
    );
    await f.t.run((ctx) =>
        ctx.db.patch(first.providerCallId, { leaseExpiresAt: Date.now() - 1 }),
    );
    const other = f.bindings[1];
    assert(other);
    await expect(
        f.t.mutation(
            internal.providerCalls.recordAttempt,
            await f.attempt(1, other.runId),
        ),
    ).rejects.toThrow("qualification_outcome_unresolved");
    const calls = await f.t.run((ctx) =>
        ctx.db.query("providerCalls").collect(),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
        _id: first.providerCallId,
        status: "started",
    });
    const usage = await f.t.run((ctx) =>
        ctx.db
            .query("qualificationUsage")
            .withIndex("by_context_and_run", (q) =>
                q.eq("contextId", f.contextId).eq("runId", undefined),
            )
            .unique(),
    );
    expect(usage).toMatchObject({ pending: 1, usage: { model: 1 } });
    expect(usage?.usage.costUsd).toBeLessThan(3);
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
    ).rejects.toThrow("qualification_outcome_unresolved");
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

test("a new grant cannot silently replace an explicitly selected legacy accounting policy", async () => {
    await expect(liveFixture(23, false, "conservative_v1")).rejects.toThrow(
        "resource_policy_unsupported",
    );
});

test.each([
    undefined,
    "known_final_v1",
] as const)("current native reservation uses admitted model capacity (%s)", async (policy) => {
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
    expect(receipt?.qualificationReservationUsd).toBeCloseTo(0.0086016, 10);
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
    expect((await reserve).shouldExecute).toBe(true);
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

test("a proven local refusal is not a Sources input observation despite its HTTP status", async () => {
    const f = await liveFixture();
    const first = f.bindings[0];
    if (!first) throw new Error("Missing first binding");
    const started = await startQualifiedSources(f);
    const context = await f.t.run(async (ctx) => {
        const run = await ctx.db.get(first.runId);
        const sourceMission = await ctx.db
            .query("agentMissions")
            .withIndex("by_run_and_request_key", (q) =>
                q.eq("runId", first.runId),
            )
            .first();
        if (!run || !sourceMission) throw new Error("Missing fixture mission");
        const prepId = started.preparationId;
        await ctx.db.patch(run._id, { sourcePreparationId: prepId });
        await ctx.db.patch(sourceMission._id, {
            requestKey: `sources:${prepId}`,
        });
        const invocationId = await ctx.db.insert("agentInvocations", {
            runId: run._id,
            missionId: sourceMission._id,
            generation: run.executionGeneration,
            definitionVersion: 1,
            taskKey: "first-refused",
            status: "started",
            provenance: "live",
            inputJson: "{}",
            createdAt: Date.now(),
        });
        const receiptId = await ctx.db.insert("providerCalls", {
            runId: run._id,
            invocationId,
            operationKey: "refused-local",
            stepKey: "fixture",
            executionGeneration: run.executionGeneration,
            attempt: 1,
            service: "model",
            operation: "agent_reasoning",
            status: "failed",
            dispatchOutcome: "not_dispatched",
            providerObservation: { httpStatus: 400, observedAt: Date.now() },
            createdAt: Date.now(),
        });
        await ctx.db.patch(sourceMission._id, {
            firstProviderInput: {
                invocationId,
                providerCallId: receiptId,
                contentHash: "a".repeat(64),
            },
        });
        return { runId: run._id, fixtureKey: first.fixtureKey };
    });
    const snapshot = await f.t.query(
        internal.execution.fixtures.qualificationSnapshot,
        context,
    );
    expect(snapshot.firstSourcesInput?.dispatch).toBe("not_dispatched");
});

test("the input pointer advances past proven non-dispatch but keeps an uncertain first attempt", async () => {
    const f = await liveFixture();
    const a = await f.attempt(0);
    const b = await f.attempt(1);
    const [first, second] = await f.t.run(async (ctx) => {
        const ids = [];
        for (const attempt of [a, b]) {
            const receiptId = await ctx.db.insert("providerCalls", {
                ...attempt,
                status: "failed",
                createdAt: Date.now(),
                dispatchOutcome:
                    attempt === a ? "not_dispatched" : "response_received",
            });
            await ctx.db.patch(attempt.invocationId, {
                providerCallId: receiptId,
            });
            ids.push(receiptId);
        }
        return ids;
    });
    assert(first && second);
    await f.t.run(async (ctx) => {
        const invocation = await ctx.db.get(a.invocationId);
        assert(invocation);
        await retainInvocationPayload(
            ctx,
            invocation,
            "request",
            JSON.stringify({ wire: 1 }),
        );
        const next = await ctx.db.get(b.invocationId);
        assert(next);
        await retainInvocationPayload(
            ctx,
            next,
            "request",
            JSON.stringify({ wire: 2 }),
        );
    });
    expect(
        (await f.t.run((ctx) => ctx.db.get(a.missionId)))?.firstProviderInput
            ?.invocationId,
    ).toBe(b.invocationId);
    await f.t.run(async (ctx) => {
        await ctx.db.patch(a.missionId, { firstProviderInput: undefined });
        await ctx.db.patch(first, { dispatchOutcome: "unknown" });
        const one = await ctx.db.get(a.invocationId);
        const two = await ctx.db.get(b.invocationId);
        assert(one && two);
        await retainInvocationPayload(
            ctx,
            one,
            "request",
            JSON.stringify({ wire: 1 }),
        );
        await retainInvocationPayload(
            ctx,
            two,
            "request",
            JSON.stringify({ wire: 2 }),
        );
    });
    expect(
        (await f.t.run((ctx) => ctx.db.get(a.missionId)))?.firstProviderInput
            ?.invocationId,
    ).toBe(a.invocationId);
});

test("legacy usage without conflict accounting cannot authorize another attempt", async () => {
    const f = await liveFixture();
    await f.t.run(async (ctx) => {
        for (const row of await ctx.db
            .query("qualificationUsage")
            .withIndex("by_context_and_run", (q) =>
                q.eq("contextId", f.contextId),
            )
            .collect())
            await ctx.db.patch(row._id, { conflicts: undefined });
    });
    await expect(
        f.t.mutation(internal.providerCalls.recordAttempt, await f.attempt(0)),
    ).rejects.toThrow("qualification_outcome_unresolved");
});

test.each([
    "matched",
    "missing",
    "changed",
])("native financial reservations require a correlated relay acknowledgement (proof=%s)", async (proof) => {
    const f = await liveFixture();
    vi.stubEnv("OPENROUTER_API_KEY", "offline-only");
    await f.t.run(async (ctx) => {
        const context = await ctx.db.get(f.contextId);
        assert(context?.paidQualification);
        await ctx.db.patch(context._id, {
            paidQualification: {
                ...context.paidQualification,
                relayOrigin: "http://127.0.0.1:43210",
            },
        });
    });
    let dispatches = 0;
    const seen: string[] = [];
    vi.stubGlobal(
        "fetch",
        async (input: RequestInfo | URL, init?: RequestInit) => {
            const request = new Request(input, init);
            seen.push(
                JSON.stringify({
                    url: request.url,
                    headers: [...request.headers.keys()],
                    originalHeaders:
                        input instanceof Request
                            ? [...input.headers.keys()]
                            : null,
                    initHeaders: [...new Headers(init?.headers).keys()],
                    redirect: init?.redirect,
                }),
            );
            expect(new URL(request.url).origin).toBe("http://127.0.0.1:43210");
            expect(request.headers.has("authorization")).toBe(false);
            expect(init?.redirect).toBe("error");
            const correlation = request.headers.get(
                "x-workbench-relay-dispatch",
            );
            assert(correlation);
            expect(JSON.parse(correlation).bodyHash).toBe(
                sha256Hex(await request.text()),
            );
            dispatches++;
            return Response.json(
                { error: { message: "Local deterministic refusal" } },
                {
                    status: 400,
                    headers:
                        proof === "missing"
                            ? {}
                            : {
                                  "x-workbench-relay-not-dispatched":
                                      proof === "matched"
                                          ? correlation
                                          : JSON.stringify({
                                                ...JSON.parse(correlation),
                                                generation: 999,
                                            }),
                              },
                },
            );
        },
    );
    const mission = await f.t.run(async (ctx) => {
        const conversation = await ctx.db
            .query("agentConversations")
            .withIndex("by_run", (q) => q.eq("runId", f.runId))
            .unique();
        const turn = conversation?.activeTurnId
            ? await ctx.db.get(conversation.activeTurnId)
            : null;
        return turn?.missionId ? ctx.db.get(turn.missionId) : null;
    });
    assert(mission);
    await f.t.mutation(internal.execution.missions.resume, {
        missionId: mission._id,
        expectedGeneration: mission.generation,
        simulation: false,
    });
    const ready = await f.t.run((ctx) => ctx.db.get(mission._id));
    assert(ready?.piWakeToken);
    await f.t.action(internal.execution.piWorker.run, {
        missionId: mission._id,
        expectedGeneration: mission.generation,
        token: ready.piWakeToken,
    });
    const state = await f.t.run(async (ctx) => ({
        calls: await ctx.db
            .query("providerCalls")
            .withIndex("by_run", (q) => q.eq("runId", f.runId))
            .collect(),
        usage: await ctx.db
            .query("qualificationUsage")
            .withIndex("by_context_and_run", (q) =>
                q.eq("contextId", f.contextId).eq("runId", f.runId),
            )
            .unique(),
    }));
    const endMission = await f.t.run((ctx) => ctx.db.get(mission._id));
    if (!dispatches) {
        const invs = await f.t.run((ctx) =>
            ctx.db
                .query("agentInvocations")
                .withIndex("by_mission", (q) => q.eq("missionId", mission._id))
                .collect(),
        );
        throw new Error(
            JSON.stringify({
                code: endMission?.blockCode,
                seen,
                fixtureRun: f.runId,
                missionRun: mission.runId,
                last: endMission?.lastInvocationId,
                allReceipts: await f.t.run(async (ctx) =>
                    (await ctx.db.query("providerCalls").collect()).map(
                        (c) => ({
                            id: c._id,
                            runId: c.runId,
                            invocationId: c.invocationId,
                            status: c.status,
                        }),
                    ),
                ),
                invocations: invs.map((i) => ({
                    status: i.status,
                    providerCallId: i.providerCallId,
                    output: i.outputJson,
                    raw: i.rawOutputJson,
                    received: i.receivedOutputJson,
                })),
            }),
        );
    }
    expect({
        dispatches,
        blockCode: endMission?.blockCode,
        requests: state.calls.map((c) => ({
            status: c.status,
            errorCode: c.errorCode,
        })),
    }).toMatchObject({ dispatches: 1 });
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0]?.dispatchOutcome).toBe(
        proof === "matched" ? "not_dispatched" : "response_received",
    );
    expect(state.usage?.usage.model).toBe(1);
    if (proof === "matched") expect(state.usage?.usage.costUsd).toBe(0);
    else expect(state.usage?.usage.costUsd).toBeGreaterThan(0);
}, 30000);

test("qualificationContinuation treats a quiet local generation block as safe while refusing active, retrying or systemic blocks", async () => {
    const f = await liveFixture();
    const first = f.bindings[0];
    if (!first) throw new Error("Missing first binding");
    const setup = await f.t.run(async (ctx) => {
        const run = await ctx.db.get(first.runId);
        const mission = await ctx.db
            .query("agentMissions")
            .withIndex("by_run_and_request_key", (q) =>
                q.eq("runId", first.runId),
            )
            .first();
        if (!run || !mission) throw new Error("Missing fixture run or mission");
        const now = Date.now();
        const existingConversation = await ctx.db
            .query("agentConversations")
            .withIndex("by_run", (q) => q.eq("runId", run._id))
            .unique();
        const conversationId =
            existingConversation?._id ??
            (await ctx.db.insert("agentConversations", {
                runId: run._id,
                storageRef: "conv-quiet-block",
                queuedCount: 0,
                createdAt: now,
            }));
        await ctx.db.patch(conversationId, { queuedCount: 0 });
        const turnId = await ctx.db.insert("agentConversationTurns", {
            runId: run._id,
            conversationId,
            status: "active",
            instructionVersion: 1,
            generation: run.executionGeneration,
            messageCount: 1,
            missionId: mission._id,
            createdAt: now,
        });
        await ctx.db.patch(conversationId, { activeTurnId: turnId });
        const existingSession = await ctx.db
            .query("piSessions")
            .withIndex("by_conversation", (q) =>
                q.eq("conversationId", conversationId),
            )
            .unique();
        const sessionId =
            existingSession?._id ??
            (await ctx.db.insert("piSessions", {
                missionId: mission._id,
                conversationId,
                generation: run.executionGeneration,
                writer: "worker-1",
                epoch: 1,
                leaseUntil: now - 1_000,
                sequence: 2,
                nextId: 3,
            }));
        await ctx.db.patch(sessionId, {
            leaseUntil: now - 1_000,
            settlementFailureCode: undefined,
        });
        await ctx.db.patch(mission._id, {
            status: "blocked",
            blockCode: "repetition_stop",
            piActiveWriter: undefined,
            piWakeId: undefined,
        });
        return {
            runId: run._id,
            fixtureKey: first.fixtureKey,
            missionId: mission._id,
            sessionId,
            conversationId,
            now,
        };
    });

    const queryContinuation = () =>
        f.t.query(internal.execution.fixtures.qualificationContinuation, {
            runId: setup.runId,
            fixtureKey: setup.fixtureKey,
        });

    expect(await queryContinuation()).toMatchObject({
        scenarioQuiet: true,
        executionStatus: "idle",
        sourcesStatus: null,
        conversation: { kind: "quiet_blocked", code: "repetition_stop" },
    });

    // Active lease must stay unsettled.
    await f.t.run((ctx) =>
        ctx.db.patch(setup.sessionId, { leaseUntil: Date.now() + 60_000 }),
    );
    expect(await queryContinuation()).toMatchObject({
        scenarioQuiet: false,
        conversation: { kind: "unsettled", code: "repetition_stop" },
    });
    await f.t.run((ctx) =>
        ctx.db.patch(setup.sessionId, { leaseUntil: setup.now - 1_000 }),
    );

    // Active writer must stay unsettled.
    await f.t.run((ctx) =>
        ctx.db.patch(setup.missionId, { piActiveWriter: "worker-2" }),
    );
    expect(await queryContinuation()).toMatchObject({
        scenarioQuiet: false,
        conversation: { kind: "unsettled", code: "repetition_stop" },
    });
    await f.t.run((ctx) =>
        ctx.db.patch(setup.missionId, { piActiveWriter: undefined }),
    );

    // Settlement failure must stay unsettled.
    await f.t.run((ctx) =>
        ctx.db.patch(setup.sessionId, {
            settlementFailureCode: "native_settlement_incomplete",
        }),
    );
    expect(await queryContinuation()).toMatchObject({
        scenarioQuiet: false,
        conversation: { kind: "unsettled", code: "repetition_stop" },
    });
    await f.t.run((ctx) =>
        ctx.db.patch(setup.sessionId, { settlementFailureCode: undefined }),
    );

    // Systemic / non-generation block codes must stay unsettled.
    await f.t.run((ctx) =>
        ctx.db.patch(setup.missionId, {
            blockCode: "qualification_budget_exhausted",
        }),
    );
    expect(await queryContinuation()).toMatchObject({
        scenarioQuiet: false,
        conversation: {
            kind: "unsettled",
            code: "qualification_budget_exhausted",
        },
    });
    await f.t.run((ctx) =>
        ctx.db.patch(setup.missionId, { blockCode: "repetition_stop" }),
    );

    // Non-idle run status must refuse scenarioQuiet even with a quiet_blocked conversation.
    await f.t.run((ctx) =>
        ctx.db.patch(setup.runId, { executionStatus: "running" }),
    );
    expect(await queryContinuation()).toMatchObject({
        scenarioQuiet: false,
        executionStatus: "running",
        conversation: { kind: "quiet_blocked", code: "repetition_stop" },
    });
});
