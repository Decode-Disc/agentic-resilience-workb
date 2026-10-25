import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalMutation } from "./_generated/server";
import { manualSourceIntakeError } from "./domain/manualSourceIntake";
import { assertSourceCandidateRequestFits } from "./domain/sourceCandidateCapacity";
import { readPreparationConcurrency } from "./domain/sourcePreparationAuthority";
import { coveragePresetValidator } from "./domain/validators";
import {
    sourceCandidateLimit,
    sourcePreparationEnabled,
} from "./resourceLimits";
import { insertPendingManualSource } from "./sources";
import { workflow } from "./workflow";

const MAX_ANALYSES_PER_VISITOR = 3;
export const confirmAndStartReserved = internalMutation({
    args: {
        preflightId: v.id("companyPreflights"),
        idempotencyKey: v.string(),
        coveragePreset: coveragePresetValidator,
        researchAngle: v.optional(v.string()),
        manualSourcePreparationIds: v.optional(
            v.array(v.id("manualSourcePreparations")),
        ),
    },
    returns: v.object({
        runId: v.id("researchRuns"),
        remainingAnalyses: v.number(),
    }),
    handler: async (ctx, args) => {
        const authUserId = await getAuthUserId(ctx);
        if (!authUserId) {
            throw new Error("Not authenticated");
        }
        const visitor = await ctx.db
            .query("visitors")
            .withIndex("by_auth_user_id", (query) =>
                query.eq("authUserId", authUserId),
            )
            .unique();
        if (visitor?.status !== "active") {
            throw new Error("Unauthorized");
        }

        const idempotencyKey = args.idempotencyKey.trim();
        if (idempotencyKey.length === 0 || idempotencyKey.length > 128) {
            throw new Error("Invalid idempotency key");
        }
        const researchAngle = args.researchAngle?.trim();
        if (researchAngle && researchAngle.length > 500) {
            throw new Error("Research angle cannot exceed 500 characters");
        }
        assertSourceCandidateRequestFits(
            args.manualSourcePreparationIds?.length ?? 0,
            sourceCandidateLimit(),
        );

        const existing = await ctx.db
            .query("researchRuns")
            .withIndex("by_owner_and_reservation_key", (query) =>
                query
                    .eq("ownerVisitorId", visitor._id)
                    .eq("reservationKey", idempotencyKey),
            )
            .unique();
        if (existing) {
            if (existing.companyPreflightId !== args.preflightId) {
                throw new Error(
                    "Idempotency key belongs to another company preflight",
                );
            }
            return {
                runId: existing._id,
                remainingAnalyses:
                    MAX_ANALYSES_PER_VISITOR - visitor.analysesReserved,
            };
        }

        if (sourcePreparationEnabled()) readPreparationConcurrency();
        const now = Date.now();
        const manualSources = new Map<
            string,
            {
                preparationId: Id<"manualSourcePreparations">;
                canonicalUrl: string;
                title: string;
                providerReference: string;
            }
        >();
        for (const preparationId of args.manualSourcePreparationIds ?? []) {
            const preparation = await ctx.db.get(preparationId);
            if (!preparation || preparation.ownerAuthUserId !== authUserId) {
                throw new ConvexError(
                    manualSourceIntakeError("not_authorized", {
                        preparationId,
                    }).data,
                );
            }
            if (preparation.consumedAt || preparation.expiresAt <= now) {
                throw new ConvexError(
                    manualSourceIntakeError("preparation_expired", {
                        preparationId,
                    }).data,
                );
            }
            manualSources.set(preparation.canonicalUrl, {
                preparationId,
                canonicalUrl: preparation.canonicalUrl,
                title: preparation.title,
                providerReference: preparation.providerReference,
            });
        }

        const running = await ctx.db
            .query("researchRuns")
            .withIndex("by_owner_and_execution_status", (query) =>
                query
                    .eq("ownerVisitorId", visitor._id)
                    .eq("executionStatus", "running"),
            )
            .first();
        if (running) {
            throw new Error("A research workflow is already running");
        }
        if (visitor.analysesReserved >= MAX_ANALYSES_PER_VISITOR) {
            throw new Error("Analysis limit reached");
        }

        const preflight = await ctx.db.get(args.preflightId);
        const preflightBelongsToSession =
            preflight?.ownerAuthUserId !== undefined
                ? preflight.ownerAuthUserId === authUserId
                : preflight?.ownerVisitorId === visitor._id;
        if (
            !preflight ||
            !preflightBelongsToSession ||
            preflight.status !== "resolved"
        ) {
            throw new Error("Company preflight is not available");
        }
        if (preflight.expiresAt <= now) {
            throw new Error("Company preflight has expired");
        }
        const company = await ctx.db.get(preflight.companyId);
        if (!company) {
            throw new Error("Resolved company was not found");
        }
        const companySnapshot = preflight.companySnapshot ?? {
            cik: company.cik,
            legalName: company.legalName,
            ticker: company.ticker,
            exchange: company.exchange,
            investorRelationsUrl: company.investorRelationsUrl,
            websiteUrl: company.websiteUrl,
            websiteUrlSource: company.websiteUrlSource,
        };

        const runId = await ctx.db.insert("researchRuns", {
            ownerVisitorId: visitor._id,
            reservationKey: idempotencyKey,
            reservationStatus: "consumed",
            companyId: company._id,
            companySnapshot,
            companyPreflightId: preflight._id,
            coveragePreset: args.coveragePreset,
            researchAngle: researchAngle || undefined,
            lifecycleState: "draft",
            executionStatus: "running",
            executionGeneration: 1,
            nextEventSequence: 2,
            workflowVersion: 2,
            retryCount: 0,
            createdAt: now,
            updatedAt: now,
        });
        const corpusRevisionId = await ctx.db.insert("corpusRevisions", {
            runId,
            revision: 1,
            status: "draft",
            createdAt: now,
        });
        for (const manualSource of manualSources.values()) {
            await insertPendingManualSource(ctx, {
                runId,
                corpusRevisionId,
                reviewerVisitorId: visitor._id,
                canonicalUrl: manualSource.canonicalUrl,
                title: manualSource.title,
                providerReference: manualSource.providerReference,
                now,
            });
            await ctx.db.patch(manualSource.preparationId, {
                consumedAt: now,
            });
        }
        const workflowId = await workflow.start(
            ctx,
            internal.researchWorkflow.run,
            {
                runId,
                executionGeneration: 1,
                prepareSources: sourcePreparationEnabled(),
            },
            {
                onComplete: internal.researchWorkflow.onComplete,
                context: { runId },
            },
        );
        await ctx.db.patch(runId, {
            activeCorpusRevisionId: corpusRevisionId,
            workflowId,
        });
        await ctx.db.patch(preflight._id, {
            ownerVisitorId: visitor._id,
            status: "consumed",
        });
        await ctx.db.patch(visitor._id, {
            analysesReserved: visitor.analysesReserved + 1,
        });
        await ctx.db.insert("runEvents", {
            runId,
            sequence: 1,
            type: "run_created",
            lifecycleState: "draft",
            executionStatus: "running",
            occurredAt: now,
        });
        await ctx.db.insert("runEvents", {
            runId,
            sequence: 2,
            type: "company_confirmed",
            lifecycleState: "draft",
            executionStatus: "running",
            occurredAt: now,
        });
        await ctx.db.insert("auditEvents", {
            actor: { type: "visitor", visitorId: visitor._id },
            action: "analysis_reserved",
            targetType: "research_run",
            targetId: runId,
            occurredAt: now,
        });
        await ctx.db.insert("auditEvents", {
            actor: { type: "visitor", visitorId: visitor._id },
            action: "company_confirmed",
            targetType: "research_run",
            targetId: runId,
            occurredAt: now,
        });
        return {
            runId,
            remainingAnalyses:
                MAX_ANALYSES_PER_VISITOR - (visitor.analysesReserved + 1),
        };
    },
});

export const confirmAndStart = action({
    args: {
        preflightId: v.id("companyPreflights"),
        idempotencyKey: v.string(),
        coveragePreset: coveragePresetValidator,
        researchAngle: v.optional(v.string()),
        manualSourcePreparationIds: v.optional(
            v.array(v.id("manualSourcePreparations")),
        ),
    },
    returns: v.object({
        runId: v.id("researchRuns"),
        remainingAnalyses: v.number(),
    }),
    handler: async (
        ctx,
        args,
    ): Promise<{
        runId: Id<"researchRuns">;
        remainingAnalyses: number;
    }> => {
        assertSourceCandidateRequestFits(
            args.manualSourcePreparationIds?.length ?? 0,
            sourceCandidateLimit(),
        );
        return ctx.runMutation(
            internal.researchLaunch.confirmAndStartReserved,
            {
                preflightId: args.preflightId,
                idempotencyKey: args.idempotencyKey,
                coveragePreset: args.coveragePreset,
                researchAngle: args.researchAngle,
                manualSourcePreparationIds: args.manualSourcePreparationIds,
            },
        );
    },
});
