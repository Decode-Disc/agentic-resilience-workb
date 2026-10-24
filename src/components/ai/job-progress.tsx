import {
    CheckmarkCircle02Icon,
    Loading03Icon,
    Cancel01Icon,
    AlertCircleIcon,
    PlayIcon,
    PauseIcon,
} from "@hugeicons/core-free-icons";
import Icon from "@/components/icon";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface JobStage {
    detail?: string;
    duration?: string;
    id: string;
    label: string;
    progress?: number;
    status: "complete" | "pending" | "running" | "failed";
    current?: number;
    total?: number;
    progressLabel?: string;
    weight?: number;
}

interface JobProgressProps extends React.ComponentProps<"section"> {
    eta?: string;
    onCancel?: () => void;
    onPausedChange?: (paused: boolean) => void;
    paused?: boolean;
    stages: JobStage[];
    title: string;
}

const labelTone: Record<JobStage["status"], string> = {
    complete: "text-muted-foreground",
    failed: "text-muted-foreground",
    pending: "text-muted-foreground",
    running: "text-foreground",
};

function stageFill(stage: JobStage) {
    if (stage.status === "complete") return 1;
    if (stage.status === "running")
        return Math.min(
            Math.max(
                stage.total && stage.current !== undefined
                    ? stage.current / stage.total
                    : (stage.progress ?? 0),
                0,
            ),
            1,
        );
    return 0;
}

function JobProgress({
    className,
    eta,
    onCancel,
    onPausedChange,
    paused = false,
    stages,
    title,
    ...props
}: JobProgressProps) {
    const [confirming, setConfirming] = React.useState(false);
    const interrupted = stages.some((stage) => stage.status === "failed");
    const finished = stages.every((stage) => stage.status === "complete");
    const totalWeight = stages.reduce(
        (sum, stage) => sum + (stage.weight ?? 1),
        0,
    );
    const doneWeight = stages.reduce(
        (sum, stage) => sum + (stage.weight ?? 1) * stageFill(stage),
        0,
    );
    const progress = totalWeight
        ? Math.round((doneWeight / totalWeight) * 100)
        : 0;

    return (
        <section
            data-slot="job-progress"
            className={cn(
                "rounded-xl bg-card p-5 font-sans text-sm font-[450] tracking-[-0.05px] text-muted-foreground shadow-soft",
                className,
            )}
            {...props}>
            <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                    <h3 className="text-[15px] leading-6 font-medium text-foreground">
                        {title}
                    </h3>
                    <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground tabular-nums">
                        {finished
                            ? "Finished"
                            : interrupted
                              ? "Needs attention"
                              : paused
                                ? `Paused at ${progress}%`
                                : eta
                                  ? `${progress}% complete · ${eta} remaining`
                                  : `${progress}% complete`}
                    </p>
                </div>
                {!finished && (onPausedChange || onCancel) && (
                    <div className="flex shrink-0 items-center gap-1">
                        {confirming ? (
                            <>
                                <Button
                                    className="h-7 rounded-full px-3 text-muted-foreground"
                                    onClick={() => setConfirming(false)}
                                    size="sm"
                                    variant="ghost">
                                    Keep running
                                </Button>
                                <Button
                                    className="h-7 rounded-full bg-destructive/10 px-3 text-destructive hover:bg-destructive/20 hover:text-destructive"
                                    onClick={() => {
                                        setConfirming(false);
                                        onCancel?.();
                                    }}
                                    size="sm"
                                    variant="ghost">
                                    Stop
                                </Button>
                            </>
                        ) : (
                            <>
                                {onPausedChange && (
                                    <Button
                                        aria-label={
                                            paused ? "Resume job" : "Pause job"
                                        }
                                        aria-pressed={paused}
                                        onClick={() => onPausedChange(!paused)}
                                        size="icon-sm"
                                        variant="ghost">
                                        <Icon
                                            iconNode={
                                                paused ? PlayIcon : PauseIcon
                                            }
                                        />
                                    </Button>
                                )}
                                {onCancel && (
                                    <Button
                                        aria-label="Cancel job"
                                        onClick={() => setConfirming(true)}
                                        size="icon-sm"
                                        variant="ghost">
                                        <Icon iconNode={Cancel01Icon} />
                                    </Button>
                                )}
                            </>
                        )}
                    </div>
                )}
            </div>
            <progress
                aria-label={`${title} progress`}
                className="sr-only"
                max={100}
                value={progress}
            />
            <JobProgressTrack
                stages={stages}
                paused={paused}
                className="mt-4"
            />
            <ol className="mt-5 flex flex-col gap-3">
                {stages.map((stage) => (
                    <li
                        aria-label={`${stage.label}: ${stage.status === "failed" ? "Interrupted" : stage.status === "running" ? (paused ? "Paused" : "Active") : stage.status === "complete" ? "Complete" : "Pending"}`}
                        aria-current={
                            stage.status === "running" ? "step" : undefined
                        }
                        className="flex items-start gap-3"
                        key={stage.id}>
                        <span className="flex h-5 w-4 shrink-0 items-center justify-center">
                            <StageIcon paused={paused} status={stage.status} />
                        </span>
                        <div className="min-w-0 flex-1">
                            <p className="flex items-baseline gap-3">
                                <span
                                    className={cn(
                                        "min-w-0 flex-1 text-sm leading-5",
                                        labelTone[stage.status],
                                    )}>
                                    {stage.label}
                                </span>
                                {stage.status === "complete" &&
                                    stage.duration && (
                                        <span className="shrink-0 text-[13px] leading-5 text-muted-foreground tabular-nums">
                                            {stage.duration}
                                        </span>
                                    )}
                            </p>
                            {(stage.status === "running" ||
                                stage.status === "failed") &&
                                stage.detail && (
                                    <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground tabular-nums">
                                        {stage.detail}
                                    </p>
                                )}
                        </div>
                    </li>
                ))}
            </ol>
        </section>
    );
}

/** Segments describe stages, not a weighted estimate of elapsed work or time remaining. */
function JobProgressTrack({
    stages,
    paused = false,
    className,
}: {
    stages: JobStage[];
    paused?: boolean;
    className?: string;
}) {
    return (
        <div
            className={cn("flex gap-1", className)}
            data-slot="job-progress-track">
            {stages.map((stage) => (
                <span
                    key={stage.id}
                    data-slot="job-progress-segment"
                    data-status={stage.status}
                    style={{ flexGrow: stage.weight ?? 1, flexBasis: 0 }}
                    className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                    {stage.status === "running" && (
                        <progress
                            className="sr-only"
                            aria-label={
                                stage.progressLabel ?? `${stage.label} progress`
                            }
                            aria-valuetext={stage.detail}
                            aria-valuenow={
                                stage.total && stage.current !== undefined
                                    ? stage.current
                                    : stage.progress !== undefined
                                      ? stage.progress * 100
                                      : undefined
                            }
                            aria-valuemax={
                                stage.total && stage.total > 0
                                    ? stage.total
                                    : 100
                            }
                            aria-valuemin={0}
                            max={
                                stage.total && stage.total > 0
                                    ? stage.total
                                    : 100
                            }
                            value={
                                stage.total && stage.current !== undefined
                                    ? stage.current
                                    : stage.progress !== undefined
                                      ? stage.progress * 100
                                      : undefined
                            }
                        />
                    )}
                    <span
                        aria-hidden="true"
                        className={cn(
                            "block h-full origin-left rounded-full bg-info-foreground dark:bg-info transition-transform duration-200 ease-out motion-reduce:transition-none",
                            paused && "opacity-50",
                            stage.status === "running" &&
                                stage.progress === undefined &&
                                stage.current === undefined &&
                                "animate-pulse motion-reduce:animate-none",
                        )}
                        style={{
                            transform: `scaleX(${stage.status === "running" && stage.progress === undefined && stage.current === undefined ? 1 : stageFill(stage)})`,
                        }}
                    />
                </span>
            ))}
        </div>
    );
}

function StageIcon({
    paused,
    status,
}: Pick<JobStage, "status"> & { paused?: boolean }) {
    if (status === "failed")
        return (
            <Icon
                iconNode={AlertCircleIcon}
                className="size-4 text-warning-foreground dark:text-warning"
            />
        );
    if (status === "complete")
        return (
            <Icon
                iconNode={CheckmarkCircle02Icon}
                aria-label="Complete"
                className="size-4 text-success-foreground transition-[opacity,scale] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] dark:text-success starting:scale-90 starting:opacity-0 motion-reduce:starting:scale-100 motion-reduce:transition-none"
            />
        );
    if (status === "running")
        return (
            <Icon
                iconNode={Loading03Icon}
                aria-label="Running"
                className={cn(
                    "size-4 text-info-foreground dark:text-info",
                    paused
                        ? "opacity-50"
                        : "animate-spin motion-reduce:animate-none",
                )}
            />
        );
    return (
        <>
            <span
                aria-hidden="true"
                className="size-3.5 rounded-full border-[1.5px] border-muted-foreground/50"
            />
            <span className="sr-only">Pending</span>
        </>
    );
}

export { JobProgress, JobProgressTrack };
export type { JobStage, JobProgressProps };
