import {
    MAX_NORMALIZED_ARTIFACT_BYTES,
    MAX_PASSAGES_PER_SOURCE,
    MAX_QUOTATION_CHARS,
    MAX_SOURCE_SEARCH_BLOCKS,
    MAX_SOURCE_SEARCH_CANDIDATES,
} from "@convex/resourcePolicy";
import { v } from "convex/values";
import { sha256Hex, stableStringify } from "./hashing";
import { SOURCE_RETRIEVAL_VERSION } from "./sourceRetrievalPolicy";

export const LOCATOR_VERSION = "web-v1";
export const PDF_LOCATOR_VERSION = "pdf-v1";

export { completeCharacterBoundary } from "./hashing";

export const webLocatorValidator = v.object({
    kind: v.literal("web"),
    canonicalUrl: v.string(),
    sourceVersionHash: v.string(),
    headingPath: v.optional(v.array(v.string())),
    exactQuotation: v.string(),
    startOffset: v.optional(v.number()),
    endOffset: v.optional(v.number()),
    boundingText: v.optional(v.string()),
    contextBefore: v.optional(v.string()),
    contextAfter: v.optional(v.string()),
});

export const pdfLocatorValidator = v.object({
    kind: v.literal("pdf"),
    canonicalUrl: v.string(),
    sourceVersionHash: v.string(),
    pageNumber: v.number(),
    headingPath: v.optional(v.array(v.string())),
    exactQuotation: v.string(),
    startOffset: v.optional(v.number()),
    endOffset: v.optional(v.number()),
    boundingText: v.optional(v.string()),
    contextBefore: v.optional(v.string()),
    contextAfter: v.optional(v.string()),
});

export const sourceLocatorValidator = v.union(
    webLocatorValidator,
    pdfLocatorValidator,
);

export type WebLocator = {
    kind: "web";
    canonicalUrl: string;
    sourceVersionHash: string;
    headingPath?: string[];
    exactQuotation: string;
    startOffset?: number;
    endOffset?: number;
    boundingText?: string;
    contextBefore?: string;
    contextAfter?: string;
};

export type PdfLocator = {
    kind: "pdf";
    canonicalUrl: string;
    sourceVersionHash: string;
    pageNumber: number;
    headingPath?: string[];
    exactQuotation: string;
    startOffset?: number;
    endOffset?: number;
    boundingText?: string;
    contextBefore?: string;
    contextAfter?: string;
};

export type SourceLocator = WebLocator | PdfLocator;

export type NormalizedPassage = {
    order: number;
    exactQuotation: string;
    quotationHash: string;
    locatorVersion: string;
    locator: SourceLocator;
    contextBefore?: string;
    contextAfter?: string;
    headingPath?: string[];
    pageNumber?: number;
};

type ExtractedPassage = NormalizedPassage & {
    locator: SourceLocator & { startOffset: number; endOffset: number };
};

// SHA-256 round constants (64 words).
export {
    advanceSha256,
    type Sha256Checkpoint,
    sha256CheckpointHex,
    sha256Hex,
    stableStringify,
} from "./hashing";

/**
 * Computes a collision-safe passage key by hashing the full passage identity:
 * sourceId + sourceVersionHash + locatorVersion + kind + full locator + order + quotationHash.
 */
export function computePassageKey(args: {
    sourceId: string;
    sourceVersionHash: string;
    locatorVersion: string;
    locator: SourceLocator;
    order: number;
    quotationHash: string;
}): string {
    const canonical = {
        sourceId: args.sourceId,
        sourceVersionHash: args.sourceVersionHash,
        locatorVersion: args.locatorVersion,
        locator: args.locator,
        order: args.order,
        quotationHash: args.quotationHash,
    };
    return sha256Hex(stableStringify(canonical));
}

/** Gives prose, tables and examples room before short navigation labels when reading is bounded. This is a formatting priority, not evidence qualification. */
export function hasDetailedPassageContent(quotation: string): boolean {
    const text = quotation
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/<[^>]+>/g, "")
        .trim();
    return (
        text.length >= 160 ||
        /[.!?](?:\s|$)/.test(text) ||
        /^\s*\|.+\|/m.test(text) ||
        text.includes("```")
    );
}

/** Prepares searchable units across the whole bounded capture, retaining exact source bytes. */
function extractStructuredPassages(args: {
    text: string;
    canonicalUrl: string;
    sourceVersionHash: string;
}): ExtractedPassage[] {
    if (
        new TextEncoder().encode(args.text).byteLength >
        MAX_NORMALIZED_ARTIFACT_BYTES
    ) {
        throw new Error("Searchable capture exceeds the source byte limit");
    }
    let units: Array<{ start: number; end: number; headings: string[] }> = [];
    const blocks: Array<{ start: number; end: number; headings: string[] }> =
        [];
    const headings: string[] = [];
    let group: { start: number; end: number; headings: string[] } | undefined;
    const appendUnit = (unit: {
        start: number;
        end: number;
        headings: string[];
    }) => {
        if (units.length >= MAX_SOURCE_SEARCH_CANDIDATES)
            throw new Error("searchable_candidate_limit_exceeded");
        units.push(unit);
    };
    const flush = () => {
        if (group) appendUnit(group);
        group = undefined;
    };
    for (const match of args.text.matchAll(
        /[^\n]+(?:\n(?![ \t]*\n)[^\n]+)*/g,
    )) {
        const raw = match[0];
        const trimmed = raw.trim();
        if (!trimmed) continue;
        const start = match.index + raw.indexOf(trimmed);
        const end = start + trimmed.length;
        const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
        if (heading) {
            flush();
            const marker = heading[1];
            const title = heading[2];
            if (!marker || !title)
                throw new Error("Invalid structured heading");
            headings.length = Math.min(headings.length, marker.length - 1);
            headings.push(title);
            continue;
        }
        if (blocks.length >= MAX_SOURCE_SEARCH_BLOCKS)
            throw new Error("searchable_candidate_limit_exceeded");
        blocks.push({ start, end, headings: [...headings] });
        if (group && end - group.start > 1800) flush();
        let offset = start;
        while (end - offset > MAX_QUOTATION_CHARS) {
            flush();
            let boundary = offset + MAX_QUOTATION_CHARS;
            const code = args.text.charCodeAt(boundary - 1);
            if (code >= 0xd800 && code <= 0xdbff) boundary -= 1;
            appendUnit({
                start: offset,
                end: boundary,
                headings: [...headings],
            });
            offset = boundary;
        }
        if (group) group.end = end;
        else group = { start: offset, end, headings: [...headings] };
    }
    flush();
    // A financial table is often delivered as blank-line-separated rows. Keep its columns and caption together when they fit an exact quotation.
    for (let i = 0; i < blocks.length; i++) {
        const first = blocks[i];
        if (!first) throw new Error("Invalid structured block order");
        if (!args.text.slice(first.start, first.end).includes("|")) continue;
        let endIndex = i;
        let endBlock = first;
        let next = blocks[endIndex + 1];
        while (next && args.text.slice(next.start, next.end).includes("|")) {
            endBlock = next;
            endIndex++;
            next = blocks[endIndex + 1];
        }
        let startIndex = i;
        let startBlock = first;
        let previous = blocks[startIndex - 1];
        while (
            previous &&
            i - startIndex < 2 &&
            first.start - previous.start < 500 &&
            previous.headings.join("/") === first.headings.join("/")
        ) {
            startBlock = previous;
            startIndex--;
            previous = blocks[startIndex - 1];
        }
        let end = endBlock.end;
        const after = blocks[endIndex + 1];
        if (
            after &&
            after.end - after.start < 300 &&
            /note|amount|exclude|include|basis|unaudited/i.test(
                args.text.slice(after.start, after.end),
            )
        )
            end = after.end;
        const start = startBlock.start;
        if (end - start <= MAX_QUOTATION_CHARS) {
            units = units.filter(
                (unit) => unit.start < start || unit.end > end,
            );
            appendUnit({ start, end, headings: first.headings });
        }
        i = endIndex;
    }
    units.sort((a, b) => a.start - b.start || a.end - b.end);
    return units.map((unit, order) => {
        const exactQuotation = args.text.slice(unit.start, unit.end);
        const contextBefore = args.text
            .slice(Math.max(0, unit.start - 150), unit.start)
            .trim();
        const contextAfter = args.text.slice(unit.end, unit.end + 150).trim();
        return {
            order,
            exactQuotation,
            quotationHash: sha256Hex(exactQuotation),
            locatorVersion: LOCATOR_VERSION,
            locator: {
                kind: "web",
                canonicalUrl: args.canonicalUrl,
                sourceVersionHash: args.sourceVersionHash,
                startOffset: unit.start,
                endOffset: unit.end,
                exactQuotation,
                headingPath: unit.headings,
                contextBefore,
                contextAfter,
            },
            headingPath: unit.headings,
            contextBefore,
            contextAfter,
        };
    });
}

function selectMaterializedPassages(
    candidates: ExtractedPassage[],
    maxPassages: number,
    requiredSpans: Array<{ startOffset: number; endOffset: number }>,
): ExtractedPassage[] {
    if (!Number.isSafeInteger(maxPassages) || maxPassages < 1)
        throw new Error("materialization_limit_invalid");
    const required = new Set<number>();
    const orders = new Set(candidates.map((p) => p.order));
    for (const span of requiredSpans) {
        if (
            !Number.isSafeInteger(span.startOffset) ||
            !Number.isSafeInteger(span.endOffset) ||
            span.startOffset < 0 ||
            span.endOffset <= span.startOffset
        )
            throw new Error("required_passage_unavailable");
        const passage = candidates.find(
            (p) =>
                p.locator.startOffset <= span.startOffset &&
                p.locator.endOffset >= span.endOffset,
        );
        if (!passage) throw new Error("required_passage_unavailable");
        for (let order = passage.order - 1; order <= passage.order + 1; order++)
            if (orders.has(order)) required.add(order);
    }
    if (required.size > maxPassages)
        throw new Error("required_passages_exceed_limit");
    for (const passage of candidates) {
        if (required.size >= maxPassages) break;
        required.add(passage.order);
    }
    return candidates
        .filter((p) => required.has(p.order))
        .sort((a, b) => a.order - b.order);
}

/** Extracts bounded passages across the document, preserving original paragraph identities and offsets. */
export function extractPassagesFromNormalizedText(args: {
    text: string;
    canonicalUrl: string;
    sourceVersionHash: string;
    maxPassages?: number;
    maxQuotationChars?: number;
    preparationVersion?: typeof SOURCE_RETRIEVAL_VERSION;
    requiredSpans?: Array<{ startOffset: number; endOffset: number }>;
}): ExtractedPassage[] {
    if (args.preparationVersion === SOURCE_RETRIEVAL_VERSION) {
        const candidates = extractStructuredPassages(args);
        return args.maxPassages === undefined
            ? candidates
            : selectMaterializedPassages(
                  candidates,
                  args.maxPassages,
                  args.requiredSpans ?? [],
              );
    }
    const maxPassages = args.maxPassages ?? MAX_PASSAGES_PER_SOURCE;
    const maxChars = args.maxQuotationChars ?? MAX_QUOTATION_CHARS;
    const preserveRequired = (args.requiredSpans?.length ?? 0) > 0;
    if (
        preserveRequired &&
        new TextEncoder().encode(args.text).byteLength >
            MAX_NORMALIZED_ARTIFACT_BYTES
    )
        throw new Error("Searchable capture exceeds the source byte limit");

    const lines = args.text.split("\n");
    const detailedPassages: ExtractedPassage[] = [];
    const briefPassages: ExtractedPassage[] = [];
    const currentHeadingPath: string[] = [];

    let currentBlock = "";
    let blockStartOffset = 0;
    let runningOffset = 0;
    let nextOrder = 0;

    function flushBlock() {
        const trimmed = currentBlock.trim();
        let chunkOffset = 0;
        while (chunkOffset < trimmed.length) {
            let chunkEnd = Math.min(chunkOffset + maxChars, trimmed.length);
            const boundaryCode = trimmed.charCodeAt(chunkEnd - 1);
            if (
                chunkEnd < trimmed.length &&
                boundaryCode >= 0xd800 &&
                boundaryCode <= 0xdbff
            ) {
                chunkEnd -= 1;
            }
            const quotation = trimmed.slice(chunkOffset, chunkEnd);
            if (quotation.length === 0) {
                throw new Error("Passage quotation limit must be positive");
            }
            const order = nextOrder++;
            const chunkStartOffset = blockStartOffset + chunkOffset;
            chunkOffset = chunkEnd;
            const bucket = hasDetailedPassageContent(quotation)
                ? detailedPassages
                : briefPassages;
            if (preserveRequired && nextOrder > MAX_SOURCE_SEARCH_CANDIDATES)
                throw new Error("searchable_candidate_limit_exceeded");
            if (!preserveRequired && bucket.length >= maxPassages) continue;
            const quotationHash = sha256Hex(quotation);

            const contextBefore =
                chunkStartOffset > 0
                    ? args.text
                          .slice(
                              Math.max(0, chunkStartOffset - 150),
                              chunkStartOffset,
                          )
                          .trim()
                    : undefined;
            const blockEndOffset = chunkStartOffset + quotation.length;
            const contextAfter =
                blockEndOffset < args.text.length
                    ? args.text
                          .slice(
                              blockEndOffset,
                              Math.min(args.text.length, blockEndOffset + 150),
                          )
                          .trim()
                    : undefined;

            const locator: WebLocator & {
                startOffset: number;
                endOffset: number;
            } = {
                kind: "web",
                canonicalUrl: args.canonicalUrl,
                sourceVersionHash: args.sourceVersionHash,
                ...(currentHeadingPath.length > 0
                    ? { headingPath: [...currentHeadingPath] }
                    : {}),
                exactQuotation: quotation,
                startOffset: chunkStartOffset,
                endOffset: blockEndOffset,
                boundingText:
                    quotation.length > 300
                        ? quotation.slice(0, 300)
                        : quotation,
                ...(contextBefore ? { contextBefore } : {}),
                ...(contextAfter ? { contextAfter } : {}),
            };

            bucket.push({
                order,
                exactQuotation: quotation,
                quotationHash,
                locatorVersion: LOCATOR_VERSION,
                locator,
                ...(contextBefore ? { contextBefore } : {}),
                ...(contextAfter ? { contextAfter } : {}),
                ...(currentHeadingPath.length > 0
                    ? { headingPath: [...currentHeadingPath] }
                    : {}),
            });
        }
        currentBlock = "";
    }

    for (const line of lines) {
        const trimmedLine = line.trim();
        const lineOffset = runningOffset;
        runningOffset += line.length + 1; // +1 for newline

        if (!trimmedLine) {
            flushBlock();
            continue;
        }

        // Check if line is a heading marker (e.g., "# Heading" or all caps short title)
        if (
            trimmedLine.startsWith("# ") ||
            trimmedLine.startsWith("## ") ||
            trimmedLine.startsWith("### ")
        ) {
            flushBlock();
            const headingText = trimmedLine.replace(/^#+\s*/, "");
            currentHeadingPath.length = 0;
            currentHeadingPath.push(headingText);
            continue;
        }

        if (!currentBlock) {
            blockStartOffset = lineOffset;
            currentBlock = trimmedLine;
        } else {
            currentBlock += `\n${trimmedLine}`;
        }
    }

    flushBlock();
    if (preserveRequired)
        return selectMaterializedPassages(
            [...detailedPassages, ...briefPassages],
            maxPassages,
            args.requiredSpans ?? [],
        );
    return [
        ...detailedPassages,
        ...briefPassages.slice(
            0,
            Math.max(0, maxPassages - detailedPassages.length),
        ),
    ].sort((left, right) => left.order - right.order);
}

/**
 * Extracts structured passages from page-separated PDF content.
 * Offsets are page-relative.
 */
export function extractPdfPassagesFromPages(
    pages: ReadonlyArray<{
        pageNumber: number;
        text: string;
        headingPath?: string[];
    }>,
    args: {
        canonicalUrl: string;
        sourceVersionHash: string;
        maxPassages?: number;
        maxQuotationChars?: number;
    },
): NormalizedPassage[] {
    const maxPassages = args.maxPassages ?? MAX_PASSAGES_PER_SOURCE;
    const maxChars = args.maxQuotationChars ?? MAX_QUOTATION_CHARS;
    const passages: NormalizedPassage[] = [];

    for (const page of pages) {
        if (passages.length >= maxPassages) {
            break;
        }

        const lines = page.text.split("\n");
        const currentHeadingPath: string[] = page.headingPath
            ? [...page.headingPath]
            : [];
        let currentBlock = "";
        let blockStartOffset = 0;
        let runningOffset = 0;

        function flushBlock() {
            const trimmed = currentBlock.trim();
            if (trimmed.length > 0 && passages.length < maxPassages) {
                const quotation =
                    trimmed.length > maxChars
                        ? trimmed.slice(0, maxChars)
                        : trimmed;
                const quotationHash = sha256Hex(quotation);
                const order = passages.length;

                const contextBefore =
                    blockStartOffset > 0
                        ? page.text
                              .slice(
                                  Math.max(0, blockStartOffset - 150),
                                  blockStartOffset,
                              )
                              .trim()
                        : undefined;
                const blockEndOffset = blockStartOffset + trimmed.length;
                const contextAfter =
                    blockEndOffset < page.text.length
                        ? page.text
                              .slice(
                                  blockEndOffset,
                                  Math.min(
                                      page.text.length,
                                      blockEndOffset + 150,
                                  ),
                              )
                              .trim()
                        : undefined;

                const locator: PdfLocator = {
                    kind: "pdf",
                    canonicalUrl: args.canonicalUrl,
                    sourceVersionHash: args.sourceVersionHash,
                    pageNumber: page.pageNumber,
                    ...(currentHeadingPath.length > 0
                        ? { headingPath: [...currentHeadingPath] }
                        : {}),
                    exactQuotation: quotation,
                    startOffset: blockStartOffset,
                    endOffset: blockStartOffset + quotation.length,
                    boundingText:
                        trimmed.length > 300 ? trimmed.slice(0, 300) : trimmed,
                    ...(contextBefore ? { contextBefore } : {}),
                    ...(contextAfter ? { contextAfter } : {}),
                };

                passages.push({
                    order,
                    exactQuotation: quotation,
                    quotationHash,
                    locatorVersion: PDF_LOCATOR_VERSION,
                    locator,
                    pageNumber: page.pageNumber,
                    ...(contextBefore ? { contextBefore } : {}),
                    ...(contextAfter ? { contextAfter } : {}),
                    ...(currentHeadingPath.length > 0
                        ? { headingPath: [...currentHeadingPath] }
                        : {}),
                });
            }
            currentBlock = "";
        }

        for (const line of lines) {
            const trimmedLine = line.trim();
            const lineOffset = runningOffset;
            runningOffset += line.length + 1;

            if (!trimmedLine) {
                flushBlock();
                continue;
            }

            if (
                trimmedLine.startsWith("# ") ||
                trimmedLine.startsWith("## ") ||
                trimmedLine.startsWith("### ")
            ) {
                flushBlock();
                const headingText = trimmedLine.replace(/^#+\s*/, "");
                currentHeadingPath.length = 0;
                currentHeadingPath.push(headingText);
                continue;
            }

            if (!currentBlock) {
                blockStartOffset = lineOffset;
                currentBlock = trimmedLine;
            } else {
                currentBlock += `\n${trimmedLine}`;
            }
        }

        flushBlock();
    }

    return passages;
}

/**
 * Prepares an immutable document snapshot for any number of exact citation checks.
 * Each locator retains its own version-hash and bounds checks. Keep the returned
 * function scoped to processing this document rather than caching it globally.
 */
export function preparePassageReproduction(
    storedArtifact: string | Uint8Array,
): (locator: SourceLocator) => string {
    const bytes =
        typeof storedArtifact === "string"
            ? new TextEncoder().encode(storedArtifact)
            : storedArtifact;
    const text =
        typeof storedArtifact === "string"
            ? storedArtifact
            : new TextDecoder().decode(storedArtifact);

    const artifactHash = sha256Hex(bytes);
    let pages: string[] | undefined;
    return (locator) => {
        if (artifactHash !== locator.sourceVersionHash) {
            throw new Error(
                `Source version hash mismatch: expected ${locator.sourceVersionHash}, computed ${artifactHash}`,
            );
        }

        if (locator.kind === "pdf") {
            pages ??= text.split(/\f\n?/);
            const pageText = pages[locator.pageNumber - 1];
            if (pageText === undefined) {
                throw new Error(
                    `Page ${locator.pageNumber} not found in stored artifact (${pages.length} pages available)`,
                );
            }

            if (
                typeof locator.startOffset !== "number" ||
                typeof locator.endOffset !== "number" ||
                locator.startOffset < 0 ||
                locator.endOffset > pageText.length ||
                locator.startOffset > locator.endOffset
            ) {
                throw new Error(
                    `Invalid PDF passage character offsets: page=${locator.pageNumber}, startOffset=${locator.startOffset}, endOffset=${locator.endOffset}, pageLength=${pageText.length}`,
                );
            }

            const slice = pageText.slice(
                locator.startOffset,
                locator.endOffset,
            );
            if (slice !== locator.exactQuotation) {
                throw new Error(
                    `PDF passage quotation mismatch at page ${locator.pageNumber} offsets [${locator.startOffset}, ${locator.endOffset}]: expected exact quotation does not match stored slice`,
                );
            }

            return slice;
        }

        if (
            typeof locator.startOffset !== "number" ||
            typeof locator.endOffset !== "number" ||
            locator.startOffset < 0 ||
            locator.endOffset > text.length ||
            locator.startOffset > locator.endOffset
        ) {
            throw new Error(
                `Invalid passage character offsets: startOffset=${locator.startOffset}, endOffset=${locator.endOffset}, textLength=${text.length}`,
            );
        }

        const slice = text.slice(locator.startOffset, locator.endOffset);
        if (slice !== locator.exactQuotation) {
            throw new Error(
                `Passage quotation mismatch at offsets [${locator.startOffset}, ${locator.endOffset}]: expected exact quotation does not match stored slice`,
            );
        }

        return slice;
    };
}
