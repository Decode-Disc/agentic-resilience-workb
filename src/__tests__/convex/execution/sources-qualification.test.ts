import { api, internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { sha256Hex } from "@convex/domain/sourcePassages";
import { requireQualifiedBrowserMission } from "@convex/providerCalls";
import { makeFunctionReference } from "convex/server";
import { afterEach, assert, expect, test, vi } from "vitest";
import { installModel } from "@/__tests__/setup/model-configuration";
import { seedCapturedSources } from "@/__tests__/setup/sources-mission";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
});
async function fixture() {
    const f = await seedCapturedSources();
    vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
    await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        assert(run?.ownerVisitorId);
        const visitor = await ctx.db.get(run.ownerVisitorId);
        assert(visitor);
        await ctx.db.patch(visitor.invitationId, { slotKey: "analyst-4" });
    });
    const contextId = await f.t.mutation(
        internal.runWorkspace.openBrowserTestContext,
        {
            slotKey: "analyst-4",
            contextKey: "sources-paid",
            durationMs: 60000,
        },
    );
    const { admin, catalogId } = await installModel(
        f.t,
        { model: "z-ai/glm-5.3-flash", reasoningEffort: "low" },
        "sources",
    );
    const { secondId, modelRevisionId } = await f.t.run(async (ctx) => {
        const catalog = await ctx.db.get(catalogId);
        assert(catalog?.currentRevisionId);
        const run = await ctx.db.get(f.runId);
        assert(run);
        await ctx.db.patch(run._id, {
            purpose: "browser_test",
            browserTestContextId: contextId,
        });
        const { _id, _creationTime, ...fields } = run;
        const secondId = await ctx.db.insert("researchRuns", {
            ...fields,
            purpose: "browser_test",
            browserTestContextId: contextId,
            executionStatus: "idle",
            sourcePreparationId: undefined,
        });
        await ctx.db.patch(contextId, {
            paidQualification: {
                runId: run._id,
                modelRevisionId: catalog.currentRevisionId,
                maximumRequests: 40,
                maximumCostUsd: 2,
                authorizedAt: Date.now(),
                sourcesLot: [run._id, secondId],
            },
        });
        await ctx.db.patch(f.missionId, {
            modelRevisionId: catalog.currentRevisionId,
        });
        return { secondId, modelRevisionId: catalog.currentRevisionId };
    });
    const attempt = async (key: string) => {
        const inputJson = JSON.stringify({ key });
        const invocationId = await f.t.run((ctx) =>
            ctx.db.insert("agentInvocations", {
                missionId: f.missionId,
                runId: f.runId,
                corpusRevisionId: f.corpusRevisionId,
                generation: 4,
                definitionVersion: 1,
                taskKey: key,
                provenance: "live",
                status: "started",
                inputJson,
                createdAt: Date.now(),
            }),
        );
        return {
            runId: f.runId,
            corpusRevisionId: f.corpusRevisionId,
            missionId: f.missionId,
            invocationId,
            executionGeneration: 4,
            workflowVersion: 1,
            stepKey: "agent_reasoning",
            service: "model" as const,
            operation: "agent_reasoning",
            operationKey: `mission:${f.missionId}:invocation:${invocationId}:attempt:1`,
            attempt: 1,
            inputHash: sha256Hex(inputJson),
            status: "started" as const,
        };
    };
    const search = async (key: string) => {
        const requestId = await f.t.mutation(
            internal.execution.operations.enqueueNative,
            {
                runId: f.runId,
                expectedGeneration: 4,
                cause: key,
                input: {
                    kind: "discover_sources_for_need",
                    needId: "common-context",
                    query: key,
                },
            },
        );
        await f.t.mutation(internal.execution.operations.claim, {
            requestId,
            expectedGeneration: 4,
        });
        const reserved = await f.t.mutation(internal.sourcesMission.reserve, {
            requestId,
            expectedGeneration: 4,
        });
        return {
            runId: f.runId,
            corpusRevisionId: f.corpusRevisionId,
            preparationId: f.preparationId,
            executionGeneration: 4,
            workflowVersion: reserved.preparation.workflowVersion,
            stepKey: "source_preparation",
            service: "exa" as const,
            operation: "source_need_search",
            operationKey: `sources:${requestId}:search`,
            inputHash: reserved.inputHash,
            attempt: 1,
            status: "started" as const,
        };
    };
    return {
        ...f,
        admin,
        contextId,
        secondId,
        modelRevisionId,
        attempt,
        search,
    };
}

test("the Sources grant admits live reasoning and preparation-bound search, preserving replay", async () => {
    const f = await fixture();
    const input = await f.attempt("reasoning");
    const first = await f.t.mutation(
        internal.providerCalls.recordAttempt,
        input,
    );
    expect(first.shouldExecute).toBe(true);
    expect(
        await f.t.mutation(internal.providerCalls.recordAttempt, input),
    ).toMatchObject({
        providerCallId: first.providerCallId,
        shouldExecute: false,
    });
    const discovery = await f.search("targeted search");
    expect(
        await f.t.mutation(internal.providerCalls.recordAttempt, discovery),
    ).toMatchObject({ shouldExecute: true });
    const rows = await f.t.run((ctx) =>
        ctx.db
            .query("providerCalls")
            .withIndex("by_run", (q) => q.eq("runId", f.runId))
            .collect(),
    );
    expect(rows.map((c) => c.qualificationReservationUsd)).toEqual([
        0.0239616, 0.007,
    ]);
});

test("independent qualification pins admit Sources reasoning and native preparation without authorizing the Workbench model", async () => {
    const f = await fixture();
    const workbench = await installModel(f.t, {
        model: "openai/gpt-oss-120b",
        reasoningEffort: "low",
    });
    await f.t.run(async (ctx) => {
        const context = await ctx.db.get(f.contextId);
        const catalog = await ctx.db.get(workbench.catalogId);
        assert(context?.paidQualification && catalog?.currentRevisionId);
        await ctx.db.patch(context._id, {
            paidQualification: {
                ...context.paidQualification,
                modelRevisionId: catalog.currentRevisionId,
                sourcesModelRevisionId: f.modelRevisionId,
            },
        });
        await ctx.db.patch(f.preparationId, {
            modelRevisionId: f.modelRevisionId,
        });
    });
    await expect(
        f.t.query(internal.execution.fixtures.workbenchRelay, {
            missionId: f.missionId,
            expectedGeneration: 4,
        }),
    ).resolves.toBeNull();
    expect(
        await f.t.mutation(
            internal.providerCalls.recordAttempt,
            await f.attempt("distinct-sources"),
        ),
    ).toMatchObject({ shouldExecute: true });
    await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        assert(run);
        await expect(
            requireQualifiedBrowserMission(ctx, run, null, f.preparationId),
        ).resolves.not.toBeNull();
        const catalog = await ctx.db.get(workbench.catalogId);
        assert(catalog?.currentRevisionId);
        await ctx.db.patch(f.preparationId, {
            modelRevisionId: catalog.currentRevisionId,
        });
        await expect(
            requireQualifiedBrowserMission(ctx, run, null, f.preparationId),
        ).rejects.toThrow("paid_work_disabled");
    });
});

test("a reduced Sources model allowance is enforced before another attempt is reserved", async () => {
    const f = await fixture();
    await f.t.run(async (ctx) => {
        const context = await ctx.db.get(f.contextId);
        assert(context?.paidQualification);
        await ctx.db.patch(f.contextId, {
            paidQualification: {
                ...context.paidQualification,
                maximumRequests: 1,
            },
        });
    });
    await f.t.mutation(
        internal.providerCalls.recordAttempt,
        await f.attempt("within-remainder"),
    );
    await expect(
        f.t.mutation(
            internal.providerCalls.recordAttempt,
            await f.attempt("over-remainder"),
        ),
    ).rejects.toThrow("qualification_budget_exhausted");
    const calls = await f.t.run((ctx) =>
        ctx.db
            .query("providerCalls")
            .withIndex("by_run", (q) => q.eq("runId", f.runId))
            .collect(),
    );
    expect(calls).toHaveLength(1);
});

test("twenty model admissions exhaust one dossier and a sibling's known overcharge stops the lot", async () => {
    const f = await fixture();
    for (let i = 0; i < 20; i++)
        await f.t.mutation(
            internal.providerCalls.recordAttempt,
            await f.attempt(`reasoning-${i}`),
        );
    await expect(
        f.t.mutation(
            internal.providerCalls.recordAttempt,
            await f.attempt("twenty-first"),
        ),
    ).rejects.toThrow("qualification_budget_exhausted");
    await f.t.run(async (ctx) => {
        const row = await ctx.db
            .query("providerCalls")
            .withIndex("by_run", (q) => q.eq("runId", f.runId))
            .first();
        assert(row);
        await ctx.db.patch(row._id, { runId: f.secondId, reportedCost: 0.5 });
    });
    await expect(
        f.t.mutation(
            internal.providerCalls.recordAttempt,
            await f.attempt("sibling-overcharge"),
        ),
    ).rejects.toThrow("qualification_budget_exhausted");
});

test.each([
    "foreign",
    "embedding",
    "disabled",
    "unknown",
])("Sources qualification refuses %s without a new receipt", async (condition) => {
    const f = await fixture();
    const input = await f.attempt(condition);
    if (condition === "foreign")
        await f.t.run((ctx) =>
            ctx.db.patch(f.contextId, { paidQualification: undefined }),
        );
    if (condition === "embedding") input.operation = "source_embedding";
    if (condition === "disabled")
        await f.admin.mutation(api.adminOperations.setPaidWorkEnabled, {
            enabled: false,
            reason: "qualification test",
        });
    if (condition === "unknown") {
        const admitted = await f.t.mutation(
            internal.providerCalls.recordAttempt,
            await f.attempt("uncertain"),
        );
        await f.t.run((ctx) =>
            ctx.db.patch(admitted.providerCallId, {
                status: "failed",
                dispatchOutcome: "unknown",
            }),
        );
    }
    await expect(
        f.t.mutation(internal.providerCalls.recordAttempt, input),
    ).rejects.toThrow(
        condition === "unknown"
            ? "qualification_budget_exhausted"
            : "paid_work_disabled",
    );
    expect(
        await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toHaveLength(condition === "unknown" ? 1 : 0);
});

test("search and acquisition admissions stop before exceeding each dossier's shared ceilings", async () => {
    const f = await fixture();
    for (let i = 0; i < 2; i++)
        expect(
            (
                await f.t.mutation(
                    internal.providerCalls.recordAttempt,
                    await f.search(`search-${i}`),
                )
            ).shouldExecute,
        ).toBe(true);
    await expect(
        f.t.mutation(
            internal.providerCalls.recordAttempt,
            await f.search("search-over"),
        ),
    ).rejects.toThrow("qualification_budget_exhausted");
    const captureAttempt = (i: number) => ({
        runId: f.runId,
        corpusRevisionId: f.corpusRevisionId,
        preparationId: f.preparationId,
        sourceId: f.sourceId,
        executionGeneration: 4,
        workflowVersion: 1,
        stepKey: "source_preparation",
        service: "exa" as const,
        operation: "get_contents",
        operationKey: `capture-${i}`,
        attempt: 1,
        inputHash: sha256Hex(`capture-${i}`),
        status: "started" as const,
    });
    for (let i = 0; i < 6; i++)
        expect(
            (
                await f.t.mutation(
                    internal.providerCalls.recordAttempt,
                    captureAttempt(i),
                )
            ).shouldExecute,
        ).toBe(true);
    await expect(
        f.t.mutation(internal.providerCalls.recordAttempt, captureAttempt(6)),
    ).rejects.toThrow("qualification_budget_exhausted");
    expect(
        await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toHaveLength(8);
});

test("native documentary control rechecks its exact model and revocable context before dispatch", async () => {
    const f = await fixture();
    await f.t.mutation(internal.modelConfiguration.forPreparation, {
        preparationId: f.preparationId,
        expectedGeneration: 4,
    });
    const preparation = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    assert(preparation);
    const inputHash = sha256Hex("native control");
    const call = await f.t.mutation(internal.providerCalls.recordAttempt, {
        runId: f.runId,
        corpusRevisionId: f.corpusRevisionId,
        preparationId: f.preparationId,
        sourceId: f.sourceId,
        executionGeneration: 4,
        workflowVersion: preparation.workflowVersion,
        stepKey: "source_preparation",
        service: "model",
        operation: "source_documentary_control",
        operationKey: `${preparation.operationKey}:step:source_preparation:input:${inputHash}:attempt:1`,
        inputHash,
        attempt: 1,
        status: "started",
    });
    expect(call.shouldExecute).toBe(true);
    const invocationId = await f.t.mutation(
        internal.execution.invocationLifecycle.beginOneShot,
        { providerCallId: call.providerCallId, inputJson: "{}" },
    );
    await f.t.mutation(internal.execution.invocationLifecycle.retainRequest, {
        invocationId,
        expectedGeneration: 4,
        requestJson: '{"model":"z-ai/glm-5.3-flash"}',
    });
    await expect(
        f.t.query(internal.execution.invocationLifecycle.authorizeDispatch, {
            invocationId,
            expectedGeneration: 4,
        }),
    ).resolves.toBeNull();
    await f.t.run((ctx) => ctx.db.patch(f.contextId, { status: "closed" }));
    await expect(
        f.t.query(internal.execution.invocationLifecycle.authorizeDispatch, {
            invocationId,
            expectedGeneration: 4,
        }),
    ).rejects.toThrow("paid_work_disabled");
});

test("owned qualification inspection returns exact retained documentary identities and refuses a foreign fixture key", async () => {
    const f = await fixture();
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, { reservationKey: "browser:captured-sources" }),
    );
    const inspect = makeFunctionReference<
        "query",
        { runId: Id<"researchRuns">; fixtureKey: string },
        {
            preparation: { _id: Id<"sourceSelectionProposalRebuilds"> };
            captures: Array<{ _id: Id<"sourceCaptures"> }>;
        }
    >("execution/fixtures:inspectSourcesQualification");
    const result = await f.t.query(inspect, {
        runId: f.runId,
        fixtureKey: "captured-sources",
    });
    expect(result.preparation._id).toBe(f.preparationId);
    expect(result.captures.map((c) => c._id)).toEqual([f.captureId]);
    await expect(
        f.t.query(inspect, { runId: f.runId, fixtureKey: "foreign" }),
    ).rejects.toThrow("Local simulation scope required");
});

test("Sources inspection retains technical receipts in addition to the model allowance", async () => {
    const f = await fixture();
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, { reservationKey: "browser:all-receipts" }),
    );
    for (let index = 0; index < 20; index++)
        await f.t.mutation(
            internal.providerCalls.recordAttempt,
            await f.attempt(`model-${index}`),
        );
    await f.t.mutation(
        internal.providerCalls.recordAttempt,
        await f.search("documentary-search"),
    );
    const result = await f.t.query(
        internal.execution.fixtures.inspectWorkbench,
        { runId: f.runId, fixtureKey: "all-receipts" },
    );
    expect(result.receipts).toHaveLength(21);
    expect(
        result.receipts.filter((call) => call.service === "model"),
    ).toHaveLength(20);
    expect(
        result.receipts.filter(
            (call) => call.operation === "source_need_search",
        ),
    ).toHaveLength(1);
    await expect(
        f.t.query(internal.execution.fixtures.inspectWorkbench, {
            runId: f.runId,
            fixtureKey: "foreign",
        }),
    ).rejects.toThrow("Local simulation scope required");
});
