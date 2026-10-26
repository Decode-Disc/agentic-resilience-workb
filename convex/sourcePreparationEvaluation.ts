import { vWorkflowStep } from "@convex-dev/workflow";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { sourcePreparationExecutionPlanValidator } from "./domain/sourcePreparationAuthority";
import { SOURCE_QUALIFICATION_VERSION } from "./domain/sourceQualification";
import {
    MAX_HISTORICAL_SOURCE_CANDIDATES,
    SOURCE_PREPARATION_DEADLINE_MS,
} from "./resourceLimits";
import { assertLocalFixture } from "./retrievalEvaluation";
import schema from "./schema";
import {
    PREPARATION_STUDY_MAX_ATTEMPTS,
    PREPARATION_STUDY_MAX_RESERVATION_USD,
    preparationStudyEnvelopeValidator,
    qualificationNeedsStudyComparison,
    validatePreparationStudyEnvelope,
} from "./sourcePreparationStudyPolicy";

export {
    PREPARATION_STUDY_MAX_ATTEMPTS,
    PREPARATION_STUDY_MAX_RESERVATION_USD,
} from "./sourcePreparationStudyPolicy";

import { workflow } from "./workflow";

/** Native preparation experiments reuse admitted local fixtures; none of these operations fetch sources. */
export const seed = internalMutation({
    args: {
        envelope: v.optional(preparationStudyEnvelopeValidator),
        slotKey: v.string(),
        fixtureKey: v.string(),
        sourceRunId: v.id("researchRuns"),
        manifestSha256: v.string(),
        phase: v.union(
            v.literal("replay"),
            v.literal("reading"),
            v.literal("comparison"),
        ),
        concurrency: v.number(),
        executionPlanVersion: sourcePreparationExecutionPlanValidator,
        qualificationReferencePreparationId: v.optional(
            v.id("sourceSelectionProposalRebuilds"),
        ),
    },
    returns: v.object({
        runId: v.id("researchRuns"),
        preparationId: v.id("sourceSelectionProposalRebuilds"),
    }),
    handler: async (
        ctx,
        args,
    ): Promise<{
        runId: Id<"researchRuns">;
        preparationId: Id<"sourceSelectionProposalRebuilds">;
    }> => {
        if (
            !/^[a-f0-9]{64}$/.test(args.manifestSha256) ||
            !Number.isSafeInteger(args.concurrency) ||
            args.concurrency < 1
        )
            throw new Error("Invalid preparation study");
        if (args.envelope) {
            const condition = validatePreparationStudyEnvelope(args.envelope);
            if (condition.phase !== args.phase)
                throw new Error("Frozen study phase mismatch");
        }
        const original = await ctx.db.get(args.sourceRunId);
        const company = original?.companyId
            ? await ctx.db.get(original.companyId)
            : null;
        if (!original || !company)
            throw new Error("Frozen source dossier missing");
        if (args.qualificationReferencePreparationId) {
            const reference = await ctx.db.get(
                args.qualificationReferencePreparationId,
            );
            const referenceRun = reference
                ? await ctx.db.get(reference.runId)
                : null;
            if (
                args.phase !== "comparison" ||
                reference?.status !== "complete" ||
                reference.preparationStudy?.phase !== "reading" ||
                reference.preparationStudy.sourceRunId !== original._id ||
                referenceRun?.ownerVisitorId !== original.ownerVisitorId ||
                !reference.sourceOutcomes?.length ||
                reference.sourceOutcomes.some(
                    (outcome) => outcome.result.status !== "qualified",
                )
            ) {
                throw new Error("Completed owned reading study required");
            }
        }
        const seeded = await ctx.runMutation(
            internal.retrievalEvaluation.seed,
            {
                slotKey: args.slotKey,
                fixtureKey: args.fixtureKey,
                company: {
                    cik: company.cik,
                    legalName: company.legalName,
                    ticker: company.ticker,
                },
            },
        );
        const run = await ctx.db.get(seeded.runId);
        if (
            !run ||
            run.ownerVisitorId !== original.ownerVisitorId ||
            original.reservationKey?.startsWith("retrieval-evaluation:")
        )
            throw new Error("Owned original dossier required");
        const p = await ctx.db.get(seeded.preparationId);
        if (!p) throw new Error("Missing study preparation");
        const study = {
            envelope: args.envelope,
            manifestSha256: args.manifestSha256,
            sourceRunId: original._id,
            phase: args.phase,
            qualificationReferencePreparationId:
                args.qualificationReferencePreparationId,
        };
        if (p.preparationStudy) {
            if (
                JSON.stringify(p.preparationStudy.envelope) !==
                    JSON.stringify(study.envelope) ||
                p.preparationStudy.manifestSha256 !== study.manifestSha256 ||
                p.preparationStudy.sourceRunId !== study.sourceRunId ||
                p.preparationStudy.phase !== study.phase ||
                p.preparationStudy.qualificationReferencePreparationId !==
                    study.qualificationReferencePreparationId ||
                p.maxConcurrentSources !== args.concurrency ||
                p.executionPlanVersion !== args.executionPlanVersion
            )
                throw new Error("Frozen preparation study changed");
            return seeded;
        }
        const oldPreparation = original.sourcePreparationId
            ? await ctx.db.get(original.sourcePreparationId)
            : null;
        await ctx.db.patch(run._id, {
            companySnapshot: original.companySnapshot,
            researchAngle: original.researchAngle,
            coveragePreset: original.coveragePreset,
            lifecycleState: "awaiting_source_review",
        });
        const allowance = args.envelope
            ? validatePreparationStudyEnvelope(args.envelope).modelSources
            : args.phase === "replay"
              ? 0
              : args.phase === "reading" ||
                  args.qualificationReferencePreparationId
                ? 24
                : 8;
        await ctx.db.patch(p._id, {
            preparationStudy: study,
            maxConcurrentSources: args.concurrency,
            entryPoint: "source_review",
            executionPlanVersion: args.executionPlanVersion,
            asOfTime: oldPreparation?.asOfTime ?? original.createdAt,
            modelLimits: { work: allowance, incidents: allowance },
            manualSourceIds: [],
            comparisonVersion:
                args.phase === "comparison" ? p.comparisonVersion : undefined,
        });
        return seeded;
    },
});

/** Copies one frozen capture at a time to keep original dossiers and transaction budgets intact. */
export const copySource = internalMutation({
    args: {
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        sourceId: v.id("sources"),
        qualificationTaskId: v.optional(v.id("aiTaskResults")),
        expectedContentHash: v.string(),
        replayInputHash: v.optional(v.string()),
        fixtureIndex: v.optional(v.number()),
    },
    returns: v.object({
        sourceId: v.id("sources"),
        captureId: v.id("sourceCaptures"),
        taskId: v.optional(v.id("aiTaskResults")),
    }),
    handler: async (
        ctx,
        args,
    ): Promise<{
        sourceId: Id<"sources">;
        captureId: Id<"sourceCaptures">;
        taskId?: Id<"aiTaskResults">;
    }> => {
        const p = await ctx.runQuery(internal.retrievalEvaluation.authorize, {
            preparationId: args.preparationId,
        });
        if (!p.preparationStudy || p.workflowId)
            throw new Error("Study is not awaiting frozen inputs");
        const source = await ctx.db.get(args.sourceId);
        if (!source || source.runId !== p.preparationStudy.sourceRunId)
            throw new Error("Source outside frozen dossier");
        const requestedTask = args.qualificationTaskId
            ? await ctx.db.get(args.qualificationTaskId)
            : null;
        const referenceId =
            p.preparationStudy.qualificationReferencePreparationId;
        const reference = referenceId ? await ctx.db.get(referenceId) : null;
        const referenceOutcome = reference?.sourceOutcomes?.find(
            (outcome) =>
                outcome.result.status === "qualified" &&
                outcome.result.taskId === args.qualificationTaskId,
        );
        const referenceSource = referenceOutcome
            ? await ctx.db.get(referenceOutcome.sourceId)
            : null;
        const referenceCapture =
            referenceOutcome?.result.status === "qualified"
                ? await ctx.db.get(referenceOutcome.result.sourceCaptureId)
                : null;
        if (
            referenceId &&
            (reference?.status !== "complete" ||
                !referenceOutcome ||
                referenceSource?.canonicalUrl !== source.canonicalUrl ||
                referenceSource.runId !== reference.runId ||
                referenceCapture?.status !== "committed" ||
                referenceCapture.runId !== reference.runId ||
                referenceCapture.corpusRevisionId !==
                    reference.corpusRevisionId ||
                referenceCapture.sourceId !== referenceSource._id ||
                referenceCapture.contentHash !== args.expectedContentHash ||
                requestedTask?.corpusRevisionId !==
                    reference.corpusRevisionId ||
                requestedTask?.schemaVersion !== SOURCE_QUALIFICATION_VERSION)
        ) {
            throw new Error("Frozen qualification mismatch");
        }
        const title =
            args.fixtureIndex === undefined
                ? source.title
                : `${source.title} [replay ${args.fixtureIndex}]`;
        const priorSources = await ctx.db
            .query("sources")
            .withIndex("by_run_and_url", (q) =>
                q.eq("runId", p.runId).eq("canonicalUrl", source.canonicalUrl),
            )
            .take(MAX_HISTORICAL_SOURCE_CANDIDATES + 1);
        const priorSource = priorSources.find((s) => s.title === title);
        if (priorSource) {
            const priorCapture = await ctx.db
                .query("sourceCaptures")
                .withIndex("by_preparation_and_source", (q) =>
                    q
                        .eq("preparationId", p._id)
                        .eq("sourceId", priorSource._id),
                )
                .unique();
            const task = await ctx.db
                .query("aiTaskResults")
                .withIndex("by_source_and_task_type_and_created_at", (q) =>
                    q
                        .eq("sourceId", priorSource._id)
                        .eq("taskType", "source_qualification"),
                )
                .first();
            if (
                !priorCapture ||
                priorCapture.contentHash !== args.expectedContentHash ||
                (args.replayInputHash &&
                    task?.inputHash !== args.replayInputHash) ||
                Boolean(task) !== Boolean(args.qualificationTaskId)
            )
                throw new Error("Frozen copy changed");
            return {
                sourceId: priorSource._id,
                captureId: priorCapture._id,
                ...(task ? { taskId: task._id } : {}),
            };
        }
        const candidates = await ctx.db
            .query("sourceCaptures")
            .withIndex("by_preparation_and_source", (q) =>
                q.eq("preparationId", p._id),
            )
            .take(MAX_HISTORICAL_SOURCE_CANDIDATES + 1);
        if (candidates.length >= MAX_HISTORICAL_SOURCE_CANDIDATES)
            throw new Error("Study source limit reached");
        const original = await ctx.db
            .query("sourceCaptures")
            .withIndex("by_source_and_input_hash_and_status", (q) =>
                q.eq("sourceId", source._id),
            )
            .take(MAX_HISTORICAL_SOURCE_CANDIDATES + 1);
        const capture = original.find(
            (c) => c.status === "committed" && c.storageId && c.contentHash,
        );
        if (!capture?.storageId || !capture.contentHash)
            throw new Error("Frozen capture unavailable");
        if (capture.contentHash !== args.expectedContentHash)
            throw new Error("Frozen capture changed");
        if (args.replayInputHash && p.preparationStudy.phase !== "replay")
            throw new Error("Replay hashes are offline-only");
        if (
            args.fixtureIndex !== undefined &&
            (p.preparationStudy.phase !== "replay" ||
                !Number.isSafeInteger(args.fixtureIndex) ||
                args.fixtureIndex < 0)
        )
            throw new Error("Synthetic copies are replay-only");
        const {
            _id: _sourceId,
            _creationTime: _sourceTime,
            ...metadata
        } = source;
        const newSourceId = await ctx.db.insert("sources", {
            ...metadata,
            runId: p.runId,
            title,
        });
        await ctx.db.patch(p._id, {
            manualSourceIds: [...(p.manualSourceIds ?? []), newSourceId],
        });
        const reserved = await ctx.runMutation(
            internal.sourceCaptures.reserveUpload,
            { preparationId: p._id, sourceId: newSourceId },
        );
        await ctx.runMutation(internal.sourceCaptures.attachStorage, {
            preparationId: p._id,
            captureId: reserved.capture._id,
            storageId: capture.storageId,
        });
        await ctx.runMutation(internal.sourceCaptures.finalize, {
            preparationId: p._id,
            captureId: reserved.capture._id,
            contentHash: capture.contentHash,
            byteCount: capture.byteCount ?? 0,
            resolvedUrl: capture.resolvedUrl ?? source.canonicalUrl,
            retrievalVersion: capture.retrievalVersion ?? "frozen-capture",
            normalizerVersion: reserved.capture.normalizerVersion,
            retrievedAt: capture.retrievedAt ?? capture.createdAt,
            readingCompleteness: capture.readingCompleteness ?? "partial",
            omittedPassageCount: capture.omittedPassageCount ?? 0,
        });
        await ctx.db.patch(reserved.capture._id, {
            qualificationInputPolicy: capture.qualificationInputPolicy,
        });
        let taskId: Id<"aiTaskResults"> | undefined;
        if (args.qualificationTaskId) {
            if (p.preparationStudy.phase === "reading")
                throw new Error("Reading study cannot import qualifications");
            const task = requestedTask;
            if (
                task?.runId !== (reference?.runId ?? source.runId) ||
                task.sourceId !== (referenceSource?._id ?? source._id) ||
                task.sourceCaptureId !==
                    (referenceOutcome?.result.status === "qualified"
                        ? referenceOutcome.result.sourceCaptureId
                        : capture._id) ||
                task.output.kind !== "source_qualification" ||
                task.output.contentHash !== capture.contentHash
            )
                throw new Error("Frozen qualification mismatch");
            const {
                _id: _taskId,
                _creationTime: _taskTime,
                ...taskMetadata
            } = task;
            taskId = await ctx.db.insert("aiTaskResults", {
                ...taskMetadata,
                runId: p.runId,
                corpusRevisionId: p.corpusRevisionId,
                sourceId: newSourceId,
                sourceCaptureId: reserved.capture._id,
                executionMode: "showcase",
                inputHash: args.replayInputHash ?? task.inputHash,
                output: {
                    ...task.output,
                    sourceCaptureId: reserved.capture._id,
                },
            });
            if (p.preparationStudy.phase === "comparison")
                await ctx.db.patch(p._id, {
                    sourceOutcomes: [
                        ...(p.sourceOutcomes ?? []),
                        {
                            sourceId: newSourceId,
                            result: {
                                status: "qualified",
                                sourceCaptureId: reserved.capture._id,
                                taskId,
                            },
                        },
                    ],
                });
        } else if (p.preparationStudy.phase !== "reading")
            throw new Error("Frozen qualification required");
        return {
            sourceId: newSourceId,
            captureId: reserved.capture._id,
            ...(taskId ? { taskId } : {}),
        };
    },
});

export const start = internalMutation({
    args: {
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        manifestSha256: v.string(),
        approval: v.optional(
            v.object({
                manifestSha256: v.string(),
                maximumAttempts: v.number(),
                budgetUsd: v.number(),
                approvedAt: v.string(),
            }),
        ),
    },
    returns: v.string(),
    handler: async (ctx, args): Promise<string> => {
        const p = await ctx.runQuery(internal.retrievalEvaluation.authorize, {
            preparationId: args.preparationId,
        });
        const study = p.preparationStudy;
        if (!study || study.manifestSha256 !== args.manifestSha256)
            throw new Error("Study manifest mismatch");
        if (p.workflowId) return p.workflowId;
        if (!p.manualSourceIds?.length)
            throw new Error("Missing frozen study sources");
        if (study.phase !== "replay") {
            const grant = args.approval;
            if (
                !grant ||
                grant.manifestSha256 !== study.manifestSha256 ||
                grant.maximumAttempts !==
                    (study.envelope?.maximumAttempts ??
                        PREPARATION_STUDY_MAX_ATTEMPTS) ||
                !Number.isFinite(grant.budgetUsd) ||
                grant.budgetUsd <
                    (study.envelope?.maximumReservationUsd ??
                        PREPARATION_STUDY_MAX_RESERVATION_USD) ||
                !Number.isFinite(Date.parse(grant.approvedAt))
            )
                throw new Error("Explicit study authorization required");
            if (p.manualSourceIds.length !== 24)
                throw new Error(
                    "Paid study requires the exact 24-source corpus",
                );
        }
        const now = Date.now();
        if (
            study.phase === "comparison" &&
            study.qualificationReferencePreparationId
        ) {
            const targets = await ctx.runQuery(
                internal.sourcePreparation.comparisonTargets,
                {
                    preparationId: p._id,
                    now,
                },
            );
            if (!targets.length)
                throw new Error("Frozen study has no comparison targets");
            if (targets.length > 24)
                throw new Error("Frozen comparison target limit exceeded");
            await ctx.db.patch(p._id, {
                modelLimits: {
                    work: targets.length,
                    incidents: targets.length,
                },
            });
        }
        if (study.envelope) {
            const condition = validatePreparationStudyEnvelope(study.envelope);
            let actualSources =
                study.phase === "reading" ? p.manualSourceIds.length : 0;
            if (study.phase === "comparison") {
                for (const outcome of p.sourceOutcomes ?? []) {
                    if (outcome.result.status !== "qualified")
                        throw new Error("Frozen qualification missing");
                    const task = await ctx.db.get(outcome.result.taskId);
                    if (task?.output.kind !== "source_qualification")
                        throw new Error("Frozen qualification missing");
                    if (
                        qualificationNeedsStudyComparison(
                            task.output.qualification,
                            task.schemaVersion,
                        )
                    )
                        actualSources++;
                }
            }
            if (
                condition.phase !== study.phase ||
                actualSources !== condition.modelSources
            )
                throw new Error("Frozen model source count mismatch");
            await ctx.db.patch(p._id, {
                modelLimits: { work: actualSources, incidents: actualSources },
            });
        }
        await ctx.db.patch(p._id, {
            deadlineAt: now + SOURCE_PREPARATION_DEADLINE_MS,
            leaseExpiresAt: now + SOURCE_PREPARATION_DEADLINE_MS,
        });
        const handle = await workflow.start(
            ctx,
            internal.sourcePreparationWorkflow.run,
            { preparationId: p._id },
            {
                onComplete: internal.sourcePreparationWorkflow.onComplete,
                context: { preparationId: p._id },
            },
        );
        await ctx.db.patch(p._id, {
            workflowId: handle,
            preparationStudy: { ...study, workflowId: handle },
        });
        return handle;
    },
});

export const inspect = internalQuery({
    args: {
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        details: v.optional(v.boolean()),
    },
    returns: v.object({
        preparation: schema.doc("sourceSelectionProposalRebuilds"),
        run: schema.doc("researchRuns"),
        steps: v.array(vWorkflowStep),
        calls: v.array(schema.doc("providerCalls")),
        tasks: v.array(schema.doc("aiTaskResults")),
    }),
    handler: async (ctx, args) => {
        // authorize also requires an active lease; completed studies need only the same local gate.
        const p = await ctx.db.get(args.preparationId);
        if (!p?.preparationStudy) throw new Error("Preparation study missing");
        const run = await ctx.db.get(p.runId);
        if (!run) throw new Error("Study dossier missing");
        assertLocalFixture();
        if (args.details === false)
            return { preparation: p, run, steps: [], calls: [], tasks: [] };
        const handle = p.preparationStudy.workflowId;
        const steps = handle
            ? (
                  await workflow.listSteps(ctx, handle, {
                      paginationOpts: { cursor: null, numItems: 1000 },
                  })
              ).page
            : [];
        return {
            preparation: p,
            run,
            steps,
            calls: await ctx.db
                .query("providerCalls")
                .withIndex("by_run", (q) => q.eq("runId", p.runId))
                .take(129),
            tasks: await ctx.db
                .query("aiTaskResults")
                .withIndex("by_run_and_task_type_and_input_hash", (q) =>
                    q.eq("runId", p.runId),
                )
                .take(121),
        };
    },
});
