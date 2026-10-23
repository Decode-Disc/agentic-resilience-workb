import type { DataModel, Doc, Id } from "@convex/_generated/dataModel";
import { MAX_HISTORICAL_SOURCE_CANDIDATES } from "@convex/resourceLimits";
import type { GenericDatabaseReader } from "convex/server";
import { v } from "convex/values";
import { readPinnedSourceQualification } from "./sourceUsage";

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
    },
) {
    const outcome = input.preparations
        .flatMap((p) => p.sourceOutcomes ?? [])
        .find((o) => o.sourceId === input.sourceId);
    let pinned = input.item
        ? await readPinnedSourceQualification(db, {
              ...input.item,
              runId: input.runId,
              sourceId: input.sourceId,
          })
        : null;
    if (!pinned && !input.approved && outcome?.result.status === "qualified") {
        pinned = await readPinnedSourceQualification(db, {
            runId: input.runId,
            sourceId: input.sourceId,
            sourceCaptureId: outcome.result.sourceCaptureId,
            qualificationTaskId: outcome.result.taskId,
        });
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
        ? await db.get(input.item.sourceCaptureId)
        : input.approved
          ? null
          : (
                await db
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
