import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import schema from "@convex/schema";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import workflowTest from "@/__tests__/convex/workflows/workflow-test-register.js";
import { createAdmittedPreflight } from "@/__tests__/setup/research-launch";
import {
    activateSourcesMission,
    sourcesTestEnvelope,
} from "@/__tests__/setup/sources-mission";

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
        sourcesCoveragePolicyVersion: "sources_coverage_v1",
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

const capacityQuestion = (id: string) => ({
    id,
    text: `Question ${id}?`,
    rationale: "Document it",
    shortLabel: id,
});

async function framingDossier(key: string) {
    const t = convexTest(schema, modules);

    workflowTest.register(t);
    const { userId, preflightId } = await createAdmittedPreflight(t);
    const analyst = t.withIdentity({ subject: userId });
    const { runId } = await analyst.mutation(api.framing.confirmCompany, {
        preflightId,
        idempotencyKey: key,
        coveragePreset: "balanced",
    });
    const save = (
        expectedRevision: number,
        requestKey: string,
        ids: string[],
    ) =>
        analyst.mutation(api.framing.save, {
            runId,
            expectedRevision,
            requestKey,
            content: {
                scope: "Claims coordination",
                questions: ids.map(capacityQuestion),
            },
        });
    return { t, analyst, runId, save };
}

test("the research program cannot grow beyond the questions documentary preparation can take on", async () => {
    // One need covers the common context, so three needs leave room for two framed questions.
    activateSourcesMission({ ...sourcesTestEnvelope, maxNeeds: 3 });
    const { analyst, runId, save } = await framingDossier("question-capacity");
    expect(await save(1, "two-questions", ["a", "b"])).toBe(2);
    await expect(save(2, "three-questions", ["a", "b", "c"])).rejects.toThrow(
        "framing_question_capacity",
    );
    expect(
        await analyst.query(api.workbench.snapshot, { runId }),
    ).toMatchObject({
        framing: { revision: 2 },
        researchStart: { block: null, questionCapacity: 2 },
    });
});

test("a program left over capacity by a configuration change stays repairable and Start explains the block before any attempt", async () => {
    activateSourcesMission({ ...sourcesTestEnvelope, maxNeeds: 4 });
    const { t, analyst, runId, save } = await framingDossier("over-capacity");
    expect(await save(1, "three-questions", ["a", "b", "c"])).toBe(2);
    activateSourcesMission({ ...sourcesTestEnvelope, maxNeeds: 2 });
    expect(
        await analyst.query(api.workbench.snapshot, { runId }),
    ).toMatchObject({
        researchStart: {
            block: "sources_need_capacity",
            questionCapacity: 1,
        },
    });
    expect(await save(2, "reordered", ["c", "b", "a"])).toBe(3);
    await expect(save(3, "grown", ["a", "b", "c", "d"])).rejects.toThrow(
        "framing_question_capacity",
    );
    await expect(
        analyst.mutation(api.framing.startResearch, {
            runId,
            expectedRevision: 3,
            requestKey: "over-capacity-start",
        }),
    ).rejects.toThrow("sources_need_capacity");
    expect(await save(3, "reduced", ["b"])).toBe(4);
    expect(
        await analyst.query(api.workbench.snapshot, { runId }),
    ).toMatchObject({
        researchStart: { block: null, questionCapacity: 1 },
    });
    const run = await t.run((ctx) => ctx.db.get(runId));
    expect(run).toMatchObject({
        lifecycleState: "framing",
        executionStatus: "idle",
    });
    expect(
        await t.run((ctx) => ctx.db.query("visitors").first()),
    ).toMatchObject({ analysesReserved: 0 });
});

test.each([
    "",
    "abc",
])("Start blocks an unavailable Sources window %j without consuming the dossier", async (window) => {
    activateSourcesMission();
    const { t, analyst, runId, save } =
        await framingDossier("window-readiness");
    await save(1, "one-question", ["a"]);
    vi.stubEnv("SOURCES_PREPARATION_WINDOW_MINUTES", window);
    const args = { runId, expectedRevision: 2, requestKey: "configured-start" };
    await expect(
        analyst.mutation(api.framing.startResearch, args),
    ).rejects.toThrow("sources_configuration_unavailable");
    expect(
        await analyst.query(api.workbench.snapshot, { runId }),
    ).toMatchObject({
        researchStart: { block: "sources_configuration_unavailable" },
    });
    const run = await t.run((ctx) => ctx.db.get(runId));
    expect(run).toMatchObject({
        lifecycleState: "framing",
        executionStatus: "idle",
    });
    expect(run?.fixedFramingRevisionId).toBeUndefined();
    expect(run?.workflowId).toBeUndefined();
    expect(run?.researchStartRequestKey).toBeUndefined();
    expect(
        await t.run((ctx) => ctx.db.query("visitors").first()),
    ).toMatchObject({ analysesReserved: 0 });
    expect(await save(2, "still-editable", ["a"])).toBe(3);
    vi.stubEnv("SOURCES_PREPARATION_WINDOW_MINUTES", "15");
    await analyst.mutation(api.framing.startResearch, {
        ...args,
        expectedRevision: 3,
    });
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
        executionStatus: "running",
        reservationStatus: "consumed",
    });
    expect(
        await t.run((ctx) => ctx.db.query("visitors").first()),
    ).toMatchObject({ analysesReserved: 1 });
});

test("Start availability reports an inactive documentary preparation before any attempt", async () => {
    const { analyst, runId, save } = await framingDossier("inactive-readiness");
    await save(1, "one-question", ["a"]);
    expect(
        await analyst.query(api.workbench.snapshot, { runId }),
    ).toMatchObject({
        researchStart: {
            block: "sources_configuration_unavailable",
            questionCapacity: null,
        },
    });
});

test("new Sources research pins its protocol while repeated Start consumes no second analysis", async () => {
    activateSourcesMission();
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
