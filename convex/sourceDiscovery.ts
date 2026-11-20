import { internal } from "@convex/_generated/api";
import { stableStringify } from "@convex/domain/sourcePassages";
import {
    readSourcesReplay,
    sourcesReplayCandidates,
} from "@convex/qualificationSourceReplay";
import { patchQualificationReceipt } from "@convex/qualificationUsage";
import {
    simulatedSourceCandidate,
    sourcesSimulationEnabled,
} from "@convex/sourcesSimulation";
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { readSourceCandidateCapacity } from "./domain/sourceCandidateCapacity";
import { supplementalSearchOperationKey } from "./domain/sourceDiscoveryRecovery";
import {
    assertPreparationExecutionFence,
    sourcePreparationError,
} from "./domain/sourcePreparationAuthority";
import { upsertSourceReviewItem } from "./domain/sourceReviewProjection";
import {
    MAX_SUPPLEMENT_CANDIDATES,
    MAX_SUPPLEMENT_SEARCHES,
} from "./resourcePolicy";

const candidateValidator = v.object({
    canonicalUrl: v.string(),
    title: v.string(),
    origin: v.union(v.literal("sec"), v.literal("exa")),
    category: v.string(),
    publishedAt: v.optional(v.number()),
    providerReference: v.optional(v.string()),
    secForm: v.optional(v.string()),
    secAccessionNumber: v.optional(v.string()),
    providerResultPosition: v.optional(v.number()),
    discoveryQueryIndex: v.optional(v.number()),
});

export const persistCandidates = internalMutation({
    args: {
        runId: v.id("researchRuns"),
        corpusRevisionId: v.id("corpusRevisions"),
        preparationId: v.optional(v.id("sourceSelectionProposalRebuilds")),
        executionGeneration: v.number(),
        operationKey: v.string(),
        candidates: v.array(candidateValidator),
        providerCompletion: v.optional(
            v.object({
                providerCallId: v.id("providerCalls"),
                status: v.union(v.literal("succeeded"), v.literal("partial")),
                latencyMs: v.number(),
                accepted: v.number(),
                rejected: v.number(),
                searchTime: v.optional(v.number()),
                reportedCost: v.optional(v.number()),
            }),
        ),
    },
    returns: v.object({ inserted: v.number(), total: v.number() }),
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        const revision = await ctx.db.get(args.corpusRevisionId);
        if (
            !run ||
            run.executionGeneration !== args.executionGeneration ||
            run.executionStatus !== "running" ||
            (!args.preparationId &&
                run.lifecycleState !== "discovering_sources") ||
            run.activeCorpusRevisionId !== args.corpusRevisionId ||
            revision?.runId !== run._id ||
            revision.status !== "draft"
        ) {
            throw new Error("Research execution is no longer active");
        }

        const preparationState = args.preparationId
            ? await assertPreparationExecutionFence(ctx.db, {
                  preparationId: args.preparationId,
                  now: Date.now(),
              })
            : null;
        const supplement =
            preparationState && run.automaticSupplementOperationId
                ? await ctx.db.get(run.automaticSupplementOperationId)
                : null;
        let recoveredFamily: string | undefined;
        if (preparationState && !preparationState.preparation.sourcesMission) {
            const call = args.providerCompletion
                ? await ctx.db.get(args.providerCompletion.providerCallId)
                : null;
            const queryIndex =
                supplement?.supplementQueries?.findIndex(
                    (_, index) =>
                        call?.operationKey ===
                        supplementalSearchOperationKey(
                            supplement._id,
                            index,
                            call?.attempt,
                        ),
                ) ?? -1;
            if (
                preparationState.run._id !== run._id ||
                supplement?.runId !== run._id ||
                queryIndex < 0 ||
                queryIndex >= MAX_SUPPLEMENT_SEARCHES ||
                !supplement.supplementClaimedQueryIndexes?.includes(
                    queryIndex,
                ) ||
                call?.runId !== run._id ||
                call.preparationId !== args.preparationId ||
                call.corpusRevisionId !== revision._id ||
                call.executionGeneration !== args.executionGeneration ||
                call.service !==
                    (supplement.supplementQueries?.[queryIndex]
                        ?.discoveryIntent === "regulatory"
                        ? "sec"
                        : "exa") ||
                call.operation !== "source_supplement_search" ||
                call.operationKey !== args.operationKey ||
                call.attempt > 2 ||
                (supplement.supplementClaimedQueryIndexes?.filter(
                    (index) => index === queryIndex,
                ).length ?? 0) < call.attempt ||
                call.status !== "started" ||
                args.candidates.length > 4
            )
                throw sourcePreparationError("supplement_result_invalid");
            if (args.providerCompletion?.status === "succeeded")
                recoveredFamily =
                    supplement.supplementQueries?.[queryIndex]?.discoveryIntent;
        }
        const replay = preparationState?.preparation.sourcesMission
            ? await readSourcesReplay(ctx, run._id)
            : null;
        if (
            preparationState?.preparation.sourcesMission &&
            (replay || (await sourcesSimulationEnabled(ctx, run._id)))
        ) {
            const work = preparationState.preparation.sourcesMission.work.find(
                (w) =>
                    w.kind === "discover_sources_for_need" &&
                    args.operationKey === `sources:${w.requestId}:search`,
            );
            if (
                !work ||
                args.providerCompletion ||
                stableStringify(args.candidates) !==
                    stableStringify(
                        (replay
                            ? sourcesReplayCandidates(replay).slice(
                                  0,
                                  args.candidates.length,
                              )
                            : [simulatedSourceCandidate(run._id)]
                        ).map((candidate) => ({
                            ...candidate,
                            origin: "exa",
                            category: "research_lead",
                        })),
                    ) ||
                (replay &&
                    (args.candidates.length === 0 ||
                        args.candidates.length > replay.documents.length))
            )
                throw sourcePreparationError("discovery_result_invalid");
            await ctx.runQuery(internal.sourcesMission.assertActive, {
                requestId: work.requestId,
                expectedGeneration: args.executionGeneration,
            });
        } else if (preparationState?.preparation.sourcesMission) {
            const call = args.providerCompletion
                ? await ctx.db.get(args.providerCompletion.providerCallId)
                : null;
            if (
                !call ||
                call.runId !== run._id ||
                call.preparationId !== args.preparationId ||
                call.executionGeneration !== args.executionGeneration ||
                call.operation !== "source_need_search" ||
                call.operationKey !== args.operationKey ||
                !(
                    call.status === "started" ||
                    (call.status === "succeeded" &&
                        call.dispatchOutcome === "response_received")
                )
            )
                throw sourcePreparationError("discovery_result_invalid");
        }
        const capacity = await readSourceCandidateCapacity(
            ctx.db,
            run._id,
            preparationState &&
                preparationState.preparation.sourcesMission?.phase !== "initial"
                ? "dossier"
                : "initial_discovery",
        );
        const remaining = supplement
            ? Math.min(
                  capacity.remaining,
                  MAX_SUPPLEMENT_CANDIDATES -
                      (supplement.supplementSourceIds?.length ?? 0),
              )
            : capacity.remaining;
        const insertedIds = [];
        let inserted = 0;
        const seen = new Set<string>();
        const now = Date.now();
        for (const candidate of args.candidates) {
            if (inserted >= remaining) {
                break;
            }
            if (seen.has(candidate.canonicalUrl)) {
                continue;
            }
            seen.add(candidate.canonicalUrl);
            const existing = await ctx.db
                .query("sources")
                .withIndex("by_run_and_url", (query) =>
                    query
                        .eq("runId", run._id)
                        .eq("canonicalUrl", candidate.canonicalUrl),
                )
                .unique();
            if (existing) {
                continue;
            }
            const sourceId = await ctx.db.insert("sources", {
                runId: run._id,
                ...candidate,
                ...(preparationState?.preparation.target
                    ? { reviewSearchId: preparationState.preparation._id }
                    : {}),
                createdAt: now,
            });
            insertedIds.push(sourceId);
            const decisionId = await ctx.db.insert("sourceDecisions", {
                runId: run._id,
                corpusRevisionId: revision._id,
                sourceId,
                decisionKey: `${args.operationKey}:${candidate.canonicalUrl}`,
                decision: "pending",
                occurredAt: now,
            });
            await upsertSourceReviewItem(ctx, {
                runId: run._id,
                corpusRevisionId: revision._id,
                sourceId,
                decision: "pending",
                sourceCreatedAt: now,
                latestDecisionId: decisionId,
                decisionOccurredAt: now,
            });
            inserted += 1;
        }
        const total = capacity.total + inserted;
        if (supplement)
            await ctx.db.patch(supplement._id, {
                supplementSourceIds: [
                    ...(supplement.supplementSourceIds ?? []),
                    ...insertedIds,
                ],
            });
        if (preparationState?.preparation.target) {
            await ctx.db.patch(preparationState.preparation._id, {
                ...(preparationState.preparation.target.kind ===
                    "failed_discovery" && recoveredFamily
                    ? {
                          failedDiscoveryFamilies:
                              preparationState.preparation.failedDiscoveryFamilies.filter(
                                  (family) => family !== recoveredFamily,
                              ),
                      }
                    : {}),
                readingSourceIds: [
                    ...(preparationState.preparation.readingSourceIds ?? []),
                    ...insertedIds,
                ],
                insertedCount:
                    (preparationState.preparation.insertedCount ?? 0) +
                    inserted,
            });
        }
        await ctx.db.patch(run._id, {
            nextEventSequence: run.nextEventSequence + 1,
            updatedAt: now,
        });
        await ctx.db.insert("runEvents", {
            runId: run._id,
            sequence: run.nextEventSequence + 1,
            type: "source_discovery_progress",
            lifecycleState: run.lifecycleState,
            executionStatus: run.executionStatus,
            stepKey: "discover_sources",
            messageKey: "source_candidates_persisted",
            current: total,
            occurredAt: now,
        });
        if (args.providerCompletion) {
            const providerCall = await ctx.db.get(
                args.providerCompletion.providerCallId,
            );
            if (
                !providerCall ||
                providerCall.runId !== run._id ||
                providerCall.executionGeneration !== args.executionGeneration ||
                !(
                    providerCall.status === "started" ||
                    (args.preparationId &&
                        providerCall.operation === "source_need_search" &&
                        providerCall.status === "succeeded" &&
                        providerCall.dispatchOutcome === "response_received")
                )
            ) {
                throw new Error("Provider attempt cannot be completed");
            }
            await patchQualificationReceipt(ctx, providerCall, {
                status: args.providerCompletion.status,
                dispatchOutcome: "response_received",
                latencyMs: args.providerCompletion.latencyMs,
                usage: {
                    accepted: args.providerCompletion.accepted,
                    rejected: args.providerCompletion.rejected,
                    searchTime: args.providerCompletion.searchTime,
                },
                reportedCost: args.providerCompletion.reportedCost,
                completedAt: now,
            });
        }
        return { inserted, total };
    },
});

export const countCandidates = internalQuery({
    args: {
        runId: v.id("researchRuns"),
        executionGeneration: v.number(),
    },
    returns: v.object({ total: v.number() }),
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        if (
            !run ||
            run.executionGeneration !== args.executionGeneration ||
            run.executionStatus !== "running" ||
            run.lifecycleState !== "discovering_sources"
        ) {
            throw new Error("Research execution is no longer active");
        }
        const capacity = await readSourceCandidateCapacity(
            ctx.db,
            run._id,
            "initial_discovery",
        );
        return { total: capacity.total };
    },
});

export const getCandidateCapacity = internalQuery({
    args: {
        runId: v.id("researchRuns"),
        executionGeneration: v.number(),
    },
    returns: v.object({
        limit: v.number(),
        total: v.number(),
        remaining: v.number(),
    }),
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        if (
            !run ||
            run.executionGeneration !== args.executionGeneration ||
            run.executionStatus !== "running" ||
            run.lifecycleState !== "discovering_sources"
        ) {
            throw new Error("Research execution is no longer active");
        }
        return readSourceCandidateCapacity(
            ctx.db,
            run._id,
            "initial_discovery",
        );
    },
});

export const isExecutionActive = internalQuery({
    args: {
        runId: v.id("researchRuns"),
        executionGeneration: v.number(),
    },
    returns: v.boolean(),
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        return (
            run?.executionGeneration === args.executionGeneration &&
            run.executionStatus === "running" &&
            run.lifecycleState === "discovering_sources"
        );
    },
});
