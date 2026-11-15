import type { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import type { DocumentaryNeed } from "@/components/workbench-ui/documentary-needs";
import {
    ClaimGlyph,
    type ClaimTone,
    WorkbenchIcon,
} from "@/components/workbench-ui/glyphs";
import type {
    ReaderContribution,
    ReaderObservedLink,
    ReaderPage,
} from "@/components/workbench-ui/source-reader";
import type { SourceReaderListItem } from "@/components/workbench-ui/source-reader-list";
import type { SourceMatrixRow } from "@/components/workbench-ui/source-matrix";
import type {
    SourcesMatrixFilter,
    SourcesPreparationView,
} from "@/components/workspace/sources/sources-screens";
import { Badge } from "@/components/ui/badge";
import { sourceDocumentKindLabel } from "@/lib/presentation/research-copy";
import { sourceMissionPresentation } from "@/lib/presentation/workbench";

type Overview = NonNullable<
    FunctionReturnType<typeof api.sourcesWorkspace.overview>
>;
export type SourcesRow = NonNullable<
    FunctionReturnType<typeof api.sourcesWorkspace.listSources>
>[number];
type Reading = NonNullable<
    FunctionReturnType<typeof api.sourcesWorkspace.getSource>
>;
type ContributionKind = keyof NonNullable<SourcesRow["contributions"]>["kinds"];
type Run = Parameters<typeof sourceMissionPresentation>[0];

/** Documentary contributions borrow claim tones for colour only; their labels never imply an inventory class. */
const documentaryKinds: Record<
    ContributionKind,
    { tone: ClaimTone; label: string; counted: [string, string] }
> = {
    asserted_fact: {
        tone: "fact",
        label: "Asserted fact",
        counted: ["asserted fact", "asserted facts"],
    },
    attributed_argument: {
        tone: "inference",
        label: "Attributed argument",
        counted: ["attributed argument", "attributed arguments"],
    },
    forecast: {
        tone: "hypothesis",
        label: "Forecast",
        counted: ["forecast", "forecasts"],
    },
    context: {
        tone: "unknown",
        label: "Context",
        counted: ["context statement", "context statements"],
    },
};
const kindOrder: readonly ContributionKind[] = [
    "asserted_fact",
    "attributed_argument",
    "forecast",
    "context",
];

export const documentaryContributionTerms = {
    help: "What this source contributes, by documentary kind: asserted facts, attributed arguments, forecasts and context. Every bar uses the same scale, so rows compare.",
    legend: "contributions by documentary kind",
};

const familyLabels: Record<SourcesRow["family"], string> = {
    regulatory: "SEC filings",
    investor_relations: "Investor relations",
    official_product: "Product pages",
    official_commercial: "Commercial terms",
    counter_evidence: "Counter-evidence",
    official_security: "Security pages",
    independent_analysis: "Independent analysis",
    analyst_supplied: "Added by analyst",
    unrecognized: "Other web sources",
};
const relationshipLabels: Record<SourcesRow["authorityTier"], string> = {
    regulator_primary: "Regulatory filing",
    company_primary: "Company-authored",
    company_hosted_ir: "Company-authored",
    institutional_independent: "Independent",
    qualified_partner: "Partner",
    unverified: "Unverified origin",
    analyst_supplied: "Added by analyst",
};
const docTags: Partial<Record<SourcesRow["documentKind"], string>> = {
    regulatory_annual: "10-K",
    regulatory_interim: "10-Q",
    regulatory_material: "8-K",
    regulatory_proxy: "PROXY",
    earnings_release: "PR",
    investor_presentation: "DECK",
    earnings_transcript: "CALL",
    official_product_documentation: "DOCS",
    official_integration_documentation: "DOCS",
    official_pricing: "PRICE",
    official_commercial_terms: "TERMS",
    official_security_documentation: "SEC",
    independent_analysis: "IND",
    news_reporting: "NEWS",
    partner_evidence: "PART",
    community_content: "POST",
    search_or_index: "INDEX",
};
const readingLabels: Record<SourcesRow["reading"], string> = {
    full: "Full reading",
    partial: "Partial reading",
    capturing: "Capturing",
    unavailable: "Unavailable",
    not_captured: "Not captured",
};

function plural(count: number, [one, many]: readonly [string, string]) {
    return `${count} ${count === 1 ? one : many}`;
}

function docTag(row: SourcesRow) {
    return row.secForm?.toUpperCase() ?? docTags[row.documentKind] ?? "DOC";
}

function dateLabel(value?: number) {
    return value === undefined
        ? undefined
        : new Intl.DateTimeFormat("en", {
              month: "short",
              year: "numeric",
          }).format(value);
}

function rowMeta(row: SourcesRow) {
    return [
        row.host,
        sourceDocumentKindLabel(row.documentKind),
        dateLabel(row.publishedAt),
    ]
        .filter(Boolean)
        .join(" · ");
}

function readingState(reading: SourcesRow["reading"]) {
    return reading === "full" || reading === "partial"
        ? reading
        : ("unavailable" as const);
}

/** One wording for inclusion; Context is a retained source whose usable contributions are context only. */
const membershipLabels: Record<SourcesRow["membership"], string> = {
    retained: "Retained",
    excluded: "Excluded",
    not_retained: "Not retained",
    pending: "Pending",
};

function membershipBadge(row: SourcesRow) {
    if (row.membership === "retained" && row.contextOnly)
        return <Badge tone="ink">Context</Badge>;
    const tone =
        row.membership === "retained"
            ? "accent"
            : row.membership === "pending"
              ? "dashed"
              : "unknown";
    return <Badge tone={tone}>{membershipLabels[row.membership]}</Badge>;
}

function controlBadge(tally: NonNullable<SourcesRow["contributions"]>) {
    if (tally.conflict)
        return (
            <Badge tone="counter">
                <ClaimGlyph kind="counter" />
                Conflict {tally.conflict}
            </Badge>
        );
    if (tally.notEstablished)
        return <Badge tone="unknown">Not established</Badge>;
    if (tally.unchecked) return <Badge tone="dashed">Unchecked</Badge>;
    return tally.total ? (
        <Badge tone="ink">
            <WorkbenchIcon name="check" size={11} strokeWidth={2.4} />
            Supported
        </Badge>
    ) : undefined;
}

function restrictionText(row: SourcesRow) {
    const tally = row.contributions;
    if (!tally) return undefined;
    if (tally.inspectionOnly)
        return `${tally.inspectionOnly} for inspection only`;
    if (tally.restricted) return `${tally.restricted} with narrowed use`;
    if (row.contextOnly) return "Context only";
    return undefined;
}

/** One matrix row; inclusion, reading, contribution and control remain separate columns. */
export function sourcesMatrixRow(row: SourcesRow): SourceMatrixRow {
    const tally = row.contributions;
    return {
        id: row.sourceId,
        docType: docTag(row),
        title: row.title,
        meta: rowMeta(row),
        relationship: relationshipLabels[row.authorityTier],
        reading: readingState(row.reading),
        readingLabel: readingLabels[row.reading],
        missing: row.reading !== "full" && row.reading !== "partial",
        quiet:
            row.membership === "not_retained" || row.membership === "excluded",
        contributions: tally
            ? {
                  count: tally.total,
                  segments: kindOrder
                      .filter((kind) => tally.kinds[kind] > 0)
                      .map((kind) => ({
                          kind: documentaryKinds[kind].tone,
                          count: tally.kinds[kind],
                          label: plural(
                              tally.kinds[kind],
                              documentaryKinds[kind].counted,
                          ),
                      })),
              }
            : undefined,
        restriction: restrictionText(row),
        control: tally ? controlBadge(tally) : undefined,
        selection: membershipBadge(row),
    };
}

export const sourcesMatrixFilters = [
    {
        id: "kind",
        label: "Source kind",
        options: [
            { id: "all", label: "All kinds" },
            { id: "regulatory", label: "SEC filings" },
            { id: "investor_relations", label: "Investor relations" },
            { id: "company", label: "Company pages" },
            { id: "independent", label: "Independent" },
            { id: "analyst_supplied", label: "Added by analyst" },
            { id: "unrecognized", label: "Other web sources" },
        ],
    },
    {
        id: "reading",
        label: "Reading",
        options: [
            { id: "any", label: "Any reading" },
            { id: "full", label: "Full" },
            { id: "partial", label: "Partial" },
            { id: "unread", label: "Not read" },
        ],
    },
    {
        id: "use",
        label: "Selection",
        options: [
            { id: "any", label: "Any selection" },
            { id: "retained", label: "Retained" },
            { id: "context", label: "Context" },
            { id: "not_retained", label: "Not retained" },
            { id: "excluded", label: "Excluded" },
            { id: "pending", label: "Pending" },
        ],
    },
] as const satisfies readonly Omit<SourcesMatrixFilter, "value">[];

export type SourcesFilterId = (typeof sourcesMatrixFilters)[number]["id"];
export type SourcesFilterValues = Record<SourcesFilterId, string>;
export const defaultSourcesFilters: SourcesFilterValues = {
    kind: "all",
    reading: "any",
    use: "any",
};

/** Restores only known filter options; anything else falls back to no filtering. */
export function sourcesFilterValues(
    values: Partial<Record<SourcesFilterId, string>>,
): SourcesFilterValues {
    const result = { ...defaultSourcesFilters };
    for (const filter of sourcesMatrixFilters) {
        const value = values[filter.id];
        if (filter.options.some((option) => option.id === value))
            result[filter.id] = value as string;
    }
    return result;
}

const companyFamilies = new Set<SourcesRow["family"]>([
    "official_product",
    "official_commercial",
    "official_security",
]);
const independentFamilies = new Set<SourcesRow["family"]>([
    "independent_analysis",
    "counter_evidence",
]);

/** Filters the bounded dossier collection; the query and filters never change saved state. */
export function filterSourcesRows(
    rows: readonly SourcesRow[],
    query: string,
    filters: SourcesFilterValues,
) {
    const text = query.trim().toLocaleLowerCase("en");
    return rows.filter((row) => {
        if (
            text &&
            !`${row.title} ${row.url} ${sourceDocumentKindLabel(row.documentKind)}`
                .toLocaleLowerCase("en")
                .includes(text)
        )
            return false;
        const kind = filters.kind;
        if (
            kind !== "all" &&
            !(kind === "company"
                ? companyFamilies.has(row.family)
                : kind === "independent"
                  ? independentFamilies.has(row.family)
                  : row.family === kind)
        )
            return false;
        const reading = filters.reading;
        if (
            reading !== "any" &&
            (reading === "unread"
                ? row.reading === "full" || row.reading === "partial"
                : row.reading !== reading)
        )
            return false;
        const use = filters.use;
        if (use === "any") return true;
        if (use === "context")
            return row.membership === "retained" && row.contextOnly;
        if (use === "retained")
            return row.membership === "retained" && !row.contextOnly;
        return row.membership === use;
    });
}

/** Retained material first, then work still under way, then sources outside the prepared set. */
export function sourcesReaderGroups(rows: readonly SourcesRow[]) {
    const item = (row: SourcesRow): SourceReaderListItem => ({
        id: row.sourceId,
        docType: docTag(row),
        title: row.title,
        meta: row.contributions?.conflict
            ? `${plural(row.contributions.conflict, ["conflict", "conflicts"])} · ${row.host}`
            : row.contributions
              ? `${plural(row.contributions.total, ["contribution", "contributions"])} · ${row.host}`
              : `${readingLabels[row.reading]} · ${row.host}`,
        ...(row.contributions?.conflict
            ? { metaTone: "counter" as const }
            : {}),
        reading: readingState(row.reading),
    });
    return (
        [
            ["retained", "Retained"],
            ["pending", "Being prepared"],
            ["not_retained", "Not retained"],
            ["excluded", "Excluded"],
        ] as const
    )
        .map(([membership, label]) => ({
            id: membership,
            label,
            items: rows
                .filter((row) => row.membership === membership)
                .map(item),
        }))
        .filter((group) => group.items.length > 0);
}

function questionLabels(overview: Overview | null | undefined) {
    return new Map(
        overview?.questions.map((question, index) => [
            question.id,
            `Q${index + 1}`,
        ]) ?? [],
    );
}

const familyOrder = Object.keys(familyLabels) as SourcesRow["family"][];

/** Preparation figures for the overview; the outcome label follows the shared Sources mission state. */
export function sourcesPreparationView(
    overview: Overview,
    run: Run,
    rows: readonly SourcesRow[],
): SourcesPreparationView {
    const { state, title } = sourceMissionPresentation(run, {
        status: overview.preparationStatus,
        missionStatus: overview.missionStatus,
    });
    const labels = questionLabels(overview);
    const settled = state === "completed" || state === "interrupted";
    const limited =
        overview.materialOutcome === "partial" ||
        overview.materialOutcome === "blocked";
    const count = (outcome: DocumentaryNeed["outcome"]) =>
        overview.needs.filter((need) => need.outcome === outcome).length;
    const needs = plural(overview.needs.length, [
        "documentary need",
        "documentary needs",
    ]);
    const gaps = count("gap");
    const unfinished = count("unfinished");
    const summary = overview.materialOutcome
        ? [
              `${plural(overview.organize.retained, ["document", "documents"])} retained across ${needs}.`,
              gaps
                  ? `${plural(gaps, ["need", "needs"])} found no usable public document.`
                  : undefined,
              unfinished
                  ? `${plural(unfinished, ["need", "needs"])} ${unfinished === 1 ? "has" : "have"} unfinished work.`
                  : undefined,
              "Investigation is not available yet.",
          ]
              .filter(Boolean)
              .join(" ")
        : state === "paused"
          ? `Sources is paused with ${plural(overview.reading.captured, ["document", "documents"])} read so far for ${needs}.`
          : state === "interrupted"
            ? `Sources stopped before handing off its material. ${plural(overview.reading.captured, ["document", "documents"])} read so far remain available.`
            : `Sources is collecting and reading material for ${needs}. Outcomes settle when it hands off.`;
    const families = new Map<SourcesRow["family"], "found" | "unavailable">();
    for (const row of rows) families.set(row.family, "found");
    for (const family of overview.collect.failedFamilies)
        if (!families.has(family)) families.set(family, "unavailable");
    return {
        eyebrow: "Initial preparation",
        title,
        summary,
        outcome: {
            label:
                state === "completed"
                    ? limited
                        ? "Prepared with limits"
                        : "Prepared"
                    : state === "interrupted"
                      ? "Interrupted"
                      : state === "paused"
                        ? "Paused"
                        : state === "running"
                          ? "In progress"
                          : "Waiting",
            settled,
        },
        collect: {
            candidates: overview.collect.candidates,
            families: familyOrder
                .filter((family) => families.has(family))
                .map((family) => ({
                    id: family,
                    label: familyLabels[family],
                    outcome: families.get(family) ?? "found",
                })),
            note:
                overview.collect.searches || overview.collect.acquisitions
                    ? [
                          overview.collect.searches
                              ? plural(overview.collect.searches, [
                                    "targeted search",
                                    "targeted searches",
                                ])
                              : undefined,
                          overview.collect.acquisitions
                              ? plural(overview.collect.acquisitions, [
                                    "linked document acquired",
                                    "linked documents acquired",
                                ])
                              : undefined,
                      ]
                          .filter(Boolean)
                          .join(" · ")
                    : undefined,
        },
        reading: {
            captured: overview.reading.captured,
            full: overview.reading.full,
            partial: overview.reading.partial,
            unavailable: overview.reading.unavailable,
            controls: {
                supported: overview.contributions.supported,
                conflict: overview.contributions.conflict,
                notEstablished: overview.contributions.notEstablished,
                unfinished: overview.contributions.unchecked,
            },
            note: overview.reading.capturing
                ? `${plural(overview.reading.capturing, ["capture", "captures"])} under way`
                : undefined,
        },
        organize: {
            selected: overview.organize.retained,
            context: overview.organize.contextOnly,
            uses: [
                {
                    id: "primary",
                    role: "primary" as const,
                    text: overview.materialOutcome
                        ? `${plural(overview.organize.retained - overview.organize.contextOnly, ["document", "documents"])} with usable contributions`
                        : "Retention settles at handoff",
                },
                ...(overview.contributions.conflict
                    ? [
                          {
                              id: "opposing",
                              role: "opposing" as const,
                              text: `${plural(overview.contributions.conflict, ["contribution", "contributions"])} in documentary conflict`,
                          },
                      ]
                    : []),
                ...(overview.organize.notRetained || overview.organize.excluded
                    ? [
                          {
                              id: "excluded",
                              role: "excluded" as const,
                              text: [
                                  overview.organize.notRetained
                                      ? `${overview.organize.notRetained} not retained`
                                      : undefined,
                                  overview.organize.excluded
                                      ? `${overview.organize.excluded} excluded by you`
                                      : undefined,
                              ]
                                  .filter(Boolean)
                                  .join(" · "),
                          },
                      ]
                    : []),
            ],
            handoff: overview.materialOutcome
                ? [
                      overview.organize.restricted
                          ? `${plural(overview.organize.restricted, ["contribution", "contributions"])} restricted`
                          : undefined,
                      "Investigation is not available yet",
                  ]
                      .filter(Boolean)
                      .join(" · ")
                : undefined,
        },
        questions: overview.questions.map((question, index) => ({
            id: question.id,
            label: labels.get(question.id) ?? `Q${index + 1}`,
            question: question.text,
        })),
        needs: overview.needs.map(
            (need): DocumentaryNeed => ({
                id: need.id,
                label: need.information,
                questions: need.questionIds,
                outcome: need.outcome,
                documents: need.documents,
                contributions: need.contributions,
                ...(need.conflicts
                    ? {
                          flag: (
                              <Badge tone="counter">
                                  <ClaimGlyph kind="counter" />
                                  {plural(need.conflicts, [
                                      "conflict",
                                      "conflicts",
                                  ])}
                              </Badge>
                          ),
                      }
                    : {}),
                ...(need.gap || need.unfinished.length
                    ? {
                          detail: [need.gap, ...need.unfinished]
                              .filter(Boolean)
                              .join(" "),
                      }
                    : {}),
            }),
        ),
    };
}

const useLabels: Record<
    Reading["contributions"][number]["permittedUse"],
    string
> = {
    documentary: "Documentary use",
    attributed_argument_only: "Attributed argument only",
    context_only: "Context only",
    blocked: "Inspection only",
};
const conclusionBadges = {
    supported: (
        <Badge tone="ink">
            <WorkbenchIcon name="check" size={11} strokeWidth={2.4} />
            Supported
        </Badge>
    ),
    documentary_conflict: (
        <Badge tone="counter">
            <ClaimGlyph kind="counter" />
            Conflict
        </Badge>
    ),
    not_established: <Badge tone="unknown">Not established</Badge>,
};

/** Reader document: cited excerpts with their neighbours, never invented pages, and contributions in documentary terms. */
export function sourcesReaderDocument(
    reading: Reading,
    overview: Overview | null | undefined,
) {
    const labels = questionLabels(overview);
    const needQuestions = new Map(
        overview?.needs.map((need) => [need.id, need.questionIds]) ?? [],
    );
    const citing = new Map<number, Reading["contributions"][number]>();
    for (const contribution of reading.contributions)
        for (const order of contribution.passageOrders)
            if (!citing.has(order)) citing.set(order, contribution);
    const pages: ReaderPage[] = reading.sections.map((section, index) => ({
        id: section.id,
        label: `Excerpt ${index + 1}`,
        section: section.heading ?? "Document",
        passages: section.passages.map((passage) => {
            const contribution = citing.get(passage.order);
            const kind = contribution
                ? contribution.conclusion === "documentary_conflict"
                    ? ("counter" as const)
                    : documentaryKinds[contribution.kind].tone
                : undefined;
            return {
                id: `p${passage.order}`,
                text: passage.quotation,
                ...(contribution && kind
                    ? {
                          kind,
                          label: documentaryKinds[contribution.kind].label,
                          highlight:
                              kind === "counter"
                                  ? ("conflict" as const)
                                  : ("selected" as const),
                      }
                    : reading.excerpts === "cited"
                      ? { quiet: true }
                      : {}),
            };
        }),
    }));
    const pageOf = new Map(
        pages.flatMap((page) =>
            page.passages.map((passage) => [passage.id, page.id] as const),
        ),
    );
    const contributions: ReaderContribution[] = reading.contributions.map(
        (contribution) => {
            const passageId = `p${contribution.passageOrders[0]}`;
            const pageId = pageOf.get(passageId);
            const questions = [
                ...new Set(
                    contribution.needIds.flatMap((needId) =>
                        (needQuestions.get(needId) ?? []).flatMap((id) => {
                            const label = labels.get(id);
                            return label ? [label] : [];
                        }),
                    ),
                ),
            ].sort();
            const narrowed =
                contribution.reportedUse &&
                contribution.reportedUse !== contribution.permittedUse
                    ? `Control reported ${useLabels[contribution.reportedUse].toLowerCase()}; effective use is ${useLabels[contribution.permittedUse].toLowerCase()}.`
                    : undefined;
            return {
                id: contribution.id,
                kind:
                    contribution.conclusion === "documentary_conflict"
                        ? "counter"
                        : documentaryKinds[contribution.kind].tone,
                label: documentaryKinds[contribution.kind].label,
                meta: [contribution.period, contribution.attribution]
                    .filter(Boolean)
                    .join(" · "),
                status: (
                    <>
                        {contribution.conclusion ? (
                            conclusionBadges[contribution.conclusion]
                        ) : (
                            <Badge tone="dashed">Unchecked</Badge>
                        )}
                    </>
                ),
                text: contribution.statement,
                note: [
                    useLabels[contribution.permittedUse],
                    contribution.diagnostic,
                    narrowed,
                    contribution.restricted
                        ? "A later control narrowed this use."
                        : undefined,
                ]
                    .filter(Boolean)
                    .join(" · "),
                ...(pageId ? { target: { pageId, passageId } } : {}),
                ...(questions.length ? { questions } : {}),
            };
        },
    );
    const observedLinks: ReaderObservedLink[] = reading.observedLinks.map(
        (link) => ({
            id: `link-${link.index}`,
            label: link.originText.trim() || link.url,
            captured: link.captured,
            meta: link.captured ? "captured" : "link seen, not read",
        }),
    );
    const row = reading.source;
    return {
        title: row.title,
        meta: [
            row.host,
            readingLabels[row.reading].toLowerCase(),
            reading.excerpts === "cited"
                ? "cited excerpts"
                : reading.excerpts === "opening"
                  ? "opening excerpt"
                  : undefined,
        ]
            .filter(Boolean)
            .join(" · "),
        pages,
        contributionLabel: [
            relationshipLabels[row.authorityTier],
            sourceDocumentKindLabel(row.documentKind),
            dateLabel(row.publishedAt),
        ]
            .filter(Boolean)
            .join(" · "),
        contributions,
        observedLinks,
        originalHref: row.url,
    };
}

/** Composer draft for a follow-up about one source; the analyst edits and sends it. */
export function sourceFollowUpDraft(
    kind: "check" | "challenge",
    row: Pick<SourcesRow, "title" | "url" | "membership">,
) {
    return kind === "check"
        ? `Please run a targeted documentary check on "${row.title}" (${row.url}). What I want verified: `
        : `I want to challenge the selection of "${row.title}" (${row.url}), currently ${membershipLabels[row.membership].toLowerCase()}. My reason: `;
}
