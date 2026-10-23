import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createServer } from "vite";
import { prepareRetrievedStudyComparison } from "./retrieval-study.ts";

type Reference = {
    documentId: string;
    startOffset: number;
    endOffset: number;
    quotationSha256?: string;
};
type Review = {
    studySha256: string;
    independentHumanGroundTruth: false;
    controls: Array<{
        id: string;
        status: "comparable" | "context_only" | "unresolved";
        rationale: string;
        assessmentScope: string;
        references: Reference[];
        equivalentEvidenceSets?: Array<{
            rationale: string;
            references: Reference[];
        }>;
    }>;
};
type Selection = Reference & { quotation?: string; quotationSha256?: string };
type Row = {
    caseId: string;
    mode: string;
    selected: Selection[];
    inputBytes: number;
    complete: boolean;
};
type BuilderArgs = Parameters<typeof prepareRetrievedStudyComparison>;
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const hash = (path: string) =>
    createHash("sha256").update(readFileSync(path)).digest("hex");

/** Whitespace gaps are allowed, but every substantive character of the reviewed reference must reach the model input. */
function covers(reference: Reference, selected: Selection[], text: string) {
    let cursor = reference.startOffset;
    for (const passage of selected
        .filter((p) => p.documentId === reference.documentId)
        .sort((a, b) => a.startOffset - b.startOffset)) {
        if (passage.endOffset <= cursor) continue;
        if (
            passage.startOffset > cursor &&
            text
                .slice(
                    cursor,
                    Math.min(passage.startOffset, reference.endOffset),
                )
                .trim()
        )
            return false;
        cursor = Math.max(cursor, passage.endOffset);
        if (cursor >= reference.endOffset) return true;
    }
    return cursor >= reference.endOffset;
}

/** Context retention and unresolved controls cannot inflate comparable-evidence recall. This does not score a model verdict. */
export function scoreReviewedRetrieval(
    review: Review,
    rows: Row[],
    texts: Map<string, string>,
) {
    const conditions = rows.map((row) => {
        for (const selected of row.selected) {
            const text = texts.get(selected.documentId);
            assert(
                text !== undefined &&
                    Number.isSafeInteger(selected.startOffset) &&
                    Number.isSafeInteger(selected.endOffset) &&
                    selected.startOffset >= 0 &&
                    selected.endOffset > selected.startOffset &&
                    selected.endOffset <= text.length,
                "Invalid selected span",
            );
            const quotation = text.slice(
                selected.startOffset,
                selected.endOffset,
            );
            if (selected.quotation !== undefined)
                assert.equal(
                    selected.quotation,
                    quotation,
                    "Selected quotation changed",
                );
            if (selected.quotationSha256)
                assert.equal(
                    createHash("sha256").update(quotation).digest("hex"),
                    selected.quotationSha256,
                    "Selected quotation changed",
                );
        }
        const control = review.controls.find(
            (c) =>
                row.caseId === `${c.id}:focused` ||
                row.caseId === `${c.id}:distractors`,
        );
        assert(control, "Missing reviewed control");
        assert(
            ["comparable", "context_only", "unresolved"].includes(
                control.status,
            ),
            "Unknown reference status",
        );
        assert(
            control.status === "unresolved"
                ? control.references.length === 0
                : control.references.length > 0,
            "Reference/status mismatch",
        );
        const retainedSet = (references: Reference[]) =>
            references
                .map((ref) => {
                    const text = texts.get(ref.documentId);
                    assert(
                        text !== undefined &&
                            Number.isSafeInteger(ref.startOffset) &&
                            Number.isSafeInteger(ref.endOffset) &&
                            ref.startOffset >= 0 &&
                            ref.endOffset > ref.startOffset &&
                            ref.endOffset <= text.length,
                        "Invalid reviewed span",
                    );
                    if (ref.quotationSha256)
                        assert.equal(
                            createHash("sha256")
                                .update(
                                    text.slice(ref.startOffset, ref.endOffset),
                                )
                                .digest("hex"),
                            ref.quotationSha256,
                            "Reviewed quotation changed",
                        );
                    return covers(ref, row.selected, text);
                })
                .every(Boolean);
        const exactRetained = retainedSet(control.references);
        const alternatives = (control.equivalentEvidenceSets ?? []).map(
            (set) => {
                assert(
                    control.status !== "unresolved" &&
                        set.rationale.trim() &&
                        set.references.length > 0 &&
                        set.references.every((ref) => ref.quotationSha256),
                    "Incomplete equivalent evidence adjudication",
                );
                return retainedSet(set.references);
            },
        );
        return {
            caseId: row.caseId,
            mode: row.mode,
            status: control.status,
            retained:
                control.status === "unresolved"
                    ? null
                    : exactRetained || alternatives.some(Boolean),
            exactRetained:
                control.status === "unresolved" ? null : exactRetained,
            inputBytes: row.inputBytes,
            historicalComplete: row.complete,
        };
    });
    assert(
        new Set(conditions.map((c) => `${c.caseId}:${c.mode}`)).size ===
            conditions.length,
        "Duplicate replay condition",
    );
    const summary = [...new Set(rows.map((r) => r.mode))].map((mode) => ({
        mode,
        comparable: {
            retained: conditions.filter(
                (c) =>
                    c.mode === mode && c.status === "comparable" && c.retained,
            ).length,
            total: conditions.filter(
                (c) => c.mode === mode && c.status === "comparable",
            ).length,
        },
        contextOnly: {
            retained: conditions.filter(
                (c) =>
                    c.mode === mode &&
                    c.status === "context_only" &&
                    c.retained,
            ).length,
            total: conditions.filter(
                (c) => c.mode === mode && c.status === "context_only",
            ).length,
        },
        unresolvedConditions: conditions.filter(
            (c) => c.mode === mode && c.status === "unresolved",
        ).length,
        medianInputBytes: rows
            .filter((r) => r.mode === mode)
            .map((r) => r.inputBytes)
            .sort((a, b) => a - b)[
            Math.floor(rows.filter((r) => r.mode === mode).length / 2)
        ],
        maximumInputBytes: Math.max(
            ...rows.filter((r) => r.mode === mode).map((r) => r.inputBytes),
        ),
        historicalComplete: rows.filter((r) => r.mode === mode && r.complete)
            .length,
    }));
    return {
        summary,
        conditions,
        modelVerdictMeasured: false,
        independentHumanGroundTruth: false,
        winner: null,
    };
}

/** Replays saved native ranks through the real preparer. There is no provider or deployment client in this path. */
export async function runRetrievalReplay(args: string[]) {
    const known = new Set([
        "--retrieval-phase",
        "--study",
        "--run-dir",
        "--ranked-rows",
        "--reference-review",
        "--report-file",
        "--retrieval-mode",
        "--company",
        "--context-bytes",
    ]);
    const options = new Map<string, string>();
    for (let i = 0; i < args.length; i += 2) {
        const key = args[i],
            value = args[i + 1];
        assert(
            key &&
                known.has(key) &&
                value &&
                !value.startsWith("--") &&
                !options.has(key),
            "Invalid replay option",
        );
        options.set(key, value);
    }
    assert(
        options.get("--retrieval-phase") === "replay",
        "Expected replay phase",
    );
    const dir = options.get("--run-dir");
    const rankedPath = options.get("--ranked-rows");
    const reviewPath = options.get("--reference-review");
    const reportPath = options.get("--report-file");
    assert(
        dir && rankedPath && reviewPath && reportPath,
        "Replay needs run directory, ranked rows, reference review and a new report file",
    );
    const contextBytes = options.has("--context-bytes")
        ? Number(options.get("--context-bytes"))
        : undefined;
    assert(
        contextBytes === undefined ||
            (Number.isSafeInteger(contextBytes) &&
                contextBytes > 0 &&
                contextBytes <= 128 * 1024),
        "Invalid context byte budget",
    );
    const mode = options.get("--retrieval-mode") ?? "both";
    assert(["lexical", "hybrid", "both"].includes(mode), "Unknown replay mode");
    const studyPath =
        options.get("--study") ??
        "scripts/evaluations/source-selection/fixtures/cross-company-20261020/study.json";
    const server = await createServer({
        server: { middlewareMode: true },
        appType: "custom",
    });
    try {
        const { readStudy } = (await server.ssrLoadModule(
            "/scripts/evaluations/source-selection/source-quality-study.ts",
        )) as typeof import("./source-quality-study.ts");
        const loaded = readStudy(resolve(studyPath));
        const frozen = read(join(dir, "freeze.json")) as BuilderArgs[1];
        const state = read(join(dir, "native-state.json")) as Record<
            string,
            BuilderArgs[4]
        >;
        const review = read(reviewPath) as Review;
        assert.equal(
            frozen.studyHash,
            loaded.studySha256,
            "Frozen study changed",
        );
        assert.equal(
            review.studySha256,
            loaded.studySha256,
            "Review belongs to a different study",
        );
        assert.equal(
            review.independentHumanGroundTruth,
            false,
            "Assistant review must not claim independent human ground truth",
        );
        assert.equal(
            review.controls.length,
            loaded.study.controls.length,
            "Review must cover every control",
        );
        assert.equal(
            new Set(review.controls.map((c) => c.id)).size,
            review.controls.length,
            "Duplicate reviewed control",
        );
        for (const control of review.controls) {
            const original = loaded.study.controls.find(
                (c) => c.id === control.id,
            );
            assert(
                original && control.rationale && control.assessmentScope,
                "Incomplete reference adjudication",
            );
            for (const ref of [
                ...control.references,
                ...(control.equivalentEvidenceSets ?? []).flatMap(
                    (set) => set.references,
                ),
            ])
                assert(
                    original.primaryDocumentIds.includes(ref.documentId),
                    "Reviewed reference is outside eligible primary documents",
                );
        }
        const rankedRows = read(rankedPath) as Array<{
            id: string;
            captureId: string;
            order: number;
            startOffset: number;
            endOffset: number;
        }>;
        const indexed = new Map(rankedRows.map((r) => [r.id, r]));
        const originalRows = readFileSync(
            join(dir, "native-results.jsonl"),
            "utf8",
        )
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line)) as Array<
            Row & { metadata: BuilderArgs[5]["metadata"] }
        >;
        const originals = [
            ...new Map(
                originalRows.map((r) => [`${r.caseId}:${r.mode}`, r]),
            ).values(),
        ].filter(
            (r) =>
                (mode === "both" || r.mode === mode) &&
                (!options.get("--company") ||
                    r.caseId.startsWith(`${options.get("--company")}-`)),
        );
        assert(originals.length > 0, "No replay conditions selected");
        const {
            prepareSourceComparisonInput,
            SOURCE_COMPARISON_CONTEXT_EXPANSION_BYTES,
        } = (await server.ssrLoadModule(
            "/convex/domain/sourceComparison.ts",
        )) as typeof import("@convex/domain/sourceComparison");
        const texts = new Map(loaded.documents.map((d) => [d.id, d.text]));
        const replayed: Row[] = [];
        let provenanceFailures = 0;
        for (const before of originals) {
            const condition = frozen.cases.find((c) => c.id === before.caseId);
            assert(condition, "Missing frozen condition");
            const company = frozen.companies.find(
                (c) => c.id === condition.companyId,
            );
            const fixture = state[condition.companyId];
            assert(company && fixture, "Missing native fixture identity");
            const reverse = new Map(
                Object.entries(fixture.captures).map(([doc, capture]) => [
                    String(capture),
                    doc,
                ]),
            );
            const ids = before.metadata.selectedPassageKeys;
            const passages = ids.map((id) => {
                const row = indexed.get(id);
                assert(row, "Missing native ranked row");
                const docId = reverse.get(row.captureId);
                const doc = frozen.documents.find((d) => d.id === docId);
                const passage = doc?.passages.find(
                    (p) => p.order === row.order,
                );
                assert(
                    doc &&
                        passage &&
                        row.startOffset === passage.startOffset &&
                        row.endOffset === passage.endOffset,
                    "Native row no longer matches frozen capture",
                );
                assert.equal(
                    texts.get(doc.id)?.slice(row.startOffset, row.endOffset),
                    passage.quotation,
                    "Frozen quotation changed",
                );
                return {
                    id: row.id,
                    captureId: row.captureId,
                    order: row.order,
                    quotation: passage.quotation,
                    startOffset: row.startOffset,
                    endOffset: row.endOffset,
                    headingPath: passage.headingPath,
                };
            }) as BuilderArgs[5]["passages"];
            const result: BuilderArgs[5] = {
                metadata: before.metadata,
                rankings: [ids as BuilderArgs[5]["rankings"][number]],
                passages,
            };
            const prepared = prepareRetrievedStudyComparison(
                loaded,
                frozen,
                company,
                condition,
                fixture,
                result,
                prepareSourceComparisonInput,
                contextBytes,
            );
            const selected = prepared.request.primaryPassages.map((p) => {
                const documentId = reverse.get(p.captureId);
                assert(documentId, "Unknown selected capture");
                if (
                    texts.get(documentId)?.slice(p.startOffset, p.endOffset) !==
                    p.quotation
                )
                    provenanceFailures++;
                return {
                    documentId,
                    startOffset: p.startOffset,
                    endOffset: p.endOffset,
                    quotation: p.quotation,
                };
            });
            replayed.push({
                caseId: before.caseId,
                mode: before.mode,
                selected,
                inputBytes: prepared.serializedRequestBytes,
                complete: condition.required.every((ref) =>
                    covers(ref, selected, texts.get(ref.documentId) ?? ""),
                ),
            });
        }
        const report = {
            method: "Saved native ranks and existing captures replayed through the current production preparer; no new ranking or model verdict",
            frozenReferenceSha256: hash(join(dir, "freeze.json")),
            referenceReviewSha256: hash(reviewPath),
            nativeRowsSha256: hash(rankedPath),
            preparerSha256: hash("convex/domain/sourceComparison.ts"),
            contextExpansionByteLimit:
                contextBytes ?? SOURCE_COMPARISON_CONTEXT_EXPANSION_BYTES,
            inferenceCalls: 0,
            provenanceFailures,
            before: scoreReviewedRetrieval(review, originals, texts),
            after: scoreReviewedRetrieval(review, replayed, texts),
            selected: replayed.map((row) => ({
                ...row,
                selected: row.selected.map(({ quotation, ...p }) => ({
                    ...p,
                    quotationSha256: createHash("sha256")
                        .update(quotation ?? "")
                        .digest("hex"),
                })),
            })),
        };
        assert.equal(provenanceFailures, 0, "Replay lost source provenance");
        writeFileSync(
            resolve(reportPath),
            `${JSON.stringify(report, null, 2)}\n`,
            { flag: "wx" },
        );
        console.log(
            JSON.stringify(
                {
                    before: report.before.summary,
                    after: report.after.summary,
                    inferenceCalls: 0,
                    provenanceFailures,
                },
                null,
                2,
            ),
        );
    } finally {
        await server.close();
    }
}
