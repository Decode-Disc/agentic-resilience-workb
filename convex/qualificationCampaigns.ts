import {
    qualificationCategory,
    readQualificationUsage,
} from "@convex/qualificationUsage";
import { PERSISTENCE_PAGE_SIZE } from "@convex/resourcePolicy";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { zodToConvex } from "convex-helpers/server/zod4";
import type { Doc, Id } from "./_generated/dataModel";
import {
    env,
    internalMutation,
    internalQuery,
    type QueryCtx,
} from "./_generated/server";
import { sha256Hex, stableStringify } from "./domain/sourcePassages";
import { preparationFailureClass } from "./domain/sourcePreparationAuthority";
import { resolveReasoningPreference } from "./integrations/modelRouting";
import { readResponseControlPolicy } from "./modelConfiguration";
import {
    analysisPricingAuthority,
    analysisProviderSchema,
    analysisReceiptSchema,
    analysisUsageChargeMicros,
    campaignConfiguration,
    campaignConfigurations,
    campaignLimitsSchema,
    campaignManifestSchema,
    emptyCampaignLimits,
    newCampaignManifestSchema,
} from "./qualificationCampaignPolicy";
import {
    MAX_SOURCES_QUALIFICATION_RECEIPTS,
    RESOURCE_POLICY_VERSION,
} from "./resourcePolicy";
import { BROWSER_TEST_SLOT, requireBrowserTestOwner } from "./runWorkspace";
import schema from "./schema";

const hash = (value: unknown) => sha256Hex(stableStringify(value));
const keys = ["model", "search", "acquisition", "costUsd"] as const;
async function owned(ctx: QueryCtx, campaignId: Id<"qualificationCampaigns">) {
    // Status and cleanup remain available after temporary fixture flags are restored.
    let hostname: string;
    try {
        hostname = new URL(env.CONVEX_CLOUD_URL).hostname;
    } catch {
        throw new Error("Local campaign configuration invalid");
    }
    if (!["localhost", "127.0.0.1"].includes(hostname))
        throw new Error("Local campaign required");
    const campaign = await ctx.db.get(campaignId);
    const invitation = await ctx.db
        .query("invitations")
        .withIndex("by_slot_key", (q) => q.eq("slotKey", BROWSER_TEST_SLOT))
        .unique();
    const owner = campaign ? await ctx.db.get(campaign.ownerVisitorId) : null;
    if (
        !campaign ||
        invitation?.claimedByVisitorId !== owner?._id ||
        owner?.status !== "active"
    )
        throw new Error("Campaign owner unavailable");
    return campaign;
}
export const authorize = internalMutation({
    args: { manifest: zodToConvex(campaignManifestSchema) },
    returns: v.id("qualificationCampaigns"),
    handler: async (ctx, { manifest: input }) => {
        const manifest = campaignManifestSchema.parse(input);
        const owner = await requireBrowserTestOwner(ctx, BROWSER_TEST_SLOT);
        const previous = await ctx.db
            .query("qualificationCampaigns")
            .withIndex("by_owner_and_key", (q) =>
                q.eq("ownerVisitorId", owner._id).eq("key", manifest.key),
            )
            .unique();
        const manifestHash = hash(manifest);
        if (previous) {
            if (previous.manifestHash !== manifestHash)
                throw new Error("Campaign authorization conflict");
            if (
                previous.status !== "active" ||
                previous.manifest.expiresAt <= Date.now()
            )
                throw new Error("Campaign closed or expired");
            return previous._id;
        }
        newCampaignManifestSchema.parse(manifest);
        if (manifest.expiresAt <= Date.now())
            throw new Error("Campaign expired");
        const configurationHashes: { id: string; hash: string }[] = [];
        if (manifest.mode === "live")
            for (const profile of campaignConfigurations(manifest)) {
                const configurations = [];
                for (const role of manifest.capability === "sources"
                    ? (["workbench", "sources"] as const)
                    : (["workbench"] as const)) {
                    const choice = profile.models[role];
                    if (!choice) throw new Error("Campaign model required");
                    const catalog = await ctx.db
                        .query("modelCatalog")
                        .withIndex("by_model_and_provider", (q) =>
                            q
                                .eq("model", choice.model)
                                .eq("provider", choice.provider),
                        )
                        .unique();
                    const model = catalog?.currentRevisionId
                        ? await ctx.db.get(catalog.currentRevisionId)
                        : null;
                    if (
                        !catalog?.enabled ||
                        catalog.status !== "ready" ||
                        !model
                    )
                        throw new Error(
                            "Prepare the campaign model before authorization",
                        );
                    configurations.push({
                        role,
                        model: model.model,
                        provider: model.provider,
                        descriptor: model.descriptor,
                        effort: resolveReasoningPreference(
                            model.descriptor,
                            choice.reasoning,
                        ),
                    });
                }
                const policy = await readResponseControlPolicy(ctx);
                const profileHash = hash({
                    configurations,
                    controller: profile.controllerModel
                        ? {
                              enabled: true,
                              model: profile.controllerModel,
                              contradictionThreshold:
                                  policy.contradictionThreshold,
                              supportThreshold: policy.supportThreshold,
                          }
                        : { enabled: false },
                });
                configurationHashes.push({ id: profile.id, hash: profileHash });
            }
        const configurationHash =
            manifest.version === 1 ? configurationHashes[0]?.hash : undefined;
        return ctx.db.insert("qualificationCampaigns", {
            resourcePolicy: RESOURCE_POLICY_VERSION,
            configurationHash,
            configurationHashes:
                manifest.version !== 1 ? configurationHashes : undefined,
            key: manifest.key,
            manifest,
            manifestHash,
            ownerVisitorId: owner._id,
            status: "active",
            allocated: emptyCampaignLimits(),
            lots: 0,
            createdAt: Date.now(),
        });
    },
});
export const admit = internalMutation({
    args: {
        campaignId: v.id("qualificationCampaigns"),
        key: v.string(),
        candidateHash: v.string(),
        correction: v.optional(v.string()),
        configurationId: v.optional(v.string()),
        changedPaths: v.array(v.string()),
    },
    returns: v.id("qualificationLots"),
    handler: async (ctx, args) => {
        const campaign = await owned(ctx, args.campaignId);
        const m = campaign.manifest;
        if (campaign.resourcePolicy !== RESOURCE_POLICY_VERSION)
            throw new Error("resource_policy_unsupported");
        if (campaign.status !== "active" || m.expiresAt <= Date.now())
            throw new Error("Campaign closed or expired");
        if (
            !/^[a-z0-9-]{1,80}$/.test(args.key) ||
            !/^[a-f0-9]{64}$/.test(args.candidateHash) ||
            args.changedPaths.length > 1000
        )
            throw new Error("Invalid candidate");
        const previous = await ctx.db
            .query("qualificationLots")
            .withIndex("by_campaign_and_key", (q) =>
                q.eq("campaignId", campaign._id).eq("key", args.key),
            )
            .unique();
        if (previous) {
            if (
                previous.candidateHash !== args.candidateHash ||
                hash(previous.changedPaths) !== hash(args.changedPaths) ||
                previous.correction !== args.correction ||
                (args.configurationId !== undefined &&
                    args.configurationId !== previous.configurationId)
            )
                throw new Error("Lot admission conflict");
            return previous._id;
        }
        if (campaign.activeLotId)
            throw new Error("Campaign lot pending reconciliation or review");
        let configurationId: string | undefined;
        let coverage: Doc<"qualificationCoverage"> | null | undefined;
        if (m.version !== 1) {
            const entries = await Promise.all(
                m.configurations.map(async (c) => ({
                    configuration: c,
                    coverage: await ctx.db
                        .query("qualificationCoverage")
                        .withIndex(
                            "by_campaign_and_candidate_and_configuration",
                            (q) =>
                                q
                                    .eq("campaignId", campaign._id)
                                    .eq("candidateHash", args.candidateHash)
                                    .eq("configurationId", c.id),
                        )
                        .unique(),
                })),
            );
            if (entries.every((e) => e.coverage?.passed))
                throw new Error("Campaign objective already satisfied");
            const selected = args.configurationId
                ? entries.find(
                      (e) =>
                          e.configuration.id ===
                          campaignConfiguration(m, args.configurationId).id,
                  )
                : entries.find(
                      (e) =>
                          !e.coverage?.passed &&
                          (e.coverage?.attempts ?? 0) <
                              m.repetitionsPerCandidate,
                  );
            if (!selected)
                throw new Error("Candidate repetition allowance exhausted");
            configurationId = selected.configuration.id;
            coverage = selected.coverage;
            if ((coverage?.attempts ?? 0) >= m.repetitionsPerCandidate)
                throw new Error("Candidate repetition allowance exhausted");
            if (
                campaign.lots &&
                campaign.lastCandidateHash !== args.candidateHash &&
                (!args.correction?.trim() || !args.changedPaths.length)
            )
                throw new Error(
                    "An authorized correction must identify the new candidate",
                );
        } else {
            const lots = await ctx.db
                .query("qualificationLots")
                .withIndex("by_campaign", (q) =>
                    q.eq("campaignId", campaign._id),
                )
                .take(m.maximumLots + 1);
            if (lots.some((l) => l.verdict === "passed"))
                throw new Error("Campaign objective already satisfied");
            if (
                lots.filter((l) => l.candidateHash === args.candidateHash)
                    .length >= m.repetitionsPerCandidate
            )
                throw new Error("Candidate repetition allowance exhausted");
            if (
                lots.length &&
                lots.at(-1)?.candidateHash !== args.candidateHash &&
                (!args.correction?.trim() || !args.changedPaths.length)
            )
                throw new Error(
                    "An authorized correction must identify the new candidate",
                );
        }
        if (
            args.changedPaths.some(
                (p) =>
                    p.startsWith("/") ||
                    p.split("/").includes("..") ||
                    !m.correctionPaths.some(
                        (allowed) =>
                            p === allowed || p.startsWith(`${allowed}/`),
                    ),
            )
        )
            throw new Error("Correction outside campaign scope");
        const allocated = { ...campaign.allocated };
        for (const key of keys) {
            allocated[key] += m.perLot[key];
            if (allocated[key] > m.total[key] + (key === "costUsd" ? 1e-10 : 0))
                throw new Error("Campaign budget exhausted");
        }
        if (campaign.lots >= m.maximumLots)
            throw new Error("Campaign lot allowance exhausted");
        const lotId = await ctx.db.insert("qualificationLots", {
            campaignId: campaign._id,
            key: args.key,
            candidateHash: args.candidateHash,
            configurationId,
            correction: args.correction,
            changedPaths: args.changedPaths,
            status: "running",
            allocation: m.perLot,
            createdAt: Date.now(),
        });
        if (configurationId) {
            if (coverage)
                await ctx.db.patch(coverage._id, {
                    attempts: coverage.attempts + 1,
                });
            else
                await ctx.db.insert("qualificationCoverage", {
                    campaignId: campaign._id,
                    candidateHash: args.candidateHash,
                    configurationId,
                    attempts: 1,
                    passed: false,
                });
        }
        await ctx.db.patch(campaign._id, {
            allocated,
            lastCandidateHash: args.candidateHash,
            lots: campaign.lots + 1,
            activeLotId: lotId,
        });
        return lotId;
    },
});
/** Shared by lot binding and the final provider authority check. */
export async function requireCampaignLot(
    ctx: QueryCtx,
    lotId: Id<"qualificationLots">,
) {
    const lot = await ctx.db.get(lotId);
    if (!lot) throw new Error("Campaign lot unavailable");
    const campaign = await owned(ctx, lot.campaignId);
    if (
        campaign.status !== "active" ||
        campaign.manifest.expiresAt <= Date.now() ||
        campaign.activeLotId !== lotId ||
        lot.status !== "running"
    )
        throw new Error("Campaign lot is not active");
    return { lot, campaign };
}
export const bind = internalMutation({
    args: {
        lotId: v.id("qualificationLots"),
        contextId: v.id("browserTestContexts"),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const { lot, campaign } = await requireCampaignLot(ctx, args.lotId);
        const context = await ctx.db.get(args.contextId);
        if (
            context?.status !== "active" ||
            context.ownerVisitorId !== campaign.ownerVisitorId ||
            (context.campaignLotId && context.campaignLotId !== lot._id) ||
            (lot.contextId && lot.contextId !== context._id)
        )
            throw new Error("Campaign context conflict");
        await ctx.db.patch(context._id, { campaignLotId: lot._id });
        await ctx.db.patch(lot._id, {
            contextId: context._id,
            contextKey: context.contextKey,
        });
        return null;
    },
});
export const reserveAnalysis = internalMutation({
    args: {
        lotId: v.id("qualificationLots"),
        attemptKey: v.string(),
        evidenceHash: v.string(),
        provider: zodToConvex(analysisProviderSchema),
        model: v.string(),
        reservationMicros: v.optional(v.number()),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const lot = await ctx.db.get(args.lotId);
        if (!lot) throw new Error("Campaign lot unavailable");
        const campaign = await owned(ctx, lot.campaignId);
        const manifest = campaign.manifest;
        if (campaign.resourcePolicy !== RESOURCE_POLICY_VERSION)
            throw new Error("resource_policy_unsupported");
        if (args.provider === "opencode-go")
            throw new Error(
                "OpenCode Go subscription-only guarantee unverified",
            );
        if (
            manifest.version !== 3 ||
            campaign.status !== "active" ||
            manifest.expiresAt <= Date.now() ||
            campaign.activeLotId !== lot._id ||
            (lot.status !== "closing" && lot.status !== "review")
        )
            throw new Error("Analysis not authorized");
        const subscription =
            manifest.analysis.accounting === "native_subscription";
        if (
            !/^[a-zA-Z0-9-]{1,100}$/.test(args.attemptKey) ||
            !/^[a-f0-9]{64}$/.test(args.evidenceHash) ||
            (subscription
                ? args.reservationMicros !== undefined
                : args.reservationMicros === undefined ||
                  !Number.isSafeInteger(args.reservationMicros) ||
                  args.reservationMicros < 1) ||
            !manifest.analysis.routes.some(
                (route) =>
                    route.provider === args.provider &&
                    route.model === args.model,
            )
        )
            throw new Error("Invalid analysis reservation");
        if (
            args.reservationMicros !==
            (manifest.analysis.maxRequestCostMicros ??
                manifest.analysis.perLot.costMicros)
        )
            throw new Error(
                "Analysis reservation must cover the authorized request bound",
            );
        const existing = await ctx.db
            .query("qualificationAnalysisAttempts")
            .withIndex("by_lot_and_attempt", (q) =>
                q.eq("lotId", lot._id).eq("attemptKey", args.attemptKey),
            )
            .unique();
        if (existing) throw new Error("Analysis attempt already reserved");
        const unresolved =
            manifest.analysis.settlementPolicy === "verified_usage_v1"
                ? await ctx.db
                      .query("qualificationAnalysisAttempts")
                      .withIndex("by_campaign_and_status", (q) =>
                          q
                              .eq("campaignId", lot.campaignId)
                              .eq("status", "reserved"),
                      )
                      .first()
                : (
                      await ctx.db
                          .query("qualificationAnalysisAttempts")
                          .withIndex("by_lot_and_attempt", (q) =>
                              q.eq("lotId", lot._id),
                          )
                          .take(manifest.analysis.perLot.requests + 1)
                  ).some(
                      (attempt) =>
                          attempt.status === "reserved" &&
                          attempt.provider === args.provider &&
                          attempt.model === args.model,
                  );
        if (unresolved)
            throw new Error("Prior analysis dispatch outcome unknown");
        const total = campaign.analysisAllocated ?? {
            requests: 0,
            costMicros: 0,
        };
        const used = lot.analysisAllocated ?? { requests: 0, costMicros: 0 };
        const nextTotal = {
            requests: total.requests + 1,
            costMicros: total.costMicros + (args.reservationMicros ?? 0),
        };
        const nextLot = {
            requests: used.requests + 1,
            costMicros: used.costMicros + (args.reservationMicros ?? 0),
        };
        if (
            !Number.isSafeInteger(nextTotal.costMicros) ||
            nextTotal.requests > manifest.analysis.total.requests ||
            nextTotal.costMicros > (manifest.analysis.total.costMicros ?? 0) ||
            nextLot.requests > manifest.analysis.perLot.requests ||
            nextLot.costMicros > (manifest.analysis.perLot.costMicros ?? 0)
        )
            throw new Error("Analysis allowance exhausted");
        await ctx.db.insert("qualificationAnalysisAttempts", {
            ...args,
            campaignId: campaign._id,
            status: "reserved",
            createdAt: Date.now(),
        });
        await ctx.db.patch(campaign._id, { analysisAllocated: nextTotal });
        await ctx.db.patch(lot._id, { analysisAllocated: nextLot });
        return null;
    },
});
export const settleAnalysis = internalMutation({
    args: {
        lotId: v.id("qualificationLots"),
        attemptKey: v.string(),
        costMicros: v.optional(v.number()),
        receipt: v.optional(zodToConvex(analysisReceiptSchema)),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const lot = await ctx.db.get(args.lotId);
        if (!lot) throw new Error("Campaign lot unavailable");
        const campaign = await owned(ctx, lot.campaignId);
        const attempt = await ctx.db
            .query("qualificationAnalysisAttempts")
            .withIndex("by_lot_and_attempt", (q) =>
                q.eq("lotId", lot._id).eq("attemptKey", args.attemptKey),
            )
            .unique();
        if (!attempt) throw new Error("Invalid analysis settlement");
        const analysis =
            campaign.manifest.version === 3
                ? campaign.manifest.analysis
                : undefined;
        if (analysis?.accounting !== undefined) {
            const api = analysis.accounting === "api_cost";
            const invalid = api
                ? "Invalid native API analysis settlement"
                : "Invalid analysis settlement";
            const parsed = analysisReceiptSchema.safeParse(args.receipt);
            if (
                args.costMicros !== undefined ||
                !parsed.success ||
                parsed.data.accounting !== analysis.accounting
            )
                throw new Error(invalid);
            const receipt = parsed.data;
            if (
                api &&
                (!analysis.pricing ||
                    receipt.pricingHash !==
                        sha256Hex(
                            analysisPricingAuthority(analysis.pricing).identity,
                        ))
            )
                throw new Error(invalid);
            if (attempt.status === "settled") {
                if (hash(attempt.receipt) !== hash(receipt))
                    throw new Error("Analysis settlement conflict");
                return null;
            }
            const charge =
                analysis.settlementPolicy === "verified_usage_v1" &&
                analysis.pricing
                    ? analysisUsageChargeMicros(analysis.pricing, receipt)
                    : receipt.costMicros;
            if (
                api &&
                (attempt.reservationMicros === undefined ||
                    charge === undefined ||
                    charge > attempt.reservationMicros)
            )
                throw new Error("Analysis reservation overrun");
            if (
                analysis.settlementPolicy === "verified_usage_v1" &&
                attempt.reservationMicros !== undefined &&
                charge !== undefined
            ) {
                const released = attempt.reservationMicros - charge;
                const total = campaign.analysisAllocated;
                const used = lot.analysisAllocated;
                if (
                    !total ||
                    !used ||
                    total.costMicros < attempt.reservationMicros ||
                    used.costMicros < attempt.reservationMicros
                )
                    throw new Error("Analysis allocation unavailable");
                await ctx.db.patch(campaign._id, {
                    analysisAllocated: {
                        ...total,
                        costMicros: total.costMicros - released,
                    },
                });
                await ctx.db.patch(lot._id, {
                    analysisAllocated: {
                        ...used,
                        costMicros: used.costMicros - released,
                    },
                });
            }
            await ctx.db.patch(attempt._id, {
                status: "settled",
                receipt,
                ...(api ? { costMicros: charge } : {}),
            });
            return null;
        }
        if (
            args.receipt !== undefined ||
            args.costMicros === undefined ||
            !Number.isSafeInteger(args.costMicros) ||
            args.costMicros < 0
        )
            throw new Error("Invalid analysis settlement");
        if (attempt.status === "settled") {
            if (attempt.costMicros !== args.costMicros)
                throw new Error("Analysis settlement conflict");
            return null;
        }
        if (
            attempt.reservationMicros === undefined ||
            args.costMicros > attempt.reservationMicros
        )
            throw new Error("Analysis reservation overrun");
        if (!campaign.analysisAllocated || !lot.analysisAllocated)
            throw new Error("Analysis allocation unavailable");
        await ctx.db.patch(attempt._id, {
            status: "settled",
            costMicros: args.costMicros,
        });
        return null;
    },
});
export const reconcile = internalMutation({
    args: { lotId: v.id("qualificationLots"), cleanupCompleted: v.boolean() },
    returns: v.object({
        reconciled: v.boolean(),
        usage: zodToConvex(campaignLimitsSchema),
    }),
    handler: async (ctx, args) => {
        const lot = await ctx.db.get(args.lotId);
        if (!lot) throw new Error("Campaign lot unavailable");
        const campaign = await owned(ctx, lot.campaignId);
        if (lot.status !== "running" && lot.status !== "closing")
            return { reconciled: true, usage: lot.allocation };
        const context = lot.contextId ? await ctx.db.get(lot.contextId) : null;
        if (!args.cleanupCompleted || (context && context.status !== "closed"))
            return { reconciled: false, usage: lot.allocation };
        const usage = emptyCampaignLimits();
        if (
            campaign.manifest.version !== 1 &&
            context?.paidQualification?.scenarios
        ) {
            const retained = await readQualificationUsage(ctx, context._id);
            if (
                !retained ||
                retained.pending ||
                retained.unknown ||
                retained.overruns
            )
                return { reconciled: false, usage: lot.allocation };
            Object.assign(usage, retained.usage);
        } else {
            const runIds =
                context?.paidQualification?.sourcesLot ??
                (context?.paidQualification
                    ? [context.paidQualification.runId]
                    : []);
            for (const runId of runIds) {
                const receipts = await ctx.db
                    .query("providerCalls")
                    .withIndex("by_run", (q) => q.eq("runId", runId))
                    .take(MAX_SOURCES_QUALIFICATION_RECEIPTS + 1);
                if (receipts.length > MAX_SOURCES_QUALIFICATION_RECEIPTS)
                    throw new Error("Campaign receipt capacity exceeded");
                for (const call of receipts) {
                    if (
                        call.status === "started" ||
                        preparationFailureClass(call) === "unknown" ||
                        (call.reportedCost ?? 0) >
                            (call.qualificationReservationUsd ?? 0)
                    )
                        return { reconciled: false, usage: lot.allocation };
                    const category = qualificationCategory(call);
                    if (category !== "technical") usage[category]++;
                    usage.costUsd += Math.max(
                        call.qualificationReservationUsd ?? 0,
                        call.reportedCost ?? 0,
                    );
                }
            }
        }
        const allocated = { ...campaign.allocated };
        for (const key of keys) {
            if (usage[key] > lot.allocation[key] + 1e-10)
                throw new Error("Campaign usage exceeds reservation");
            allocated[key] += usage[key] - lot.allocation[key];
        }
        await ctx.db.patch(lot._id, { status: "review", allocation: usage });
        await ctx.db.patch(campaign._id, { allocated });
        return { reconciled: true, usage };
    },
});
export const assess = internalMutation({
    args: {
        lotId: v.id("qualificationLots"),
        assessmentHash: v.string(),
        verdict: v.union(
            v.literal("passed"),
            v.literal("failed"),
            v.literal("inconclusive"),
        ),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const lot = await ctx.db.get(args.lotId);
        if (!lot || !/^[a-f0-9]{64}$/.test(args.assessmentHash))
            throw new Error("Invalid campaign assessment");
        const campaign = await owned(ctx, lot.campaignId);
        if (lot.status === "finished") {
            if (
                lot.assessmentHash !== args.assessmentHash ||
                lot.verdict !== args.verdict
            )
                throw new Error("Campaign assessment conflict");
            return null;
        }
        if (lot.status !== "review")
            throw new Error("Campaign reconciliation required");
        await ctx.db.patch(lot._id, {
            status: "finished",
            assessmentHash: args.assessmentHash,
            verdict: args.verdict,
        });
        if (lot.configurationId) {
            const configurationId = lot.configurationId;
            const coverage = await ctx.db
                .query("qualificationCoverage")
                .withIndex("by_campaign_and_candidate_and_configuration", (q) =>
                    q
                        .eq("campaignId", campaign._id)
                        .eq("candidateHash", lot.candidateHash)
                        .eq("configurationId", configurationId),
                )
                .unique();
            if (!coverage) throw new Error("Campaign coverage unavailable");
            await ctx.db.patch(coverage._id, {
                passed: args.verdict === "passed",
            });
        }
        if (campaign.activeLotId === lot._id)
            await ctx.db.patch(campaign._id, { activeLotId: undefined });
        return null;
    },
});
export const inspect = internalQuery({
    args: {
        campaignId: v.id("qualificationCampaigns"),
        paginationOpts: v.optional(paginationOptsValidator),
    },
    returns: v.object({
        campaign: schema.doc("qualificationCampaigns"),
        lots: v.array(schema.doc("qualificationLots")),
        continueCursor: v.union(v.string(), v.null()),
        coverage: v.array(schema.doc("qualificationCoverage")),
    }),
    handler: async (ctx, args) => {
        const campaign = await owned(ctx, args.campaignId);
        const query = ctx.db
            .query("qualificationLots")
            .withIndex("by_campaign", (q) => q.eq("campaignId", campaign._id));
        const page =
            campaign.manifest.version !== 1
                ? await query.order("desc").paginate(
                      args.paginationOpts ?? {
                          numItems:
                              PERSISTENCE_PAGE_SIZE.qualificationAccounting,
                          cursor: null,
                      },
                  )
                : null;
        const lots = page
            ? page.page.reverse()
            : await query.take(campaign.manifest.maximumLots + 1);
        const candidateHash = campaign.lastCandidateHash;
        const coverage =
            campaign.manifest.version !== 1 && candidateHash
                ? (
                      await Promise.all(
                          campaign.manifest.configurations.map((c) =>
                              ctx.db
                                  .query("qualificationCoverage")
                                  .withIndex(
                                      "by_campaign_and_candidate_and_configuration",
                                      (q) =>
                                          q
                                              .eq("campaignId", campaign._id)
                                              .eq(
                                                  "candidateHash",
                                                  candidateHash,
                                              )
                                              .eq("configurationId", c.id),
                                  )
                                  .unique(),
                          ),
                      )
                  ).flatMap((c) => (c ? [c] : []))
                : [];
        return {
            campaign,
            lots,
            continueCursor: page && !page.isDone ? page.continueCursor : null,
            coverage,
        };
    },
});
export const close = internalMutation({
    args: { campaignId: v.id("qualificationCampaigns") },
    returns: v.null(),
    handler: async (ctx, args) => {
        const campaign = await owned(ctx, args.campaignId);
        await ctx.db.patch(campaign._id, { status: "closed" });
        return null;
    },
});

/** Revokes dispatch before browser or evidence cleanup can fail. */
export const beginCleanup = internalMutation({
    args: { lotId: v.id("qualificationLots") },
    returns: v.null(),
    handler: async (ctx, { lotId }) => {
        const lot = await ctx.db.get(lotId);
        if (!lot) throw new Error("Campaign lot unavailable");
        await owned(ctx, lot.campaignId);
        if (lot.status === "running")
            await ctx.db.patch(lotId, { status: "closing" });
        return null;
    },
});
