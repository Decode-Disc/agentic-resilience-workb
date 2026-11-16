import {
    Alert02Icon,
    Cancel01Icon,
    CheckmarkCircle02Icon,
    Loading03Icon,
} from "@hugeicons/core-free-icons";
import { type JSX, useEffect, useId, useRef } from "react";
import Icon from "@/components/icon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PlatformIcon } from "@/types/ui";

export type ApprovalCardState =
    | "request"
    | "running"
    | "done"
    | "denied"
    | "superseded";

export type ApprovalCardChoice<V extends string = string> = {
    value: V;
    label: string;
    variant: "default" | "outline" | "ghost";
    /** Shown and linked by aria-describedby; the choice is disabled while set. */
    disabledReason?: string;
};

export const DEFAULT_APPROVAL_CHOICES: readonly ApprovalCardChoice<
    "deny" | "always" | "once"
>[] = [
    { value: "deny", label: "Deny", variant: "ghost" },
    { value: "always", label: "Always allow", variant: "outline" },
    { value: "once", label: "Allow once", variant: "default" },
] as const;

const STATE_ICONS: Record<
    ApprovalCardState,
    { icon: PlatformIcon; spin?: boolean; tone: string }
> = {
    request: {
        icon: Alert02Icon,
        tone: "text-warning-foreground dark:text-warning",
    },
    running: {
        icon: Loading03Icon,
        spin: true,
        tone: "text-muted-foreground",
    },
    done: { icon: CheckmarkCircle02Icon, tone: "text-approved" },
    denied: { icon: Cancel01Icon, tone: "text-muted-foreground" },
    superseded: { icon: Cancel01Icon, tone: "text-muted-foreground" },
};

/** Presents consent choices or their receipt without owning persistence or deciding whether an action is allowed. */
export function ApprovalCard<V extends string = "deny" | "always" | "once">({
    title,
    description,
    details,
    state,
    statusLabel,
    choices,
    onChoose,
    receiptAction,
    icon,
    className,
}: {
    title: string;
    description?: string;
    details?: readonly { label: string; value: string }[];
    state: ApprovalCardState;
    statusLabel?: string;
    choices?: readonly ApprovalCardChoice<V>[];
    onChoose?: (value: V) => void;
    /** Shown on a decided card, for example "Stop allowing". */
    receiptAction?: { label: string; onSelect: () => void };
    icon?: PlatformIcon;
    className?: string;
}): JSX.Element {
    const id = useId();
    const titleId = `${id}-title`;
    const descriptionId = `${id}-description`;
    const choicesRef = useRef<HTMLDivElement>(null);
    const receiptRef = useRef<HTMLDivElement>(null);
    const prevStateRef = useRef<ApprovalCardState>(state);

    useEffect(() => {
        const previous = prevStateRef.current;
        prevStateRef.current = state;
        if (previous !== "request" || state === "request") return;
        const active = document.activeElement;
        if (
            active === document.body ||
            (active instanceof Node && choicesRef.current?.contains(active))
        )
            receiptRef.current?.focus();
    }, [state]);

    const resolvedChoices =
        choices ??
        (DEFAULT_APPROVAL_CHOICES as readonly ApprovalCardChoice<V>[]);
    const uniqueReasons: string[] = [];
    for (const choice of resolvedChoices) {
        if (
            choice.disabledReason &&
            !uniqueReasons.includes(choice.disabledReason)
        )
            uniqueReasons.push(choice.disabledReason);
    }
    const reasonIds = new Map(
        uniqueReasons.map((reason, index) => [reason, `${id}-reason-${index}`]),
    );
    const stateIcon = STATE_ICONS[state];
    const headerIcon = icon ?? stateIcon.icon;

    return (
        <fieldset
            aria-labelledby={titleId}
            aria-describedby={description ? descriptionId : undefined}
            data-slot="approval-card"
            data-state={state}
            className={cn(
                "m-0 rounded-xl border border-divider bg-card p-3.5 text-sm text-foreground shadow-xs",
                className,
            )}>
            <div className="flex items-start gap-2.5">
                <span
                    aria-hidden="true"
                    className={cn("mt-0.5 shrink-0", stateIcon.tone)}>
                    <Icon
                        iconNode={headerIcon}
                        className={cn(
                            "size-4",
                            stateIcon.spin &&
                                "animate-spin motion-reduce:animate-none",
                        )}
                    />
                </span>
                <div className="min-w-0 flex-1 space-y-1.5">
                    <p
                        id={titleId}
                        className="font-medium leading-snug text-foreground">
                        {title}
                    </p>
                    {description && (
                        <p
                            id={descriptionId}
                            className="text-xs leading-relaxed text-muted-foreground">
                            {description}
                        </p>
                    )}
                    {details && details.length > 0 && (
                        <dl className="grid gap-1 pt-1 text-xs sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-3">
                            {details.map((detail) => (
                                <div key={detail.label} className="contents">
                                    <dt className="text-muted-foreground">
                                        {detail.label}
                                    </dt>
                                    <dd className="min-w-0 font-medium text-foreground">
                                        {detail.value}
                                    </dd>
                                </div>
                            ))}
                        </dl>
                    )}
                </div>
            </div>

            {state === "request" ? (
                <div ref={choicesRef} className="mt-3 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                        {resolvedChoices.map((choice) => {
                            const disabled = Boolean(choice.disabledReason);
                            const describedBy = choice.disabledReason
                                ? reasonIds.get(choice.disabledReason)
                                : undefined;
                            return (
                                <Button
                                    key={choice.value}
                                    type="button"
                                    size="sm"
                                    variant={choice.variant}
                                    disabled={disabled}
                                    aria-describedby={describedBy}
                                    onClick={() => onChoose?.(choice.value)}>
                                    {choice.label}
                                </Button>
                            );
                        })}
                    </div>
                    {uniqueReasons.length > 0 && (
                        <div className="space-y-1 text-xs text-muted-foreground">
                            {uniqueReasons.map((reason) => (
                                <p key={reason} id={reasonIds.get(reason)}>
                                    {reason}
                                </p>
                            ))}
                        </div>
                    )}
                </div>
            ) : (
                (statusLabel || receiptAction) && (
                    <div
                        ref={receiptRef}
                        tabIndex={-1}
                        role="status"
                        className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-divider pt-2.5 text-xs text-muted-foreground outline-none">
                        {statusLabel && <span>{statusLabel}</span>}
                        {state !== "running" && receiptAction && (
                            <Button
                                type="button"
                                variant="ghost"
                                size="xs"
                                onClick={receiptAction.onSelect}>
                                {receiptAction.label}
                            </Button>
                        )}
                    </div>
                )
            )}
        </fieldset>
    );
}
