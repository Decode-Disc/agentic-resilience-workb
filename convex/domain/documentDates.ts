import { zodToConvex } from "convex-helpers/server/zod4";
import { z } from "zod";

const dateEvidenceSchema = z.object({
    kind: z.enum(["publication", "filing", "event"]),
    value: z.string(),
    precision: z.enum(["day", "instant"]),
    origin: z.object({
        kind: z.enum(["metadata", "sec_field", "dateline"]),
        label: z.string(),
        raw: z.string(),
    }),
});
const dateGroupSchema = z.object({
    status: z.enum(["unknown", "known", "conflict"]),
    evidence: z.array(dateEvidenceSchema),
});
export const documentDatesSchema = z.object({
    publication: dateGroupSchema,
    filing: dateGroupSchema,
    event: dateGroupSchema,
});
export const documentDatesValidator = zodToConvex(documentDatesSchema);
export type DateEvidence = z.infer<typeof dateEvidenceSchema>;
export type DocumentDates = z.infer<typeof documentDatesSchema>;
const months = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
];

function validDate(value: string) {
    const day = value.slice(0, 10);
    const time = Date.parse(value);
    const calendar = Date.parse(day);
    return (
        /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) &&
        Number.isFinite(time) &&
        Number.isFinite(calendar) &&
        new Date(calendar).toISOString().slice(0, 10) === day
    );
}

/** Reconciles explicit documentary indications without promoting narrative dates or acquisition time. */
export function documentDates({
    metadata,
    text,
    previous,
}: {
    metadata: readonly DateEvidence[];
    text: string;
    previous?: DocumentDates;
}): DocumentDates {
    const evidence = [
        ...metadata,
        ...Object.values(previous ?? {}).flatMap((group) => group.evidence),
    ];
    const forms = [
        {
            kind: "publication" as const,
            label: "GLOBE NEWSWIRE",
            pattern:
                /^[^\n]*?,\s*([a-z]+)\.?\s+(\d{1,2}),\s*(\d{4})\s*\(GLOBE NEWSWIRE\)\s*[-–—]+/gimu,
        },
        {
            kind: "publication" as const,
            label: "BUSINESS WIRE",
            pattern:
                /^[^\n]*?[-–—]\(BUSINESS WIRE\)[-–—]+\s*([a-z]+)\.?\s+(\d{1,2}),\s*(\d{4})[-–—]+/gimu,
        },
        {
            kind: "event" as const,
            label: "Date of Report (Date of earliest event reported)",
            pattern:
                /Date of Report\s*\(Date of earliest event reported\)\s*:\s*([a-z]+)\.?\s+(\d{1,2}),\s*(\d{4})\b/giu,
        },
    ];
    for (const form of forms)
        for (const match of text.matchAll(form.pattern)) {
            const month = months.findIndex(
                (name) =>
                    name === match[1]?.toLowerCase() ||
                    name.slice(0, 3) === match[1]?.toLowerCase(),
            );
            if (month < 0) continue;
            const value = `${match[3]}-${String(month + 1).padStart(2, "0")}-${match[2]?.padStart(2, "0")}`;
            if (validDate(value))
                evidence.push({
                    kind: form.kind,
                    value,
                    precision: "day",
                    origin: {
                        kind: form.kind === "event" ? "sec_field" : "dateline",
                        label: form.label,
                        raw: match[0].trimStart(),
                    },
                });
        }
    const group = (
        kind: DateEvidence["kind"],
    ): DocumentDates["publication"] => {
        const items = [
            ...new Map(
                evidence
                    .filter(
                        (item) => item.kind === kind && validDate(item.value),
                    )
                    .map((item) => [JSON.stringify(item), item]),
            ).values(),
        ];
        const days = new Set(items.map((item) => item.value.slice(0, 10)));
        const instants = new Set(
            items
                .filter((item) => item.precision === "instant")
                .map((item) => Date.parse(item.value)),
        );
        const conflict =
            instants.size > 1 ||
            (items.some((item) => item.precision === "day") && days.size > 1);
        return {
            status: !items.length ? "unknown" : conflict ? "conflict" : "known",
            evidence: items,
        };
    };
    return {
        publication: group("publication"),
        filing: group("filing"),
        event: group("event"),
    };
}

/** Compatibility aliases are available only when every indication agrees. */
export function unambiguousDocumentTime(
    group: DocumentDates["publication"],
): number | undefined {
    if (group.status !== "known") return undefined;
    const evidence =
        group.evidence.find((item) => item.precision === "instant") ??
        group.evidence[0];
    return evidence ? Date.parse(evidence.value) : undefined;
}

/** Numeric compatibility fields may originate from day-only dates; midnight never adds unsupported time precision. */
export function recordedDocumentDate(
    kind: DateEvidence["kind"],
    timestamp: number,
    origin: DateEvidence["origin"],
): DateEvidence {
    const iso = new Date(timestamp).toISOString();
    const dayOnly = kind === "filing" || iso.endsWith("T00:00:00.000Z");
    return {
        kind,
        value: dayOnly ? iso.slice(0, 10) : iso,
        precision: dayOnly ? "day" : "instant",
        origin,
    };
}
