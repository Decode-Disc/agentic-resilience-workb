import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
    type ClaimTone,
    claimLabels,
    EvidenceBadge,
    WorkbenchIcon,
} from "./glyphs";
import styles from "./source-reader.module.css";
export interface ReaderPassage {
    id: string;
    text: ReactNode;
    kind?: ClaimTone;
    label?: string;
    meta?: string;
    highlight?: "selected" | "conflict" | "projection";
    quiet?: boolean;
}
export interface ReaderPage {
    id: string;
    label: string;
    section: string;
    heading?: ReactNode;
    passages: readonly ReaderPassage[];
}
export interface ReaderContribution {
    id: string;
    kind: ClaimTone;
    label?: string;
    meta: string;
    status: ReactNode;
    text: ReactNode;
    note?: string;
    /** The passage this contribution comes from; makes the contribution a link to it. */
    target?: { pageId: string; passageId: string };
    /** Question labels this contribution serves, such as Q1. */
    questions?: readonly string[];
}
export interface SourceReaderProps {
    title: string;
    meta: string;
    pages: readonly ReaderPage[];
    initialPage?: number;
    pagePosition?: string;
    onPageChange?: (id: string) => void;
    contributionLabel: string;
    contributions: readonly ReaderContribution[];
    /** A source list placed before the document; switches to the workspace geometry. */
    navigation?: ReactNode;
    /** Public address of the original document. */
    originalHref?: string;
    observedLinks?: readonly ReaderObservedLink[];
    /** Follow-up actions below the contributions. */
    actions?: ReactNode;
    /** `tabs` stacks the document and its contributions behind two tabs for narrow containers. */
    layout?: "columns" | "tabs";
    /** A close action placed on the title line, for overlays. */
    dismiss?: ReactNode;
}
/** A link destination seen in the document; `captured` distinguishes a read capture from a label only. */
export interface ReaderObservedLink {
    id: string;
    label: ReactNode;
    captured: boolean;
    meta: ReactNode;
}
const highlights = {
    selected: {
        background: "color-mix(in oklab,var(--brand-purple) 14%,transparent)",
        boxShadow: "0 2px 0 var(--brand-purple)",
        padding: "1px 2px",
    },
    conflict: {
        background:
            "color-mix(in oklab,var(--counter-evidence) 11%,transparent)",
        boxShadow: "0 2px 0 var(--counter-evidence)",
        padding: "1px 2px",
    },
    projection: { borderBottom: "2px dotted var(--evidence-hypothesis)" },
};
type ReaderTab = "document" | "contributions";
const allQuestions = "all";

/** Displays supplied excerpts and annotations; it never fabricates pagination or claims. */
export function SourceReader({
    title,
    meta,
    pages,
    initialPage = 0,
    pagePosition,
    onPageChange,
    contributionLabel,
    contributions,
    navigation,
    originalHref,
    observedLinks = [],
    actions,
    layout = "columns",
    dismiss,
}: SourceReaderProps) {
    const [index, setIndex] = useState(initialPage);
    const [activeId, setActiveId] = useState<string>();
    const [question, setQuestion] = useState(allQuestions);
    const [tab, setTab] = useState<ReaderTab>("document");
    const [reveal, setReveal] = useState<{
        kind: "passage" | "contribution";
        id: string;
    }>();
    const root = useRef<HTMLDivElement>(null);
    const page = pages[index];
    const active = contributions.find((c) => c.id === activeId);
    const questions = [
        ...new Set(contributions.flatMap((c) => c.questions ?? [])),
    ].sort();
    const shown =
        question === allQuestions
            ? contributions
            : contributions.filter((c) => c.questions?.includes(question));

    useEffect(() => {
        if (!reveal) return;
        const target = root.current?.querySelector(
            reveal.kind === "passage"
                ? `[data-passage-id="${CSS.escape(reveal.id)}"]`
                : `[data-contribution-id="${CSS.escape(reveal.id)}"]`,
        );
        const reduced = window.matchMedia(
            "(prefers-reduced-motion: reduce)",
        ).matches;
        target?.scrollIntoView({
            block: "nearest",
            behavior: reduced ? "auto" : "smooth",
        });
    }, [reveal]);

    const move = (next: number) => {
        if (!pages[next]) return;
        setIndex(next);
        setActiveId(undefined);
        onPageChange?.(pages[next].id);
    };
    const openPassage = (contribution: ReaderContribution) => {
        const target = contribution.target;
        if (!target) return;
        const next = pages.findIndex((item) => item.id === target.pageId);
        if (next < 0) return;
        if (next !== index) onPageChange?.(target.pageId);
        setIndex(next);
        setActiveId(contribution.id);
        setTab("document");
        setReveal({ kind: "passage", id: target.passageId });
    };
    const openContribution = (contribution: ReaderContribution) => {
        setActiveId(contribution.id);
        setQuestion(allQuestions);
        setTab("contributions");
        setReveal({ kind: "contribution", id: contribution.id });
    };

    const header = (
        <div className={styles.hd}>
            <span className={styles.hdTitle}>
                <span className={styles.hdTitleRow}>
                    <b style={{ fontSize: 18, letterSpacing: "-.02em" }}>
                        {title}
                    </b>
                    {dismiss}
                </span>
                <span className="wb-meta">{meta}</span>
            </span>
            <Button
                className={styles.ib}
                aria-label="Previous passage"
                onClick={() => move(index - 1)}
                disabled={index === 0}>
                <WorkbenchIcon name="back" size={14} />
            </Button>
            <span className="wb-meta" style={{ color: "var(--foreground)" }}>
                {pagePosition ?? page?.label}
            </span>
            <Button
                className={styles.ib}
                aria-label="Next passage"
                onClick={() => move(index + 1)}
                disabled={index >= pages.length - 1}>
                <WorkbenchIcon name="chevron" size={14} />
            </Button>
            {originalHref && (
                <Button
                    variant="outline"
                    size="sm"
                    className={styles.original}
                    nativeButton={false}
                    render={
                        <a
                            href={originalHref}
                            target="_blank"
                            rel="noreferrer"
                        />
                    }>
                    Open original
                    <WorkbenchIcon name="external" size={12} />
                </Button>
            )}
        </div>
    );

    const desk = (
        <div className={styles.desk}>
            {page ? (
                <article className={styles.page}>
                    <span
                        className="wb-meta"
                        style={{
                            display: "flex",
                            justifyContent: "space-between",
                        }}>
                        <span>{page.section}</span>
                        <span>{page.label}</span>
                    </span>
                    {page.heading && (
                        <h3 className={styles.heading}>{page.heading}</h3>
                    )}
                    {page.passages.map((p) => {
                        const linked = contributions.find(
                            (c) =>
                                c.target?.pageId === page.id &&
                                c.target.passageId === p.id,
                        );
                        const badge = p.kind && (
                            <EvidenceBadge kind={p.kind}>
                                {p.label}
                            </EvidenceBadge>
                        );
                        return (
                            <p
                                key={p.id}
                                className={styles.para}
                                data-passage-id={p.id}
                                data-passage-active={
                                    (active?.target?.pageId === page.id &&
                                        active.target.passageId === p.id) ||
                                    undefined
                                }
                                style={
                                    p.quiet
                                        ? { color: "var(--muted-foreground)" }
                                        : undefined
                                }>
                                {p.kind && (
                                    <span className={styles.mark}>
                                        {linked ? (
                                            <button
                                                type="button"
                                                className={styles.markLink}
                                                aria-label={`Show what this passage gives: ${p.label ?? claimLabels[p.kind]}`}
                                                onClick={() =>
                                                    openContribution(linked)
                                                }>
                                                {badge}
                                            </button>
                                        ) : (
                                            badge
                                        )}
                                        <span className="wb-meta">
                                            {p.meta}
                                        </span>
                                    </span>
                                )}
                                <span
                                    style={
                                        p.highlight
                                            ? highlights[p.highlight]
                                            : undefined
                                    }>
                                    {p.text}
                                </span>
                            </p>
                        );
                    })}
                </article>
            ) : (
                <p className={styles.noPassages}>
                    No document passages available.
                </p>
            )}
            {navigation && <span className={styles.fade} aria-hidden="true" />}
        </div>
    );

    const gives = (
        <>
            {layout === "columns" && (
                <span className={styles.sideHead}>
                    <span
                        className="wb-label"
                        style={{ color: "var(--accent-foreground)" }}>
                        {"// What this document gives"}
                    </span>
                    <b style={{ fontSize: 16, letterSpacing: "-.02em" }}>
                        {contributionLabel}
                    </b>
                </span>
            )}
            {questions.length > 1 && (
                <fieldset className={styles.questions}>
                    <legend className="sr-only">Filter by question</legend>
                    {[allQuestions, ...questions].map((id) => {
                        const count =
                            id === allQuestions
                                ? contributions.length
                                : contributions.filter((c) =>
                                      c.questions?.includes(id),
                                  ).length;
                        return (
                            <button
                                key={id}
                                type="button"
                                className={styles.question}
                                aria-pressed={question === id}
                                onClick={() => setQuestion(id)}>
                                {id === allQuestions ? "All" : id}
                                <span className={styles.questionCount}>
                                    {count}
                                </span>
                            </button>
                        );
                    })}
                </fieldset>
            )}
            {contributions.length === 0 && (
                <p className={styles.noPassages}>
                    No contribution was assessed in this document.
                </p>
            )}
            {shown.map((c) => {
                const body = (
                    <>
                        <span className={styles.contribHead}>
                            <EvidenceBadge kind={c.kind}>
                                {c.label}
                            </EvidenceBadge>
                            <span className="wb-meta" style={{ flex: 1 }}>
                                {c.meta}
                                {c.questions?.length
                                    ? ` · ${c.questions.join(" ")}`
                                    : ""}
                            </span>
                            {c.status}
                        </span>
                        <span className={styles.contribText}>{c.text}</span>
                        {c.note && (
                            <span className={styles.contribNote}>{c.note}</span>
                        )}
                        {c.target && (
                            <span
                                className={styles.contribGo}
                                aria-hidden="true">
                                Show in document
                                <WorkbenchIcon name="chevron" size={12} />
                            </span>
                        )}
                    </>
                );
                return c.target ? (
                    <button
                        key={c.id}
                        type="button"
                        className={cn(styles.contrib, styles.contribLink)}
                        data-contribution-id={c.id}
                        aria-current={c.id === activeId ? "true" : undefined}
                        onClick={() => openPassage(c)}>
                        {body}
                    </button>
                ) : (
                    <div
                        key={c.id}
                        className={styles.contrib}
                        data-contribution-id={c.id}>
                        {body}
                    </div>
                );
            })}
            {observedLinks.length > 0 && (
                <div className={styles.links}>
                    <span className="wb-label">Links observed</span>
                    <ul>
                        {observedLinks.map((link) => (
                            <li
                                key={link.id}
                                data-captured={link.captured || undefined}>
                                <WorkbenchIcon
                                    name={
                                        link.captured
                                            ? "check"
                                            : "unfinished-check"
                                    }
                                    size={14}
                                    strokeWidth={link.captured ? 2.2 : 1.6}
                                />
                                <span style={{ flex: 1 }}>{link.label}</span>
                                <span className="wb-meta">{link.meta}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {actions && layout === "columns" && (
                <div className={styles.actions}>{actions}</div>
            )}
        </>
    );

    if (layout === "tabs") {
        return (
            <div ref={root} className={styles.tabbed}>
                {header}
                <Tabs
                    value={tab}
                    onValueChange={(value) => setTab(value as ReaderTab)}
                    className={styles.tabs}>
                    <TabsList className={styles.tabList}>
                        <TabsTrigger value="document">Document</TabsTrigger>
                        <TabsTrigger value="contributions">
                            What it gives ({contributions.length})
                        </TabsTrigger>
                    </TabsList>
                    <ScrollArea
                        className={styles.tabScroll}
                        viewportClassName={styles.tabViewport}>
                        <TabsContent value="document">{desk}</TabsContent>
                        <TabsContent
                            value="contributions"
                            className={styles.tabbedSide}>
                            <section
                                aria-label="What this document gives"
                                className={styles.sideBody}>
                                <span className="wb-meta">
                                    {contributionLabel}
                                </span>
                                {gives}
                            </section>
                        </TabsContent>
                    </ScrollArea>
                    {actions && tab === "contributions" && (
                        <div className={styles.tabActions}>{actions}</div>
                    )}
                </Tabs>
            </div>
        );
    }

    return (
        <div
            ref={root}
            className={cn(styles.wrap, navigation && styles.workspace)}>
            {navigation}
            <section className={cn("wb-glass", styles.main)}>
                {header}
                {desk}
            </section>
            <section
                aria-label="What this document gives"
                className={cn("wb-glass", styles.side)}>
                {gives}
            </section>
        </div>
    );
}
