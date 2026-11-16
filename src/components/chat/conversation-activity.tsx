import {
    ArrowRight01Icon,
    Cancel01Icon,
    Loading03Icon,
    Tick02Icon,
} from "@hugeicons/core-free-icons";
import {
    type ReactNode,
    useId,
    useLayoutEffect,
    useRef,
    useState,
} from "react";
import {
    ConversationActivityList,
    ConversationActivityVisibility,
} from "./conversation-activity-list";
import Icon from "@/components/icon";
import { Button } from "@/components/ui/button";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";

import "./workbench-conversation.css";

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
            <Icon
                iconNode={
                    state === "running"
                        ? Loading03Icon
                        : state === "completed"
                          ? Tick02Icon
                          : Cancel01Icon
                }
                size={15}
                className={
                    state === "running" ? "chat-working-icon" : undefined
                }
            />
            <span>
                <span data-slot="activity-title">{title}</span>
                {!compact && (
                    <span data-slot="activity-summary">{summary}</span>
                )}
            </span>
            <span data-slot="activity-state">{workStateLabels[state]}</span>
            {(children || compact) && (
                <Icon iconNode={ArrowRight01Icon} size={12} />
            )}
        </>
    );
    return children || compact ? (
        <Collapsible
            data-message-id={id}
            data-slot="conversation-activity"
            data-state={state}>
            <CollapsibleTrigger
                render={<Button variant="ghost" />}
                aria-label={`Inspect ${title}`}>
                {row}
            </CollapsibleTrigger>
            <CollapsibleContent>
                <div data-slot="activity-detail">
                    {compact && <p className="chat-work-result">{summary}</p>}
                    {children}
                </div>
            </CollapsibleContent>
        </Collapsible>
    ) : (
        <div data-slot="conversation-activity" data-state={state}>
            <div className="chat-activity-row">{row}</div>
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
    runningHeader,
    titleContent,
}: {
    id: string;
    title: string;
    summary: string;
    state: ConversationWorkItem["state"];
    activities: readonly ConversationWorkItem[];
    content?: ReactNode | ((open: boolean) => ReactNode);
    triggerLabel?: string;
    runningHeader?: ReactNode;
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
    if (!activities.length && !runningHeader && !content) return null;
    return (
        <Collapsible
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
                render={<Button variant="ghost" />}
                aria-label={triggerLabel ?? `Inspect ${title.toLowerCase()}`}>
                <Icon iconNode={ArrowRight01Icon} size={13} />
                {running && runningHeader ? (
                    runningHeader
                ) : (
                    <span className="chat-work-description">
                        <strong>{titleContent ?? title}</strong>
                        <span>{summary}</span>
                    </span>
                )}
                {state === "interrupted" && (
                    <span className="chat-work-limit">Interrupted</span>
                )}
            </CollapsibleTrigger>
            {!open && active && latest && (
                <div className="chat-work-latest">
                    <ConversationActivity {...latest} compact>
                        {latest.details}
                    </ConversationActivity>
                </div>
            )}
            <CollapsibleContent keepMounted>
                <div className="chat-work-entries">
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
