import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import type {
    ReaderContribution,
    ReaderObservedLink,
    ReaderPage,
    SourceMatrixRow,
    SourceReaderListItem,
} from "@/components/workbench-ui";
import { ClaimGlyph, WorkbenchIcon } from "@/components/workbench-ui/glyphs";
import type { SourcesPreparationView } from "@/components/workspace/sources/sources-screens";
import { readerContributions, readerPages } from "./fixture-data";

/** Illustrative CCC preparation; no source was collected or read for this preview. */
export const preparationView: SourcesPreparationView = {
    summary:
        "29 documents retained across 8 documentary needs. 1 need found no public document. 2 needs have unfinished work.",
    stop: "The Sources Agent stopped because its time window ended.",
    description:
        "A shared foundation plus searches aimed at Q1–Q4. Each source is collected once and reused by every question.",
    collect: {
        candidates: 47,
        reused: 8,
        families: [
            { id: "sec", label: "SEC filings", outcome: "found" },
            { id: "ir", label: "Investor relations, calls", outcome: "found" },
            { id: "analyst", label: "Analyst coverage", outcome: "none" },
            { id: "patent", label: "Patent register", outcome: "unavailable" },
        ],
        note: "6 duplicates folded · different URLs ≠ independent",
    },
    reading: {
        captured: 38,
        passages: 112,
        full: 31,
        partial: 5,
        unavailable: 2,
        controls: {
            supported: 24,
            conflict: 2,
            notEstablished: 6,
            unfinished: 1,
        },
        note: "Source text is read as data, never as instructions",
    },
    organize: {
        selected: 29,
        context: 9,
        uses: [
            {
                id: "primary",
                role: "primary",
                text: "Filings and calls carry Q1–Q3",
            },
            {
                id: "opposing",
                role: "opposing",
                text: "4 sources kept on purpose",
            },
            {
                id: "excluded",
                role: "excluded",
                text: "9, each with its reason",
            },
        ],
        handoff: "Handed to Investigation with restrictions attached",
    },
    questions: [
        {
            id: "q1",
            label: "Q1",
            question: "Does CCC control coordination?",
        },
        {
            id: "q2",
            label: "Q2",
            question: "Is its operational context durable?",
        },
        {
            id: "q3",
            label: "Q3",
            question: "Could core platforms replace it?",
        },
        {
            id: "q4",
            label: "Q4",
            question: "Could an agent bypass it?",
        },
    ],
    needs: [
        {
            id: "workflow",
            label: "Where the platform sits in the claims workflow",
            questions: ["q1", "q2"],
            outcome: "prepared",
            documents: 9,
            contributions: 21,
        },
        {
            id: "assignment",
            label: "Who sets assignment rules",
            questions: ["q1"],
            outcome: "prepared",
            documents: 3,
            contributions: 6,
            sources: [
                {
                    id: "10-k",
                    title: "Form 10-K · FY2025",
                    meta: "4 contributions",
                    reading: "full",
                },
                {
                    id: "q2-call",
                    title: "Q2 2025 earnings call",
                    meta: "1 contribution",
                    reading: "full",
                },
                {
                    id: "10-q",
                    title: "Form 10-Q · Q2 2025",
                    meta: "1 contribution",
                    reading: "full",
                },
            ],
            flag: (
                <Badge tone="counter">
                    <ClaimGlyph kind="counter" />1 conflict
                </Badge>
            ),
            detail: "The 10-K and the Q2 call cover the same period but define assignment differently; both are kept with attribution.",
        },
        {
            id: "dependence",
            label: "How far insurers depend on platform-run steps",
            questions: ["q2"],
            outcome: "prepared",
            documents: 5,
            contributions: 9,
        },
        {
            id: "access",
            label: "Third-party access to claims data",
            questions: ["q3", "q4"],
            outcome: "prepared",
            documents: 3,
            contributions: 4,
        },
        {
            id: "switching",
            label: "Switching terms between platforms",
            questions: ["q3"],
            outcome: "gap",
            detail: "Three searches completed; no public document states these terms.",
        },
        {
            id: "deck",
            label: "Platform plans beyond the investor-day deck",
            questions: ["q3", "q4"],
            outcome: "unfinished",
            documents: 1,
            detail: "Reading stopped at slide 40; absence beyond it is not established.",
        },
        {
            id: "patent",
            label: "Patent coverage of claim routing",
            questions: ["q4"],
            outcome: "unfinished",
            detail: "The patent register was unreachable. A failed capture does not make it irrelevant.",
        },
        {
            id: "context",
            label: "Company context: segments, periods and filings",
            questions: [],
            outcome: "prepared",
            documents: 5,
            contributions: 8,
        },
    ],
};

const supported = (
    <Badge tone="ink">
        <WorkbenchIcon name="check" size={11} strokeWidth={2.4} />
        Supported
    </Badge>
);
const notEstablished = <Badge tone="unknown">Not established</Badge>;
const selection = {
    selected: <Badge tone="accent">Selected</Badge>,
    context: <Badge tone="ink">Context</Badge>,
    pending: <Badge tone="dashed">Pending</Badge>,
    excluded: <Badge tone="unknown">Excluded</Badge>,
};

export type SourceKind = "filings" | "calls" | "investor" | "third-party";
export type SourceSelection = keyof typeof selection;
export interface IllustrativeSource extends SourceMatrixRow {
    kind?: SourceKind;
    use: SourceSelection;
    document: {
        meta: string;
        pages: readonly ReaderPage[];
        contributionLabel: string;
        contributions: readonly ReaderContribution[];
        observedLinks?: readonly ReaderObservedLink[];
        originalHref?: string;
    };
}

const row = (
    source: Omit<IllustrativeSource, "selection"> & { selection?: ReactNode },
): IllustrativeSource => ({
    ...source,
    selection: source.selection ?? selection[source.use],
});

const annualReport = row({
    id: "10-k",
    kind: "filings",
    use: "selected",
    docType: "10-K",
    title: "Form 10-K · FY2025",
    meta: "sec.gov · annual report · FY2025",
    relationship: "Company-authored",
    reading: "full",
    contributions: {
        count: 18,
        segments: [
            { kind: "fact", count: 12 },
            { kind: "inference", count: 4 },
            { kind: "counter", count: 2 },
        ],
    },
    restriction: "Outlook kept as projection",
    control: supported,
    document: {
        meta: "sec.gov · capture v1 · complete capture · 142 pages",
        pages: readerPages.map((page) =>
            page.id === "p8"
                ? {
                      ...page,
                      heading: "Overview",
                      passages: [
                          {
                              id: "intro",
                              quiet: true,
                              text: "[Illustrative excerpt] The company describes a platform that connects insurers, repair facilities and other participants across the auto claims lifecycle.",
                          },
                          ...page.passages,
                      ],
                  }
                : page,
        ),
        contributionLabel: "Company-authored · annual report · FY2025",
        contributions: readerContributions,
        observedLinks: [
            {
                id: "deck",
                label: "Investor day 2025 deck",
                captured: true,
                meta: "captured",
            },
            {
                id: "guide",
                label: "Integration guide",
                captured: false,
                meta: "label only, not read",
            },
        ],
        originalHref: "https://www.sec.gov/",
    },
});

type Segments = NonNullable<IllustrativeSource["contributions"]>["segments"];
const fact = (count: number) => ({ kind: "fact" as const, count });
const inference = (count: number) => ({ kind: "inference" as const, count });
const projection = (count: number) => ({ kind: "hypothesis" as const, count });
const opposing = (count: number) => ({ kind: "counter" as const, count });

/** The remaining 30 illustrative sources; documents are summarized, not excerpted. */
function additionalSources(): IllustrativeSource[] {
    const source = (
        id: string,
        kind: SourceKind | undefined,
        use: SourceSelection,
        docType: string,
        title: string,
        meta: string,
        relationship: string,
        reading: IllustrativeSource["reading"],
        segments: Segments,
        restriction?: string,
    ) => {
        const count = segments?.reduce((sum, s) => sum + s.count, 0) ?? 0;
        return row({
            id,
            kind,
            use,
            docType,
            title,
            meta,
            relationship,
            reading,
            readingLabel: reading === "partial" ? "Partial" : undefined,
            contributions:
                reading === "unavailable"
                    ? undefined
                    : count
                      ? { count, segments }
                      : { count: 0, note: "nothing usable" },
            restriction,
            control: count ? supported : undefined,
            missing: reading === "unavailable",
            quiet: use === "excluded",
            document: {
                meta: `${meta} · capture v1 · ${reading === "full" ? "complete capture" : reading === "partial" ? "partial capture" : "capture unavailable"}`,
                pages: [],
                contributionLabel: `${relationship} · ${title}`,
                contributions: [],
            },
        });
    };
    return [
        source(
            "10-k-2024",
            "filings",
            "selected",
            "10-K",
            "Form 10-K · FY2024",
            "sec.gov · annual report · FY2024",
            "Company-authored",
            "full",
            [fact(9), inference(2)],
            "Earlier period, compared only",
        ),
        source(
            "10-k-2023",
            "filings",
            "selected",
            "10-K",
            "Form 10-K · FY2023",
            "sec.gov · annual report · FY2023",
            "Company-authored",
            "full",
            [fact(6)],
            "Earlier period, compared only",
        ),
        source(
            "10-q-q1",
            "filings",
            "selected",
            "10-Q",
            "Form 10-Q · Q1 2025",
            "sec.gov · quarterly report",
            "Company-authored",
            "full",
            [fact(4), inference(1)],
        ),
        source(
            "10-q-q3-2024",
            "filings",
            "selected",
            "10-Q",
            "Form 10-Q · Q3 2024",
            "sec.gov · quarterly report",
            "Company-authored",
            "full",
            [fact(3)],
        ),
        source(
            "8-k-acquisition",
            "filings",
            "selected",
            "8-K",
            "Form 8-K · acquisition",
            "sec.gov · current report",
            "Company-authored",
            "full",
            [fact(2), inference(1)],
        ),
        source(
            "proxy-2025",
            "filings",
            "selected",
            "DEF14A",
            "Proxy statement · 2025",
            "sec.gov · proxy",
            "Company-authored",
            "full",
            [fact(3)],
            "Governance context only",
        ),
        source(
            "s-1",
            "filings",
            "selected",
            "S-1",
            "Registration statement · 2021",
            "sec.gov · listing prospectus",
            "Company-authored",
            "full",
            [fact(5), projection(1)],
            "Period 2021, structural facts only",
        ),
        source(
            "q1-call",
            "calls",
            "selected",
            "CALL",
            "Q1 2025 earnings call",
            "investor relations · transcript",
            "Company-authored",
            "full",
            [fact(3), inference(2)],
            "Management statements, attributed",
        ),
        source(
            "q4-call",
            "calls",
            "selected",
            "CALL",
            "Q4 2024 earnings call",
            "investor relations · transcript",
            "Company-authored",
            "full",
            [fact(4), projection(1)],
            "Management statements, attributed",
        ),
        source(
            "q3-call",
            "calls",
            "selected",
            "CALL",
            "Q3 2024 earnings call",
            "investor relations · transcript",
            "Company-authored",
            "full",
            [fact(2), inference(1)],
            "Management statements, attributed",
        ),
        source(
            "q2-2024-call",
            "calls",
            "selected",
            "CALL",
            "Q2 2024 earnings call",
            "investor relations · transcript",
            "Company-authored",
            "partial",
            [fact(2)],
            "Q&A not captured",
        ),
        source(
            "investor-day-2023",
            "investor",
            "selected",
            "DECK",
            "Investor day 2023",
            "investor relations · presentation",
            "Company-authored",
            "partial",
            [fact(2), projection(2)],
            "Absence after slide 22 not established",
        ),
        source(
            "annual-letter",
            "investor",
            "selected",
            "PDF",
            "Shareholder letter · 2024",
            "investor relations · letter",
            "Company-authored",
            "full",
            [inference(2), projection(1)],
            "Management view, attributed",
        ),
        source(
            "impact-report",
            "investor",
            "selected",
            "PDF",
            "Impact report · 2024",
            "investor relations · report",
            "Company-authored",
            "full",
            [fact(2)],
        ),
        source(
            "insurer-association",
            "third-party",
            "selected",
            "PDF",
            "Insurer association · claims study",
            "industry body · report",
            "Third-party",
            "full",
            [fact(3), opposing(1)],
        ),
        source(
            "repair-survey",
            "third-party",
            "selected",
            "PDF",
            "Repair network survey · 2025",
            "industry body · survey",
            "Third-party",
            "partial",
            [fact(2), opposing(1)],
            "Methodology appendix not read",
        ),
        source(
            "trade-press-2",
            "third-party",
            "selected",
            "PRESS",
            "Trade press · insurer platforms",
            "industry publication · article",
            "Third-party",
            "full",
            [inference(1), opposing(1)],
            "Argument checked against filings",
        ),
        source(
            "peer-annual",
            "third-party",
            "selected",
            "PDF",
            "Peer platform · annual report",
            "peer company · annual report",
            "Third-party",
            "full",
            [fact(3), opposing(2)],
            "Peer claims, not about the company",
        ),
        source(
            "regulator-bulletin",
            "third-party",
            "selected",
            "REG",
            "Regulator bulletin · claims data",
            "state regulator · bulletin",
            "Regulator",
            "full",
            [fact(2)],
        ),
        source(
            "case-study",
            "third-party",
            "selected",
            "WEB",
            "Insurer case study · routing",
            "insurer site · case study",
            "Third-party",
            "full",
            [fact(1), inference(1)],
            "Single insurer, not representative",
        ),
        source(
            "conference-talk",
            "third-party",
            "selected",
            "VIDEO",
            "Industry conference talk · 2025",
            "conference · transcript",
            "Third-party",
            "partial",
            [inference(1)],
            "Transcript ends at minute 18",
        ),
        source(
            "trade-press-3",
            "third-party",
            "selected",
            "PRESS",
            "Trade press · repair costs",
            "industry publication · article",
            "Third-party",
            "full",
            [fact(1), opposing(1)],
        ),
        source(
            "standards-body",
            "third-party",
            "selected",
            "PDF",
            "Data standards body · overview",
            "standards body · specification",
            "Third-party",
            "full",
            [fact(2)],
            "Describes standards, not adoption",
        ),
        source(
            "insurer-10-k",
            "third-party",
            "selected",
            "10-K",
            "Insurer customer · Form 10-K",
            "sec.gov · customer annual report",
            "Third-party",
            "full",
            [fact(2), opposing(1)],
        ),
        source(
            "blog",
            undefined,
            "context",
            "WEB",
            "Company blog · product update",
            "company site · article",
            "Company-authored",
            "full",
            [],
            "Marketing, not used as evidence",
        ),
        source(
            "docs-index",
            undefined,
            "context",
            "WEB",
            "Product documentation · index",
            "company site · index page",
            "Company-authored",
            "full",
            [],
            "Linked pages not read",
        ),
        source(
            "academic-paper",
            undefined,
            "pending",
            "PDF",
            "Academic paper · claims platforms",
            "journal · article",
            "Third-party",
            "unavailable",
            undefined,
            "Paywalled, not irrelevance",
        ),
        source(
            "press-release-2019",
            "investor",
            "excluded",
            "PR",
            "Press release · 2019",
            "investor relations · release",
            "Company-authored",
            "full",
            [fact(1)],
            "Period 2019, superseded",
        ),
        source(
            "mirror",
            "filings",
            "excluded",
            "10-K",
            "Mirror copy of the FY2025 annual report",
            "third-party mirror · duplicate",
            "Company-authored",
            "full",
            [],
            "Duplicate of an existing capture",
        ),
        source(
            "opinion-blog",
            "third-party",
            "excluded",
            "WEB",
            "Opinion blog · platform risk",
            "personal blog · article",
            "Third-party",
            "full",
            [inference(1)],
            "Unattributed claims",
        ),
    ];
}

/** All 38 illustrative sources; the first eight carry document excerpts. */
export const illustrativeSources: readonly IllustrativeSource[] = [
    annualReport,
    row({
        id: "q2-call",
        kind: "calls",
        use: "selected",
        docType: "CALL",
        title: "Q2 2025 earnings call",
        meta: "investor relations · transcript",
        relationship: "Company-authored",
        reading: "full",
        contributions: {
            count: 9,
            segments: [
                { kind: "fact", count: 5 },
                { kind: "inference", count: 3 },
                { kind: "hypothesis", count: 1 },
            ],
        },
        restriction: "Management statements, attributed",
        control: (
            <Badge tone="counter">
                <ClaimGlyph kind="counter" />
                Conflict · 10-K p. 8
            </Badge>
        ),
        document: {
            meta: "investor relations · capture v1 · complete capture · transcript",
            pages: [
                {
                    id: "remarks",
                    label: "Prepared remarks",
                    section: "Management remarks",
                    passages: [
                        {
                            id: "routing",
                            kind: "counter",
                            label: "Conflict",
                            meta: "vs 10-K p. 8 ¶4",
                            highlight: "conflict",
                            text: "[Illustrative excerpt] Our platform recommends where each claim should be repaired.",
                        },
                        {
                            id: "context",
                            quiet: true,
                            text: "[Illustrative excerpt] Management statements are attributed and never read as independent confirmation.",
                        },
                    ],
                },
            ],
            contributionLabel: "Company-authored · earnings call · Q2 2025",
            contributions: [
                {
                    id: "routing",
                    kind: "counter",
                    label: "Fact",
                    meta: "Prepared remarks",
                    questions: ["Q1"],
                    target: { pageId: "remarks", passageId: "routing" },
                    status: (
                        <Badge tone="counter">
                            <ClaimGlyph kind="counter" />
                            Conflict
                        </Badge>
                    ),
                    text: "Management describes CCC-recommended routing.",
                    note: "The 10-K describes insurer-set rules. Periods match; definitions differ.",
                },
            ],
        },
    }),
    row({
        id: "investor-day",
        kind: "investor",
        use: "selected",
        docType: "DECK",
        title: "Investor day 2025",
        meta: "investor relations · presentation",
        relationship: "Company-authored",
        reading: "partial",
        readingLabel: "Partial · to slide 40",
        contributions: {
            count: 7,
            segments: [
                { kind: "fact", count: 3 },
                { kind: "inference", count: 2 },
                { kind: "hypothesis", count: 2 },
            ],
        },
        restriction: "Absence after slide 40 not established",
        control: notEstablished,
        document: {
            meta: "investor relations · capture v1 · partial reading · to slide 40",
            pages: [
                {
                    id: "slide-40",
                    label: "slide 40",
                    section: "Network",
                    passages: [
                        {
                            id: "last",
                            quiet: true,
                            text: "[Illustrative excerpt] Reading stopped at this slide. Later slides were not consulted.",
                        },
                    ],
                },
            ],
            contributionLabel: "Company-authored · presentation · 2025",
            contributions: [],
        },
    }),
    row({
        id: "10-q",
        kind: "filings",
        use: "selected",
        docType: "10-Q",
        title: "Form 10-Q · Q2 2025",
        meta: "sec.gov · quarterly report",
        relationship: "Company-authored",
        reading: "full",
        contributions: { count: 6, segments: [{ kind: "fact", count: 6 }] },
        control: supported,
        document: {
            meta: "sec.gov · capture v1 · complete capture",
            pages: [],
            contributionLabel: "Company-authored · quarterly report · Q2 2025",
            contributions: [],
            originalHref: "https://www.sec.gov/",
        },
    }),
    row({
        id: "integrations",
        use: "context",
        docType: "WEB",
        title: "Insurer integrations · index page",
        meta: "company site · 6 links observed",
        relationship: "Company-authored",
        reading: "full",
        contributions: { count: 0, note: "links only" },
        restriction: "Linked pages not read",
        document: {
            meta: "company site · capture v1 · complete capture · links only",
            pages: [],
            contributionLabel: "Company-authored · index page",
            contributions: [],
        },
    }),
    row({
        id: "trade-press",
        kind: "third-party",
        use: "selected",
        docType: "PRESS",
        title: "Trade press · repair networks",
        meta: "industry publication · article",
        relationship: "Third-party",
        reading: "full",
        contributions: {
            count: 3,
            segments: [
                { kind: "inference", count: 1 },
                { kind: "counter", count: 2 },
            ],
        },
        restriction: "Argument checked against filings",
        control: supported,
        document: {
            meta: "industry publication · capture v1 · complete capture",
            pages: [],
            contributionLabel: "Third-party · article",
            contributions: [],
        },
    }),
    row({
        id: "patent-register",
        use: "pending",
        missing: true,
        docType: "REG",
        title: "Patent register search",
        meta: "public register · query",
        relationship: "Regulator",
        reading: "unavailable",
        restriction: "Failed capture, not irrelevance",
        control: <Badge tone="dashed">Unfinished</Badge>,
        document: {
            meta: "public register · capture unavailable",
            pages: [],
            contributionLabel: "Regulator · register query",
            contributions: [],
        },
    }),
    row({
        id: "industry-overview",
        kind: "third-party",
        use: "excluded",
        quiet: true,
        docType: "PDF",
        title: "Industry overview · reused",
        meta: "earlier dossier · 2022",
        relationship: "Third-party",
        reading: "unknown",
        contributions: { count: 2, segments: [{ kind: "fact", count: 2 }] },
        restriction: "Period 2022, not current",
        control: notEstablished,
        document: {
            meta: "earlier dossier · completeness unverified · 2022",
            pages: [],
            contributionLabel: "Third-party · industry overview · 2022",
            contributions: [],
        },
    }),
    ...additionalSources(),
];
export { annualReport };
export const totalSources = 38;
export const selectedSources = 29;

const listItem = (
    id: string,
    meta: string,
    title?: string,
    metaTone?: "counter",
): SourceReaderListItem => {
    const source = illustrativeSources.find((item) => item.id === id);
    if (!source) throw new Error(`Unknown illustrative source ${id}`);
    return {
        id,
        docType: source.docType,
        title: title ?? source.title,
        meta,
        metaTone,
        ...(metaTone === "counter" ? { conflicts: 1 } : {}),
        reading: source.reading,
    };
};

/** Full question text by label, for every place the reader shows Q1, Q2… */
export const readerQuestionTexts: Readonly<Record<string, string>> = {
    Q1: "Does CCC control coordination?",
    Q2: "Is its operational context durable?",
    Q3: "Could core platforms replace it?",
    Q4: "Could an agent bypass it?",
};

export const readerSourceGroups = [
    {
        id: "filings",
        label: "Filings",
        items: [
            listItem("10-k", "18 contributions"),
            listItem("10-q", "6 contributions"),
        ],
    },
    {
        id: "calls",
        label: "Calls and investor",
        items: [
            listItem("q2-call", "1 conflict", undefined, "counter"),
            listItem("investor-day", "partial capture"),
        ],
    },
    {
        id: "third-party",
        label: "Third-party",
        items: [listItem("trade-press", "3 contributions")],
    },
    {
        id: "context",
        label: "Context",
        items: [
            listItem(
                "integrations",
                "links only",
                "Insurer integrations index",
            ),
        ],
    },
];

export const matrixFilters = [
    {
        id: "kind",
        label: "Source kind",
        options: [
            { id: "all", label: "All kinds" },
            { id: "filings", label: "Filings" },
            { id: "calls", label: "Calls" },
            { id: "investor", label: "Investor" },
            { id: "third-party", label: "Third-party" },
        ],
    },
    {
        id: "reading",
        label: "Reading",
        options: [
            { id: "any", label: "Any capture" },
            { id: "partial", label: "Partial" },
            { id: "unavailable", label: "Unavailable" },
        ],
    },
    {
        id: "use",
        label: "Selection",
        options: [
            { id: "any", label: "Any selection" },
            { id: "selected", label: "Selected" },
            { id: "context", label: "Context" },
            { id: "excluded", label: "Excluded" },
        ],
    },
] as const;
export type MatrixFilterValues = Record<
    (typeof matrixFilters)[number]["id"],
    string
>;
export const defaultMatrixFilters: MatrixFilterValues = {
    kind: "all",
    reading: "any",
    use: "any",
};

/** Illustrative filtering of the fixture rows; a connected consumer filters persisted sources. */
export function filterIllustrativeSources(
    query: string,
    filters: MatrixFilterValues,
) {
    const needle = query.trim().toLowerCase();
    // Same order as the live matrix: most contributions first.
    return [...illustrativeSources]
        .sort(
            (a, b) =>
                (b.contributions?.count ?? 0) - (a.contributions?.count ?? 0),
        )
        .filter(
            (source) =>
                (filters.kind === "all" || source.kind === filters.kind) &&
                (filters.reading === "any" ||
                    source.reading === filters.reading) &&
                (filters.use === "any" || source.use === filters.use) &&
                (!needle ||
                    `${source.docType} ${source.title} ${source.meta} ${source.restriction ?? ""}`
                        .toLowerCase()
                        .includes(needle)),
        );
}
