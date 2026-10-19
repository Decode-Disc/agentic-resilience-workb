import type { Id } from "@convex/_generated/dataModel";
import schema from "@convex/schema";
import type {
    ExecutionStatus,
    ResearchRunLifecycle,
} from "@convex/domain/transitions";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";

const modules = import.meta.glob("/convex/**/*.ts");

const createForRun = makeFunctionReference<
    "mutation",
    { runId: Id<"researchRuns">; expectedExecutionGeneration: number },
    Id<"researchPlans">
>("researchPlanning:createForRun");

const listQuestionsForPlan = makeFunctionReference<
    "query",
    { planId: Id<"researchPlans"> },
    Array<{
        runId: Id<"researchRuns">;
        researchPlanId: Id<"researchPlans">;
        planVersion: number;
        questionKey: string;
        prompt: string;
        dimensionKeys: Array<string>;
        createdAt: number;
    }>
>("researchPlanning:listQuestionsForPlan");

const runTransition = makeFunctionReference<
    "mutation",
    {
        runId: string;
        expectedExecutionGeneration: number;
        lifecycleState: string;
        executionStatus: string;
        stepKey: string;
    },
    null
>("researchRuns:transition");

const getRun = makeFunctionReference<"query", { runId: string }, unknown>(
    "researchRuns:get",
);

async function createDiscoveringRun(t: ReturnType<typeof convexTest>) {
    return t.run(async (ctx) => {
        const companyId = await ctx.db.insert("companies", {
            cik: "1373715",
            legalName: "ServiceNow, Inc.",
            ticker: "NOW",
            exchange: "NYSE",
            websiteUrl: "https://www.servicenow.com/",
            investorRelationsUrl: "https://investor.servicenow.com/",
            canonicalizedAt: 1,
        });
        const runId = await ctx.db.insert("researchRuns", {
            companyId,
            coveragePreset: "balanced",
            lifecycleState: "discovering_sources",
            executionStatus: "running",
            executionGeneration: 1,
            nextEventSequence: 1,
            createdAt: 1,
            updatedAt: 1,
        });
        return { runId, expectedExecutionGeneration: 1 };
    });
}

test("persists stable versioned questions with the research plan", async () => {
    const t = convexTest(schema, modules);
    const scenario = await createDiscoveringRun(t);
    const planId = await t.mutation(createForRun, scenario);
    const questions = await t.query(listQuestionsForPlan, { planId });
    expect(questions).toHaveLength(10);
    expect(
        new Set(questions.map((question) => question.questionKey)).size,
    ).toBe(questions.length);
    for (const question of questions) {
        expect(question.runId).toBe(scenario.runId);
        expect(question.researchPlanId).toBe(planId);
        expect(question.planVersion).toBe(2);
        expect(typeof question.prompt).toBe("string");
        expect(Array.isArray(question.dimensionKeys)).toBe(true);
        expect(question.dimensionKeys).toHaveLength(1);
        expect(typeof question.createdAt).toBe("number");
    }
    const dimQuestion = questions.find(
        (q) => q.questionKey === "dimension:context_ownership",
    );
    expect(dimQuestion).toBeDefined();
    expect(dimQuestion?.dimensionKeys).toEqual(["context_ownership"]);
    expect(dimQuestion?.prompt).toBe(
        "What public evidence supports or challenges context ownership for ServiceNow, Inc.?",
    );
});

test("generates exact research-angle prompt and defensible dimension mapping", async () => {
    const t = convexTest(schema, modules);
    const companyId = await t.run(async (ctx) =>
        ctx.db.insert("companies", {
            cik: "1373715",
            legalName: "ServiceNow, Inc.",
            ticker: "NOW",
            exchange: "NYSE",
            websiteUrl: "https://www.servicenow.com/",
            investorRelationsUrl: "https://investor.servicenow.com/",
            canonicalizedAt: 1,
        }),
    );
    const runId = await t.run(async (ctx) =>
        ctx.db.insert("researchRuns", {
            companyId,
            coveragePreset: "balanced",
            researchAngle: "agentic revenue orchestration",
            lifecycleState: "discovering_sources",
            executionStatus: "running",
            executionGeneration: 1,
            nextEventSequence: 1,
            createdAt: 1,
            updatedAt: 1,
        }),
    );
    const planId = await t.mutation(createForRun, {
        runId,
        expectedExecutionGeneration: 1,
    });
    const questions = await t.query(listQuestionsForPlan, { planId });
    expect(questions).toHaveLength(11);
    const angleQuestion = questions.find(
        (q) => q.questionKey === "research-angle",
    );
    expect(angleQuestion).toBeDefined();
    expect(angleQuestion?.prompt).toBe(
        "What public evidence addresses this research focus: agentic revenue orchestration?",
    );
    expect(angleQuestion?.dimensionKeys).toHaveLength(10);
    expect(angleQuestion?.planVersion).toBe(2);
    expect(angleQuestion?.runId).toBe(runId);
    expect(angleQuestion?.researchPlanId).toBe(planId);
});

test("reuses questions idempotently on repeated plan creation", async () => {
    const t = convexTest(schema, modules);
    const scenario = await createDiscoveringRun(t);
    const planIdFirst = await t.mutation(createForRun, scenario);
    const planIdSecond = await t.mutation(createForRun, scenario);
    expect(planIdFirst).toBe(planIdSecond);
    const questions = await t.query(listQuestionsForPlan, {
        planId: planIdFirst,
    });
    expect(questions).not.toHaveLength(0);
});

test("listQuestionsForPlan bounds returned rows to maximum 11 questions", async () => {
    const t = convexTest(schema, modules);
    const scenario = await createDiscoveringRun(t);
    const planId = await t.mutation(createForRun, scenario);
    await t.run(async (ctx) => {
        for (let i = 0; i < 5; i++) {
            await ctx.db.insert("researchPlanQuestions", {
                runId: scenario.runId,
                researchPlanId: planId,
                planVersion: 2,
                questionKey: `extra_question_${i}`,
                prompt: `Extra prompt ${i}`,
                dimensionKeys: ["context_ownership"],
                createdAt: Date.now() + i,
            });
        }
    });
    const questions = await t.query(listQuestionsForPlan, { planId });
    expect(questions).toHaveLength(11);
});

const pauseForClaimGenerationUnavailable = makeFunctionReference<
    "mutation",
    { runId: Id<"researchRuns">; expectedExecutionGeneration: number },
    null
>("researchRuns:pauseForClaimGenerationUnavailable");

test("pauses extraction with an explicit claim_generation_unavailable reason", async () => {
    const t = convexTest(schema, modules);
    const { runId } = await createDiscoveringRun(t);
    await t.mutation(runTransition, {
        runId,
        expectedExecutionGeneration: 1,
        lifecycleState: "awaiting_source_review" as ResearchRunLifecycle,
        executionStatus: "paused" as ExecutionStatus,
        stepKey: "source_review",
    });
    await t.mutation(runTransition, {
        runId,
        expectedExecutionGeneration: 1,
        lifecycleState: "corpus_approved" as ResearchRunLifecycle,
        executionStatus: "idle" as ExecutionStatus,
        stepKey: "source_review",
    });
    await t.mutation(runTransition, {
        runId,
        expectedExecutionGeneration: 1,
        lifecycleState: "extracting_evidence" as ResearchRunLifecycle,
        executionStatus: "running" as ExecutionStatus,
        stepKey: "extract_evidence",
    });
    await t.mutation(pauseForClaimGenerationUnavailable, {
        runId,
        expectedExecutionGeneration: 1,
    });
    await expect(t.query(getRun, { runId })).resolves.toMatchObject({
        lifecycleState: "extracting_evidence",
        executionStatus: "paused",
        pauseReason: "claim_generation_unavailable",
    });
});

test("allows extracting evidence to finish only at evidence_ready idle", async () => {
    const { assertLifecycleTransition } = await import(
        "@convex/domain/transitions"
    );
    expect(() =>
        assertLifecycleTransition(
            "extracting_evidence" as ResearchRunLifecycle,
            "evidence_ready" as ResearchRunLifecycle,
            "idle" as ExecutionStatus,
        ),
    ).not.toThrow();
    expect(() =>
        assertLifecycleTransition(
            "extracting_evidence" as ResearchRunLifecycle,
            "assessing_dimensions" as ResearchRunLifecycle,
            "running" as ExecutionStatus,
        ),
    ).toThrow();
});
