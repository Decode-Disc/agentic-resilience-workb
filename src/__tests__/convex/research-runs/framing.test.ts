import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import schema from "@convex/schema";
import agentTest from "@convex-dev/agent/test";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import workflowTest from "@/__tests__/convex/workflows/workflow-test-register.js";
import { createAdmittedPreflight } from "@/__tests__/setup/research-launch";
import { activateSourcesMission } from "@/__tests__/setup/sources-mission";

const modules = import.meta.glob("/convex/**/*.ts");
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
});
const transition = makeFunctionReference<"mutation">("researchRuns:transition");

test("company confirmation retains a framing dossier without consuming an analysis or launching research", async () => {
    const t = convexTest(schema, modules);
    workflowTest.register(t);
    const { userId, preflightId } = await createAdmittedPreflight(t);
    agentTest.register(t);
    const confirm = makeFunctionReference<
        "mutation",
        {
            preflightId: Id<"companyPreflights">;
            idempotencyKey: string;
            coveragePreset: "balanced";
        },
        { runId: Id<"researchRuns">; remainingAnalyses: number }
    >("framing:confirmCompany");
    const analyst = t.withIdentity({ subject: userId });
    const result = await analyst.mutation(confirm, {
        preflightId,
        idempotencyKey: "frame-only",
        coveragePreset: "balanced",
    });
    expect(await t.run((ctx) => ctx.db.get(result.runId))).toMatchObject({
        lifecycleState: "framing",
        executionStatus: "idle",
    });
    expect(await t.run((ctx) => ctx.db.get(result.runId))).not.toHaveProperty(
        "workflowId",
    );
    expect(
        await analyst.query(api.execution.conversations.get, {
            runId: result.runId,
        }),
    ).toMatchObject({ queuedCount: 1, activeTurn: null });
    expect(result.remainingAnalyses).toBe(3);
    expect(
        await t.run((ctx) => ctx.db.query("visitors").first()),
    ).toMatchObject({ analysesReserved: 0 });
    expect(
        await analyst.mutation(confirm, {
            preflightId,
            idempotencyKey: "frame-only",
            coveragePreset: "balanced",
        }),
    ).toEqual(result);
});

test("framing edits use revisions and explicit research start consumes one analysis in the same dossier", async () => {
    activateSourcesMission();
    const t = convexTest(schema, modules);
    agentTest.register(t);
    workflowTest.register(t);
    const { userId, preflightId } = await createAdmittedPreflight(t);
    const analyst = t.withIdentity({ subject: userId });
    const result = await analyst.mutation(api.framing.confirmCompany, {
        preflightId,
        idempotencyKey: "framing-launch",
        researchAngle: "Original discarded activity",
        coveragePreset: "balanced",
    });
    const save = api.framing.save;
    const start = api.framing.startResearch;
    const content = {
        scope: "Photo-led auto claims",
        questions: [
            {
                id: "coordination",
                text: "Who controls coordination?",
                shortLabel: "Coordination",
                rationale: "Distinguish control from supplying modules.",
            },
        ],
    };
    expect(
        await analyst.mutation(save, {
            runId: result.runId,
            expectedRevision: 1,
            requestKey: "edit-1",
            content,
        }),
    ).toBe(2);
    await expect(
        analyst.mutation(save, {
            runId: result.runId,
            expectedRevision: 1,
            requestKey: "stale",
            content,
        }),
    ).rejects.toThrow("framing_version_conflict");
    await expect(
        analyst.mutation(start, {
            runId: result.runId,
            expectedRevision: 1,
            requestKey: "start",
        }),
    ).rejects.toThrow("framing_version_conflict");
    expect(
        await analyst.mutation(start, {
            runId: result.runId,
            expectedRevision: 2,
            requestKey: "start",
        }),
    ).toBe(result.runId);
    expect(
        await analyst.mutation(start, {
            runId: result.runId,
            expectedRevision: 2,
            requestKey: "start",
        }),
    ).toBe(result.runId);
    const run = await t.run((ctx) => ctx.db.get(result.runId));
    expect(run).toMatchObject({
        reservationStatus: "consumed",
        executionStatus: "running",
        researchStartRequestKey: "start",
    });
    expect(run?.fixedFramingRevisionId).toBe(run?.currentFramingRevisionId);
    await t.mutation(transition, {
        runId: result.runId,
        expectedExecutionGeneration: 1,
        lifecycleState: "checking_public_evidence",
        executionStatus: "running",
        stepKey: "check_public_evidence",
    });
    await t.mutation(
        makeFunctionReference<"mutation">("researchRuns:transition"),
        {
            runId: result.runId,
            expectedExecutionGeneration: 1,
            lifecycleState: "discovering_sources",
            executionStatus: "running",
            stepKey: "discover_sources",
        },
    );
    const planId = await t.mutation(
        makeFunctionReference<"mutation">("researchPlanning:createForRun"),
        { runId: result.runId, expectedExecutionGeneration: 1 },
    );
    const questions = await t.query(
        makeFunctionReference<"query">("researchPlanning:listQuestionsForPlan"),
        { planId },
    );
    const discovery = await t.query(
        makeFunctionReference<"query">("researchPlanning:getDiscoveryContext"),
        { runId: result.runId },
    );
    expect(
        discovery.queries.every(
            (query: { query: string }) =>
                query.query.includes(content.scope) &&
                !query.query.includes("Original discarded activity"),
        ),
    ).toBe(true);
    expect(questions.map((q: { prompt: string }) => q.prompt)).toEqual([
        "Who controls coordination?",
    ]);

    expect(
        await t.run((ctx) => ctx.db.query("visitors").first()),
    ).toMatchObject({ analysesReserved: 1 });
    await expect(
        analyst.mutation(save, {
            runId: result.runId,
            expectedRevision: 2,
            requestKey: "after-start",
            content,
        }),
    ).rejects.toThrow("framing_fixed");
});

test("an incomplete framing draft can be saved without authorizing research", async () => {
    const t = convexTest(schema, modules);
    agentTest.register(t);
    workflowTest.register(t);
    const { userId, preflightId } = await createAdmittedPreflight(t);
    const client = t.withIdentity({ subject: userId });
    const { runId } = await client.mutation(api.framing.confirmCompany, {
        preflightId,
        idempotencyKey: "partial",
        coveragePreset: "balanced",
    });
    expect(
        await client.mutation(api.framing.save, {
            runId,
            expectedRevision: 1,
            requestKey: "scope-only",
            content: { scope: "Claims coordination", questions: [] },
        }),
    ).toBe(2);
    await expect(
        client.mutation(api.framing.startResearch, {
            runId,
            expectedRevision: 2,
            requestKey: "start",
        }),
    ).rejects.toThrow("framing_invalid");
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
        lifecycleState: "framing",
        executionStatus: "idle",
    });
});

test("research cannot start on a corpus-approval fallback when Sources is not activated", async () => {
    vi.stubEnv("SOURCES_MISSION_ENABLED", "false");
    try {
        const t = convexTest(schema, modules);
        agentTest.register(t);
        workflowTest.register(t);
        const { userId, preflightId } = await createAdmittedPreflight(t);
        const analyst = t.withIdentity({ subject: userId });
        const { runId } = await analyst.mutation(api.framing.confirmCompany, {
            preflightId,
            idempotencyKey: "inactive-sources",
            coveragePreset: "balanced",
        });
        await analyst.mutation(api.framing.save, {
            runId,
            expectedRevision: 1,
            requestKey: "inactive-brief",
            content: {
                scope: "Photo-led auto claims",
                questions: [
                    {
                        id: "control",
                        text: "Who controls coordination?",
                        rationale: "Document coordination",
                        shortLabel: "Control",
                    },
                ],
            },
        });
        await expect(
            analyst.mutation(api.framing.startResearch, {
                runId,
                expectedRevision: 2,
                requestKey: "inactive-start",
            }),
        ).rejects.toThrow("sources_configuration_unavailable");
        const run = await t.run((ctx) => ctx.db.get(runId));
        expect(run).toMatchObject({
            lifecycleState: "framing",
            executionStatus: "idle",
        });
        expect(run?.workflowId).toBeUndefined();
        expect(run?.researchStartedAt).toBeUndefined();
        expect(
            await t.run((ctx) => ctx.db.query("visitors").first()),
        ).toMatchObject({ analysesReserved: 0 });
    } finally {
        vi.unstubAllEnvs();
    }
});

test("new Sources research pins its protocol while repeated Start consumes no second analysis", async () => {
    vi.stubEnv("SOURCES_MISSION_ENABLED", "true");
    vi.stubEnv(
        "SOURCES_MISSION_ENVELOPE",
        JSON.stringify({
            version: 1,
            maxNeeds: 12,
            initialSearches: 4,
            complementSearches: 3,
            acquisitions: 10,
            controls: 20,
        }),
    );
    try {
        const t = convexTest(schema, modules);
        agentTest.register(t);
        workflowTest.register(t);
        const { userId, preflightId } = await createAdmittedPreflight(t);
        const analyst = t.withIdentity({ subject: userId });
        const { runId } = await analyst.mutation(api.framing.confirmCompany, {
            preflightId,
            idempotencyKey: "sources-start",
            coveragePreset: "balanced",
        });
        await analyst.mutation(api.framing.save, {
            runId,
            expectedRevision: 1,
            requestKey: "sources-brief",
            content: {
                scope: "Photo-led auto claims",
                questions: [
                    {
                        id: "control",
                        text: "Who controls coordination?",
                        rationale: "Document coordination",
                        shortLabel: "Control",
                    },
                ],
            },
        });
        const args = {
            runId,
            expectedRevision: 2,
            requestKey: "sources-start",
        };
        await analyst.mutation(api.framing.startResearch, args);
        await analyst.mutation(api.framing.startResearch, args);
        expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
            sourcesProtocol: "sources_mission_v1",
            lifecycleState: "draft",
        });
        expect(
            await t.run((ctx) => ctx.db.query("visitors").first()),
        ).toMatchObject({ analysesReserved: 1 });
    } finally {
        vi.unstubAllEnvs();
    }
});
