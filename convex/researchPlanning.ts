import { v } from "convex/values";

import { internalMutation, internalQuery } from "./_generated/server";
import { mergeRunCompanyMetadata } from "./domain/companyMetadata";
import {
    ASSESSMENT_DIMENSION_KEYS,
    buildResearchPlan,
    buildResearchPlanQuestions,
    RESEARCH_PLAN_TEMPLATE_VERSION,
} from "./domain/researchPlan";

const MAX_RESEARCH_PLAN_QUESTIONS = ASSESSMENT_DIMENSION_KEYS.length + 1;

const planQueryValidator = v.object({
    query: v.string(),
    category: v.string(),
    discoveryIntent: v.optional(v.string()),
    includeDomains: v.optional(v.array(v.string())),
    dimensionKeys: v.array(v.string()),
});

export const createForRun = internalMutation({
    args: {
        runId: v.id("researchRuns"),
        expectedExecutionGeneration: v.number(),
    },
    returns: v.id("researchPlans"),
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        if (run?.executionGeneration !== args.expectedExecutionGeneration) {
            throw new Error("Stale research execution generation");
        }
        if (
            !run?.companyId ||
            !run.coveragePreset ||
            run.lifecycleState !== "discovering_sources" ||
            run.executionStatus !== "running"
        ) {
            throw new Error("Research run is missing planning inputs");
        }
        const existing = await ctx.db
            .query("researchPlans")
            .withIndex("by_run_and_version", (query) =>
                query
                    .eq("runId", run._id)
                    .eq("version", RESEARCH_PLAN_TEMPLATE_VERSION),
            )
            .unique();
        if (existing) {
            return existing._id;
        }
        const company = mergeRunCompanyMetadata(
            run.companySnapshot,
            await ctx.db.get(run.companyId),
        );
        if (!company) {
            throw new Error("Confirmed company was not found");
        }
        const plan = buildResearchPlan({
            company,
            coveragePreset: run.coveragePreset,
            researchAngle: run.researchAngle,
        });
        const questions = buildResearchPlanQuestions({
            company,
            researchAngle: run.researchAngle,
        });
        const now = Date.now();
        const planId = await ctx.db.insert("researchPlans", {
            runId: run._id,
            version: RESEARCH_PLAN_TEMPLATE_VERSION,
            ...plan,
            createdAt: now,
        });
        for (const question of questions) {
            await ctx.db.insert("researchPlanQuestions", {
                runId: run._id,
                researchPlanId: planId,
                planVersion: RESEARCH_PLAN_TEMPLATE_VERSION,
                questionKey: question.questionKey,
                prompt: question.prompt,
                dimensionKeys: question.dimensionKeys,
                createdAt: now,
            });
        }
        await ctx.db.patch(run._id, {
            nextEventSequence: run.nextEventSequence + 1,
            updatedAt: now,
        });
        await ctx.db.insert("runEvents", {
            runId: run._id,
            sequence: run.nextEventSequence + 1,
            type: "research_plan_created",
            lifecycleState: run.lifecycleState,
            executionStatus: run.executionStatus,
            stepKey: "build_research_plan",
            messageKey: "research_plan_created",
            total: plan.queries.length,
            occurredAt: now,
        });
        return planId;
    },
});

export const listQuestionsForPlan = internalQuery({
    args: { planId: v.id("researchPlans") },
    returns: v.array(
        v.object({
            runId: v.id("researchRuns"),
            researchPlanId: v.id("researchPlans"),
            planVersion: v.number(),
            questionKey: v.string(),
            prompt: v.string(),
            dimensionKeys: v.array(v.string()),
            createdAt: v.number(),
        }),
    ),
    handler: async (ctx, args) => {
        const rows = await ctx.db
            .query("researchPlanQuestions")
            .withIndex("by_plan_and_key", (query) =>
                query.eq("researchPlanId", args.planId),
            )
            .take(MAX_RESEARCH_PLAN_QUESTIONS);
        return rows.map((row) => ({
            runId: row.runId,
            researchPlanId: row.researchPlanId,
            planVersion: row.planVersion,
            questionKey: row.questionKey,
            prompt: row.prompt,
            dimensionKeys: row.dimensionKeys,
            createdAt: row.createdAt,
        }));
    },
});

export const getDiscoveryContext = internalQuery({
    args: { runId: v.id("researchRuns") },
    returns: v.object({
        cik: v.string(),
        corpusRevisionId: v.id("corpusRevisions"),
        executionGeneration: v.number(),
        researchAngle: v.optional(v.string()),
        queries: v.array(planQueryValidator),
    }),
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        if (
            !run?.companyId ||
            !run.activeCorpusRevisionId ||
            run.lifecycleState !== "discovering_sources" ||
            run.executionStatus !== "running"
        ) {
            throw new Error("Research run is missing discovery inputs");
        }
        const company = mergeRunCompanyMetadata(
            run.companySnapshot,
            await ctx.db.get(run.companyId),
        );
        const plan = await ctx.db
            .query("researchPlans")
            .withIndex("by_run_and_version", (query) =>
                query
                    .eq("runId", run._id)
                    .eq("version", RESEARCH_PLAN_TEMPLATE_VERSION),
            )
            .unique();
        if (!company || !plan) {
            throw new Error("Research discovery context was not found");
        }
        return {
            cik: company.cik,
            corpusRevisionId: run.activeCorpusRevisionId,
            executionGeneration: run.executionGeneration,
            researchAngle: run.researchAngle,
            queries: plan.queries,
        };
    },
});
