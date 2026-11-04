import { api, internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { sha256Hex } from "@convex/domain/sourcePassages";
import { getAgentDefinition } from "@convex/execution/agentCatalog";
import { agentToolSchemas } from "@convex/execution/agentDefinition";
import { piInputProfileKey } from "@convex/integrations/modelInput";
import { WORKBENCH_MODEL_ROUTE } from "@convex/integrations/modelRouting";
import { revisionRoute } from "@convex/modelConfiguration";
import { makeFunctionReference } from "convex/server";
import { afterEach, assert, expect, test, vi } from "vitest";
import { installModel } from "@/__tests__/setup/model-configuration";
import { seedWorkbench } from "@/__tests__/setup/workbench";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});
async function fixture() {
    const f = await seedWorkbench(true);
    vi.stubEnv("WORKBENCH_AGENT_ENABLED", "true");
    const { admin } = await installModel(f.t, WORKBENCH_MODEL_ROUTE);
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, { reservationKey: "browser:qualification" }),
    );
    const authorize = () =>
        f.t.mutation(
            internal.execution.fixtures.authorizeWorkbenchQualification,
            { runId: f.runId, fixtureKey: "qualification" },
        );
    return { ...f, authorize, admin };
}
async function admittedFixture() {
    const f = await fixture();
    await f.authorize();
    const active = await f.t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId: f.runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: false,
        },
    );
    assert(active);
    const mission = await f.t.run((ctx) => ctx.db.get(active.missionId));
    assert(mission);
    const turnId = mission.conversationTurnId;
    const turn = turnId ? await f.t.run((ctx) => ctx.db.get(turnId)) : null;
    assert(turn);
    const attempt = async (taskKey: string) => {
        const inputJson = JSON.stringify({ missionId: mission._id, taskKey });
        const invocationId = await f.t.run((ctx) =>
            ctx.db.insert("agentInvocations", {
                missionId: mission._id,
                runId: f.runId,
                generation: mission.generation,
                definitionVersion: mission.definitionVersion,
                taskKey,
                instructionVersion: turn.instructionVersion,
                provenance: "live",
                status: "started",
                inputJson,
                createdAt: Date.now(),
            }),
        );
        return {
            missionId: mission._id,
            invocationId,
            runId: f.runId,
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
    const calls = () =>
        f.t.run((ctx) =>
            ctx.db
                .query("providerCalls")
                .withIndex("by_run", (q) => q.eq("runId", f.runId))
                .collect(),
        );
    return { ...f, mission, attempt, calls };
}

test("an explicitly authorized local Workbench fixture reserves one real model attempt without recharging its replay", async () => {
    const f = await admittedFixture(),
        input = await f.attempt("first");
    const result = await f.t.mutation(
        internal.providerCalls.recordAttempt,
        input,
    );
    expect(result.shouldExecute).toBe(true);
    expect(
        await f.t.run((ctx) => ctx.db.get(result.providerCallId)),
    ).toMatchObject({
        status: "started",
        qualificationReservationUsd: 0.0239616,
    });
    expect(
        await f.t.mutation(internal.providerCalls.recordAttempt, input),
    ).toMatchObject({
        providerCallId: result.providerCallId,
        shouldExecute: false,
    });
    expect(await f.calls()).toHaveLength(1);
});

test("concurrent reservations share the last request and replaying authorization cannot reset the twenty-call lot", async () => {
    const f = await admittedFixture();
    for (let i = 0; i < 19; i++)
        await f.t.mutation(
            internal.providerCalls.recordAttempt,
            await f.attempt(`first-${i}`),
        );
    await f.authorize();
    const inputs = await Promise.all([
        f.attempt("last-a"),
        f.attempt("last-b"),
    ]);
    const outcomes = await Promise.allSettled(
        inputs.map((input) =>
            f.t.mutation(internal.providerCalls.recordAttempt, input),
        ),
    );
    expect(outcomes.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((x) => x.status === "rejected")).toHaveLength(1);
    expect(await f.calls()).toHaveLength(20);
    await expect(
        f.t.mutation(
            internal.providerCalls.recordAttempt,
            await f.attempt("over"),
        ),
    ).rejects.toThrow("qualification_budget_exhausted");
});

test("a qualification can pin a lower allowance without increasing it on replay", async () => {
    const f = await fixture();
    const authorize = makeFunctionReference<
        "mutation",
        {
            runId: Id<"researchRuns">;
            fixtureKey: string;
            maximumRequests: number;
            maximumCostUsd: number;
        },
        null
    >("execution/fixtures:authorizeWorkbenchQualification");
    const args = {
        runId: f.runId,
        fixtureKey: "qualification",
        maximumRequests: 3,
        maximumCostUsd: 0.1,
    };
    await f.t.mutation(authorize, args);
    await f.t.mutation(authorize, args);
    await expect(
        f.t.mutation(authorize, { ...args, maximumRequests: 4 }),
    ).rejects.toThrow("conflicts");
    const run = await f.t.run((ctx) => ctx.db.get(f.runId));
    assert(run?.browserTestContextId);
    const contextId = run.browserTestContextId;
    const context = await f.t.run((ctx) => ctx.db.get(contextId));
    expect(context?.paidQualification).toMatchObject({
        maximumRequests: 3,
        maximumCostUsd: 0.1,
    });
    await expect(
        f.t.mutation(authorize, { ...args, maximumCostUsd: 0.2 }),
    ).rejects.toThrow("conflicts");
    for (const maximumRequests of [0, -1, 21, 2.5])
        await expect(
            f.t.mutation(authorize, { ...args, maximumRequests }),
        ).rejects.toThrow("Invalid qualification limits");
    await expect(
        f.t.mutation(authorize, { ...args, maximumCostUsd: 0.6 }),
    ).rejects.toThrow("Invalid qualification limits");
});

test("an unknown outcome retains its reservation and an unexpected charge prevents further dispatch", async () => {
    const f = await admittedFixture(),
        input = await f.attempt("unknown");
    const first = await f.t.mutation(
        internal.providerCalls.recordAttempt,
        input,
    );
    await f.t.mutation(internal.providerCalls.recordAttempt, {
        ...input,
        status: "failed",
        dispatchOutcome: "unknown",
        errorCode: "attempt_outcome_unknown",
    });
    const rows = await f.calls();
    expect(rows[0]?.qualificationReservationUsd).toBe(0.0239616);
    await f.t.run((ctx) =>
        ctx.db.patch(first.providerCallId, { reportedCost: 0.1 }),
    );
    await expect(
        f.t.mutation(
            internal.providerCalls.recordAttempt,
            await f.attempt("after-unexpected-charge"),
        ),
    ).rejects.toThrow("qualification_budget_exhausted");
    expect(await f.calls()).toHaveLength(1);
});

test("authorization does not permit acquisition or override the global paid-work control", async () => {
    const f = await admittedFixture();
    await expect(
        f.t.mutation(internal.providerCalls.recordAttempt, {
            runId: f.runId,
            executionGeneration: 1,
            service: "exa",
            operation: "search",
            operationKey: "no-acquisition",
            attempt: 1,
            status: "started",
        }),
    ).rejects.toThrow("paid_work_disabled");
    await f.admin.mutation(api.adminOperations.setPaidWorkEnabled, {
        enabled: false,
        reason: "Disabled during qualification test",
    });
    await expect(
        f.t.mutation(
            internal.providerCalls.recordAttempt,
            await f.attempt("globally-disabled"),
        ),
    ).rejects.toThrow("paid_work_disabled");
    expect(await f.calls()).toEqual([]);
});

test.each([
    "cloud",
    "disabled-fixtures",
    "expired-context",
    "changed-model",
    "launched-research",
    "revoked-invitation",
] as const)("the qualified attempt refuses %s before adding a provider receipt", async (condition) => {
    const f = await admittedFixture(),
        input = await f.attempt("refused");
    if (condition === "cloud")
        vi.stubEnv("CONVEX_CLOUD_URL", "https://example.convex.cloud");
    if (condition === "disabled-fixtures")
        vi.stubEnv("E2E_FIXTURES_ENABLED", "false");
    if (condition === "expired-context") vi.setSystemTime(Date.now() + 61000);
    if (condition === "changed-model")
        await f.t.run((ctx) =>
            ctx.db.patch(f.mission._id, { modelRevisionId: undefined }),
        );
    if (condition === "launched-research")
        await f.t.run((ctx) =>
            ctx.db.patch(f.runId, { researchStartedAt: Date.now() }),
        );
    if (condition === "revoked-invitation")
        await f.t.run(async (ctx) => {
            const run = await ctx.db.get(f.runId);
            assert(run?.ownerVisitorId);
            const visitor = await ctx.db.get(run.ownerVisitorId);
            assert(visitor);
            await ctx.db.patch(visitor.invitationId, { status: "revoked" });
        });
    await expect(
        f.t.mutation(internal.providerCalls.recordAttempt, input),
    ).rejects.toThrow();
    expect(await f.calls()).toEqual([]);
});

test("the final dispatch check rejects a qualification that left framing after reservation", async () => {
    const f = await admittedFixture(),
        input = await f.attempt("phase-transition");
    await f.t.mutation(internal.providerCalls.recordAttempt, input);
    const args = {
        invocationId: input.invocationId,
        expectedGeneration: f.mission.generation,
    };
    await f.t.mutation(internal.execution.invocationLifecycle.retainRequest, {
        ...args,
        requestJson: '{"model":"z-ai/glm-5.3-flash"}',
    });
    await expect(
        f.t.query(
            internal.execution.invocationLifecycle.authorizeDispatch,
            args,
        ),
    ).resolves.toBeNull();
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, { researchStartedAt: Date.now() }),
    );
    await expect(
        f.t.query(
            internal.execution.invocationLifecycle.authorizeDispatch,
            args,
        ),
    ).rejects.toThrow("paid_work_disabled");
    expect(await f.calls()).toHaveLength(1);
});

test.each([
    false,
    true,
])("Workbench admission uses real inference only with an explicit qualification grant (%s)", async (authorized) => {
    const f = await fixture();
    if (authorized) await f.authorize();
    await f.t.mutation(internal.execution.conversations.pumpWorkbench, {
        runId: f.runId,
    });
    const missions = await f.t.run((ctx) =>
        ctx.db
            .query("agentMissions")
            .withIndex("by_run_and_request_key", (q) => q.eq("runId", f.runId))
            .collect(),
    );
    expect(missions).toHaveLength(1);
    expect(missions[0]?.provenance).toBe(authorized ? "live" : "simulation");
    expect(
        await f.t.run((ctx) =>
            ctx.db
                .query("providerCalls")
                .withIndex("by_run", (q) => q.eq("runId", f.runId))
                .collect(),
        ),
    ).toEqual([]);
});

test("the existing source-review fixture can receive its grant before activation initializes the first Workbench turn", async () => {
    const f = await fixture();
    const seeded = await f.t.mutation(
        internal.e2eFixtures.seedSourceReviewScenario,
        { slotKey: "analyst-4", fixtureKey: "new-qualification" },
    );
    await expect(
        f.t.mutation(
            internal.execution.fixtures.authorizeWorkbenchQualification,
            { runId: seeded.runId, fixtureKey: "new-qualification" },
        ),
    ).resolves.toBeNull();
    expect(await f.t.run((ctx) => ctx.db.get(seeded.runId))).toMatchObject({
        lifecycleState: "awaiting_source_review",
    });
});

test("qualification binds an immutable numeric loopback relay and rejects other destinations", async () => {
    const f = await fixture();
    for (const relayOrigin of [
        "https://example.com",
        "http://localhost:49176",
        "http://127.0.0.1:49176/path",
        "http://127.0.0.1:49176/?x=1",
    ]) {
        await expect(
            f.t.mutation(
                internal.execution.fixtures.authorizeWorkbenchQualification,
                {
                    runId: f.runId,
                    fixtureKey: "qualification",
                    relayOrigin,
                },
            ),
        ).rejects.toThrow("Invalid qualification relay origin");
    }
    await f.t.mutation(
        internal.execution.fixtures.authorizeWorkbenchQualification,
        {
            runId: f.runId,
            fixtureKey: "qualification",
            relayOrigin: "http://127.0.0.1:49176",
        },
    );
    await expect(
        f.t.mutation(
            internal.execution.fixtures.authorizeWorkbenchQualification,
            {
                runId: f.runId,
                fixtureKey: "qualification",
                relayOrigin: "http://127.0.0.1:49177",
            },
        ),
    ).rejects.toThrow("conflicts");
});

test("the relay lookup checks mission generation and revokes transport when the browser context closes", async () => {
    const f = await fixture();
    await f.t.mutation(
        internal.execution.fixtures.authorizeWorkbenchQualification,
        {
            runId: f.runId,
            fixtureKey: "qualification",
            relayOrigin: "http://127.0.0.1:49176",
        },
    );
    const active = await f.t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId: f.runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: false,
        },
    );
    assert(active);
    const mission = await f.t.run((ctx) => ctx.db.get(active.missionId));
    assert(mission);
    const input = {
        missionId: mission._id,
        expectedGeneration: mission.generation,
    };
    expect(
        await f.t.query(internal.execution.fixtures.workbenchRelay, input),
    ).toBe("http://127.0.0.1:49176");
    await expect(
        f.t.query(internal.execution.fixtures.workbenchRelay, {
            ...input,
            expectedGeneration: mission.generation + 1,
        }),
    ).rejects.toThrow();
    const run = await f.t.run((ctx) => ctx.db.get(f.runId));
    assert(run?.browserTestContextId);
    const closedContextId = run.browserTestContextId;
    await f.t.run((ctx) => ctx.db.patch(closedContextId, { status: "closed" }));
    await expect(
        f.t.query(internal.execution.fixtures.workbenchRelay, input),
    ).rejects.toThrow();
});

test("Workbench qualification exposes bounded operation receipts for refusal verification", async () => {
    const f = await fixture();
    const snapshot = await f.t.query(
        internal.execution.fixtures.inspectWorkbench,
        { runId: f.runId, fixtureKey: "qualification" },
    );
    expect(snapshot.operationReceipts).toEqual([]);
});

test.each([
    {
        label: "GLM",
        quota: 0,
        route: { model: "z-ai/glm-5.3-flash", reasoningEffort: "low" as const },
    },
    {
        label: "Nemo",
        quota: 0,
        route: { model: "mistralai/mistral-nemo", provider: "deepinfra/fp8" },
    },
    {
        label: "a catalogue-selected GPT-OSS route",
        quota: 0,
        route: {
            model: "openai/gpt-oss-20b",
            provider: "primeintellect/fp4",
            reasoningEffort: "low" as const,
        },
    },
    {
        label: "GLM with consumed product quota",
        quota: 3,
        route: { model: "z-ai/glm-5.3-flash", reasoningEffort: "low" as const },
    },
])("a Sources lot requires its exact input profile before authorizing two owned research dossiers with $label", async ({
    route,
    quota,
}) => {
    const f = await seedWorkbench(true);
    vi.stubEnv("WORKBENCH_AGENT_ENABLED", "true");
    vi.stubEnv("SOURCES_MISSION_ENABLED", "false");
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, { reservationKey: "browser:qualification" }),
    );
    const { admin, catalogId } = await installModel(f.t, route, "workbench");
    await admin.mutation(api.modelConfiguration.assign, {
        agent: "sources",
        catalogId,
        expectedRevision: 0,
        requestKey: "assign-sources-lot",
    });
    const secondId = await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        assert(run);
        const { _id, _creationTime, ...fields } = run;
        return ctx.db.insert("researchRuns", {
            ...fields,
            reservationKey: "browser:qualification-adobe",
        });
    });
    const authorize = makeFunctionReference<
        "mutation",
        {
            runId: Id<"researchRuns">;
            fixtureKey: string;
            sourcesLot: Array<{
                runId: Id<"researchRuns">;
                fixtureKey: string;
            }>;
        },
        null
    >("execution/fixtures:authorizeWorkbenchQualification");
    const args = {
        runId: f.runId,
        fixtureKey: "qualification",
        sourcesLot: [
            { runId: f.runId, fixtureKey: "qualification" },
            { runId: secondId, fixtureKey: "qualification-adobe" },
        ],
    };
    const missing = await f.t.run(async (ctx) => {
        const catalog = await ctx.db.get(catalogId);
        assert(catalog?.currentRevisionId);
        const model = await ctx.db.get(catalog.currentRevisionId);
        assert(model);
        const definition = getAgentDefinition("sources_v1", 1);
        const key = await piInputProfileKey({
            instructions: definition.instructions,
            prompt: "",
            operations: agentToolSchemas(definition),
            definitionVersion: definition.version,
            nativeConversation: definition.nativeConversation,
            nativeRoute: revisionRoute(model),
        });
        const row = await ctx.db
            .query("nativeInputProfiles")
            .withIndex("by_key", (q) => q.eq("key", key))
            .unique();
        assert(row);
        await ctx.db.delete(row._id);
        return { key: row.key, bytes: row.bytes };
    });
    await expect(f.t.mutation(authorize, args)).rejects.toThrow(
        "model_input_profile_unavailable",
    );
    const unauthorizedContext = await f.t.run((ctx) =>
        ctx.db.query("browserTestContexts").first(),
    );
    assert(unauthorizedContext);
    expect(unauthorizedContext).not.toHaveProperty("paidQualification");
    expect(
        await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
    await f.t.run((ctx) => ctx.db.insert("nativeInputProfiles", missing));
    await f.t.mutation(authorize, args);
    const before = await f.t.run((ctx) => ctx.db.get(f.runId));
    assert(before?.currentFramingRevisionId);
    const framingId = before.currentFramingRevisionId;
    const framing = await f.t.run((ctx) => ctx.db.get(framingId));
    assert(framing);
    await f.client.mutation(api.framing.save, {
        runId: f.runId,
        expectedRevision: framing.revision,
        requestKey: "sources-framing",
        content: {
            scope: "Photo-led claims",
            questions: [
                {
                    id: "coordination",
                    text: "Who controls coordination?",
                    shortLabel: "Coordination",
                    rationale: "Document effective action rights.",
                },
            ],
        },
    });
    assert(before.ownerVisitorId);
    const ownerId = before.ownerVisitorId;
    await f.t.run((ctx) => ctx.db.patch(ownerId, { analysesReserved: quota }));
    await f.client.mutation(api.framing.startResearch, {
        runId: f.runId,
        expectedRevision: framing.revision + 1,
        requestKey: "sources-start",
    });
    const run = await f.t.run((ctx) => ctx.db.get(f.runId));
    expect(await f.t.run((ctx) => ctx.db.get(ownerId))).toMatchObject({
        analysesReserved: quota,
    });
    if (quota === 3) {
        assert(run?.fixedFramingRevisionId);
        const fixedId = run.fixedFramingRevisionId;
        await f.t.run(async (ctx) => {
            const fixed = await ctx.db.get(fixedId);
            assert(fixed);
            const { _id, _creationTime, ...fields } = fixed;
            const secondFramingId = await ctx.db.insert("framingRevisions", {
                ...fields,
                runId: secondId,
                revision: 1,
                requestKey: "second-quota-frame",
            });
            await ctx.db.patch(secondId, {
                currentFramingRevisionId: secondFramingId,
            });
        });
        const qualifiedContext = await f.t.run((ctx) =>
            ctx.db.query("browserTestContexts").first(),
        );
        assert(qualifiedContext?.paidQualification);
        await f.t.run((ctx) =>
            ctx.db.patch(qualifiedContext._id, {
                paidQualification: undefined,
            }),
        );
        await expect(
            f.client.mutation(api.framing.startResearch, {
                runId: secondId,
                expectedRevision: 1,
                requestKey: "second-quota-start",
            }),
        ).rejects.toThrow("analysis_limit_reached");
        await f.t.run((ctx) =>
            ctx.db.patch(qualifiedContext._id, {
                paidQualification: qualifiedContext.paidQualification,
            }),
        );
        await expect(
            f.client.mutation(api.framing.startResearch, {
                runId: secondId,
                expectedRevision: 1,
                requestKey: "second-quota-start",
            }),
        ).rejects.toThrow("execution_slot_unavailable");
        await f.t.run((ctx) =>
            ctx.db.patch(f.runId, {
                lifecycleState: "sources_prepared",
                executionStatus: "idle",
            }),
        );
        await f.client.mutation(api.framing.startResearch, {
            runId: secondId,
            expectedRevision: 1,
            requestKey: "second-quota-start",
        });
        await expect(
            f.client.mutation(api.framing.startResearch, {
                runId: f.runId,
                expectedRevision: framing.revision + 1,
                requestKey: "sources-start",
            }),
        ).resolves.toBe(f.runId);
        expect(await f.t.run((ctx) => ctx.db.get(ownerId))).toMatchObject({
            analysesReserved: 3,
        });
        expect(await f.t.run((ctx) => ctx.db.get(secondId))).toMatchObject({
            sourcesProtocol: "sources_mission_v1",
            researchStartRequestKey: "second-quota-start",
        });
    }
    expect(run).toMatchObject({
        sourcesProtocol: "sources_mission_v1",
        sourcesEnvelope: {
            version: 1,
            maxNeeds: 4,
            initialSearches: 2,
            complementSearches: 1,
            acquisitions: 6,
            controls: 8,
        },
    });
    expect(process.env.SOURCES_MISSION_ENABLED).not.toBe("true");
});

test("a fresh Sources qualification fixture contains its real company but no seeded documentary material", async () => {
    const f = await fixture();
    const seed = makeFunctionReference<
        "mutation",
        {
            slotKey: string;
            fixtureKey: string;
            emptyDocumentaryMaterial: boolean;
            recordedScenario: {
                companyName: string;
                companyCik: string;
                ticker: string;
                websiteUrl: string;
                researchAngle: string;
                sources: [];
            };
        },
        { runId: Id<"researchRuns">; sourceIds: Array<Id<"sources">> }
    >("e2eFixtures:seedSourceReviewScenario");
    const result = await f.t.mutation(seed, {
        slotKey: "analyst-4",
        fixtureKey: "fresh-sources",
        emptyDocumentaryMaterial: true,
        recordedScenario: {
            companyName: "Adobe Inc.",
            companyCik: "796343",
            ticker: "ADBE",
            websiteUrl: "https://www.adobe.com/",
            researchAngle: "Creative Cloud production workflow",
            sources: [],
        },
    });
    expect(result.sourceIds).toEqual([]);
    expect(await f.t.run((ctx) => ctx.db.get(result.runId))).toMatchObject({
        lifecycleState: "framing",
        executionStatus: "idle",
        companySnapshot: { cik: "796343" },
    });
    expect(
        await f.t.run((ctx) => ctx.db.query("sourceCaptures").collect()),
    ).toEqual([]);
});

test("a Sources lot explicitly pins controller authority and cannot renew it", async () => {
    const f = await fixture();
    const config = await f.admin.query(api.modelConfiguration.list, {});
    const workbench = config.assignments.find((a) => a.agent === "workbench");
    const sources = config.assignments.find((a) => a.agent === "sources");
    assert(workbench?.catalogId);
    await f.admin.mutation(api.modelConfiguration.assign, {
        agent: "sources",
        catalogId: workbench.catalogId,
        expectedRevision: sources?.revision ?? 0,
        requestKey: "sources-controller-route",
    });
    const secondId = await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        assert(run);
        const { _id, _creationTime, ...fields } = run;
        return ctx.db.insert("researchRuns", {
            ...fields,
            reservationKey: "browser:second",
        });
    });
    const args = {
        runId: f.runId,
        fixtureKey: "qualification",
        sourcesLot: [
            { runId: f.runId, fixtureKey: "qualification" },
            { runId: secondId, fixtureKey: "second" },
        ],
        responseControllerModel: "typesafe/jev-1.14",
    };
    await expect(
        f.t.mutation(
            internal.execution.fixtures.authorizeWorkbenchQualification,
            args,
        ),
    ).rejects.toThrow("Qualification controller configuration mismatch");
    const policy = await f.admin.mutation(
        api.modelConfiguration.setResponseControl,
        {
            expectedRevision: config.responseControl.revision,
            enabled: true,
            model: args.responseControllerModel,
            contradictionThreshold: 0.93,
            supportThreshold: 0.75,
        },
    );
    await expect(
        f.t.mutation(
            internal.execution.fixtures.authorizeWorkbenchQualification,
            { ...args, responseControllerModel: "other/model" },
        ),
    ).rejects.toThrow("Qualification controller configuration mismatch");
    await f.t.mutation(
        internal.execution.fixtures.authorizeWorkbenchQualification,
        args,
    );
    await f.t.mutation(
        internal.execution.fixtures.authorizeWorkbenchQualification,
        args,
    );
    const run = await f.t.run((ctx) => ctx.db.get(f.runId));
    assert(run?.browserTestContextId);
    const contextId = run.browserTestContextId;
    const context = await f.t.run((ctx) => ctx.db.get(contextId));
    expect(context?.paidQualification?.responseControl).toEqual(policy);
    await f.admin.mutation(api.modelConfiguration.setResponseControl, {
        expectedRevision: policy.revision,
        enabled: true,
        model: policy.model,
        contradictionThreshold: 0.94,
        supportThreshold: policy.supportThreshold,
    });
    await expect(
        f.t.mutation(
            internal.execution.fixtures.authorizeWorkbenchQualification,
            args,
        ),
    ).rejects.toThrow(
        "Qualification authorization conflicts with the retained lot",
    );
});
