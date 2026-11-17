import type { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { expect, test } from "vitest";
import {
    filterSourcesRows,
    type SourcesRow,
    sortSourcesRows,
    sourcesFilterValues,
    sourcesPhasePresentation,
} from "@/lib/presentation/sources";
import { sourcesLocation, workspaceSearch } from "@/lib/workspace/navigation";

type Row = NonNullable<
    FunctionReturnType<typeof api.sourcesWorkspace.listSources>
>[number];
const row = (
    patch: Omit<Partial<Row>, "sourceId"> & { sourceId: string },
): SourcesRow => ({
    title: patch.sourceId,
    url: `https://example.com/${patch.sourceId}`,
    host: "example.com",
    origin: "exa",
    family: "unrecognized",
    documentKind: "unknown",
    authorityTier: "unverified",
    reading: "full",
    membership: "retained",
    contextOnly: false,
    contributions: null,
    limitations: [],
    ...patch,
    sourceId: patch.sourceId as Id<"sources">,
});
const rows = [
    row({ sourceId: "filing", family: "regulatory" }),
    row({ sourceId: "context", family: "official_product", contextOnly: true }),
    row({
        sourceId: "unread",
        reading: "unavailable",
        membership: "not_retained",
    }),
    row({
        sourceId: "excluded",
        family: "independent_analysis",
        membership: "excluded",
    }),
];
const ids = (
    values: Partial<Record<"kind" | "reading" | "use", string>>,
    query = "",
) =>
    filterSourcesRows(rows, query, sourcesFilterValues(values)).map(
        (r) => r.sourceId,
    );

test("selection filters keep retained, context-only, not retained and excluded apart", () => {
    expect(ids({ use: "retained" })).toEqual(["filing"]);
    expect(ids({ use: "context" })).toEqual(["context"]);
    expect(ids({ use: "not_retained" })).toEqual(["unread"]);
    expect(ids({ use: "excluded" })).toEqual(["excluded"]);
    expect(ids({ kind: "company" })).toEqual(["context"]);
    expect(ids({ kind: "independent" })).toEqual(["excluded"]);
    expect(ids({ reading: "unread" })).toEqual(["unread"]);
    expect(ids({}, "FILING")).toEqual(["filing"]);
    expect(ids({ use: "unknown-option" })).toHaveLength(rows.length);
});

test("Sources locations survive the URL only within the Sources section", () => {
    expect(
        workspaceSearch({
            section: "sources",
            sourcesView: "reader",
            source: "abc",
            q: "filing",
            use: "context",
        }),
    ).toEqual({
        section: "sources",
        sourcesView: "reader",
        source: "abc",
        q: "filing",
        use: "context",
    });
    expect(
        workspaceSearch({ section: "progress", sourcesView: "matrix", q: "x" }),
    ).toEqual({ section: "progress" });
    expect(
        workspaceSearch({ section: "sources", sourcesView: "elsewhere" }),
    ).toEqual({ section: "sources" });
});

const allSourcesPhases = [
    "collecting",
    "waiting",
    "paused",
    "time_limit",
    "completed",
    "completed_with_limits",
    "ended_without_material",
    "interrupted",
    "failed",
    "insufficient_evidence",
] as const;

test.each(
    allSourcesPhases,
)("the %s Sources phase reads as analyst copy", (phase) => {
    const copy = sourcesPhasePresentation(phase);
    for (const text of [copy.label, copy.outcome, copy.title, copy.detail])
        expect(text).not.toMatch(/_|sources_prepared|execution|mission/i);
    if (phase === "failed")
        expect(copy.detail).toContain("Start a new analysis");
    if (phase === "time_limit")
        expect(copy.detail).toMatch(
            /Decide in the conversation.*continue preparation.*use what's prepared/,
        );
});

test("Sources copy names the agent and never shows raw codes", () => {
    for (const phase of allSourcesPhases) {
        const copy = sourcesPhasePresentation(phase);
        for (const text of [
            copy.label,
            copy.outcome,
            copy.title,
            copy.detail,
        ]) {
            expect(text).not.toMatch(
                /^Sources (is|used|handed|stopped|continues|reached)/,
            );
            expect(text).not.toMatch(/_[a-z]/);
        }
    }
    expect(sourcesPhasePresentation("time_limit").title).toBe(
        "The Sources Agent reached its time limit",
    );
    expect(sourcesPhasePresentation("ended_without_material")).toMatchObject({
        workState: "blocked",
        label: "No material",
        outcome: "No material",
        title: "No usable material prepared",
    });
});

const tallied = (total: number) => ({
    total,
    kinds: {
        asserted_fact: total,
        attributed_argument: 0,
        forecast: 0,
        context: 0,
    },
    supported: total,
    conflict: 0,
    notEstablished: 0,
    unchecked: 0,
    restricted: 0,
    inspectionOnly: 0,
});

test("the matrix leads with the documents that contribute most", () => {
    const sorted = sortSourcesRows([
        row({
            sourceId: "lead",
            membership: "not_retained",
            reading: "not_captured",
        }),
        row({ sourceId: "few", contributions: tallied(3) }),
        row({ sourceId: "many", contributions: tallied(15) }),
        row({
            sourceId: "unused",
            membership: "not_retained",
            contributions: tallied(3),
        }),
        row({ sourceId: "excluded", membership: "excluded" }),
        row({ sourceId: "pending", membership: "pending" }),
    ]).map((r) => r.sourceId);
    expect(sorted).toEqual([
        "many",
        "few",
        "unused",
        "pending",
        "lead",
        "excluded",
    ]);
});

test("the reader receives every Sources location key, including its starting point", () => {
    expect(
        sourcesLocation(
            workspaceSearch({
                section: "sources",
                sourcesView: "reader",
                source: "abc",
                need: "workflow",
                focus: "conflict",
                inventory: "1",
            }),
        ),
    ).toEqual({
        sourcesView: "reader",
        source: "abc",
        need: "workflow",
        focus: "conflict",
    });
});
