import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { manualSourceIntakeError } from "./domain/manualSourceIntake";
import { assertSourceCandidateRequestFits } from "./domain/sourceCandidateCapacity";
import { coveragePresetValidator } from "./domain/validators";
import { sourceCandidateLimit } from "./resourceLimits";
import { MAX_ANALYSES_PER_VISITOR } from "./resourcePolicy";
import { workspaceForVisitor } from "./runWorkspace";
import { insertPendingManualSource } from "./sources";

export const createFramingDossier = internalMutation({
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

        const workspace = await workspaceForVisitor(ctx, visitor);
        if (!workspace.canStartDossier)
            throw new Error("New research is unavailable for this workspace");
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
            if (
                existing.companyPreflightId !== args.preflightId ||
                existing.startMode !== "framed"
            ) {
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
            purpose: "research",
            ownerVisitorId: visitor._id,
            reservationKey: idempotencyKey,
            startMode: "framed",
            companyId: company._id,
            companySnapshot,
            companyPreflightId: preflight._id,
            coveragePreset: args.coveragePreset,
            researchAngle: researchAngle || undefined,
            lifecycleState: "framing",
            executionStatus: "idle",
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
        await ctx.db.patch(runId, {
            activeCorpusRevisionId: corpusRevisionId,
        });
        await ctx.db.patch(preflight._id, {
            ownerVisitorId: visitor._id,
            status: "consumed",
        });
        await ctx.db.insert("runEvents", {
            runId,
            sequence: 1,
            type: "run_created",
            lifecycleState: "framing",
            executionStatus: "idle",
            occurredAt: now,
        });
        await ctx.db.insert("runEvents", {
            runId,
            sequence: 2,
            type: "company_confirmed",
            lifecycleState: "framing",
            executionStatus: "idle",
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
                MAX_ANALYSES_PER_VISITOR - visitor.analysesReserved,
        };
    },
});
