import type { Id } from "@convex/_generated/dataModel";

export const ADMIN_SECTIONS = [
    { value: "overview", label: "Overview" },
    { value: "dossiers", label: "Dossiers" },
    { value: "models", label: "Models & agents" },
    { value: "activity", label: "Activity & spend" },
] as const;

export type AdminSection = (typeof ADMIN_SECTIONS)[number]["value"];

/** Focused views inside a section; the first one is the section's default and is expressed by omission. */
export const ADMIN_VIEWS = {
    dossiers: [
        { value: "dossiers", label: "All dossiers" },
        { value: "reservations", label: "Reservations" },
        { value: "reviews", label: "Review decisions" },
    ],
    models: [
        { value: "agents", label: "Agent models" },
        { value: "catalogue", label: "Model catalogue" },
        { value: "coherence", label: "Reply check" },
    ],
} as const;

type SectionWithViews = keyof typeof ADMIN_VIEWS;
export type AdminView<S extends SectionWithViews = SectionWithViews> =
    (typeof ADMIN_VIEWS)[S][number]["value"];

/** Dossier lists other than Research, which is the default and is expressed by omission. */
const ADMIN_PURPOSES = ["evaluation", "browser_test"] as const;
export type AdminPurpose = "research" | (typeof ADMIN_PURPOSES)[number];

export type AdminSearch = {
    /** Absent means the Overview, so plain links to administration stay valid. */
    section?: Exclude<AdminSection, "overview">;
    /** Absent means the section's first view. */
    view?: AdminView;
    /** The dossier list in view; an open dossier always belongs to it. */
    purpose?: Exclude<AdminPurpose, "research">;
    dossier?: Id<"researchRuns">;
};

function hasViews(section: AdminSection): section is SectionWithViews {
    return section in ADMIN_VIEWS;
}

/** Administration's addressable state: a known section and view (defaults omitted) and an optional open dossier. */
export function adminSearch(search: Record<string, unknown>): AdminSearch {
    const section = ADMIN_SECTIONS.find(
        (entry) => entry.value !== "overview" && entry.value === search.section,
    )?.value as AdminSearch["section"];
    const views = section && hasViews(section) ? ADMIN_VIEWS[section] : [];
    const view = views
        .slice(1)
        .find((entry) => entry.value === search.view)?.value;
    const purpose =
        section === "dossiers"
            ? ADMIN_PURPOSES.find((entry) => entry === search.purpose)
            : undefined;
    return {
        ...(section ? { section } : {}),
        ...(view ? { view } : {}),
        ...(purpose ? { purpose } : {}),
        ...(typeof search.dossier === "string" && search.dossier
            ? { dossier: search.dossier as Id<"researchRuns"> }
            : {}),
    };
}

/** The section a search shows, resolving the default. */
export function adminSection(search: AdminSearch): AdminSection {
    return search.section ?? "overview";
}

/** The view a section shows, resolving the default. */
export function adminView<S extends SectionWithViews>(
    search: AdminSearch,
    section: S,
): AdminView<S> {
    const views = ADMIN_VIEWS[section];
    return (views.find((entry) => entry.value === search.view)?.value ??
        views[0].value) as AdminView<S>;
}

/** Navigating to a section and optional view; defaults are expressed by omission. */
export function adminSectionSearch(
    section: AdminSection,
    view?: AdminView,
): AdminSearch {
    if (section === "overview") return {};
    const defaultView = hasViews(section)
        ? ADMIN_VIEWS[section][0].value
        : undefined;
    return view && view !== defaultView ? { section, view } : { section };
}

/** The dossier list a search shows, resolving the default. */
export function adminPurpose(search: AdminSearch): AdminPurpose {
    return search.purpose ?? "research";
}

/** The dossiers list of one purpose, optionally with one of its dossiers open. */
export function adminDossierSearch(
    purpose: AdminPurpose,
    dossier?: Id<"researchRuns">,
): AdminSearch {
    return {
        section: "dossiers",
        ...(purpose === "research" ? {} : { purpose }),
        ...(dossier ? { dossier } : {}),
    };
}
