import type { DataModel, Doc, Id } from "@convex/_generated/dataModel";
import type { GenericDatabaseReader } from "convex/server";
import { v } from "convex/values";
import { zodToConvex } from "convex-helpers/server/zod4";
import { z } from "zod";
/** Persisted embedding format identity; changing it requires rebuilding derived indexes. */
export const SOURCE_EMBEDDING_PROFILE_VERSION = "evidence-embedding-v1";
export const SOURCE_RETRIEVAL_VERSION = "structured-v1";
export const SOURCE_RETRIEVAL_RANKING_POLICY = "stable-passages-v1";

export const sourceDocumentMetadataValidator = v.object({
    title: v.string(),
    publishedAt: v.union(v.number(), v.null()),
    date: v.union(v.string(), v.null()),
    dateKind: v.union(v.literal("filing"), v.literal("publication"), v.null()),
    form: v.union(v.string(), v.null()),
});

/** Preserve recorded document dates without inferring them from titles or acquisition times. */
export function sourceDocumentMetadata(source: Doc<"sources">) {
    return {
        title: source.title,
        publishedAt: source.publishedAt ?? null,
        date:
            source.publishedAt === undefined
                ? null
                : new Date(source.publishedAt).toISOString(),
        dateKind:
            source.publishedAt === undefined
                ? null
                : source.origin === "sec"
                  ? ("filing" as const)
                  : ("publication" as const),
        form: source.secForm ?? null,
    };
}

export type SourcePassageRankIdentity = {
    canonicalUrl: string;
    contentHash: string;
    order: number;
    startOffset: number;
    endOffset: number;
};

/** Database identities never decide between distinct captured passages. */
export function compareSourcePassageRanks(
    a: SourcePassageRankIdentity,
    b: SourcePassageRankIdentity,
): number {
    return (
        a.canonicalUrl.localeCompare(b.canonicalUrl) ||
        a.contentHash.localeCompare(b.contentHash) ||
        a.order - b.order ||
        a.startOffset - b.startOffset ||
        a.endOffset - b.endOffset
    );
}
/** Native vector filters cannot combine scope and capture with AND; one key owns both constraints. */
export function sourceEmbeddingScopeKey(
    scope: string,
    profile: string,
    captureId: string,
): string {
    return `${scope}:${profile}:${captureId}`;
}
export const retrievalModeValidator = v.union(
    v.literal("lexical"),
    v.literal("hybrid"),
);
export const retrievalMetadataSchema = z
    .object({
        version: z.literal(SOURCE_RETRIEVAL_VERSION),
        rankingPolicy: z.literal(SOURCE_RETRIEVAL_RANKING_POLICY).optional(),
        requestedMode: z.enum(["lexical", "hybrid"]),
        effectiveMode: z.enum(["lexical", "hybrid"]),
        degradationReason: z.string().optional(),
        selectedPassageKeys: z.array(z.string()),
        omittedCandidateCount: z.number().int().nonnegative(),
    })
    .strict();
export const retrievalMetadataValidator = zodToConvex(retrievalMetadataSchema);
const STOP_WORDS = new Set(
    "the and for from with this that was were are is its not into about after also because their through within millionth".split(
        " ",
    ),
);
/** Native full-text queries have a 16-term bound. Reported values are not matching criteria; years remain periods. */
export function shortRetrievalQuery(text: string): string {
    const tokens = [
        ...new Set(
            (
                text
                    .toLowerCase()
                    .match(/[a-z][a-z0-9]{2,}|\b(?:19|20)\d{2}\b/g) ?? []
            ).filter((word) => !STOP_WORDS.has(word)),
        ),
    ];
    const metrics = new Set(
        "revenue arr retention margin income eps earnings debt cash profitability".split(
            " ",
        ),
    );
    const first = tokens.find((word) => metrics.has(word));
    if (first) {
        const qualifiers = new Set(
            "subscription recurring annual annualized total net gross operating million billion thousand usd dollars fiscal quarter quarters year months arr".split(
                " ",
            ),
        );
        const focused = tokens.filter(
            (word) =>
                word === first ||
                qualifiers.has(word) ||
                /^(?:19|20)\d{2}$/.test(word),
        );
        // Scope supplies company identity. Metric, period and basis take precedence over narrative vocabulary.
        return focused.slice(0, 16).join(" ");
    }
    return tokens.slice(0, 16).join(" ");
}
/** Shared comparison query input; retrieval applies the same bounded normalization in every caller. */
export function sourceComparisonQuery(
    finding: {
        passages: readonly { quotation: string }[];
        period: string;
        summary?: string;
        relevance?: string;
        scope?: string;
    },
    reportingPeriodEnd: string | null,
): string {
    const assertion =
        finding.relevance && finding.summary
            ? `${finding.summary} ${finding.scope ?? ""}`
            : finding.passages.map((p) => p.quotation).join(" ");
    return `${assertion} ${finding.period} ${reportingPeriodEnd ?? ""}`;
}
/** Equal-weight RRF avoids comparing incompatible lexical and cosine score scales. */
export function fuseRetrievalRanks(
    rankings: ReadonlyArray<readonly string[]>,
    identities?: ReadonlyMap<string, SourcePassageRankIdentity>,
): string[] {
    const scores = new Map<string, number>();
    for (const ranking of rankings)
        [...new Set(ranking)].forEach((id, index) => {
            scores.set(id, (scores.get(id) ?? 0) + 1 / (60 + index + 1));
        });
    return [...scores]
        .sort((a, b) => {
            if (b[1] !== a[1]) return b[1] - a[1];
            if (!identities) return a[0].localeCompare(b[0]);
            const left = identities.get(a[0]),
                right = identities.get(b[0]);
            if (!left || !right)
                throw new Error("Retrieved passage rank identity is missing");
            return compareSourcePassageRanks(left, right);
        })
        .map(([id]) => id);
}

/** Reads completion and validates vector scope without loading document bodies. */
export async function readCaptureIndexState(
    db: GenericDatabaseReader<DataModel>,
    revision: {
        runId: Id<"researchRuns">;
        corpusRevisionId: Id<"corpusRevisions">;
    },
    captureId: Id<"sourceCaptures">,
) {
    const state = await db
        .query("sourceSearchCaptures")
        .withIndex("by_scope_and_capture", (q) =>
            q
                .eq(
                    "scopeKey",
                    `${revision.runId}:${revision.corpusRevisionId}:${SOURCE_RETRIEVAL_VERSION}`,
                )
                .eq("captureId", captureId),
        )
        .unique();
    if (state?.embeddingProfile && state.candidateCount > 0) {
        // finishIndex publishes completion only after every batch has been linked.
        const first = await db
            .query("sourceSearchPassages")
            .withIndex("by_scope_capture_order", (q) =>
                q.eq("scopeKey", state.scopeKey).eq("captureId", captureId),
            )
            .first();
        if (
            first?.embeddingScopeKey !==
            sourceEmbeddingScopeKey(
                state.scopeKey,
                state.embeddingProfile,
                captureId,
            )
        ) {
            return {
                ...state,
                embeddingProfile: undefined,
                embeddingDegradationReason: "embedding_scope_outdated",
            };
        }
    }
    return state;
}

/** Stable source identity and the immutable representation selected by the server. */
export const sourceMaterialReferenceValidator = v.object({
    sourceId: v.id("sources"),
    captureId: v.id("sourceCaptures"),
    contentHash: v.string(),
});
