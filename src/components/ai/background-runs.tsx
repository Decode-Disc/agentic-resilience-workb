import {
    AlertCircleIcon,
    Cancel01Icon,
    CheckmarkCircle02Icon,
    Clock01Icon,
    Layers01Icon,
    Loading03Icon,
} from "@hugeicons/core-free-icons";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import * as React from "react";
import Icon from "@/components/icon";
import { Badge } from "@/components/ui/badge";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface BackgroundRun {
    detail?: string;
    id: string;
    label: string;
    progress?: number;
    status: "complete" | "failed" | "queued" | "running";
    updatedAt?: string;
}

interface BackgroundRunsProps extends React.ComponentProps<"section"> {
    items: BackgroundRun[];
    animated?: boolean;
    title?: string;
    summary?: React.ReactNode;
    listLabel?: string;
    variant?: "card" | "embedded";
    onCancel?: (id: string) => void;
    onOpen?: (id: string) => void;
}

const titleTone: Record<BackgroundRun["status"], string> = {
    complete: "text-muted-foreground",
    failed: "text-muted-foreground",
    queued: "text-muted-foreground",
    running: "text-foreground",
};

/** A status list that can share a parent surface and accept a progress region above its rows. */
function BackgroundRuns({
    className,
    items,
    onCancel,
    onOpen,
    animated = true,
    title = "Background runs",
    summary: customSummary,
    listLabel = "Background runs",
    variant = "card",
    children,
    ...props
}: BackgroundRunsProps) {
    const prefersReducedMotion = useReducedMotion();
    const reduceMotion = prefersReducedMotion || !animated;
    const [confirmingId, setConfirmingId] = React.useState<string | null>(null);
    const running = items.filter((item) => item.status === "running").length;
    const queued = items.filter((item) => item.status === "queued").length;
    const summary =
        [running && `${running} running`, queued && `${queued} queued`]
            .filter(Boolean)
            .join(" · ") ||
        (items.some((item) => item.status === "failed")
            ? "Needs attention"
            : "All done");

    React.useEffect(() => {
        if (!confirmingId) return;
        const timer = window.setTimeout(() => setConfirmingId(null), 3000);
        return () => window.clearTimeout(timer);
    }, [confirmingId]);

    function cancel(item: BackgroundRun) {
        if (item.status === "running" && confirmingId !== item.id) {
            setConfirmingId(item.id);
            return;
        }
        setConfirmingId(null);
        onCancel?.(item.id);
    }

    return (
        <section
            data-slot="background-runs"
            className={cn(
                "overflow-hidden font-sans text-sm text-muted-foreground",
                variant === "card" && "rounded-xl bg-card shadow-soft",
                className,
            )}
            {...props}>
            <header
                data-slot="background-runs-header"
                className="flex items-center gap-2 px-4 py-3">
                <Icon iconNode={Layers01Icon} />
                <h3 className="text-sm leading-5 font-medium text-muted-foreground">
                    {title}
                </h3>
                <Badge
                    variant="secondary"
                    className="ml-auto text-xs font-normal tabular-nums">
                    {customSummary ?? summary}
                </Badge>
            </header>
            {children}
            <ul
                aria-label={listLabel}
                data-slot="background-runs-list"
                className="flex flex-col gap-1 border-t border-border/60 p-2">
                <AnimatePresence initial={false}>
                    {items.map((item) => {
                        const cancellable =
                            !!onCancel &&
                            (item.status === "queued" ||
                                item.status === "running");
                        const Content = onOpen ? "button" : "div";
                        const statusLabel = {
                            complete: "Complete",
                            failed: "Interrupted",
                            queued: "Pending",
                            running: "Active",
                        }[item.status];
                        const confirming = confirmingId === item.id;

                        return (
                            <motion.li
                                aria-label={`${item.label}: ${statusLabel}`}
                                aria-current={
                                    item.status === "running"
                                        ? "step"
                                        : undefined
                                }
                                data-slot="background-run"
                                animate={{ opacity: 1, y: 0 }}
                                className="group relative rounded-[10px] p-2.5 transition-colors hover:bg-foreground/4"
                                exit={{ opacity: 0, y: reduceMotion ? 0 : -4 }}
                                initial={{ opacity: 1, y: 0 }}
                                key={item.id}
                                layout={reduceMotion ? false : "position"}
                                transition={{
                                    duration: reduceMotion ? 0 : 0.2,
                                    ease: [0.23, 1, 0.32, 1],
                                }}>
                                <div className="flex items-start gap-3">
                                    <span className="flex h-6 shrink-0 items-center">
                                        <RunStatus status={item.status} />
                                    </span>
                                    <Content
                                        data-slot="background-run-content"
                                        className={cn(
                                            "min-w-0 flex-1 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                            cancellable &&
                                                "pointer-coarse:pr-8",
                                        )}
                                        onClick={
                                            onOpen
                                                ? () => onOpen(item.id)
                                                : undefined
                                        }
                                        type={onOpen ? "button" : undefined}>
                                        <span
                                            data-slot="background-run-heading"
                                            className="flex items-baseline gap-3">
                                            <span
                                                className={cn(
                                                    "min-w-0 flex-1 text-sm leading-6 font-medium",
                                                    titleTone[item.status],
                                                )}>
                                                {item.label}
                                            </span>
                                            <span
                                                data-slot="background-run-meta"
                                                className="shrink-0 text-xs text-muted-foreground tabular-nums">
                                                {item.updatedAt ?? statusLabel}
                                            </span>
                                        </span>
                                        {item.detail && (
                                            <span
                                                data-slot="background-run-detail"
                                                className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                                                {item.detail}
                                            </span>
                                        )}
                                    </Content>
                                    <span className="absolute top-2.5 right-2.5 flex h-6 items-center">
                                        {cancellable &&
                                            (confirming ? (
                                                <Button
                                                    aria-label={`Stop ${item.label}`}
                                                    className="h-6 rounded-full bg-destructive/10 px-2 text-xs text-destructive hover:bg-destructive/20 hover:text-destructive"
                                                    onClick={() => cancel(item)}
                                                    size="xs"
                                                    type="button"
                                                    variant="ghost">
                                                    Stop
                                                </Button>
                                            ) : (
                                                <Button
                                                    aria-label={`Cancel ${item.label}`}
                                                    className="opacity-0 transition-[opacity,background-color] duration-150 ease-out group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100"
                                                    onClick={() => cancel(item)}
                                                    size="icon-xs"
                                                    type="button"
                                                    variant="ghost">
                                                    <Icon
                                                        iconNode={Cancel01Icon}
                                                    />
                                                </Button>
                                            ))}
                                    </span>
                                </div>
                                {item.status === "running" &&
                                    item.progress !== undefined && (
                                        <div className="mt-2.5 ml-7 h-1 overflow-hidden rounded-full bg-muted">
                                            <progress
                                                className="sr-only"
                                                aria-label={`${item.label} progress`}
                                                max={100}
                                                value={item.progress}
                                            />
                                            <div
                                                className="h-full origin-left rounded-full bg-info-foreground dark:bg-info transition-[scale] duration-200 ease-out motion-reduce:transition-none"
                                                style={{
                                                    scale: `${item.progress / 100} 1`,
                                                }}
                                            />
                                        </div>
                                    )}
                            </motion.li>
                        );
                    })}
                </AnimatePresence>
            </ul>
        </section>
    );
}

const statusEnterClass =
    "transition-[opacity,scale] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] starting:scale-90 starting:opacity-0 motion-reduce:starting:scale-100 motion-reduce:transition-none";

function RunStatus({ status }: Pick<BackgroundRun, "status">) {
    if (status === "complete")
        return (
            <Icon
                iconNode={CheckmarkCircle02Icon}
                aria-label="Complete"
                className={cn(
                    "size-4 text-success-foreground dark:text-success",
                    statusEnterClass,
                )}
            />
        );
    if (status === "failed")
        return (
            <Icon
                iconNode={AlertCircleIcon}
                aria-label="Failed"
                className={cn("size-4 text-destructive", statusEnterClass)}
            />
        );
    if (status === "running")
        return (
            <Icon
                iconNode={Loading03Icon}
                aria-label="Running"
                className="size-4 animate-spin text-info-foreground dark:text-info motion-reduce:animate-none"
            />
        );
    return (
        <Icon
            iconNode={Clock01Icon}
            aria-label="Pending"
            className="size-4 text-muted-foreground"
        />
    );
}

export type { BackgroundRun, BackgroundRunsProps };
export { BackgroundRuns };
