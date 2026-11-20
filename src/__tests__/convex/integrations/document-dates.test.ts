import { documentDates } from "@convex/domain/documentDates";
import { expect, test } from "vitest";

test("date reconciliation retains incompatible origins and separates date roles", () => {
    const dates = documentDates({
        metadata: [
            {
                kind: "publication",
                value: "2026-10-28",
                precision: "day",
                origin: {
                    kind: "metadata",
                    label: "published",
                    raw: "2026-10-28",
                },
            },
        ],
        text: "CHICAGO, Oct. 29, 2026 (GLOBE NEWSWIRE) --\nDate of Report (Date of earliest event reported): October 27, 2026",
    });
    expect(dates.publication.status).toBe("conflict");
    expect(dates.publication.evidence).toHaveLength(2);
    expect(dates.event).toMatchObject({
        status: "known",
        evidence: [{ value: "2026-10-27" }],
    });
    expect(
        documentDates({ metadata: [], text: "Later page", previous: dates }),
    ).toEqual(dates);
});
test.each([
    "CHICAGO, Feb. 30, 2026 (GLOBE NEWSWIRE) --",
    "On October 29, 2026, we released a product.",
    "October 2026",
    "",
])("invalid or narrative dates remain unknown: %s", (text) => {
    expect(documentDates({ metadata: [], text }).publication).toEqual({
        status: "unknown",
        evidence: [],
    });
});
test("matching day and instant retain their actual precision", () => {
    const dates = documentDates({
        metadata: [
            {
                kind: "publication",
                value: "2026-10-29T12:00:00Z",
                precision: "instant",
                origin: {
                    kind: "metadata",
                    label: "published",
                    raw: "2026-10-29T12:00:00Z",
                },
            },
        ],
        text: "CHICAGO, Oct. 29, 2026 (GLOBE NEWSWIRE) --",
    });
    expect(dates.publication.status).toBe("known");
    expect(dates.publication.evidence.map((item) => item.precision)).toEqual([
        "instant",
        "day",
    ]);
});

test.each([
    ["known", ["2026-10-29T23:00:00-02:00", "2026-10-30T01:00:00Z"]],
    ["conflict", ["2026-10-29T01:00:00Z", "2026-10-29T02:00:00Z"]],
] as const)("instant reconciliation preserves timestamp meaning: %s", (status, values) => {
    const result = documentDates({
        text: "",
        metadata: values.map((value) => ({
            kind: "publication",
            value,
            precision: "instant",
            origin: { kind: "metadata", label: "published", raw: value },
        })),
    });
    expect(result.publication.status).toBe(status);
    expect(result.publication.evidence).toHaveLength(2);
});

test("repeated compatible datelines retain independent origins and reject malformed markers", () => {
    const indications = Array.from(
        { length: 300 },
        (_, index) => `CITY ${index}--(BUSINESS WIRE)--Jul. 30, 2024--`,
    );
    const text = [`${"-".repeat(64000)}(BUSINESS WIRX)`, ...indications].join(
        "\n",
    );
    const dates = documentDates({ text, metadata: [] });
    expect(dates.publication.status).toBe("known");
    expect(dates.publication.evidence.map((item) => item.origin.raw)).toEqual(
        indications,
    );
    expect(
        dates.publication.evidence.every((item) => item.value === "2024-07-30"),
    ).toBe(true);
});
