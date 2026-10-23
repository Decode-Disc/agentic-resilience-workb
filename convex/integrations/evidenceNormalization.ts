import { sha256Hex } from "@convex/domain/sourcePassages";
import { MAX_NORMALIZED_ARTIFACT_BYTES } from "@convex/resourceLimits";

export const SEC_NORMALIZER_VERSION = "sec-html-v1";
export const EXA_NORMALIZER_VERSION = "exa-text-v1";
export const PDF_NORMALIZER_VERSION = "pdf-fixture-v1";
export const QUALIFICATION_NORMALIZER_VERSION = "qualification-text-v1";

export type NormalizedArtifact = {
    normalizedText: string;
    contentHash: string;
    normalizerVersion: string;
    mediaType: "text/plain";
    byteCount: number;
    normalizedPages?: ReadonlyArray<{
        pageNumber: number;
        text: string;
        headingPath?: string[];
    }>;
};

/**
 * Normalizes raw SEC filing HTML into a clean, deterministic, UTF-8 text representation.
 * - Strips script, style, noscript, svg, canvas, and comment elements.
 * - Converts headings (h1-h6) to `# Heading` format for hierarchical structure.
 * - Formats paragraphs, list items, and table cells cleanly.
 * - Unescapes HTML entities.
 * - Enforces the 16 MiB normalized limit.
 */
export function normalizeSecHtml(
    rawHtml: string,
    options: { maxBytes?: number; normalizerVersion?: string } = {},
): NormalizedArtifact {
    const maxBytes = options.maxBytes ?? MAX_NORMALIZED_ARTIFACT_BYTES;
    const normalizerVersion =
        options.normalizerVersion ?? SEC_NORMALIZER_VERSION;

    // 1. Remove non-content tags and their contents
    let text = rawHtml
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
        .replace(
            /<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi,
            "",
        )
        .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, "");

    // 2. Convert headings to markdown-style markers
    text = text.replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, "\n\n# $1\n\n");
    text = text.replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, "\n\n## $1\n\n");
    text = text.replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, "\n\n### $1\n\n");
    text = text.replace(
        /<h[4-6]\b[^>]*>([\s\S]*?)<\/h[4-6]>/gi,
        "\n\n### $1\n\n",
    );

    // 3. Block elements to newlines
    text = text.replace(/<br\s*\/?>/gi, "\n");
    text = text.replace(
        /<\/(p|div|tr|li|blockquote|section|article)>/gi,
        "\n\n",
    );
    text = text.replace(/<\/(td|th)>/gi, " | ");

    // 4. Strip all remaining HTML tags
    text = text.replace(/<[^>]+>/g, " ");

    // 5. Decode common HTML entities
    text = text
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&mdash;/gi, "—")
        .replace(/&ndash;/gi, "–")
        .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)));

    // 6. Clean up whitespace per line and collapse excessive blank lines
    const lines = text
        .split("\n")
        .map((line) => line.replace(/[ \t]+/g, " ").trim());

    const resultLines: string[] = [];
    let consecutiveBlanks = 0;

    for (const line of lines) {
        if (line.length === 0) {
            consecutiveBlanks += 1;
            if (consecutiveBlanks <= 1 && resultLines.length > 0) {
                resultLines.push("");
            }
        } else {
            consecutiveBlanks = 0;
            resultLines.push(line);
        }
    }

    const normalizedText = resultLines.join("\n").trim();

    // Check byte limit
    const encoder = new TextEncoder();
    const encoded = encoder.encode(normalizedText);

    if (encoded.byteLength > maxBytes) {
        throw new Error(
            `Normalized SEC HTML byte size ${encoded.byteLength} exceeds limit of ${maxBytes} bytes`,
        );
    }

    const contentHash = sha256Hex(encoded);

    return {
        normalizedText,
        contentHash,
        normalizerVersion,
        mediaType: "text/plain",
        byteCount: encoded.byteLength,
    };
}

function stripControlCharacters(input: string): string {
    return input.replace(
        // biome-ignore lint/suspicious/noControlCharactersInRegex: sanitize control chars in raw documents
        /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,
        "",
    );
}

/**
 * Normalizes raw Exa text into a clean, deterministic UTF-8 text representation.
 * Cleans control characters, standardizes line breaks, and bounds to 16 MiB.
 */
export function normalizeExaText(
    rawText: string,
    options: { maxBytes?: number; normalizerVersion?: string } = {},
): NormalizedArtifact {
    const maxBytes = options.maxBytes ?? MAX_NORMALIZED_ARTIFACT_BYTES;
    const normalizerVersion =
        options.normalizerVersion ?? EXA_NORMALIZER_VERSION;

    const text = stripControlCharacters(
        rawText.replace(/\r\n/g, "\n").replace(/\r/g, "\n"),
    );

    const lines = text
        .split("\n")
        .map((line) => line.replace(/[ \t]+/g, " ").trim());

    const resultLines: string[] = [];
    let consecutiveBlanks = 0;

    for (const line of lines) {
        if (line.length === 0) {
            consecutiveBlanks += 1;
            if (consecutiveBlanks <= 1 && resultLines.length > 0) {
                resultLines.push("");
            }
        } else {
            consecutiveBlanks = 0;
            resultLines.push(line);
        }
    }

    const normalizedText = resultLines.join("\n").trim();

    const encoder = new TextEncoder();
    const encoded = encoder.encode(normalizedText);

    if (encoded.byteLength > maxBytes) {
        throw new Error(
            `Normalized Exa text byte size ${encoded.byteLength} exceeds limit of ${maxBytes} bytes`,
        );
    }

    const contentHash = sha256Hex(encoded);

    return {
        normalizedText,
        contentHash,
        normalizerVersion,
        mediaType: "text/plain",
        byteCount: encoded.byteLength,
    };
}

/** Removes embedded image bytes while retaining captions in a captured text representation. */
export function normalizeQualificationText(
    rawText: string,
): NormalizedArtifact {
    const text = rawText
        .replace(/!\[([^\]]*)\]\(data:image\/[^)]+\)/gi, "$1")
        .replace(/<img\b[^>]*>/gi, (tag) => {
            const alt = /\balt\s*=\s*["']([^"']*)["']/i.exec(tag);
            return alt?.[1] ?? "";
        })
        .replace(
            /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi,
            "[embedded image omitted]",
        );
    return normalizeExaText(text, {
        normalizerVersion: QUALIFICATION_NORMALIZER_VERSION,
    });
}

/**
 * Normalizes PDF pages into a deterministic UTF-8 text representation separated by form-feed (`\f\n`).
 */
export function normalizePdfPages(
    pages: ReadonlyArray<{
        pageNumber: number;
        text: string;
        headingPath?: string[];
    }>,
    options: { maxBytes?: number; normalizerVersion?: string } = {},
): NormalizedArtifact {
    const maxBytes = options.maxBytes ?? MAX_NORMALIZED_ARTIFACT_BYTES;
    const normalizerVersion =
        options.normalizerVersion ?? PDF_NORMALIZER_VERSION;

    if (pages.length === 0) {
        throw new Error("PDF page normalization requires at least one page");
    }

    const normalizedPages: Array<{
        pageNumber: number;
        text: string;
        headingPath?: string[];
    }> = [];

    for (let index = 0; index < pages.length; index += 1) {
        const page = pages[index];
        if (!page || page.pageNumber !== index + 1) {
            throw new Error(
                `Invalid PDF page numbers: page at index ${index} has pageNumber ${page?.pageNumber}, expected ${index + 1}`,
            );
        }

        const text = stripControlCharacters(
            page.text.replace(/\r\n/g, "\n").replace(/\r/g, "\n"),
        );

        const lines = text
            .split("\n")
            .map((line) => line.replace(/[ \t]+/g, " ").trim());

        const resultLines: string[] = [];
        let consecutiveBlanks = 0;

        for (const line of lines) {
            if (line.length === 0) {
                consecutiveBlanks += 1;
                if (consecutiveBlanks <= 1 && resultLines.length > 0) {
                    resultLines.push("");
                }
            } else {
                consecutiveBlanks = 0;
                resultLines.push(line);
            }
        }

        const normalizedPageText = resultLines.join("\n").trim();
        normalizedPages.push({
            pageNumber: page.pageNumber,
            text: normalizedPageText,
            headingPath: page.headingPath,
        });
    }

    const normalizedText = normalizedPages
        .map((p) => p.text)
        .join("\f\n")
        .trim();

    const encoder = new TextEncoder();
    const encoded = encoder.encode(normalizedText);

    if (encoded.byteLength > maxBytes) {
        throw new Error(
            `Normalized PDF text byte size ${encoded.byteLength} exceeds limit of ${maxBytes} bytes`,
        );
    }

    const contentHash = sha256Hex(encoded);

    return {
        normalizedText,
        normalizedPages,
        contentHash,
        normalizerVersion,
        mediaType: "text/plain",
        byteCount: encoded.byteLength,
    };
}
