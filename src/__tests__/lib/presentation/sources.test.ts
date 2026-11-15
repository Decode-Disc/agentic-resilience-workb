import type { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { expect, test } from "vitest";
import {
    filterSourcesRows,
    type SourcesRow,
    sourcesFilterValues,
} from "@/lib/presentation/sources";
import { workspaceSearch } from "@/lib/workspace/navigation";

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
