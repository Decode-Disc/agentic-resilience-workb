import type { DataModel, Doc, Id } from "@convex/_generated/dataModel";
import { MAX_HISTORICAL_SOURCE_CANDIDATES } from "@convex/resourcePolicy";
import type {
    DocumentByName,
    GenericDatabaseReader,
    SystemDataModel,
} from "convex/server";
import { getDocumentSize, type Value } from "convex/values";
import { sourceCaptureState } from "./sourceCaptureState";
import {
    readPreparationSourceDecision,
    sourcePreparationError,
} from "./sourcePreparationAuthority";
import {
    findCaptureIndex,
    sourceCaptureScopeKey,
} from "./sourceRetrievalPolicy";
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
    private readonly captureStates = new Map<
        string,
        ReturnType<typeof sourceCaptureState>
    >();
    private readonly artifacts = new Map<
        Id<"_storage">,
        Promise<DocumentByName<SystemDataModel, "_storage"> | null>
    >();
    private readonly decisions = new Map<
        string,
        ReturnType<typeof readPreparationSourceDecision>
    >();
    private readonly passages = new Map<
        string,
        Promise<Doc<"sourceSearchPassages"> | null>
    >();
    private readonly requests = new Map<
        Id<"agentOperationRequests">,
        Promise<Doc<"agentOperationRequests"> | null>
    >();
    private readonly preparationRequests = new Map<
        string,
        Promise<Doc<"agentOperationRequests"> | null>
    >();
    private bytes = 0;
    private ranges = 0;
    private readonly reviews = new Map<
        string,
        ReturnType<typeof readPinnedComparisonReview>
    >();
    private candidates?: Promise<Doc<"sources">[]>;

    constructor(
        private readonly db: GenericDatabaseReader<DataModel>,
        private readonly runId: Id<"researchRuns">,
        private readonly capacity?: { bytes: number; ranges: number },
    ) {}

    /** Leaves capacity for not-yet-written dependencies before authorizing more work. */
    requireCapacity(bytes = 0, ranges = 0) {
        if (
            this.capacity &&
            (this.bytes + bytes > this.capacity.bytes ||
                this.ranges + ranges > this.capacity.ranges)
        )
            throw sourcePreparationError("source_review_capacity");
    }
    private range() {
        this.ranges++;
        this.requireCapacity();
    }
    private observe<T extends Record<string, Value>>(row: T | null) {
        if (row) this.bytes += getDocumentSize(row);
        this.requireCapacity();
        return row;
    }

    capture(id: Id<"sourceCaptures">) {
        let value = this.captures.get(id);
        if (!value) {
            this.range();
            value = this.db.get(id).then((row) => this.observe(row));
            this.captures.set(id, value);
        }
        return value;
    }
    private readonly indexScopes = new Map<string, Promise<string>>();
    private indexScope(
        corpusRevisionId: Id<"corpusRevisions">,
        captureId: Id<"sourceCaptures">,
    ) {
        const key = `${corpusRevisionId}:${captureId}`;
        let scope = this.indexScopes.get(key);
        if (!scope) {
            scope = findCaptureIndex(
                this.db,
                { runId: this.runId, corpusRevisionId },
                captureId,
                async (read) => {
                    this.range();
                    return this.observe(await read());
                },
            ).then(
                (index) => index?.scopeKey ?? sourceCaptureScopeKey(this.runId),
            );
            this.indexScopes.set(key, scope);
        }
        return scope;
    }

    passage(
        corpusRevisionId: Id<"corpusRevisions">,
        captureId: Id<"sourceCaptures">,
        order: number,
    ) {
        const key = `${corpusRevisionId}:${captureId}:${order}`;
        let value = this.passages.get(key);
        if (!value) {
            value = this.indexScope(corpusRevisionId, captureId).then(
                async (scopeKey) => {
                    this.range();
                    const row = await this.db
                        .query("sourceSearchPassages")
                        .withIndex("by_scope_capture_order", (q) =>
                            q
                                .eq("scopeKey", scopeKey)
                                .eq("captureId", captureId)
                                .eq("order", order),
                        )
                        .unique();
                    return this.observe(row);
                },
            );
            this.passages.set(key, value);
        }
        return value;
    }
    /** Reads only requested contiguous order ranges, preserving exact identities and caching misses. */
    async prefetchPassages(
        corpusRevisionId: Id<"corpusRevisions">,
        references: readonly {
            captureId: Id<"sourceCaptures">;
            passageOrder: number;
        }[],
    ) {
        const grouped = new Map<Id<"sourceCaptures">, Set<number>>();
        for (const reference of references) {
            if (
                this.passages.has(
                    `${corpusRevisionId}:${reference.captureId}:${reference.passageOrder}`,
                )
            )
                continue;
            const orders =
                grouped.get(reference.captureId) ?? new Set<number>();
            orders.add(reference.passageOrder);
            grouped.set(reference.captureId, orders);
        }
        for (const [captureId, values] of grouped) {
            const scopeKey = await this.indexScope(corpusRevisionId, captureId);
            const orders = [...values].sort((a, b) => a - b);
            for (let i = 0; i < orders.length; ) {
                const first = orders[i];
                if (first === undefined) break;
                let end = i;
                while (
                    end + 1 < orders.length &&
                    orders[end + 1] === (orders[end] ?? 0) + 1
                )
                    end++;
                const last = orders[end] ?? first;
                this.range();
                const rows = await this.db
                    .query("sourceSearchPassages")
                    .withIndex("by_scope_capture_order", (q) =>
                        q
                            .eq("scopeKey", scopeKey)
                            .eq("captureId", captureId)
                            .gte("order", first)
                            .lte("order", last),
                    )
                    .take(last - first + 2);
                const byOrder = new Map<number, Doc<"sourceSearchPassages">>();
                for (const row of rows) {
                    this.observe(row);
                    if (byOrder.has(row.order))
                        throw sourcePreparationError(
                            "capture_identity_conflict",
                        );
                    byOrder.set(row.order, row);
                }
                for (let order = first; order <= last; order++)
                    this.passages.set(
                        `${corpusRevisionId}:${captureId}:${order}`,
                        Promise.resolve(byOrder.get(order) ?? null),
                    );
                i = end + 1;
            }
        }
    }
    request(id: Id<"agentOperationRequests">) {
        let value = this.requests.get(id);
        if (!value) {
            this.range();
            value = this.db.get(id).then((row) => this.observe(row));
            this.requests.set(id, value);
        }
        return value;
    }
    /** Finds a completion blocker even before the operation reserves preparation work. */
    firstPreparationRequest(
        preparationId: Id<"sourceSelectionProposalRebuilds">,
        status: "running" | "waiting",
    ) {
        const key = `${preparationId}:${status}`;
        let value = this.preparationRequests.get(key);
        if (!value) {
            this.range();
            value = this.db
                .query("agentOperationRequests")
                .withIndex("by_preparation_and_status", (q) =>
                    q
                        .eq("pin.preparationId", preparationId)
                        .eq("status", status),
                )
                .first()
                .then((row) => {
                    if (row) return row;
                    this.range();
                    return this.db
                        .query("agentOperationRequests")
                        .withIndex(
                            "by_documentary_preparation_and_status",
                            (q) =>
                                q
                                    .eq(
                                        "pin.scope.preparationId",
                                        preparationId,
                                    )
                                    .eq("pin.scope.kind", "sources")
                                    .eq("status", status),
                        )
                        .first();
                })
                .then((row) => {
                    this.observe(row);
                    if (row) this.requests.set(row._id, Promise.resolve(row));
                    return row;
                });
            this.preparationRequests.set(key, value);
        }
        return value;
    }
    task(id: Id<"aiTaskResults">) {
        let value = this.tasks.get(id);
        if (!value) {
            this.range();
            value = this.db.get(id).then((row) => this.observe(row));
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
            this.range();
            value = this.db.system
                .get("_storage", id)
                .then((row) => this.observe(row));
            this.artifacts.set(id, value);
        }
        return value;
    }
    decision(
        corpusRevisionId: Id<"corpusRevisions">,
        sourceId: Id<"sources">,
        allowMissingSourceMetadata = false,
    ) {
        if (allowMissingSourceMetadata) {
            const strict = this.decisions.get(
                `${corpusRevisionId}:${sourceId}:strict`,
            );
            if (strict) return strict;
        }
        const key = `${corpusRevisionId}:${sourceId}:${allowMissingSourceMetadata ? "allow_missing" : "strict"}`;
        let value = this.decisions.get(key);
        if (!value) {
            value = readPreparationSourceDecision(this.db, {
                runId: this.runId,
                corpusRevisionId,
                sourceId,
                allowMissingSourceMetadata,
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
    rememberCapture(capture: Doc<"sourceCaptures">) {
        if (!this.captures.has(capture._id)) {
            this.observe(capture);
            this.captures.set(capture._id, Promise.resolve(capture));
        }
    }
    private readonly readingWindows = new Map<
        string,
        Promise<Doc<"agentOperationRequests">[][]>
    >();
    readingRequests(missionId: Id<"agentMissions">, limit: number) {
        const key = `${missionId}:${limit}`;
        let value = this.readingWindows.get(key);
        if (!value) {
            value = Promise.all(
                (["search_available_material", "read_in_context"] as const).map(
                    async (kind) => {
                        this.range();
                        const rows = await this.db
                            .query("agentOperationRequests")
                            .withIndex("by_mission_and_input_kind", (q) =>
                                q
                                    .eq("missionId", missionId)
                                    .eq("input.kind", kind),
                            )
                            .order("desc")
                            .take(limit + 1);
                        for (const row of rows) this.observe(row);
                        return rows;
                    },
                ),
            );
            this.readingWindows.set(key, value);
        }
        return value;
    }
    captureState(
        sourceId: Id<"sources">,
        admittedCaptureIds?: ReadonlySet<Id<"sourceCaptures">>,
    ) {
        const key = `${sourceId}:${admittedCaptureIds ? [...admittedCaptureIds].sort().join(",") : "any"}`;
        let value = this.captureStates.get(key);
        if (!value) {
            value = sourceCaptureState({ db: this.db }, sourceId, {
                admittedCaptureIds,
                onQuery: () => this.range(),
                onDoc: (row) => {
                    if (row) this.observe(row);
                },
            }).then((state) => {
                if (state.committed)
                    this.captures.set(
                        state.committed._id,
                        Promise.resolve(state.committed),
                    );
                return state;
            });
            this.captureStates.set(key, value);
        }
        return value;
    }
}
