import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { env, internalMutation, internalQuery } from "./_generated/server";
import { corpusRevisionApproved, workflow } from "./workflow";

export const sourceReviewWorkflow = workflow
    .define({
        args: {
            runId: v.id("researchRuns"),
        },
        returns: v.null(),
    })
    .handler(async (step, args): Promise<null> => {
        const approval = await step.awaitEvent(corpusRevisionApproved);
        await step.runMutation(internal.sources.verifyApprovedHandoff, {
            runId: args.runId,
            corpusRevisionId: approval.corpusRevisionId,
            expectedExecutionGeneration: approval.executionGeneration,
        });
        await step.runMutation(internal.researchRuns.transition, {
            runId: args.runId,
            expectedExecutionGeneration: approval.executionGeneration,
            lifecycleState: "corpus_approved",
            executionStatus: "idle",
            stepKey: "source_review",
        });
        return null;
    });

export const seedSourceReviewScenario = internalMutation({
    args: {
        slotKey: v.string(),
        fixtureKey: v.string(),
    },
    returns: v.object({
        runId: v.id("researchRuns"),
        corpusRevisionId: v.id("corpusRevisions"),
        proposalId: v.id("sourceSelectionProposals"),
        proposalVersion: v.number(),
        sourceIds: v.array(v.id("sources")),
    }),
    handler: async (
        ctx,
        args,
    ): Promise<{
        runId: Id<"researchRuns">;
        corpusRevisionId: Id<"corpusRevisions">;
        proposalId: Id<"sourceSelectionProposals">;
        proposalVersion: number;
        sourceIds: Array<Id<"sources">>;
    }> => {
        if (env.E2E_FIXTURES_ENABLED !== "true") {
            throw new Error("E2E fixtures are disabled");
        }
        const slotKey = args.slotKey.trim();
        const fixtureKey = args.fixtureKey.trim();
        if (!slotKey || !fixtureKey || fixtureKey.length > 80) {
            throw new Error("Invalid E2E fixture identifier");
        }
        const invitation = await ctx.db
            .query("invitations")
            .withIndex("by_slot_key", (query) => query.eq("slotKey", slotKey))
            .unique();
        if (
            invitation?.status !== "claimed" ||
            !invitation.claimedByVisitorId
        ) {
            throw new Error("Claimed E2E invitation not found");
        }
        const visitor = await ctx.db.get(invitation.claimedByVisitorId);
        if (
            visitor?.status !== "active" ||
            visitor.invitationId !== invitation._id
        ) {
            throw new Error("Active E2E visitor not found");
        }
        const reservationKey = `e2e:${fixtureKey}`;
        const existingRun = await ctx.db
            .query("researchRuns")
            .withIndex("by_owner_and_reservation_key", (query) =>
                query
                    .eq("ownerVisitorId", visitor._id)
                    .eq("reservationKey", reservationKey),
            )
            .unique();
        if (existingRun?.activeCorpusRevisionId) {
            const revision = await ctx.db.get(
                existingRun.activeCorpusRevisionId,
            );
            const proposal = revision?.sourceSelectionProposalId
                ? await ctx.db.get(revision.sourceSelectionProposalId)
                : null;
            const sources = await ctx.db
                .query("sources")
                .withIndex("by_run_and_url", (query) =>
                    query.eq("runId", existingRun._id),
                )
                .collect();
            if (revision && proposal && sources.length === 2) {
                return {
                    runId: existingRun._id,
                    corpusRevisionId: revision._id,
                    proposalId: proposal._id,
                    proposalVersion: proposal.version,
                    sourceIds: sources.map(({ _id }) => _id),
                };
            }
        }

        const now = Date.now();
        const companyId = await ctx.db.insert("companies", {
            cik: `e2e-${fixtureKey}`,
            legalName: "Reactive Systems Test Company",
            ticker: "RXT",
            exchange: "NASDAQ",
            websiteUrl: "https://example.com/",
            canonicalizedAt: now,
        });
        const runId = await ctx.db.insert("researchRuns", {
            ownerVisitorId: visitor._id,
            reservationKey,
            reservationStatus: "consumed",
            companyId,
            companySnapshot: {
                cik: `e2e-${fixtureKey}`,
                legalName: "Reactive Systems Test Company",
                ticker: "RXT",
                exchange: "NASDAQ",
                websiteUrl: "https://example.com/",
            },
            coveragePreset: "balanced",
            researchAngle: "Reactive source review verification",
            lifecycleState: "discovering_sources",
            executionStatus: "running",
            executionGeneration: 1,
            nextEventSequence: 1,
            workflowVersion: 1,
            createdAt: now,
            updatedAt: now,
        });
        const corpusRevisionId = await ctx.db.insert("corpusRevisions", {
            runId,
            revision: 1,
            status: "draft",
            createdAt: now,
        });
        await ctx.db.patch(runId, { activeCorpusRevisionId: corpusRevisionId });
        const sourceInputs = [
            {
                canonicalUrl: "https://example.com/e2e/annual-report",
                title: "Annual report",
            },
            {
                canonicalUrl: "https://example.com/e2e/product-architecture",
                title: "Product architecture overview",
            },
        ];
        const sourceIds = [];
        for (const [index, source] of sourceInputs.entries()) {
            const sourceId = await ctx.db.insert("sources", {
                runId,
                canonicalUrl: source.canonicalUrl,
                title: source.title,
                origin: "analyst_url",
                category: "analyst_supplied",
                providerReference: `e2e:${fixtureKey}:${index}`,
                createdAt: now + index,
            });
            sourceIds.push(sourceId);
        }
        const proposal: {
            proposalId: Id<"sourceSelectionProposals">;
            version: number;
        } = await ctx.runMutation(
            internal.sourceSelectionProposals.generateForRun,
            { runId, expectedExecutionGeneration: 1 },
        );
        const workflowId = await workflow.start(
            ctx,
            internal.e2eFixtures.sourceReviewWorkflow,
            { runId },
        );
        await ctx.db.patch(runId, { workflowId });
        await ctx.runMutation(internal.researchRuns.transition, {
            runId,
            expectedExecutionGeneration: 1,
            lifecycleState: "awaiting_source_review",
            executionStatus: "paused",
            stepKey: "source_review",
        });
        return {
            runId,
            corpusRevisionId,
            proposalId: proposal.proposalId,
            proposalVersion: proposal.version,
            sourceIds,
        };
    },
});

export const inspectSourceReviewScenario = internalQuery({
    args: { fixtureKey: v.string() },
    returns: v.object({
        lifecycleState: v.string(),
        executionStatus: v.string(),
        revisionStatus: v.string(),
        decisions: v.array(
            v.object({
                title: v.string(),
                decision: v.union(
                    v.literal("accepted"),
                    v.literal("pending"),
                    v.literal("rejected"),
                ),
            }),
        ),
        providerCallCount: v.number(),
    }),
    handler: async (ctx, args) => {
        if (env.E2E_FIXTURES_ENABLED !== "true") {
            throw new Error("E2E fixtures are disabled");
        }
        const reservationKey = `e2e:${args.fixtureKey.trim()}`;
        const runs = await ctx.db.query("researchRuns").take(100);
        const run = runs.find(
            (candidate) => candidate.reservationKey === reservationKey,
        );
        if (!run?.activeCorpusRevisionId) {
            throw new Error("E2E source review scenario not found");
        }
        const revision = await ctx.db.get(run.activeCorpusRevisionId);
        if (!revision) {
            throw new Error("E2E corpus revision not found");
        }
        const reviewItems = await ctx.db
            .query("sourceReviewItems")
            .withIndex("by_revision_and_queue", (query) =>
                query.eq("corpusRevisionId", revision._id),
            )
            .collect();
        const decisions = [];
        for (const item of reviewItems) {
            const source = await ctx.db.get(item.sourceId);
            if (!source) {
                throw new Error("E2E source not found");
            }
            decisions.push({ title: source.title, decision: item.decision });
        }
        const providerCalls = await ctx.db
            .query("providerCalls")
            .filter((query) => query.eq(query.field("runId"), run._id))
            .take(100);
        return {
            lifecycleState: run.lifecycleState,
            executionStatus: run.executionStatus,
            revisionStatus: revision.status,
            decisions,
            providerCallCount: providerCalls.length,
        };
    },
});
