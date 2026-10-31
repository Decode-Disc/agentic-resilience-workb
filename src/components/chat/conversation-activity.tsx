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
    state: "running" | "completed" | "interrupted";
    summary: string;
    details?: ReactNode;
};
export const workStateLabels = {
    running: "Working",
    completed: "Complete",
    interrupted: "Interrupted",
} as const;

/** Compact useful work in an assistant turn, with supporting detail disclosed in place. */
export function ConversationActivity({
    title,
    summary,
    state,
    children,
}: {
    title: string;
    summary: string;
    state: ConversationWorkItem["state"];
    children?: ReactNode;
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
                <span data-slot="activity-summary">{summary}</span>
            </span>
            <span data-slot="activity-state">{workStateLabels[state]}</span>
            {children && <Icon iconNode={ArrowRight01Icon} size={12} />}
        </>
    );
    return children ? (
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
                <div data-slot="activity-detail">{children}</div>
            </CollapsibleContent>
        </Collapsible>
    ) : (
        <div data-slot="conversation-activity" data-state={state}>
            <div className="chat-activity-row">{row}</div>
        </div>
    );
}

/** Keeps operations visible during a turn and folds the same retained work when that turn ends. */
export function ConversationActivityGroup({
    id,
    title,
    summary,
    state,
    activities,
    content,
    triggerLabel,
    runningHeader,
}: {
    id: string;
    title: string;
    summary: string;
    state: ConversationWorkItem["state"];
    activities: readonly ConversationWorkItem[];
    content?: ReactNode;
    triggerLabel?: string;
    runningHeader?: ReactNode;
}) {
    const [expanded, setExpanded] = useState(false);
    const trigger = useRef<HTMLButtonElement>(null);
    const workHasFocus = useRef(false);
    const running = state === "running";
    useLayoutEffect(() => {
        if (!running && workHasFocus.current) trigger.current?.focus();
    }, [running]);
    if (!activities.length && !runningHeader) return null;
    return (
        <Collapsible
            open={running || expanded}
            onOpenChange={setExpanded}
            role="region"
            aria-label={title}
            data-slot="conversation-work-group"
            data-message-id={id}
            data-state={state}>
            {running && runningHeader}
            {!running && (
                <CollapsibleTrigger
                    ref={trigger}
                    render={<Button variant="ghost" />}
                    aria-label={
                        triggerLabel ?? `Inspect ${title.toLowerCase()}`
                    }>
                    <Icon iconNode={ArrowRight01Icon} size={13} />
                    <span className="chat-work-description">
                        <strong>{title}</strong>
                        <span>{summary}</span>
                    </span>
                    {state === "interrupted" && (
                        <span className="chat-work-limit">Interrupted</span>
                    )}
                </CollapsibleTrigger>
            )}
            <CollapsibleContent keepMounted>
                <div
                    className="chat-work-entries"
                    onFocusCapture={() => {
                        workHasFocus.current = true;
                    }}
                    onBlurCapture={(event) => {
                        workHasFocus.current = event.currentTarget.contains(
                            event.relatedTarget,
                        );
                    }}>
                    {content ??
                        activities.map((activity) => (
                            <ConversationActivity
                                key={activity.id}
                                title={activity.title}
                                summary={activity.summary}
                                state={activity.state}>
                                {activity.details}
                            </ConversationActivity>
                        ))}
                </div>
            </CollapsibleContent>
        </Collapsible>
    );
}
