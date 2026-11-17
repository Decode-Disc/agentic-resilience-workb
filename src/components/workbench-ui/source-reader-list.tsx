import { Search01Icon } from "@hugeicons/core-free-icons";
import { MotionConfig, motion } from "motion/react";
import { type ReactNode, useId, useState } from "react";
import Icon from "@/components/icon";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
    ClaimGlyph,
    ReadingGlyph,
    type ReadingState,
    WorkbenchIcon,
} from "./glyphs";
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
    /** Conflicting citations in this source; offers a direct way to the first one. */
    conflicts?: number;
}

/** Grouped sources beside the reader; selecting one changes the document shown. A filter narrows every group, and groups fold. */
export function SourceReaderList({
    title = "Sources",
    summary,
    groups,
    selectedId,
    onSelect,
    onOpenConflict,
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
    /** Opens a source on its first conflicting citation. */
    onOpenConflict?: (id: string) => void;
    footer?: ReactNode;
}) {
    const markerId = useId();
    const [query, setQuery] = useState("");
    const needle = query.trim().toLowerCase();
    // Retained material and the group holding the open source start open; the others fold.
    const [open, setOpen] = useState<ReadonlySet<string>>(
        () =>
            new Set(
                groups
                    .filter(
                        (group, index) =>
                            index === 0 ||
                            group.items.some((item) => item.id === selectedId),
                    )
                    .map((group) => group.id),
            ),
    );
    const shown = groups.map((group) => ({
        ...group,
        matches: needle
            ? group.items.filter((item) =>
                  `${item.title} ${item.meta}`.toLowerCase().includes(needle),
              )
            : group.items,
    }));
    const nothing = needle && shown.every((group) => !group.matches.length);
    return (
        <MotionConfig reducedMotion="user">
            <nav aria-label={title} className={cn("wb-glass", styles.list)}>
                <span className={styles.header}>
                    <h2>{title}</h2>
                    {summary && <span className="wb-meta">{summary}</span>}
                </span>
                <label className={styles.filter}>
                    <Icon iconNode={Search01Icon} size={14} />
                    <input
                        type="search"
                        aria-label="Filter sources"
                        placeholder="Filter sources"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                    />
                </label>
                <div className={styles.groups}>
                    {nothing && (
                        <p className={styles.nothing}>
                            No source matches this filter.
                        </p>
                    )}
                    {shown.map((group) =>
                        needle && !group.matches.length ? null : (
                            <Collapsible
                                key={group.id}
                                // A filter reveals its matches even inside a folded group.
                                open={Boolean(needle) || open.has(group.id)}
                                onOpenChange={(next) =>
                                    setOpen((current) => {
                                        const updated = new Set(current);
                                        if (next) updated.add(group.id);
                                        else updated.delete(group.id);
                                        return updated;
                                    })
                                }
                                className={styles.group}>
                                <CollapsibleTrigger
                                    className={cn(
                                        "wb-label",
                                        styles.groupToggle,
                                    )}>
                                    <WorkbenchIcon
                                        name="chevron"
                                        size={11}
                                        strokeWidth={2}
                                    />
                                    {group.label} · {group.matches.length}
                                </CollapsibleTrigger>
                                <CollapsibleContent>
                                    <ul>
                                        {group.matches.map((item) => (
                                            <li
                                                key={item.id}
                                                className={styles.entry}
                                                data-selected={
                                                    item.id === selectedId ||
                                                    undefined
                                                }>
                                                {item.id === selectedId && (
                                                    <motion.span
                                                        layoutId={markerId}
                                                        className={
                                                            styles.marker
                                                        }
                                                        transition={
                                                            markerTransition
                                                        }
                                                        aria-hidden="true"
                                                    />
                                                )}
                                                <button
                                                    type="button"
                                                    className={styles.item}
                                                    aria-current={
                                                        item.id === selectedId
                                                            ? "true"
                                                            : undefined
                                                    }
                                                    onClick={() =>
                                                        onSelect(item.id)
                                                    }>
                                                    <span
                                                        className="wb-doc wb-doc-md"
                                                        aria-hidden="true">
                                                        {item.docType}
                                                    </span>
                                                    <span
                                                        className={styles.text}>
                                                        <span
                                                            className={
                                                                styles.title
                                                            }>
                                                            {item.title}
                                                        </span>
                                                        <span
                                                            className={cn(
                                                                "wb-meta",
                                                                styles.meta,
                                                            )}
                                                            data-tone={
                                                                item.metaTone
                                                            }>
                                                            {item.meta}
                                                        </span>
                                                    </span>
                                                    <ReadingGlyph
                                                        state={item.reading}
                                                        size={12}
                                                    />
                                                </button>
                                                {onOpenConflict &&
                                                    (item.conflicts ?? 0) >
                                                        0 && (
                                                        <button
                                                            type="button"
                                                            className={
                                                                styles.conflictLink
                                                            }
                                                            aria-label={`Go to the conflict in ${item.title}`}
                                                            onClick={() =>
                                                                onOpenConflict(
                                                                    item.id,
                                                                )
                                                            }>
                                                            <ClaimGlyph kind="counter" />
                                                            Go to conflict
                                                        </button>
                                                    )}
                                            </li>
                                        ))}
                                    </ul>
                                </CollapsibleContent>
                            </Collapsible>
                        ),
                    )}
                </div>
                {footer && <div className={styles.footer}>{footer}</div>}
            </nav>
        </MotionConfig>
    );
}
