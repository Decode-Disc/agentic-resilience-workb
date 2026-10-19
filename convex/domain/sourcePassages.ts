import { v } from "convex/values";
import {
    MAX_PASSAGES_PER_SOURCE,
    MAX_QUOTATION_CHARS,
} from "@convex/resourceLimits";

export const LOCATOR_VERSION = "web-v1";
export const PDF_LOCATOR_VERSION = "pdf-v1";

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

// SHA-256 round constants (64 words).
const SHA256_K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

// SHA-256 initial hash values (8 words).
const SHA256_H0 = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
]);

function rotateRight(value: number, bits: number): number {
    return (value >>> bits) | (value << (32 - bits));
}

/**
 * Reads a 32-bit word at an always-in-bounds index of a typed array. The
 * nullish default is only a TypeScript narrowing step (indexed access adds
 * `| undefined` to the type); these reads are all provably populated.
 */
function wordAt(words: Uint32Array, index: number): number {
    return words[index] ?? 0;
}

/**
 * Deterministic synchronous pure TypeScript SHA-256 over raw bytes (FIPS 180-4),
 * returning the digest as a lowercase 64-character hex string.
 * Kept dependency-free so Convex V8 mutation/query bundling can inline this module
 * without a node:crypto import. Matches the node:crypto "sha256"/"hex" output exactly.
 */
function sha256BytesToHex(message: Uint8Array): string {
    const messageLength = message.length;
    const bitLengthHigh = Math.floor((messageLength * 8) / 0x100000000) >>> 0;
    const bitLengthLow = (messageLength * 8) >>> 0;
    // Message is always padded with at least one 0x80 byte plus an 8-byte length
    // field, so the padded block count is (messageLength + 8) rounded up to 64.
    const paddedLength = (((messageLength + 8) >> 6) + 1) << 6;
    const padded = new Uint8Array(paddedLength);
    padded.set(message);
    padded[messageLength] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(paddedLength - 8, bitLengthHigh);
    view.setUint32(paddedLength - 4, bitLengthLow);

    // Working hash registers held as scalars.
    let h0 = wordAt(SHA256_H0, 0);
    let h1 = wordAt(SHA256_H0, 1);
    let h2 = wordAt(SHA256_H0, 2);
    let h3 = wordAt(SHA256_H0, 3);
    let h4 = wordAt(SHA256_H0, 4);
    let h5 = wordAt(SHA256_H0, 5);
    let h6 = wordAt(SHA256_H0, 6);
    let h7 = wordAt(SHA256_H0, 7);
    const schedule = new Uint32Array(64);

    for (let block = 0; block < paddedLength; block += 64) {
        // Load the next 16 big-endian message words.
        for (let i = 0; i < 16; i++) {
            schedule[i] = view.getUint32(block + i * 4);
        }
        // Expand the message schedule (16..63).
        for (let i = 16; i < 64; i++) {
            const sigma0 =
                rotateRight(wordAt(schedule, i - 15), 7) ^
                rotateRight(wordAt(schedule, i - 15), 18) ^
                (wordAt(schedule, i - 15) >>> 3);
            const sigma1 =
                rotateRight(wordAt(schedule, i - 2), 17) ^
                rotateRight(wordAt(schedule, i - 2), 19) ^
                (wordAt(schedule, i - 2) >>> 10);
            schedule[i] =
                (wordAt(schedule, i - 16) +
                    sigma0 +
                    wordAt(schedule, i - 7) +
                    sigma1) >>>
                0;
        }

        let a = h0,
            b = h1,
            c = h2,
            d = h3;
        let e = h4,
            f = h5,
            g = h6,
            hh = h7;

        // 64 compression rounds.
        for (let i = 0; i < 64; i++) {
            const sigma1 =
                rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
            const choose = (e & f) ^ (~e & g);
            const temp1 =
                (hh +
                    sigma1 +
                    choose +
                    wordAt(SHA256_K, i) +
                    wordAt(schedule, i)) >>>
                0;
            const sigma0 =
                rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
            const majority = (a & b) ^ (a & c) ^ (b & c);
            const temp2 = (sigma0 + majority) >>> 0;

            hh = g;
            g = f;
            f = e;
            e = (d + temp1) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (temp1 + temp2) >>> 0;
        }

        h0 = (h0 + a) >>> 0;
        h1 = (h1 + b) >>> 0;
        h2 = (h2 + c) >>> 0;
        h3 = (h3 + d) >>> 0;
        h4 = (h4 + e) >>> 0;
        h5 = (h5 + f) >>> 0;
        h6 = (h6 + g) >>> 0;
        h7 = (h7 + hh) >>> 0;
    }

    return [h0, h1, h2, h3, h4, h5, h6, h7]
        .map((word) => word.toString(16).padStart(8, "0"))
        .join("");
}

/**
 * Lowercase 64-char SHA-256 hex digest of UTF-8 bytes (string) or raw bytes
 * (Uint8Array), computed with a dependency-free deterministic implementation.
 */
export function sha256Hex(content: string | Uint8Array): string {
    const bytes =
        typeof content === "string"
            ? new TextEncoder().encode(content)
            : content;
    return sha256BytesToHex(bytes);
}

/**
 * Deterministic JSON serialization that sorts object keys recursively so the
 * same logical value hashes identically regardless of key insertion order
 * (Convex re-serializes stored objects with sorted keys).
 */
function stableStringify(value: unknown): string {
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(",")}]`;
    }
    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(",")}}`;
}

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

/**
 * Extracts structured, reproducible passages from a normalized text document.
 * Segments document into semantic paragraphs/sections bounded by limits.
 */
export function extractPassagesFromNormalizedText(args: {
    text: string;
    canonicalUrl: string;
    sourceVersionHash: string;
    maxPassages?: number;
    maxQuotationChars?: number;
}): NormalizedPassage[] {
    const maxPassages = args.maxPassages ?? MAX_PASSAGES_PER_SOURCE;
    const maxChars = args.maxQuotationChars ?? MAX_QUOTATION_CHARS;

    const lines = args.text.split("\n");
    const passages: NormalizedPassage[] = [];
    const currentHeadingPath: string[] = [];

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
                    ? args.text
                          .slice(
                              Math.max(0, blockStartOffset - 150),
                              blockStartOffset,
                          )
                          .trim()
                    : undefined;
            const blockEndOffset = blockStartOffset + trimmed.length;
            const contextAfter =
                blockEndOffset < args.text.length
                    ? args.text
                          .slice(
                              blockEndOffset,
                              Math.min(args.text.length, blockEndOffset + 150),
                          )
                          .trim()
                    : undefined;

            const locator: WebLocator = {
                kind: "web",
                canonicalUrl: args.canonicalUrl,
                sourceVersionHash: args.sourceVersionHash,
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
    return passages;
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
 * Verifies that a passage locator's exactQuotation can be reproduced
 * against the stored normalized artifact.
 * Hashes stored bytes, verifies hash equality against locator.sourceVersionHash,
 * validates non-negative in-bounds character offsets, and ensures exact slice match.
 */
export async function reproducePassage(
    storedArtifact: string | Uint8Array,
    locator: SourceLocator,
): Promise<string> {
    const bytes =
        typeof storedArtifact === "string"
            ? new TextEncoder().encode(storedArtifact)
            : storedArtifact;
    const text =
        typeof storedArtifact === "string"
            ? storedArtifact
            : new TextDecoder().decode(storedArtifact);

    const artifactHash = sha256Hex(bytes);
    if (artifactHash !== locator.sourceVersionHash) {
        throw new Error(
            `Source version hash mismatch: expected ${locator.sourceVersionHash}, computed ${artifactHash}`,
        );
    }

    if (locator.kind === "pdf") {
        const pages = text.split(/\f\n?/);
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

        const slice = pageText.slice(locator.startOffset, locator.endOffset);
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
}
