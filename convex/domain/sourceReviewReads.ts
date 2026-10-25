import type { DataModel, Doc, Id } from "@convex/_generated/dataModel";
import { MAX_HISTORICAL_SOURCE_CANDIDATES } from "@convex/resourceLimits";
import type {
    DocumentByName,
    GenericDatabaseReader,
    SystemDataModel,
} from "convex/server";
import { readPreparationSourceDecision } from "./sourcePreparationAuthority";
import {
    readComparisonHistory,
    readPinnedComparisonReview,
} from "./sourceUsage";

/** Shares immutable evidence reads within one authorized query, never across transactions. */
export class SourceReviewReads {
    private readonly captures = new Map<
        Id<"sourceCaptures">,
        Promise<Doc<"sourceCaptures"> | null>
    >();
    private readonly tasks = new Map<
        Id<"aiTaskResults">,
        Promise<Doc<"aiTaskResults"> | null>
    >();
    private readonly sourceRows = new Map<
        Id<"sources">,
        Promise<Doc<"sources"> | null>
    >();
    private readonly qualifications = new Map<
        Id<"sources">,
        Promise<Doc<"aiTaskResults">[]>
    >();
    private readonly comparisons = new Map<
        Id<"sources">,
        Promise<Doc<"aiTaskResults">[]>
    >();
    private readonly captureRows = new Map<
        Id<"sources">,
        Promise<Doc<"sourceCaptures">[]>
    >();
    private readonly artifacts = new Map<
        Id<"_storage">,
        Promise<DocumentByName<SystemDataModel, "_storage"> | null>
    >();
    private readonly decisions = new Map<
        string,
        ReturnType<typeof readPreparationSourceDecision>
    >();
    private readonly reviews = new Map<
        string,
        ReturnType<typeof readPinnedComparisonReview>
    >();
    private candidates?: Promise<Doc<"sources">[]>;

    constructor(
        private readonly db: GenericDatabaseReader<DataModel>,
        private readonly runId: Id<"researchRuns">,
    ) {}

    capture(id: Id<"sourceCaptures">) {
        let value = this.captures.get(id);
        if (!value) {
            value = this.db.get(id);
            this.captures.set(id, value);
        }
        return value;
    }
    task(id: Id<"aiTaskResults">) {
        let value = this.tasks.get(id);
        if (!value) {
            value = this.db.get(id);
            this.tasks.set(id, value);
        }
        return value;
    }
    source(id: Id<"sources">) {
        let value = this.sourceRows.get(id);
        if (!value) {
            value = this.db.get(id);
            this.sourceRows.set(id, value);
        }
        return value;
    }
    artifact(id: Id<"_storage">) {
        let value = this.artifacts.get(id);
        if (!value) {
            value = this.db.system.get("_storage", id);
            this.artifacts.set(id, value);
        }
        return value;
    }
    decision(corpusRevisionId: Id<"corpusRevisions">, sourceId: Id<"sources">) {
        const key = `${corpusRevisionId}:${sourceId}`;
        let value = this.decisions.get(key);
        if (!value) {
            value = readPreparationSourceDecision(this.db, {
                runId: this.runId,
                corpusRevisionId,
                sourceId,
            });
            this.decisions.set(key, value);
        }
        return value;
    }
    sources() {
        this.candidates ??= this.db
            .query("sources")
            .withIndex("by_run_and_url", (q) => q.eq("runId", this.runId))
            .take(MAX_HISTORICAL_SOURCE_CANDIDATES + 1)
            .then((rows) => {
                for (const row of rows)
                    this.sourceRows.set(row._id, Promise.resolve(row));
                return rows;
            });
        return this.candidates;
    }
    qualificationHistory(sourceId: Id<"sources">) {
        let value = this.qualifications.get(sourceId);
        if (!value) {
            value = this.db
                .query("aiTaskResults")
                .withIndex("by_source_and_task_type_and_created_at", (q) =>
                    q
                        .eq("sourceId", sourceId)
                        .eq("taskType", "source_qualification"),
                )
                .order("desc")
                .take(4)
                .then((rows) => {
                    for (const row of rows)
                        this.tasks.set(row._id, Promise.resolve(row));
                    return rows;
                });
            this.qualifications.set(sourceId, value);
        }
        return value;
    }
    comparisonHistory(sourceId: Id<"sources">) {
        let value = this.comparisons.get(sourceId);
        if (!value) {
            value = (async () => {
                const rows: Doc<"aiTaskResults">[] = [];
                for await (const row of readComparisonHistory(this.db, {
                    sourceId,
                })) {
                    rows.push(row);
                    this.tasks.set(row._id, Promise.resolve(row));
                }
                return rows;
            })();
            this.comparisons.set(sourceId, value);
        }
        return value;
    }
    comparisonReview(
        item: Parameters<typeof readPinnedComparisonReview>[1],
        qualification: Parameters<typeof readPinnedComparisonReview>[2],
    ) {
        const key = JSON.stringify([
            item.runId,
            item.corpusRevisionId,
            item.sourceId,
            qualification?.qualificationTaskId,
            qualification?.sourceCaptureId,
            qualification?.contentHash,
            item.comparisonTaskIds,
        ]);
        let value = this.reviews.get(key);
        if (!value) {
            value = readPinnedComparisonReview(
                this.db,
                item,
                qualification,
                this,
            );
            this.reviews.set(key, value);
        }
        return value;
    }
    captureHistory(sourceId: Id<"sources">) {
        let value = this.captureRows.get(sourceId);
        if (!value) {
            value = this.db
                .query("sourceCaptures")
                .withIndex("by_source_and_status_and_updated_at", (q) =>
                    q.eq("sourceId", sourceId).eq("status", "committed"),
                )
                .order("desc")
                .take(4)
                .then((rows) => {
                    for (const row of rows)
                        this.captures.set(row._id, Promise.resolve(row));
                    return rows;
                });
            this.captureRows.set(sourceId, value);
        }
        return value;
    }
}
