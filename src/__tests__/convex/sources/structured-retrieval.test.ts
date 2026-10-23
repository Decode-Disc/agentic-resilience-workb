import {
    extractPassagesFromNormalizedText,
    sha256Hex,
} from "@convex/domain/sourcePassages";
import { expect, test } from "vitest";

test("structured preparation can search late evidence without changing the legacy extraction ceiling", () => {
    const text = [
        ...Array.from(
            { length: 600 },
            (_, i) =>
                `Detailed disclosure ${i}. ${"Operational context. ".repeat(12)}`,
        ),
        "# Revenue",
        "Fiscal years ended November 30, 2025 and 2024. Amounts in millions.",
        "| Subscription revenue | 23,769 | 21,505 |",
        "Figures exclude discontinued operations.",
    ].join("\n\n");
    const args = {
        text,
        canonicalUrl: "https://example.com/report",
        sourceVersionHash: sha256Hex(text),
    };
    const legacy = extractPassagesFromNormalizedText(args);
    const candidates = extractPassagesFromNormalizedText({
        ...args,
        preparationVersion: "structured-v1",
    });
    expect(legacy).toHaveLength(512);
    const table = candidates.find((p) => p.exactQuotation.includes("23,769"));
    expect(table).toBeDefined();
    expect(table?.exactQuotation).toContain("Amounts in millions");
    expect(table?.exactQuotation).toContain("exclude discontinued");
    for (const p of candidates) {
        expect(text.slice(p.locator.startOffset, p.locator.endOffset)).toBe(
            p.exactQuotation,
        );
        expect(p.exactQuotation.length).toBeLessThanOrEqual(4000);
    }
});

import {
    fuseRetrievalRanks,
    shortRetrievalQuery,
} from "@convex/domain/sourceRetrievalPolicy";

test("query terms omit claimed values and fusion counts each list once", () => {
    expect(
        shortRetrievalQuery(
            "The subscription revenue was 23769 million USD in fiscal 2025 for Adobe and the subscription revenue",
        ),
    ).toBe("subscription revenue million usd fiscal 2025");
    expect(
        fuseRetrievalRanks(
            ["lexical-only", "both", "both"],
            ["both", "semantic-only"],
        ),
    ).toEqual(["both", "lexical-only", "semantic-only"]);
});

test("bounded materialization retains required late references and fails explicitly when mandatory context cannot fit", () => {
    const text = Array.from(
        { length: 600 },
        (_, i) => `Statement ${i}. ${"Detailed evidence. ".repeat(230)}`,
    ).join("\n\n");
    const last = text.lastIndexOf("Statement 599.");
    const args = {
        text,
        canonicalUrl: "https://example.com",
        sourceVersionHash: sha256Hex(text),
        preparationVersion: "structured-v1" as const,
        requiredSpans: [{ startOffset: last, endOffset: last + 14 }],
    };
    const selected = extractPassagesFromNormalizedText({
        ...args,
        maxPassages: 512,
    });
    expect(selected.length).toBeLessThanOrEqual(512);
    expect(
        selected.some((p) => p.exactQuotation.includes("Statement 599.")),
    ).toBe(true);
    expect(() =>
        extractPassagesFromNormalizedText({ ...args, maxPassages: 1 }),
    ).toThrow("required_passages_exceed_limit");
});

test("a table retains its reporting columns when a prose grouping boundary falls between header and rows", () => {
    const text = [
        `Preamble. ${"a".repeat(1650)}`,
        "Revenue for fiscal years ended November 30, 2025 and 2024.",
        "(dollars in millions) | 2025 | 2024 |",
        "Subscription | 22,904 | 20,521 |",
        "Other | 865 | 984 |",
        "Total revenue | 23,769 | 21,505 |",
        "Amounts exclude discontinued operations.",
    ].join("\n\n");
    const candidates = extractPassagesFromNormalizedText({
        text,
        canonicalUrl: "https://example.com",
        sourceVersionHash: sha256Hex(text),
        preparationVersion: "structured-v1",
    });
    const complete = candidates.find(
        (p) =>
            p.exactQuotation.includes("23,769") &&
            p.exactQuotation.includes("dollars in millions") &&
            p.exactQuotation.includes("November 30"),
    );
    expect(complete).toBeDefined();
});

test("long company introductions cannot displace the financial metric and reporting period from the native query", () => {
    const query = shortRetrievalQuery(
        "Example Inc fiscal year 2025 demonstrated operational durability through competition across creative enterprise software platforms and image generation tools: revenue of approximately 22.5 billion USD.",
    );
    expect(query.split(" ")).toContain("revenue");
    expect(query.split(" ")).toContain("2025");
    expect(query.split(" ")).not.toContain("approximately");
});

test("pathological heading expansion fails explicitly before searchable units can grow without bound", () => {
    const text = Array.from(
        { length: 20001 },
        (_, i) => `# Section ${i}\n\nA substantive statement.`,
    ).join("\n\n");
    expect(() =>
        extractPassagesFromNormalizedText({
            text,
            canonicalUrl: "https://example.com",
            sourceVersionHash: "bounded-fixture",
            preparationVersion: "structured-v1",
        }),
    ).toThrow("searchable_candidate_limit_exceeded");
});
