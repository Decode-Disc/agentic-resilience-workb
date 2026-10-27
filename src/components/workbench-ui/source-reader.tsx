import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { type ClaimTone, EvidenceBadge, WorkbenchIcon } from "./glyphs";
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
}: SourceReaderProps) {
    const [index, setIndex] = useState(initialPage);
    const page = pages[index];
    const move = (next: number) => {
        if (!pages[next]) return;
        setIndex(next);
        onPageChange?.(pages[next].id);
    };
    return (
        <div className={styles.wrap}>
            <section className={cn("wb-glass", styles.main)}>
                <div className={styles.hd}>
                    <span
                        style={{
                            flex: 1,
                            display: "flex",
                            flexDirection: "column",
                            gap: 4,
                            minWidth: 0,
                        }}>
                        <b style={{ fontSize: 18, letterSpacing: "-.02em" }}>
                            {title}
                        </b>
                        <span className="wb-meta">{meta}</span>
                    </span>
                    <Button
                        className={styles.ib}
                        aria-label="Previous passage"
                        onClick={() => move(index - 1)}
                        disabled={index === 0}>
                        <WorkbenchIcon name="back" size={14} />
                    </Button>
                    <span
                        className="wb-meta"
                        style={{ color: "var(--foreground)" }}>
                        {pagePosition ?? page?.label}
                    </span>
                    <Button
                        className={styles.ib}
                        aria-label="Next passage"
                        onClick={() => move(index + 1)}
                        disabled={index >= pages.length - 1}>
                        <WorkbenchIcon name="chevron" size={14} />
                    </Button>
                </div>
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
                            {page.passages.map((p) => (
                                <p
                                    key={p.id}
                                    className={styles.para}
                                    style={
                                        p.quiet
                                            ? {
                                                  color: "var(--muted-foreground)",
                                              }
                                            : undefined
                                    }>
                                    {p.kind && (
                                        <span className={styles.mark}>
                                            <EvidenceBadge kind={p.kind}>
                                                {p.label}
                                            </EvidenceBadge>
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
                            ))}
                        </article>
                    ) : (
                        <p>No document passages available.</p>
                    )}
                </div>
            </section>
            <aside className={cn("wb-glass", styles.side)}>
                <span
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                        paddingBottom: 8,
                    }}>
                    <span
                        className="wb-label"
                        style={{ color: "var(--accent-foreground)" }}>
                        {"// What this document gives"}
                    </span>
                    <b style={{ fontSize: 16, letterSpacing: "-.02em" }}>
                        {contributionLabel}
                    </b>
                </span>
                {contributions.map((c) => (
                    <div className={styles.contrib} key={c.id}>
                        <span
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                            }}>
                            <EvidenceBadge kind={c.kind}>
                                {c.label}
                            </EvidenceBadge>
                            <span className="wb-meta" style={{ flex: 1 }}>
                                {c.meta}
                            </span>
                            {c.status}
                        </span>
                        <span style={{ fontSize: 13.5, lineHeight: "19px" }}>
                            {c.text}
                        </span>
                        {c.note && (
                            <span
                                style={{
                                    fontSize: 12.5,
                                    lineHeight: "17px",
                                    color: "var(--muted-foreground)",
                                }}>
                                {c.note}
                            </span>
                        )}
                    </div>
                ))}
            </aside>
        </div>
    );
}
