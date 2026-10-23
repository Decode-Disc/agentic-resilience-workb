import { v } from "convex/values";
import { zodToConvex } from "convex-helpers/server/zod4";
import { z } from "zod";
export const SOURCE_RETRIEVAL_VERSION = "structured-v1";
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
    finding: { passages: readonly { quotation: string }[]; period: string },
    reportingPeriodEnd: string | null,
): string {
    return `${finding.passages.map((p) => p.quotation).join(" ")} ${finding.period} ${reportingPeriodEnd ?? ""}`;
}
/** Equal-weight RRF avoids comparing incompatible lexical and cosine score scales. */
export function fuseRetrievalRanks(
    ...rankings: ReadonlyArray<readonly string[]>
): string[] {
    const scores = new Map<string, number>();
    for (const ranking of rankings)
        [...new Set(ranking)].forEach((id, index) => {
            scores.set(id, (scores.get(id) ?? 0) + 1 / (60 + index + 1));
        });
    return [...scores]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([id]) => id);
}
