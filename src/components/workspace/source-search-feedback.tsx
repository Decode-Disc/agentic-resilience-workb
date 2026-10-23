import {
    CheckmarkCircle02Icon,
    CircleOffIcon,
    Clock01Icon,
    File01Icon,
    Loading03Icon,
} from "@hugeicons/core-free-icons";
import Icon from "@/components/icon";
import type { sourceRecoveryFeedback } from "@/lib/presentation/research-copy";
import { cn } from "@/lib/utils";

/** Keeps persisted search feedback distinct from the requirement's documentary status. */
export function SourceSearchFeedback({
    feedback,
    searching = false,
    retryAfterSeconds = 0,
}: {
    feedback?: ReturnType<typeof sourceRecoveryFeedback> | null;
    searching?: boolean;
    retryAfterSeconds?: number;
}) {
    if (!feedback && !searching && retryAfterSeconds === 0) return null;
    const icon = searching
        ? Loading03Icon
        : retryAfterSeconds > 0
          ? Clock01Icon
          : feedback?.status === "danger"
            ? CircleOffIcon
            : feedback?.status === "success"
              ? CheckmarkCircle02Icon
              : File01Icon;
    return (
        <div
            role={feedback?.status === "danger" ? "alert" : "status"}
            aria-live="polite"
            className="flex items-start gap-2 rounded-md bg-muted/40 p-3 text-xs leading-relaxed">
            <Icon
                iconNode={icon}
                className={cn(
                    "mt-0.5 shrink-0",
                    searching && "animate-spin motion-reduce:animate-none",
                    feedback?.status === "danger" && "text-danger",
                )}
            />
            <div className="space-y-1">
                <p className="font-medium">
                    {searching
                        ? "Looking for additional sources…"
                        : (feedback?.title ?? `Retry in ${retryAfterSeconds}s`)}
                </p>
                <p className="text-muted-foreground">
                    {searching
                        ? "Existing candidates remain available. Corpus approval waits for this search to finish."
                        : (feedback?.description ??
                          "Source searches are temporarily paused for this dossier. Existing candidates remain available.")}
                </p>
            </div>
        </div>
    );
}
