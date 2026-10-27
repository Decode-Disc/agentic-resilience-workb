import { SOURCE_COVERAGE_ROLES } from "@convex/domain/sourceSelectionPolicy";
import type { SourceReviewNavigation } from "@/components/workspace/source-proposal-review";

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
    subsection?: WorkspaceSubsection;
    inventory?: 1;
    view?: Exclude<SourceReviewNavigation["view"], "overview">;
    coverage?: SourceReviewNavigation["coverage"];
};

export const workspaceSections: ReadonlyArray<{
    key: WorkspaceSection;
    label: string;
    unavailable?: string;
}> = [
    { key: "progress", label: "Progress" },
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
    if (
        section === "sources" &&
        (search.view === "inspect" || search.view === "adjust")
    ) {
        result.view = search.view;
        if (search.view === "inspect") {
            const coverage = SOURCE_COVERAGE_ROLES.find(
                (role) => role === search.coverage,
            );
            if (coverage) result.coverage = coverage;
        }
    }
    return result;
}
