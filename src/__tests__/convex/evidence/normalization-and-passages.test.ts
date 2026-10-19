import {
    extractPassagesFromNormalizedText,
    extractPdfPassagesFromPages,
    LOCATOR_VERSION,
    PDF_LOCATOR_VERSION,
    reproducePassage,
    sha256Hex,
} from "@convex/domain/sourcePassages";
import {
    normalizeExaText,
    normalizePdfPages,
    normalizeSecHtml,
} from "@convex/integrations/evidenceNormalization";
import { describe, expect, test } from "vitest";

describe("evidenceNormalization", () => {
    test("normalizes SEC HTML deterministically, stripping scripts and styling while preserving text and headings", () => {
        const rawHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>.hide { display: none; }</style>
                <script>console.log("bad");</script>
            </head>
            <body>
                <h1>ITEM 1. BUSINESS</h1>
                <p>CCC Intelligent Solutions Inc. provides SaaS solutions for the property and casualty insurance economy.</p>
                <div>
                    <h2>Cloud Architecture</h2>
                    <p>Our hyperscale multi-tenant architecture spans multiple cloud regions with zero-trust network boundaries.</p>
                </div>
            </body>
            </html>
        `;

        const normalized = normalizeSecHtml(rawHtml);

        expect(normalized.normalizerVersion).toBe("sec-html-v1");
        expect(normalized.mediaType).toBe("text/plain");
        expect(normalized.normalizedText).toContain("ITEM 1. BUSINESS");
        expect(normalized.normalizedText).toContain("Cloud Architecture");
        expect(normalized.normalizedText).toContain(
            "hyperscale multi-tenant architecture",
        );
        expect(normalized.normalizedText).not.toContain("<style>");
        expect(normalized.normalizedText).not.toContain("console.log");
        expect(normalized.contentHash).toBe(
            sha256Hex(normalized.normalizedText),
        );
        expect(normalized.byteCount).toBe(
            new TextEncoder().encode(normalized.normalizedText).byteLength,
        );
    });

    test("extracts reproducible passages and verifies exact quotation replay", async () => {
        const rawHtml = `
            <html>
            <body>
                <h1>Business Overview</h1>
                <p>The company provides mission-critical cloud software.</p>
                <p>Annual recurring revenue grew 15% year-over-year.</p>
            </body>
            </html>
        `;

        const { normalizedText, contentHash } = normalizeSecHtml(rawHtml);
        const passages = extractPassagesFromNormalizedText({
            text: normalizedText,
            canonicalUrl:
                "https://www.sec.gov/Archives/edgar/data/1818201/000181820124000010/cccs-20231231.htm",
            sourceVersionHash: contentHash,
        });

        expect(passages.length).toBeGreaterThanOrEqual(2);
        const firstPassage = passages[0];
        expect(firstPassage).toBeDefined();
        if (!firstPassage) throw new Error("Expected at least one passage");

        expect(firstPassage.order).toBe(0);
        expect(firstPassage.locatorVersion).toBe(LOCATOR_VERSION);
        expect(firstPassage.exactQuotation).toContain(
            "mission-critical cloud software",
        );

        // Replay verification against the raw normalized artifact
        const replayed = await reproducePassage(
            normalizedText,
            firstPassage.locator,
        );
        expect(replayed).toBe(firstPassage.exactQuotation);

        // Replay verification against stored Uint8Array bytes (as returned by Convex storage)
        const storedBytes = new TextEncoder().encode(normalizedText);
        const replayedFromBytes = await reproducePassage(
            storedBytes,
            firstPassage.locator,
        );
        expect(replayedFromBytes).toBe(firstPassage.exactQuotation);
    });

    test("reproducePassage throws if quotation was altered or missing from stored artifact", async () => {
        const artifact = "Some other document content without the quote";
        const locator = {
            kind: "web" as const,
            canonicalUrl: "https://www.sec.gov/doc.htm",
            sourceVersionHash: "abc",
            exactQuotation: "missing text",
        };

        await expect(reproducePassage(artifact, locator)).rejects.toThrow(
            /Source version hash mismatch|Passage could not be reproduced/,
        );
    });

    test("H6: normalizePdfPages validates sequential 1-indexed page numbering", () => {
        // Non-sequential pages [1, 3]
        expect(() =>
            normalizePdfPages([
                { pageNumber: 1, text: "Page 1" },
                { pageNumber: 3, text: "Page 3" },
            ]),
        ).toThrow(/page number/i);

        // 0-indexed pages [0, 1]
        expect(() =>
            normalizePdfPages([
                { pageNumber: 0, text: "Page 0" },
                { pageNumber: 1, text: "Page 1" },
            ]),
        ).toThrow(/page number/i);

        // Duplicate page numbers [1, 1]
        expect(() =>
            normalizePdfPages([
                { pageNumber: 1, text: "Page 1" },
                { pageNumber: 1, text: "Page 1 dup" },
            ]),
        ).toThrow(/page number/i);
    });

    test("H6: PDF normalization handles whitespace, control chars, CRLF and reproduces passages exactly", async () => {
        const pages = [
            {
                pageNumber: 1,
                text: "  \r\n\t# PDF Header\x00\r\n\r\nThis is the first page of the PDF report.\r\n\r\nSecond paragraph here.\r\n  ",
            },
            {
                pageNumber: 2,
                text: "## Section Two\r\n\r\nContent on second page with resilient design.\r\n",
            },
        ];

        const normalized = normalizePdfPages(pages);
        expect(normalized.normalizerVersion).toBe("pdf-fixture-v1");
        expect(normalized.normalizedPages).toBeDefined();
        if (!normalized.normalizedPages)
            throw new Error("Expected normalizedPages");
        expect(normalized.normalizedPages).toHaveLength(2);
        expect(normalized.normalizedPages[0]?.text).toContain(
            "This is the first page of the PDF report.",
        );
        expect(normalized.normalizedPages[0]?.text).not.toContain("\x00");
        expect(normalized.normalizedPages[0]?.text).not.toContain("\r");

        const passages = extractPdfPassagesFromPages(
            normalized.normalizedPages,
            {
                canonicalUrl: "https://example.com/doc.pdf",
                sourceVersionHash: normalized.contentHash,
            },
        );

        expect(passages.length).toBeGreaterThanOrEqual(2);
        for (const p of passages) {
            expect(p.locatorVersion).toBe(PDF_LOCATOR_VERSION);
            const replayed = await reproducePassage(
                normalized.normalizedText,
                p.locator,
            );
            expect(replayed).toBe(p.exactQuotation);
        }
    });

    test("H8: normalizers throw oversize error instead of silently truncating", () => {
        const huge = "X".repeat(100);
        const options = { maxBytes: 50 };

        expect(() => normalizeSecHtml(`<p>${huge}</p>`, options)).toThrow(
            /exceeds.*limit/i,
        );
        expect(() => normalizeExaText(huge, options)).toThrow(
            /exceeds.*limit/i,
        );
        expect(() =>
            normalizePdfPages([{ pageNumber: 1, text: huge }], options),
        ).toThrow(/exceeds.*limit/i);
    });
});
