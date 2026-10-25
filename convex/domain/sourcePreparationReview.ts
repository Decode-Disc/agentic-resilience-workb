import type { DataModel, Doc, Id } from "@convex/_generated/dataModel";
import {
    MAX_HISTORICAL_SOURCE_CANDIDATES,
    MAX_SUPPLEMENT_SEARCHES,
} from "@convex/resourceLimits";
import type { GenericDatabaseReader } from "convex/server";
import { type Infer, v } from "convex/values";
import { readSourceCandidateCapacity } from "./sourceCandidateCapacity";
import {
    SOURCE_COMPARISON_VERSION,
    sourceFindingNeedsComparison,
} from "./sourceComparison";
import {
    comparisonContextForTarget,
    readComparisonPrimaryContext,
    sourceComparisonWork,
} from "./sourceComparisonContext";
import { readSupplementalSearchAttempts } from "./sourceDiscoveryRecovery";
import {
    nextPreparationAttempt,
    preparationBudgetBlock,
    preparationFailureCode,
    readPreparationBudget,
    readPreparationConcurrency,
    readPreparationLimits,
    sourcePreparationError,
    type sourcePreparationOutcomeValidator,
} from "./sourcePreparationAuthority";
import { SourceReviewReads } from "./sourceReviewReads";
import { classifySourceCandidate } from "./sourceSelectionPolicy";
import {
    readPinnedComparisonReview,
    readPinnedSourceQualification,
} from "./sourceUsage";

export const sourceReadingStatusValidator = v.union(
    v.literal("not_started"),
    v.literal("preparing"),
    v.literal("assessment_unavailable"),
    v.literal("reading_failed"),
    v.literal("complete"),
    v.literal("partial"),
);

/** Reads operation history once for a review projection; targeted searches do not replace earlier results. */
export async function readPreparationHistory(
    db: GenericDatabaseReader<DataModel>,
    runId: Id<"researchRuns">,
    corpusRevisionId: Id<"corpusRevisions">,
) {
    const records = await db
        .query("sourceSelectionProposalRebuilds")
        .withIndex("by_revision_and_created_at", (q) =>
            q.eq("corpusRevisionId", corpusRevisionId),
        )
        .order("desc")
        .take(MAX_HISTORICAL_SOURCE_CANDIDATES);
    return records.filter(
        (record) => record.runId === runId && record.kind === "preparation",
    );
}

/** Keeps draft coverage, source cards and the reader on the same validated reading; approved pins stay frozen. */
export async function readSourceReview(
    db: GenericDatabaseReader<DataModel>,
    input: {
        run: Doc<"researchRuns">;
        revision: Doc<"corpusRevisions">;
        source: Doc<"sources">;
        item: Doc<"sourceSelectionProposalItems"> | null;
        preparations: Doc<"sourceSelectionProposalRebuilds">[];
        company: Parameters<typeof classifySourceCandidate>[1];
        reads?: SourceReviewReads;
    },
) {
    const { run, revision, source, item, preparations } = input;
    const reading = preparations.length
        ? await readSourceReading(db, {
              runId: run._id,
              corpusRevisionId: revision._id,
              sourceId: source._id,
              item,
              preparations,
              activePreparationId:
                  run.executionStatus === "running"
                      ? run.sourcePreparationId
                      : undefined,
              approved: revision.status === "approved",
              reads: input.reads,
          })
        : null;
    const pinned = reading
        ? (reading.qualification ?? null)
        : item
          ? await readPinnedSourceQualification(db, item, input.reads)
          : null;
    const comparisonReview =
        item &&
        pinned &&
        item.qualificationTaskId === pinned.qualificationTaskId
            ? await (input.reads?.comparisonReview(item, pinned) ??
                  readPinnedComparisonReview(db, item, pinned))
            : { outcomes: {}, details: {} };
    const classification =
        revision.status === "draft" &&
        pinned &&
        item?.qualificationTaskId !== pinned.qualificationTaskId
            ? classifySourceCandidate(
                  {
                      ...source,
                      sourceId: source._id,
                      requiresAnalystReview:
                          source.reviewSearchId !== undefined,
                      inspection: {
                          status: "qualified",
                          qualification: pinned.qualification,
                          readingCompleteness: pinned.readingCompleteness,
                          comparisonOutcomes: comparisonReview.outcomes,
                      },
                  },
                  input.company,
              )
            : item;
    return { reading, pinned, comparisonReview, classification };
}

/** Separates captured bytes, pinned assessment, and actual reading attempts without granting evidence authority. */
export async function readSourceReading(
    db: GenericDatabaseReader<DataModel>,
    input: {
        runId: Id<"researchRuns">;
        corpusRevisionId: Id<"corpusRevisions">;
        sourceId: Id<"sources">;
        item?: Pick<
            Doc<"sourceSelectionProposalItems">,
            "sourceCaptureId" | "qualificationTaskId" | "inspectionStatus"
        > | null;
        preparations: Doc<"sourceSelectionProposalRebuilds">[];
        activePreparationId?: Id<"sourceSelectionProposalRebuilds">;
        approved?: boolean;
        reads?: SourceReviewReads;
    },
) {
    const outcome = input.preparations
        .flatMap((p) => p.sourceOutcomes ?? [])
        .find((o) => o.sourceId === input.sourceId);
    if (
        outcome?.result.status === "unavailable" &&
        [
            "capture_corrupt",
            "capture_unavailable",
            "capture_identity_changed",
        ].includes(outcome.result.reasonCode)
    )
        return {
            status: "reading_failed" as const,
            captured: false,
            assessed: false,
        };
    let pinned = input.item
        ? await readPinnedSourceQualification(
              db,
              {
                  ...input.item,
                  runId: input.runId,
                  sourceId: input.sourceId,
              },
              input.reads,
          )
        : null;
    if (!pinned && !input.approved && outcome?.result.status === "qualified") {
        pinned = await readPinnedSourceQualification(
            db,
            {
                runId: input.runId,
                sourceId: input.sourceId,
                sourceCaptureId: outcome.result.sourceCaptureId,
                qualificationTaskId: outcome.result.taskId,
            },
            input.reads,
        );
    }
    if (pinned)
        return {
            status:
                pinned.readingCompleteness === "partial"
                    ? ("partial" as const)
                    : ("complete" as const),
            captured: true,
            assessed: true,
            qualification: pinned,
        };
    const capture = input.item?.sourceCaptureId
        ? await (input.reads?.capture(input.item.sourceCaptureId) ??
              db.get(input.item.sourceCaptureId))
        : input.approved
          ? null
          : (input.reads
                ? await input.reads.captureHistory(input.sourceId)
                : await db
                      .query("sourceCaptures")
                      .withIndex("by_source_and_status_and_updated_at", (q) =>
                          q
                              .eq("sourceId", input.sourceId)
                              .eq("status", "committed"),
                      )
                      .order("desc")
                      .take(4)
            ).find(
                (c) =>
                    c.runId === input.runId &&
                    c.corpusRevisionId === input.corpusRevisionId,
            );
    const captured =
        capture?.status === "committed" &&
        capture.runId === input.runId &&
        capture.sourceId === input.sourceId &&
        !!capture.storageId &&
        !!capture.contentHash;

    const active = input.preparations.find(
        (p) => p._id === input.activePreparationId && p.status === "started",
    );
    const scope = active?.readingSourceIds ?? active?.manualSourceIds;
    const inProgress =
        !!active &&
        (!scope || scope.includes(input.sourceId)) &&
        !active.sourceOutcomes?.some((o) => o.sourceId === input.sourceId);
    if (inProgress)
        return {
            status: "preparing" as const,
            captured: Boolean(captured),
            assessed: false,
        };
    if (captured)
        return {
            status: "assessment_unavailable" as const,
            captured: true,
            assessed: false,
        };
    if (
        !input.item?.sourceCaptureId &&
        outcome?.result.status === "unavailable" &&
        (outcome.result.reasonCode === "missing_configuration" ||
            outcome.result.reasonCode === "paid_work_disabled")
    )
        return {
            status: "not_started" as const,
            captured: false,
            assessed: false,
        };
    if (input.item?.sourceCaptureId || outcome)
        return {
            status: "reading_failed" as const,
            captured: false,
            assessed: false,
        };
    return { status: "not_started" as const, captured: false, assessed: false };
}

type PreparationRecovery = {
    resumableSourceIds: Id<"sources">[];
    retainedOutcomes: Infer<typeof sourcePreparationOutcomeValidator>[];
    scopePreparation: Doc<"sourceSelectionProposalRebuilds">;
    hasSearchWork: boolean;
    pendingComparisons: number;
    retryAt?: number;
    blockedReason?: string;
};

/** Computes resumable work from retained receipts; callers still enforce ownership and the active draft. */
export async function readPreparationRecovery(
    db: GenericDatabaseReader<DataModel>,
    input: {
        runId: Id<"researchRuns">;
        corpusRevisionId: Id<"corpusRevisions">;
        preparation: Doc<"sourceSelectionProposalRebuilds">;
        now: number;
        reads?: SourceReviewReads;
        preparations?: Doc<"sourceSelectionProposalRebuilds">[];
    },
): Promise<PreparationRecovery> {
    const reads = input.reads ?? new SourceReviewReads(db, input.runId);
    const preparations =
        input.preparations ??
        (await readPreparationHistory(db, input.runId, input.corpusRevisionId));
    const run = await db.get(input.runId);
    let modelBudgetBlocked:
        | ReturnType<typeof preparationBudgetBlock>
        | "preparation_configuration_invalid";
    try {
        readPreparationConcurrency();
        modelBudgetBlocked = run
            ? preparationBudgetBlock(
                  await readPreparationBudget(db, run, input.preparation),
                  readPreparationLimits(),
              )
            : undefined;
    } catch (error) {
        if (
            preparationFailureCode(error) !==
            "preparation_configuration_invalid"
        )
            throw error;
        modelBudgetBlocked = "preparation_configuration_invalid";
    }
    const scope = input.preparation.readingSourceIds?.length
        ? input.preparation.readingSourceIds
        : input.preparation.manualSourceIds;
    const sources = scope
        ? (await Promise.all(scope.map((id) => reads.source(id)))).filter(
              (source) => source !== null,
          )
        : await reads.sources();
    if (sources.length > MAX_HISTORICAL_SOURCE_CANDIDATES)
        throw sourcePreparationError("preparation_scope_invalid");
    const resumableSourceIds: Id<"sources">[] = [];
    const retainedOutcomes: Infer<typeof sourcePreparationOutcomeValidator>[] =
        [];
    let retryAt: number | undefined;
    let blockedReason: string | undefined;
    let pendingComparisons = 0;
    let primaryContext:
        | Awaited<ReturnType<typeof readComparisonPrimaryContext>>
        | undefined;
    for (const source of sources) {
        if (
            source.runId !== input.runId ||
            (await reads.decision(input.corpusRevisionId, source._id)) ===
                "rejected"
        )
            continue;
        const reading = await readSourceReading(db, {
            ...input,
            sourceId: source._id,
            preparations,
            reads,
        });
        let comparisonTasks: Doc<"aiTaskResults">[] = [];
        let currentComparisonContext: string | undefined;
        let canValidateRetainedComparison = false;
        if (reading.qualification) {
            retainedOutcomes.push({
                sourceId: source._id,
                result: {
                    status: "qualified",
                    sourceCaptureId: reading.qualification.sourceCaptureId,
                    taskId: reading.qualification.qualificationTaskId,
                },
            });
            if (
                !reading.qualification.qualification.findings.some((finding) =>
                    sourceFindingNeedsComparison(
                        finding,
                        reading.qualification.qualification.limitations,
                    ),
                )
            )
                continue;
            const tasks = await reads.comparisonHistory(source._id);
            primaryContext ??= run
                ? await readComparisonPrimaryContext(
                      db,
                      run,
                      input.corpusRevisionId,
                      reads,
                  )
                : undefined;
            const [capture, qualification] = await Promise.all([
                reads.capture(reading.qualification.sourceCaptureId),
                reads.task(reading.qualification.qualificationTaskId),
            ]);
            const currentContext =
                primaryContext && capture && qualification
                    ? comparisonContextForTarget(primaryContext, {
                          source,
                          capture,
                          qualification,
                          preparation: input.preparation,
                      }).comparisonContextHash
                    : undefined;
            currentComparisonContext = currentContext;
            comparisonTasks = tasks.filter(
                (task) =>
                    task.output.kind === "source_comparison" &&
                    task.output.targetCaptureId ===
                        reading.qualification?.sourceCaptureId &&
                    task.output.qualificationTaskId ===
                        reading.qualification?.qualificationTaskId,
            );
            const work = qualification
                ? sourceComparisonWork(
                      qualification,
                      comparisonTasks,
                      currentContext,
                  )
                : { kind: "rebuild" as const };
            const currentTask =
                work.kind === "reusable" ? work.task : undefined;
            if (currentTask) continue;
            canValidateRetainedComparison =
                !currentTask &&
                comparisonTasks.some(
                    (task) =>
                        task.schemaVersion === SOURCE_COMPARISON_VERSION &&
                        task.output.kind === "source_comparison" &&
                        ["compared", "not_run"].includes(
                            task.output.checkStatus,
                        ),
                );
            pendingComparisons++;
        }
        const operation = reading.qualification
            ? "source_comparison"
            : reading.captured
              ? "source_qualification"
              : source.origin === "sec"
                ? "retrieve_filing_html"
                : "get_contents";
        let calls = await db
            .query("providerCalls")
            .withIndex("by_run_source_operation", (q) =>
                q
                    .eq("runId", input.runId)
                    .eq("sourceId", source._id)
                    .eq("operation", operation),
            )
            .order("desc")
            .take(121);
        if (!calls.length && operation === "retrieve_filing_html")
            calls = await db
                .query("providerCalls")
                .withIndex("by_run_source_operation", (q) =>
                    q
                        .eq("runId", input.runId)
                        .eq("sourceId", source._id)
                        .eq("operation", "revalidate_company"),
                )
                .order("desc")
                .take(121);
        if (reading.qualification)
            calls = calls.filter((call) => {
                const task = comparisonTasks.find(
                    (candidate) => candidate.inputHash === call.inputHash,
                );
                if (task?.comparisonContextHash)
                    return (
                        task.comparisonContextHash === currentComparisonContext
                    );
                return !(
                    task?.output.kind === "source_comparison" &&
                    ["compared", "not_run"].includes(task.output.checkStatus)
                );
            });
        const latest = calls[0];
        const exactCalls = latest
            ? calls.filter((c) => c.inputHash === latest.inputHash)
            : [];
        const plan = nextPreparationAttempt(
            exactCalls,
            {
                resumesPreparationId: input.preparation._id,
                createdAt: input.now,
            },
            input.now,
        );
        const previousOutcome = preparations
            .flatMap((p) => p.sourceOutcomes ?? [])
            .find((o) => o.sourceId === source._id);
        const previousFailure =
            previousOutcome?.result.status === "unavailable"
                ? previousOutcome.result.reasonCode
                : undefined;
        const terminalReading =
            !reading.captured &&
            !latest &&
            previousFailure &&
            ![
                "missing_configuration",
                "paid_work_disabled",
                "execution_slot_unavailable",
                "source_url_unavailable",
            ].includes(previousFailure);
        if (
            plan.attempt &&
            !terminalReading &&
            (!modelBudgetBlocked || canValidateRetainedComparison)
        )
            resumableSourceIds.push(source._id);
        else {
            const reasonCode = modelBudgetBlocked
                ? modelBudgetBlocked
                : terminalReading
                  ? previousFailure
                  : (plan.errorCode ?? "terminal_failure");
            blockedReason ??= reasonCode;
            if (plan.retryAt !== undefined)
                retryAt = Math.min(retryAt ?? Infinity, plan.retryAt);
            if (!reading.qualification)
                retainedOutcomes.push({
                    sourceId: source._id,
                    result: { status: "unavailable", reasonCode },
                });
        }
    }
    let hasSearchWork = false;
    if (!scope) {
        const supplement = run?.automaticSupplementOperationId
            ? await db.get(run.automaticSupplementOperationId)
            : null;
        const claimed = supplement?.supplementClaimedQueryIndexes ?? [];
        if (
            supplement?.supplementQueries &&
            claimed.length < MAX_SUPPLEMENT_SEARCHES &&
            (await readSourceCandidateCapacity(db, input.runId)).remaining > 0
        ) {
            hasSearchWork = supplement.supplementQueries.some(
                (_, index) => !claimed.includes(index),
            );
            for (const index of new Set(claimed)) {
                const calls = await readSupplementalSearchAttempts(
                    db,
                    input.runId,
                    supplement,
                    index,
                );
                const plan = nextPreparationAttempt(
                    calls,
                    {
                        resumesPreparationId: input.preparation._id,
                        createdAt: input.now,
                    },
                    input.now,
                    1,
                );
                if (plan.attempt === 2) hasSearchWork = true;
                if (plan.retryAt !== undefined)
                    retryAt = Math.min(retryAt ?? Infinity, plan.retryAt);
            }
        }
    }
    const configurationUnavailable =
        modelBudgetBlocked === "preparation_configuration_invalid";
    if (scope && resumableSourceIds.length === 0 && !configurationUnavailable) {
        const original = preparations.find(
            (p) => !p.manualSourceIds && !p.target,
        );
        if (original && original._id !== input.preparation._id) {
            const broader = await readPreparationRecovery(db, {
                ...input,
                preparation: original,
            });
            if (broader.resumableSourceIds.length || broader.hasSearchWork)
                return broader;
        }
    }
    return {
        resumableSourceIds: configurationUnavailable ? [] : resumableSourceIds,
        retainedOutcomes,
        scopePreparation: input.preparation,
        hasSearchWork: !configurationUnavailable && hasSearchWork,
        pendingComparisons,
        ...(retryAt !== undefined ? { retryAt } : {}),
        ...(configurationUnavailable
            ? { blockedReason: "preparation_configuration_invalid" }
            : blockedReason
              ? { blockedReason }
              : {}),
    };
}
