import { LinkSquare02Icon } from "@hugeicons/core-free-icons";
import { MotionConfig, motion } from "motion/react";
import {
    type KeyboardEvent,
    type ReactNode,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
} from "react";
import Icon from "@/components/icon";
import { Button } from "@/components/ui/button";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
    type ClaimTone,
    claimLabels,
    EvidenceBadge,
    WorkbenchIcon,
} from "./glyphs";
import { markerTransition } from "./motion";
import { QuestionTag } from "./question-tag";
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
    /** The passage this contribution comes from; without one it is listed as an unplaced note. */
    target?: { pageId: string; passageId: string };
    /** Question labels this contribution serves, such as Q1. */
    questions?: readonly string[];
    /** Documentary needs this contribution serves. */
    needIds?: readonly string[];
}
export interface ReaderFollowUp {
    id: string;
    label: string;
    onSelect: () => void;
}
/** A link destination seen in the document; `captured` distinguishes a read capture from a label only. */
export interface ReaderObservedLink {
    id: string;
    label: ReactNode;
    captured: boolean;
    meta: ReactNode;
}
export interface SourceReaderProps {
    title: string;
    meta: string;
    /** What kind of document this is, such as "Company-authored · annual report". */
    contributionLabel?: string;
    pages: readonly ReaderPage[];
    contributions: readonly ReaderContribution[];
    /** Public address of the original document. */
    originalHref?: string;
    observedLinks?: readonly ReaderObservedLink[];
    /** Follow-up actions offered from the header's Follow up menu. */
    followUps?: readonly ReaderFollowUp[];
    /** Consumer-owned decision controls placed beside Follow up. */
    decision?: ReactNode;
    /** A close action placed on the title line, for overlays. */
    dismiss?: ReactNode;
    /** Plays the arrival of a newly selected source; leave unset for the source a screen opens on. */
    arriving?: boolean;
    /** Identifies the document; a new value resets citations, filter and open notes. */
    sourceId?: string;
    /** `margin` places notes beside their passages; `inline` opens them under the passage. */
    noteMode?: "margin" | "inline";
    /** Whether every note is shown; defaults to shown in the margin and hidden inline. */
    notesShown?: boolean;
    onNotesShownChange?: (shown: boolean) => void;
    /** Starts on the first citation serving this documentary need. */
    focusNeedId?: string;
    /** Starts on the first conflicting citation, with the Conflicts filter on. */
    focusConflict?: boolean;
    /** Full question text by label (Q1, Q2…), shown wherever a label appears. */
    questionTexts?: Readonly<Record<string, string>>;
}

const highlights = {
    selected: styles.selectedHighlight,
    conflict: styles.conflictHighlight,
    projection: styles.projectionHighlight,
};
const allQuestions = "all";

interface Citation {
    key: string;
    number: number;
    passage: ReaderPassage;
    contributions: readonly ReaderContribution[];
}

const passageKey = (pageId: string, passageId: string) =>
    `${pageId}/${passageId}`;
/** Selects a citation line by key; keys sit in a quoted attribute value, so only quotes and backslashes need escaping. */
const citationSelector = (key: string) =>
    `[data-citation="${key.replace(/["\\]/g, "\\$&")}"]`;

/**
 * Reads a document as a notebook: each cited passage carries a numbered
 * marker and a note with what it contributes. The stepper walks the
 * citations in reading order; notes show in the margin or open inline.
 * It displays supplied excerpts and never fabricates passages or claims.
 */
export function SourceReader(props: SourceReaderProps) {
    // A new source, or a new starting point within it, starts the document afresh.
    const start = `${props.sourceId}:${props.focusNeedId ?? ""}:${props.focusConflict ? "conflict" : ""}`;
    return <ReaderDocument key={start} {...props} />;
}

function ReaderDocument({
    title,
    meta,
    contributionLabel,
    pages,
    contributions,
    originalHref,
    observedLinks = [],
    followUps = [],
    decision,
    dismiss,
    arriving = false,
    noteMode = "margin",
    notesShown: shownProp,
    onNotesShownChange,
    focusNeedId,
    focusConflict = false,
    questionTexts = {},
}: SourceReaderProps) {
    const markerId = useId();
    const scroller = useRef<HTMLDivElement>(null);
    const lastProgrammatic = useRef(0);

    const { citations, unplaced } = useMemo(() => {
        const byPassage = new Map<string, ReaderContribution[]>();
        for (const contribution of contributions) {
            const target = contribution.target;
            if (!target) continue;
            const key = passageKey(target.pageId, target.passageId);
            byPassage.set(key, [...(byPassage.get(key) ?? []), contribution]);
        }
        const found: Citation[] = [];
        for (const page of pages)
            for (const passage of page.passages) {
                const key = passageKey(page.id, passage.id);
                const cited = byPassage.get(key);
                if (cited)
                    found.push({
                        key,
                        number: found.length + 1,
                        passage,
                        contributions: cited,
                    });
            }
        const placed = new Set(
            found.flatMap((citation) =>
                citation.contributions.map((contribution) => contribution.id),
            ),
        );
        return {
            citations: found,
            unplaced: contributions.filter(
                (contribution) => !placed.has(contribution.id),
            ),
        };
    }, [pages, contributions]);

    const questions = [
        ...new Set(contributions.flatMap((c) => c.questions ?? [])),
    ].sort();
    const conflictCitations = citations.filter(isConflict);
    const matching = (filter: string) =>
        filter === allQuestions
            ? citations
            : filter === conflictsFilter
              ? conflictCitations
              : citations.filter((citation) =>
                    citation.contributions.some((c) =>
                        c.questions?.includes(filter),
                    ),
                );
    const [question, setQuestion] = useState(
        focusConflict && conflictCitations.length
            ? conflictsFilter
            : allQuestions,
    );
    const visible = matching(question);
    const needCitation = focusNeedId
        ? citations.find((citation) =>
              citation.contributions.some((c) =>
                  c.needIds?.includes(focusNeedId),
              ),
          )
        : undefined;
    const startCitation =
        needCitation ?? (focusConflict ? conflictCitations[0] : undefined);
    const [activeKey, setActiveKey] = useState(
        startCitation?.key ?? citations[0]?.key,
    );
    const [opened, setOpened] = useState<ReadonlySet<string>>(
        () => new Set(startCitation ? [startCitation.key] : []),
    );
    const [ownShown, setOwnShown] = useState(noteMode === "margin");
    // Uncited paragraphs fold so the citations come first; Full text restores them.
    const [fullText, setFullText] = useState(false);
    const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set());
    const shown = shownProp ?? ownShown;
    const setShown = (next: boolean) => {
        setOwnShown(next);
        onNotesShownChange?.(next);
    };
    const position = Math.max(
        0,
        visible.findIndex((citation) => citation.key === activeKey),
    );
    const active = visible[position];

    const reveal = (key: string, focus = true) => {
        const root = scroller.current;
        const line = root?.querySelector<HTMLElement>(citationSelector(key));
        if (!line) return;
        lastProgrammatic.current = Date.now();
        const reduced = window.matchMedia?.(
            "(prefers-reduced-motion: reduce)",
        ).matches;
        // Scrolls the document pane only; scrollIntoView would also move the page around it.
        if (root) {
            const offset =
                line.getBoundingClientRect().top -
                root.getBoundingClientRect().top +
                root.scrollTop;
            root.scrollTo?.({
                top: Math.max(0, offset - root.clientHeight / 3),
                behavior: reduced ? "auto" : "smooth",
            });
        }
        if (focus)
            line.querySelector<HTMLElement>("[data-marker]")?.focus({
                preventScroll: true,
            });
    };
    /** Brings an opened inline note into view inside the document pane. */
    const revealNote = (key: string) => {
        const root = scroller.current;
        const note = root?.querySelector<HTMLElement>(
            `${citationSelector(key)} [data-note]`,
        );
        if (!root || !note) return;
        lastProgrammatic.current = Date.now();
        const reduced = window.matchMedia?.(
            "(prefers-reduced-motion: reduce)",
        ).matches;
        const top =
            note.getBoundingClientRect().top - root.getBoundingClientRect().top;
        const bottom = top + note.offsetHeight;
        if (top >= 0 && bottom <= root.clientHeight) return;
        root.scrollTo?.({
            top: Math.max(0, root.scrollTop + bottom - root.clientHeight + 24),
            behavior: reduced ? "auto" : "smooth",
        });
    };
    const toggleNote = (key: string) => {
        setActiveKey(key);
        if (shown) return;
        const opening = !opened.has(key);
        setOpened((current) => {
            const next = new Set(current);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
        if (opening) requestAnimationFrame(() => revealNote(key));
    };
    const goTo = (citation: Citation | undefined) => {
        if (!citation) return;
        setActiveKey(citation.key);
        // The focused citation's note opens even while the others stay hidden.
        setOpened(new Set([citation.key]));
        requestAnimationFrame(() => reveal(citation.key));
    };
    const step = (delta: number) => goTo(visible[position + delta]);

    // Follows the citation in view while the analyst scrolls, without overriding a jump.
    useEffect(() => {
        const root = scroller.current;
        if (!root || typeof IntersectionObserver === "undefined") return;
        const observer = new IntersectionObserver(
            (entries) => {
                if (Date.now() - lastProgrammatic.current < 900) return;
                const entering = entries
                    .filter((entry) => entry.isIntersecting)
                    .sort(
                        (a, b) =>
                            a.boundingClientRect.top - b.boundingClientRect.top,
                    )[0];
                const key = (entering?.target as HTMLElement | undefined)
                    ?.dataset.citation;
                if (key) setActiveKey(key);
            },
            { root, rootMargin: "-35% 0px -55% 0px" },
        );
        for (const line of root.querySelectorAll("[data-citation]"))
            observer.observe(line);
        return () => observer.disconnect();
    }, []);

    // biome-ignore lint/correctness/useExhaustiveDependencies: runs on arrival only; another source remounts the document.
    useEffect(() => {
        // Opens on the first citation (or the need's), without taking focus from the source list.
        const first = startCitation ?? citations[0];
        if (first) requestAnimationFrame(() => reveal(first.key, false));
    }, []);

    const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        const target = event.target as HTMLElement;
        if (target.closest("input, textarea, select, [contenteditable]"))
            return;
        const onMarker = Boolean(target.closest("[data-marker]"));
        if (event.key === "j" || (onMarker && event.key === "ArrowDown")) {
            event.preventDefault();
            step(1);
        } else if (event.key === "k" || (onMarker && event.key === "ArrowUp")) {
            event.preventDefault();
            step(-1);
        }
    };

    // Wide screens keep notes in the margin; with every note hidden the text takes the full width.
    const margin = noteMode === "margin";
    const marginColumn = margin && (shown || opened.size > 0);
    const questionLabel =
        question === allQuestions
            ? ""
            : question === conflictsFilter
              ? "Conflicts · "
              : `${question} · `;
    const activeFilterText =
        question === conflictsFilter
            ? "Citations where sources disagree"
            : question === allQuestions
              ? undefined
              : questionTexts[question];
    const citationByKey = new Map(citations.map((c) => [c.key, c]));
    const visibleKeys = new Set(visible.map((citation) => citation.key));

    return (
        <MotionConfig reducedMotion="user">
            <section
                aria-label={title}
                className={styles.reader}
                data-layout={marginColumn ? "margin" : "inline"}
                data-arriving={arriving || undefined}
                onKeyDown={onKeyDown}>
                <header className={styles.header}>
                    <div className={styles.titleRow} data-title-row>
                        <h2 className={styles.title}>{title}</h2>
                        <span className={styles.titleActions}>
                            {originalHref && (
                                <a
                                    href={originalHref}
                                    target="_blank"
                                    rel="noreferrer"
                                    className={styles.original}
                                    aria-label="Open original document"
                                    title="Open original document">
                                    <span className={styles.originalText}>
                                        Original
                                    </span>
                                    <Icon
                                        iconNode={LinkSquare02Icon}
                                        size={16}
                                    />
                                </a>
                            )}
                            {dismiss}
                        </span>
                    </div>
                    <div className={styles.toolbar}>
                        <span className={cn("wb-meta", styles.meta)}>
                            {[contributionLabel, meta]
                                .filter(Boolean)
                                .join(" · ")}
                        </span>
                        <div className={styles.controls}>
                            {citations.length > 0 && (
                                <span className={styles.stepper}>
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label="Previous citation"
                                        disabled={position === 0}
                                        onClick={() => step(-1)}>
                                        <WorkbenchIcon name="back" size={14} />
                                    </Button>
                                    <span
                                        role="status"
                                        aria-label="Citation position"
                                        className={styles.position}>
                                        {visible.length
                                            ? `${questionLabel}Citation ${position + 1} of ${visible.length}`
                                            : "No citation"}
                                    </span>
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label="Next citation"
                                        disabled={
                                            position >= visible.length - 1
                                        }
                                        onClick={() => step(1)}>
                                        <WorkbenchIcon
                                            name="chevron"
                                            size={14}
                                        />
                                    </Button>
                                </span>
                            )}
                            {contributions.length > 0 && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className={styles.notesToggle}
                                    aria-label="Show all notes"
                                    aria-pressed={shown}
                                    onClick={() => {
                                        setShown(!shown);
                                        if (shown) setOpened(new Set());
                                    }}>
                                    {shown ? "Hide notes" : "Show notes"}
                                </Button>
                            )}
                            {pages.length > 0 && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className={styles.notesToggle}
                                    aria-pressed={fullText}
                                    onClick={() => setFullText(!fullText)}>
                                    Full text
                                </Button>
                            )}
                            {decision}
                            {followUps.length > 0 && (
                                <DropdownMenu>
                                    <DropdownMenuTrigger
                                        render={
                                            <Button
                                                size="sm"
                                                className={styles.followUp}
                                            />
                                        }>
                                        Follow up
                                        <WorkbenchIcon
                                            name="chevron"
                                            size={12}
                                            strokeWidth={2}
                                        />
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent
                                        align="end"
                                        sideOffset={6}
                                        className={styles.followUpMenu}>
                                        {followUps.map((followUp) => (
                                            <DropdownMenuItem
                                                key={followUp.id}
                                                onClick={followUp.onSelect}>
                                                {followUp.label}
                                            </DropdownMenuItem>
                                        ))}
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            )}
                        </div>
                    </div>
                    {(questions.length > 1 || conflictCitations.length > 0) && (
                        <fieldset className={styles.questions}>
                            <legend className="sr-only">
                                Filter by question
                            </legend>
                            {[
                                allQuestions,
                                ...(questions.length > 1 ? questions : []),
                                ...(conflictCitations.length
                                    ? [conflictsFilter]
                                    : []),
                            ].map((id) => {
                                const count = matching(id).length;
                                return (
                                    <button
                                        key={id}
                                        type="button"
                                        className={styles.question}
                                        data-tone={
                                            id === conflictsFilter
                                                ? "conflict"
                                                : undefined
                                        }
                                        aria-pressed={question === id}
                                        onClick={() => {
                                            setQuestion(id);
                                            const first = matching(id)[0];
                                            // The view moves to the question's first citation, so the choice is visible.
                                            goTo(first);
                                        }}>
                                        {question === id && (
                                            <motion.span
                                                layoutId={markerId}
                                                className={
                                                    styles.questionMarker
                                                }
                                                transition={markerTransition}
                                                aria-hidden="true"
                                            />
                                        )}
                                        {id === allQuestions
                                            ? "All"
                                            : id === conflictsFilter
                                              ? "Conflicts"
                                              : id}
                                        <span className={styles.questionCount}>
                                            {count}
                                        </span>
                                    </button>
                                );
                            })}
                        </fieldset>
                    )}
                    {activeFilterText && (
                        <ActiveFilterLine
                            key={question}
                            label={
                                question === conflictsFilter
                                    ? "Conflicts"
                                    : question
                            }
                            text={activeFilterText}
                        />
                    )}
                </header>
                <div ref={scroller} className={styles.body}>
                    {unplaced.length > 0 && (
                        <section
                            aria-label="Unplaced notes"
                            className={styles.unplaced}>
                            <span className="wb-label">
                                Not tied to a passage
                            </span>
                            {unplaced.map((contribution) => (
                                <NoteEntry
                                    key={contribution.id}
                                    contribution={contribution}
                                    questionTexts={questionTexts}
                                />
                            ))}
                        </section>
                    )}
                    {pages.length === 0 && (
                        <p className={styles.empty}>
                            No document passages available.
                        </p>
                    )}
                    {pages.map((page) => {
                        const renderPassage = (passage: ReaderPassage) => {
                            const key = passageKey(page.id, passage.id);
                            const citation = citationByKey.get(key);
                            const text = (
                                <p
                                    className={cn(
                                        styles.passage,
                                        passage.quiet && styles.quiet,
                                    )}
                                    data-passage-id={passage.id}>
                                    <span
                                        className={
                                            passage.highlight
                                                ? highlights[passage.highlight]
                                                : undefined
                                        }>
                                        {passage.text}
                                    </span>
                                </p>
                            );
                            if (!citation)
                                return (
                                    <div
                                        key={passage.id}
                                        className={styles.line}>
                                        <span />
                                        {text}
                                    </div>
                                );
                            const open = shown || opened.has(key);
                            const noteId = `${markerId}-${citation.number}`;
                            return (
                                <div
                                    key={passage.id}
                                    className={styles.line}
                                    data-citation={key}
                                    data-active={
                                        active?.key === key || undefined
                                    }
                                    data-dim={
                                        !visibleKeys.has(key) || undefined
                                    }>
                                    {margin ? (
                                        <button
                                            type="button"
                                            data-marker
                                            className={styles.marker}
                                            aria-label={`Citation ${citation.number}: ${markerSummary(citation)}`}
                                            aria-expanded={open}
                                            aria-controls={
                                                open ? noteId : undefined
                                            }
                                            onClick={() => toggleNote(key)}>
                                            {citation.number}
                                        </button>
                                    ) : (
                                        // Below the margin width the number is an index; the note line is the control.
                                        <span
                                            className={styles.marker}
                                            aria-hidden="true">
                                            {citation.number}
                                        </span>
                                    )}
                                    {text}
                                    {!margin && !shown && (
                                        <button
                                            type="button"
                                            data-marker
                                            className={styles.noteLine}
                                            aria-label={`${open ? "Hide" : "Show"} note for citation ${citation.number}: ${markerSummary(citation)}`}
                                            aria-expanded={open}
                                            aria-controls={
                                                open ? noteId : undefined
                                            }
                                            onClick={() => toggleNote(key)}>
                                            <NoteLineSummary
                                                citation={citation}
                                            />
                                            <span
                                                className={
                                                    styles.noteLineAction
                                                }>
                                                {open
                                                    ? "Hide note"
                                                    : "Show note"}
                                                <WorkbenchIcon
                                                    name="chevron"
                                                    size={11}
                                                    strokeWidth={2}
                                                />
                                            </span>
                                        </button>
                                    )}
                                    {open && (
                                        <aside
                                            id={noteId}
                                            data-note
                                            className={styles.note}>
                                            {citation.contributions.map(
                                                (contribution) => (
                                                    <NoteEntry
                                                        key={contribution.id}
                                                        contribution={
                                                            contribution
                                                        }
                                                        questionTexts={
                                                            questionTexts
                                                        }
                                                    />
                                                ),
                                            )}
                                        </aside>
                                    )}
                                </div>
                            );
                        };
                        return (
                            <article key={page.id} className={styles.page}>
                                <span
                                    className={cn("wb-meta", styles.pageHead)}>
                                    <span>{page.section}</span>
                                    <span>{page.label}</span>
                                </span>
                                {page.heading && (
                                    <h3 className={styles.heading}>
                                        {page.heading}
                                    </h3>
                                )}
                                {foldPassages(page.passages, (passage) =>
                                    citationByKey.has(
                                        passageKey(page.id, passage.id),
                                    ),
                                ).map((segment) => {
                                    if (segment.kind === "run") {
                                        const runKey = `${page.id}/${segment.passages[0]?.id}`;
                                        if (!fullText && !unfolded.has(runKey))
                                            return (
                                                <button
                                                    key={runKey}
                                                    type="button"
                                                    className={styles.fold}
                                                    onClick={() =>
                                                        setUnfolded(
                                                            (current) =>
                                                                new Set([
                                                                    ...current,
                                                                    runKey,
                                                                ]),
                                                        )
                                                    }>
                                                    {segment.passages.length ===
                                                    1
                                                        ? "1 paragraph not cited"
                                                        : `${segment.passages.length} paragraphs not cited`}
                                                </button>
                                            );
                                        return [
                                            fullText ? null : (
                                                <button
                                                    key={`${runKey}-fold`}
                                                    type="button"
                                                    className={styles.fold}
                                                    data-open
                                                    onClick={() =>
                                                        setUnfolded(
                                                            (current) => {
                                                                const next =
                                                                    new Set(
                                                                        current,
                                                                    );
                                                                next.delete(
                                                                    runKey,
                                                                );
                                                                return next;
                                                            },
                                                        )
                                                    }>
                                                    {segment.passages.length ===
                                                    1
                                                        ? "Fold 1 paragraph"
                                                        : `Fold ${segment.passages.length} paragraphs`}
                                                </button>
                                            ),
                                            ...segment.passages.map(
                                                renderPassage,
                                            ),
                                        ];
                                    }
                                    return renderPassage(segment.passage);
                                })}
                            </article>
                        );
                    })}
                    {observedLinks.length > 0 && (
                        <Collapsible className={styles.links}>
                            <CollapsibleTrigger className={styles.linksToggle}>
                                <WorkbenchIcon
                                    name="chevron"
                                    size={12}
                                    strokeWidth={2}
                                />
                                Links seen in this document (
                                {observedLinks.length})
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                                <ul className={styles.linkList}>
                                    {observedLinks.map((link) => (
                                        <li
                                            key={link.id}
                                            data-captured={
                                                link.captured || undefined
                                            }>
                                            <WorkbenchIcon
                                                name={
                                                    link.captured
                                                        ? "check"
                                                        : "unfinished-check"
                                                }
                                                size={14}
                                                strokeWidth={
                                                    link.captured ? 2.2 : 1.6
                                                }
                                            />
                                            <span className={styles.linkLabel}>
                                                {link.label}
                                            </span>
                                            <span className="wb-meta">
                                                {link.meta}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </CollapsibleContent>
                        </Collapsible>
                    )}
                </div>
            </section>
        </MotionConfig>
    );
}

const conflictsFilter = "conflicts";

/** States the active filter; long questions clamp to two lines with an explicit More. */
function ActiveFilterLine({ label, text }: { label: string; text: string }) {
    const [full, setFull] = useState(false);
    const long = text.length > 120;
    return (
        <p className={styles.activeFilter}>
            <b>{label}</b>
            <span
                className={styles.activeFilterText}
                data-clamp={(long && !full) || undefined}>
                {text}
            </span>
            {long && (
                <button
                    type="button"
                    className={styles.activeFilterMore}
                    aria-expanded={full}
                    onClick={() => setFull(!full)}>
                    {full ? "Less" : "More"}
                </button>
            )}
        </p>
    );
}

function isConflict(citation: Citation) {
    return citation.contributions.some(
        (contribution) => contribution.kind === "counter",
    );
}

/** What the note holds, readable before it is opened. */
function NoteLineSummary({ citation }: { citation: Citation }) {
    const [first] = citation.contributions;
    if (!first) return null;
    return (
        <span className={styles.noteLineSummary}>
            <EvidenceBadge kind={first.kind}>{first.label}</EvidenceBadge>
            {citation.contributions.length > 1 && (
                <span className="wb-meta">
                    +{citation.contributions.length - 1}
                </span>
            )}
        </span>
    );
}

type PassageSegment =
    | { kind: "cited"; passage: ReaderPassage }
    | { kind: "run"; passages: ReaderPassage[] };

/** Groups consecutive uncited passages into runs that can fold. */
function foldPassages(
    passages: readonly ReaderPassage[],
    isCited: (passage: ReaderPassage) => boolean,
) {
    const segments: PassageSegment[] = [];
    for (const passage of passages) {
        const last = segments.at(-1);
        if (isCited(passage)) segments.push({ kind: "cited", passage });
        else if (last?.kind === "run") last.passages.push(passage);
        else segments.push({ kind: "run", passages: [passage] });
    }
    return segments;
}

function markerSummary(citation: Citation) {
    const [first] = citation.contributions;
    if (citation.contributions.length > 1)
        return `${citation.contributions.length} notes`;
    return first ? (first.label ?? claimLabels[first.kind]) : "";
}

/** One contribution: what the passage establishes first, its control and provenance after. */
function NoteEntry({
    contribution,
    questionTexts,
}: {
    contribution: ReaderContribution;
    questionTexts: Readonly<Record<string, string>>;
}) {
    return (
        <div className={styles.entry}>
            <span className={styles.entryHead}>
                <EvidenceBadge kind={contribution.kind}>
                    {contribution.label}
                </EvidenceBadge>
                {contribution.status}
            </span>
            <span className={styles.entryText}>{contribution.text}</span>
            {(contribution.meta || contribution.questions?.length) && (
                <span className={cn("wb-meta", styles.entryMeta)}>
                    {contribution.meta}
                    {contribution.questions?.map((label) => (
                        <QuestionTag
                            key={label}
                            label={label}
                            question={questionTexts[label]}
                        />
                    ))}
                </span>
            )}
            {contribution.note && (
                <span className={styles.entryNote}>{contribution.note}</span>
            )}
        </div>
    );
}
