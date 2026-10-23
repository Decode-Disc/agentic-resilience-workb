import {
    CheckmarkCircle02Icon,
    CircleOffIcon,
    Clock01Icon,
    File01Icon,
    Loading03Icon,
} from "@hugeicons/core-free-icons";
import Icon from "@/components/icon";
import { AlertStatus } from "@/components/ui/alert-status";
import type { sourceRecoveryFeedback } from "@/lib/presentation/research-copy";

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
    const title = searching
        ? "Looking for additional sources…"
        : (feedback?.title ?? `Retry in ${retryAfterSeconds}s`);
    return (
        <AlertStatus
            status={searching ? "info" : (feedback?.status ?? "warning")}
            role={
                !searching && feedback?.status === "danger" ? "alert" : "status"
            }
            aria-label={title}
            size="sm"
            icon={
                <Icon
                    iconNode={icon}
                    className={
                        searching
                            ? "animate-spin motion-reduce:animate-none"
                            : undefined
                    }
                />
            }
            title={title}
            description={
                searching
                    ? "Looking for new documents for this topic. Existing candidates remain available. New results will need your review before inclusion."
                    : (feedback?.description ??
                      "Source searches are temporarily paused for this dossier. Existing candidates remain available.")
            }
        />
    );
}
