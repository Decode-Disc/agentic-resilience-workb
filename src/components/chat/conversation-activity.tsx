import {
    ArrowRight01Icon,
    Cancel01Icon,
    Loading03Icon,
    PauseIcon,
    Tick02Icon,
} from "@hugeicons/core-free-icons";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
    type ReactNode,
    useEffect,
    useId,
    useLayoutEffect,
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
    ConversationActivityList,
    ConversationActivityVisibility,
} from "./conversation-activity-list";

import "./workbench-conversation.css";
import styles from "./conversation-activity.module.css";

export type ConversationWorkItem = {
    id: string;
    title: string;
    state:
        | "running"
        | "completed"
        | "interrupted"
        | "waiting"
        | "blocked"
        | "paused";
    summary: string;
    details?: ReactNode;
};
export const workStateLabels = {
    running: "Working",
    completed: "Complete",
    interrupted: "Interrupted",
    waiting: "Waiting",
    paused: "Paused",
    blocked: "Unavailable",
} as const;

/** Shares visibility and document gating between the icon and text animations. */
function useWorkAnimationRef(state: ConversationWorkItem["state"]) {
    const element = useRef<HTMLSpanElement>(null);
    useEffect(() => {
        const target = element.current;
        if (!target || state !== "running") return;
        let visible = false;
        const update = () =>
            target.style.setProperty(
                "--work-animation-state",
                visible && !document.hidden ? "running" : "paused",
            );
        const observer = new IntersectionObserver(([entry]) => {
            visible = entry?.isIntersecting ?? false;
            update();
        });
        observer.observe(target);
        document.addEventListener("visibilitychange", update);
        update();
        return () => {
            observer.disconnect();
            document.removeEventListener("visibilitychange", update);
        };
    }, [state]);
    return element;
}

function ConversationWorkLabel({
    state,
    text,
}: {
    state: ConversationWorkItem["state"];
    text?: string;
}) {
    const element = useWorkAnimationRef(state);
    return (
        <span ref={element} className={styles.workLabel} data-state={state}>
            {text ?? workStateLabels[state]}
        </span>
    );
}

/** Uses supplied execution state; only visible, running work has a looping indicator. */
export function ConversationWorkMark({
    state,
}: {
    state: ConversationWorkItem["state"];
}) {
    const element = useWorkAnimationRef(state);
    const previous = useRef(state);
    const changed = previous.current !== state;
    const reducedMotion = useReducedMotion();
    useEffect(() => {
        previous.current = state;
    }, [state]);
    return (
        <span
            ref={element}
            className={styles.mark}
            data-state={state}
            data-changed={changed}
            aria-hidden="true">
            <AnimatePresence initial={false} mode="popLayout">
                <motion.span
                    key={state}
                    initial={reducedMotion ? false : { opacity: 0, scale: 0.7 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.16 }}>
                    <Icon
                        iconNode={
                            state === "running"
                                ? Loading03Icon
                                : state === "completed"
                                  ? Tick02Icon
                                  : state === "waiting" || state === "paused"
                                    ? PauseIcon
                                    : Cancel01Icon
                        }
                        size={16}
                    />
                </motion.span>
            </AnimatePresence>
        </span>
    );
}

/** Shared visible status and accessible announcement for a turn or independent mission. */
export function ConversationWorkStatus({
    state,
    label,
    stateLabel,
}: {
    state: ConversationWorkItem["state"];
    label: string;
    stateLabel?: string;
}) {
    return (
        <span
            className={styles.status}
            data-state={state}
            role="status"
            aria-label={label}>
            <ConversationWorkMark state={state} />
            <ConversationWorkLabel state={state} text={stateLabel} />
        </span>
    );
}

/** Compact useful work in an assistant turn, with supporting detail disclosed in place. */
export function ConversationActivity({
    title,
    summary,
    state,
    children,
    compact = false,
}: {
    title: string;
    summary: string;
    state: ConversationWorkItem["state"];
    children?: ReactNode;
    compact?: boolean;
}) {
    const id = useId();
    const row = (
        <>
            <ConversationWorkMark state={state} />
            <span className={styles.description}>
                <span data-slot="activity-title" className={styles.title}>
                    {title}
                </span>
                {!compact && (
                    <span
                        data-slot="activity-summary"
                        className={styles.summary}>
                        {summary}
                    </span>
                )}
            </span>
            <span data-slot="activity-state" className={styles.state}>
                <ConversationWorkLabel state={state} />
            </span>
            {(children || compact) && (
                <Icon iconNode={ArrowRight01Icon} size={12} />
            )}
        </>
    );
    return children || compact ? (
        <Collapsible
            className={styles.activity}
            data-message-id={id}
            data-slot="conversation-activity"
            data-state={state}>
            <CollapsibleTrigger
                render={
                    <Button
                        variant="unstyled"
                        size="unstyled"
                        className={styles.row}
                    />
                }
                aria-label={`Inspect ${title}`}>
                {row}
            </CollapsibleTrigger>
            <CollapsibleContent>
                <div data-slot="activity-detail" className={styles.detail}>
                    {compact && <p className="chat-work-result">{summary}</p>}
                    {children}
                </div>
            </CollapsibleContent>
        </Collapsible>
    ) : (
        <div
            data-slot="conversation-activity"
            data-state={state}
            className={styles.activity}>
            <div className={styles.row}>{row}</div>
        </div>
    );
}

/** Summarizes live work and exposes the same retained activity reader on demand. */
export function ConversationActivityGroup({
    id,
    title,
    summary,
    state,
    activities,
    content,
    triggerLabel,
    statusLabel,
    stateLabel,
    titleContent,
}: {
    id: string;
    title: string;
    summary: string;
    state: ConversationWorkItem["state"];
    activities: readonly ConversationWorkItem[];
    content?: ReactNode | ((open: boolean) => ReactNode);
    triggerLabel?: string;
    statusLabel?: string;
    stateLabel?: string;
    /** Optional title material; the text title remains the accessible group identity. */
    titleContent?: ReactNode;
}) {
    const [expanded, setExpanded] = useState(false);
    const trigger = useRef<HTMLButtonElement>(null);
    const workHasFocus = useRef(false);
    const running = state === "running";
    const active = running || state === "waiting" || state === "paused";
    useLayoutEffect(() => {
        if (!active) {
            setExpanded(false);
            if (workHasFocus.current) trigger.current?.focus();
        }
    }, [active]);
    const open = expanded;
    const latest =
        [...activities]
            .reverse()
            .find((activity) => activity.state === "running") ??
        activities.at(-1);
    if (!activities.length && !titleContent && !content) return null;
    return (
        <Collapsible
            className={styles.group}
            open={open}
            onOpenChange={setExpanded}
            role="region"
            aria-label={title}
            data-slot="conversation-work-group"
            data-message-id={id}
            data-state={state}
            onFocusCapture={() => {
                workHasFocus.current = true;
            }}
            onBlurCapture={(event) => {
                workHasFocus.current = event.currentTarget.contains(
                    event.relatedTarget,
                );
            }}>
            <CollapsibleTrigger
                ref={trigger}
                render={
                    <Button
                        variant="unstyled"
                        size="unstyled"
                        className={styles.groupTrigger}
                    />
                }
                aria-label={triggerLabel ?? `Inspect ${title.toLowerCase()}`}>
                <Icon iconNode={ArrowRight01Icon} size={13} />
                <span className={styles.groupDescription}>
                    <strong className={styles.groupTitle}>
                        {titleContent ?? title}
                    </strong>
                    <span className={styles.groupSummary}>{summary}</span>
                </span>
                <ConversationWorkStatus
                    state={state}
                    stateLabel={stateLabel}
                    label={statusLabel ?? `${title} status`}
                />
            </CollapsibleTrigger>
            {!open && active && latest && (
                <fieldset className={styles.latest}>
                    <legend className="sr-only">Latest operation</legend>
                    <ConversationActivity {...latest} compact>
                        {latest.details}
                    </ConversationActivity>
                </fieldset>
            )}
            <CollapsibleContent keepMounted>
                <div className={styles.entries}>
                    <ConversationActivityVisibility value={open}>
                        {(typeof content === "function"
                            ? content(open)
                            : content) ?? (
                            <ConversationActivityList>
                                {activities.map((activity) => (
                                    <ConversationActivity
                                        key={activity.id}
                                        title={activity.title}
                                        summary={activity.summary}
                                        state={activity.state}
                                        compact={!running}>
                                        {activity.details}
                                    </ConversationActivity>
                                ))}
                            </ConversationActivityList>
                        )}
                    </ConversationActivityVisibility>
                </div>
            </CollapsibleContent>
        </Collapsible>
    );
}
