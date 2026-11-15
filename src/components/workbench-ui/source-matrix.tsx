import { InformationCircleIcon } from "@hugeicons/core-free-icons";
import {
    type CSSProperties,
    type ReactNode,
    useCallback,
    useId,
    useRef,
    useState,
} from "react";
import Icon from "@/components/icon";
import { cn } from "@/lib/utils";
import {
    ClassDistributionBar,
    type DistributionSegmentKind,
} from "./class-distribution-bar";
import {
    ClaimGlyph,
    type ClaimTone,
    claimCountLabel,
    ReadingGlyph,
    type ReadingState,
    WorkbenchIcon,
} from "./glyphs";
import { HelpTip } from "./help-tip";
import styles from "./source-matrix.module.css";

export interface SourceMatrixRow {
    id: string;
    /** Short document tag such as 10-K or CALL. */
    docType: string;
    title: string;
    meta: string;
    /** Authorship relative to the company, shown before the source's origin. */
    relationship: string;
    reading: ReadingState;
    readingLabel?: string;
    /** Absent when no contribution could be assessed. */
    contributions?: {
        count: number;
        segments?: readonly { kind: ClaimTone; count: number }[];
        note?: string;
    };
    restriction?: string;
    control?: ReactNode;
    selection: ReactNode;
    /** Mutes a source that is outside the usable set. */
    quiet?: boolean;
    /** A capture that never succeeded keeps a dashed document tag. */
    missing?: boolean;
}

export interface SourceMatrixProps {
    caption: string;
    rows: readonly SourceMatrixRow[];
    currentId?: string;
    onOpen: (id: string) => void;
    /** Upper bound shared by every contribution bar so rows stay comparable. */
    contributionScale?: number;
    note?: ReactNode;
    empty?: ReactNode;
    /** Closes the panel, typically with pagination; stays inside the frame so it is not lost under its shadow. */
    footer?: ReactNode;
}

const columns = [
    [
        "Source",
        undefined,
        "The captured document, who authored it and where it comes from.",
    ],
    [
        "Availability",
        172,
        "How much of the document was actually read: in full, partially or not at all.",
    ],
    [
        "Contributions",
        176,
        "Assertions this source contributes, by claim class. Every bar uses the same scale, so rows compare.",
    ],
    [
        "Restriction",
        220,
        "Limits on how the source's material may be used in the analysis.",
    ],
    [
        "Control",
        150,
        "What checking this source against other documents found.",
    ],
    [
        "Selection",
        130,
        "Whether the source is used for the questions, kept as context, excluded or still pending.",
    ],
] as const;
const dash = "—";

/** Every supplied source with what was read and what it contributes; membership, reading and use stay separate. */
export function SourceMatrix({
    caption,
    rows,
    currentId,
    onOpen,
    contributionScale = Math.max(
        1,
        ...rows.map((row) => row.contributions?.count ?? 0),
    ),
    note,
    empty,
    footer,
}: SourceMatrixProps) {
    const helpId = useId();
    const { hiddenColumns, scrolled, scrollRef, onScroll } =
        useHorizontalScroll();
    // Rows that replace the first set (a page turn or a filter) arrive; the first set appears at once.
    const rowsKey = rows.map((row) => row.id).join("|");
    const firstRowsKey = useRef(rowsKey);
    return (
        <div className={cn("wb-glass wb-focal", styles.panel)}>
            <div
                className={styles.scroll}
                ref={scrollRef}
                onScroll={onScroll}
                data-more={hiddenColumns || undefined}
                data-scrolled={scrolled || undefined}>
                <table className={styles.table}>
                    <caption className="sr-only">{caption}</caption>
                    <colgroup>
                        {columns.map(([label, width]) => (
                            <col key={label} style={{ width }} />
                        ))}
                    </colgroup>
                    <thead>
                        <tr className={styles.group}>
                            {(
                                [
                                    ["Identity", 1],
                                    ["Reading", 1],
                                    ["Contribution", 2],
                                    ["Use", 2],
                                ] as const
                            ).map(([label, span]) => (
                                <th
                                    key={label}
                                    colSpan={span}
                                    scope="colgroup"
                                    data-use={label === "Use" || undefined}>
                                    <span
                                        className={cn(
                                            "wb-label",
                                            styles.groupLabel,
                                        )}>
                                        {label}
                                    </span>
                                </th>
                            ))}
                        </tr>
                        <tr className={styles.columns}>
                            {columns.map(([label, , help]) => (
                                <th key={label} scope="col">
                                    <span className={styles.columnHead}>
                                        {label}
                                        <HelpTip
                                            trigger={
                                                <button
                                                    type="button"
                                                    className={styles.help}
                                                    aria-label={`About ${label}`}
                                                    aria-describedby={`${helpId}-${label}`}>
                                                    <Icon
                                                        iconNode={
                                                            InformationCircleIcon
                                                        }
                                                        size={13}
                                                    />
                                                </button>
                                            }>
                                            {help}
                                        </HelpTip>
                                        <span
                                            id={`${helpId}-${label}`}
                                            className="sr-only">
                                            {help}
                                        </span>
                                    </span>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody
                        key={rowsKey}
                        data-arriving={
                            rowsKey !== firstRowsKey.current || undefined
                        }>
                        {rows.map((row, position) => (
                            <tr
                                key={row.id}
                                className={styles.row}
                                style={{ "--row": position } as CSSProperties}
                                data-current={row.id === currentId || undefined}
                                data-quiet={
                                    row.quiet || row.missing || undefined
                                }
                                onClick={() => onOpen(row.id)}>
                                <td>
                                    <span className={styles.source}>
                                        <span
                                            className={cn(
                                                "wb-doc wb-doc-lg",
                                                row.missing && "wb-doc-missing",
                                                styles.doc,
                                            )}
                                            data-missing={
                                                row.missing || undefined
                                            }
                                            aria-hidden="true">
                                            {row.docType}
                                        </span>
                                        <span className={styles.sourceText}>
                                            <button
                                                type="button"
                                                className={styles.title}
                                                aria-current={
                                                    row.id === currentId
                                                        ? "true"
                                                        : undefined
                                                }
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    onOpen(row.id);
                                                }}>
                                                {row.title}
                                            </button>
                                            <span
                                                className={cn(
                                                    "wb-meta",
                                                    styles.meta,
                                                )}>
                                                <span
                                                    className={
                                                        styles.relationship
                                                    }>
                                                    {row.relationship}
                                                </span>
                                                {" · "}
                                                {row.meta}
                                            </span>
                                        </span>
                                    </span>
                                </td>
                                <td>
                                    <span
                                        className={styles.reading}
                                        data-state={row.reading}>
                                        <ReadingGlyph state={row.reading} />
                                        {row.readingLabel ??
                                            (row.reading === "full"
                                                ? "Full reading"
                                                : row.reading === "partial"
                                                  ? "Partial"
                                                  : "Unavailable")}
                                    </span>
                                </td>
                                <td>
                                    <Contributions
                                        value={row.contributions}
                                        scale={contributionScale}
                                    />
                                </td>
                                <td className={styles.small}>
                                    {row.restriction ?? dash}
                                </td>
                                <td>
                                    {row.control ?? (
                                        <span className={styles.small}>
                                            {dash}
                                        </span>
                                    )}
                                </td>
                                <td>{row.selection}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {hiddenColumns && rows.length > 0 && (
                <p className={styles.scrollHint} aria-hidden="true">
                    Scroll sideways for every column
                    <WorkbenchIcon name="chevron" size={12} strokeWidth={2} />
                </p>
            )}
            {rows.length === 0 && empty && (
                <div className={styles.empty}>{empty}</div>
            )}
            <div className={styles.legend}>
                <span className={styles.legendItem}>
                    <ReadingGlyph state="full" size={12} />
                    Full
                </span>
                <span className={styles.legendItem}>
                    <ReadingGlyph state="partial" size={12} />
                    Partial
                </span>
                <span className={styles.legendItem}>
                    <ReadingGlyph state="unavailable" size={12} />
                    Unavailable
                </span>
                <span className={styles.legendItem}>
                    <ClassDistributionBar
                        width={40}
                        segments={[
                            { kind: "fact", count: 1 },
                            { kind: "inference", count: 1 },
                            { kind: "hypothesis", count: 1 },
                            { kind: "counter", count: 1 },
                        ]}
                    />
                    contributions by claim class
                </span>
                {note && <span className={styles.legendNote}>{note}</span>}
            </div>
            {footer && <div className={styles.footer}>{footer}</div>}
        </div>
    );
}

/** Tracks whether the table has scrolled and whether columns remain beyond its right edge. */
function useHorizontalScroll() {
    const [hiddenColumns, setHiddenColumns] = useState(false);
    const [scrolled, setScrolled] = useState(false);
    const measure = useCallback((element: HTMLElement) => {
        setHiddenColumns(
            element.scrollLeft + element.clientWidth < element.scrollWidth - 1,
        );
        setScrolled(element.scrollLeft > 0);
    }, []);
    const scrollRef = useCallback(
        (element: HTMLDivElement | null) => {
            if (!element) return;
            const observer = new ResizeObserver(() => measure(element));
            observer.observe(element);
            return () => observer.disconnect();
        },
        [measure],
    );
    return {
        hiddenColumns,
        scrolled,
        scrollRef,
        onScroll: (event: { currentTarget: HTMLElement }) =>
            measure(event.currentTarget),
    };
}

function Contributions({
    value,
    scale,
}: {
    value: SourceMatrixRow["contributions"];
    scale: number;
}) {
    if (!value) return <span className={styles.small}>{dash}</span>;
    const used = value.segments?.reduce((sum, s) => sum + s.count, 0) ?? 0;
    const segments: { kind: DistributionSegmentKind; count: number }[] = [
        ...(value.segments ?? []),
        { kind: "remaining", count: Math.max(0, scale - used) },
    ];
    const label = [
        `${value.count} contributions`,
        value.segments
            ?.filter((segment) => segment.count > 0)
            .map((segment) => claimCountLabel(segment.kind, segment.count))
            .join(", "),
    ]
        .filter(Boolean)
        .join(": ");
    return (
        <span className={styles.contributions}>
            <span
                className={styles.count}
                data-empty={!value.count || undefined}>
                {value.count}
            </span>
            {value.segments?.length ? (
                <HelpTip
                    trigger={
                        <button
                            type="button"
                            aria-label={label}
                            className={styles.barTrigger}
                            onClick={(event) => event.stopPropagation()}>
                            <ClassDistributionBar
                                width={92}
                                segments={segments}
                            />
                        </button>
                    }>
                    <span className={styles.breakdown}>
                        {value.segments.map((segment) => (
                            <span key={segment.kind}>
                                <ClaimGlyph kind={segment.kind} colored />
                                {claimCountLabel(segment.kind, segment.count)}
                            </span>
                        ))}
                    </span>
                </HelpTip>
            ) : (
                value.note && <span className={styles.small}>{value.note}</span>
            )}
        </span>
    );
}
