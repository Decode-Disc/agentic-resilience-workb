export type WorkspaceSection =
    | "progress"
    | "sources"
    | "investigation"
    | "synthesis";
export type WorkspaceSubsection =
    | "questions"
    | "hypotheses"
    | "requests"
    | "review"
    | "mechanism"
    | "full-brief";

export type WorkspaceSearch = {
    section: WorkspaceSection;
    detail?: "timeline" | "framing";
    subsection?: WorkspaceSubsection;
    inventory?: 1;
    /** Sources screen; absent means the preparation overview. */
    sourcesView?: "matrix" | "reader";
    /** The source open in the reader. */
    source?: string;
    /** The documentary need the reader was opened for; it starts on that need's first citation. */
    need?: string;
    /** Opens the reader on its first conflicting citation. */
    focus?: "conflict";
    /** Matrix search and filters, restored on refresh and history. */
    q?: string;
    kind?: string;
    reading?: string;
    use?: string;
};

export const workspaceSections: ReadonlyArray<{
    key: WorkspaceSection;
    label: string;
    unavailable?: string;
}> = [
    { key: "progress", label: "Research" },
    { key: "sources", label: "Sources" },
    {
        key: "investigation",
        label: "Investigation",
        unavailable:
            "Question-led investigation is not available in this prototype yet. Sources and the evidence inventory remain available.",
    },
    {
        key: "synthesis",
        label: "Synthesis",
        unavailable:
            "Synthesis is not available in this prototype yet. No mechanism or full brief has been produced.",
    },
];

/** Normalizes durable destinations without starting work or reinterpreting legacy evidence. */
export function workspaceSearch(
    search: Record<string, unknown>,
): WorkspaceSearch {
    const legacy = search.section;
    const section: WorkspaceSection =
        legacy === "assessment"
            ? "investigation"
            : legacy === "map" || legacy === "brief"
              ? "synthesis"
              : legacy === "sources" ||
                  legacy === "investigation" ||
                  legacy === "synthesis"
                ? legacy
                : "progress";
    const result: WorkspaceSearch = { section };
    if (
        section === "progress" &&
        (search.detail === "timeline" || search.detail === "framing")
    )
        result.detail = search.detail;
    if (section === "investigation") {
        result.subsection =
            legacy === "assessment"
                ? "review"
                : search.subsection === "hypotheses" ||
                    search.subsection === "requests" ||
                    search.subsection === "review"
                  ? search.subsection
                  : "questions";
    } else if (section === "synthesis") {
        result.subsection =
            legacy === "brief" || search.subsection === "full-brief"
                ? "full-brief"
                : "mechanism";
    }
    if (
        legacy === "evidence" ||
        search.inventory === 1 ||
        search.inventory === "1"
    )
        result.inventory = 1;
    if (section === "sources" && search.focus === "conflict")
        result.focus = "conflict";
    if (section === "sources") {
        if (search.sourcesView === "matrix" || search.sourcesView === "reader")
            result.sourcesView = search.sourcesView;
        // Links into the retired candidate inspection open the source matrix.
        else if (search.view === "inspect" || search.view === "adjust")
            result.sourcesView = "matrix";
        for (const key of [
            "source",
            "need",
            "q",
            "kind",
            "reading",
            "use",
        ] as const) {
            const value = search[key];
            if (typeof value === "string" && value.length > 0)
                result[key] = value;
        }
    }
    return result;
}

/** The Sources location keys, in one place for the route and every Sources consumer. */
export const sourcesLocationKeys = [
    "sourcesView",
    "source",
    "need",
    "focus",
    "q",
    "kind",
    "reading",
    "use",
] as const;
export type SourcesLocation = Pick<
    WorkspaceSearch,
    (typeof sourcesLocationKeys)[number]
>;

/** Extracts the Sources location from a parsed workspace search. */
export function sourcesLocation(search: WorkspaceSearch): SourcesLocation {
    const location: SourcesLocation = {};
    for (const key of sourcesLocationKeys) {
        const value = search[key];
        if (value !== undefined) Object.assign(location, { [key]: value });
    }
    return location;
}
