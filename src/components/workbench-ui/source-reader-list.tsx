import { MotionConfig, motion } from "motion/react";
import { type ReactNode, useId } from "react";
import { cn } from "@/lib/utils";
import { ReadingGlyph, type ReadingState } from "./glyphs";
import { markerTransition } from "./motion";
import styles from "./source-reader-list.module.css";

export interface SourceReaderListItem {
    id: string;
    docType: string;
    title: string;
    meta: string;
    /** Highlights a conflict in the item summary. */
    metaTone?: "counter";
    reading: ReadingState;
}

/** Grouped sources beside the reader; selecting one changes the document shown. */
export function SourceReaderList({
    title = "Sources",
    summary,
    groups,
    selectedId,
    onSelect,
    footer,
}: {
    title?: string;
    summary?: ReactNode;
    groups: readonly {
        id: string;
        label: string;
        items: readonly SourceReaderListItem[];
    }[];
    selectedId?: string;
    onSelect: (id: string) => void;
    footer?: ReactNode;
}) {
    const markerId = useId();
    return (
        <MotionConfig reducedMotion="user">
            <nav aria-label={title} className={cn("wb-glass", styles.list)}>
                <span className={styles.header}>
                    <h2>{title}</h2>
                    {summary && <span className="wb-meta">{summary}</span>}
                </span>
                <div className={styles.groups}>
                    {groups.map((group) => (
                        <section key={group.id} className={styles.group}>
                            <h3 className="wb-label">{group.label}</h3>
                            <ul>
                                {group.items.map((item) => (
                                    <li key={item.id}>
                                        <button
                                            type="button"
                                            className={styles.item}
                                            aria-current={
                                                item.id === selectedId
                                                    ? "true"
                                                    : undefined
                                            }
                                            onClick={() => onSelect(item.id)}>
                                            {item.id === selectedId && (
                                                <motion.span
                                                    layoutId={markerId}
                                                    className={styles.marker}
                                                    transition={
                                                        markerTransition
                                                    }
                                                    aria-hidden="true"
                                                />
                                            )}
                                            <span
                                                className="wb-doc wb-doc-md"
                                                aria-hidden="true">
                                                {item.docType}
                                            </span>
                                            <span className={styles.text}>
                                                <span className={styles.title}>
                                                    {item.title}
                                                </span>
                                                <span
                                                    className={cn(
                                                        "wb-meta",
                                                        styles.meta,
                                                    )}
                                                    data-tone={item.metaTone}>
                                                    {item.meta}
                                                </span>
                                            </span>
                                            <ReadingGlyph
                                                state={item.reading}
                                                size={12}
                                            />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    ))}
                </div>
                {footer && <div className={styles.footer}>{footer}</div>}
            </nav>
        </MotionConfig>
    );
}
