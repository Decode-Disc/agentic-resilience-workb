import type { ComponentProps } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type LoadErrorAlertVariant = "panel" | "inline" | "compact";

interface LoadErrorAlertProps
    extends Omit<ComponentProps<typeof Alert>, "title" | "variant"> {
    title: string;
    description: string;
    onRetry?: () => void;
    retryLabel?: string;
    variant?: LoadErrorAlertVariant;
}

const variantClasses: Record<LoadErrorAlertVariant, string> = {
    panel: "surface-panel mx-auto max-w-xl p-6",
    inline: "rounded-lg border-destructive/30 bg-destructive/5 p-3",
    compact:
        "flex w-auto items-center gap-2 rounded-none border-0 bg-transparent p-0 text-xs text-muted-foreground",
};

/** Presents a recoverable loading failure without exposing technical details. */
export function LoadErrorAlert({
    title,
    description,
    onRetry,
    retryLabel = "Try again",
    variant = "panel",
    className,
    ...props
}: LoadErrorAlertProps) {
    if (variant === "compact") {
        return (
            <Alert className={cn(variantClasses.compact, className)} {...props}>
                <AlertTitle className="text-xs text-muted-foreground">
                    {title}
                </AlertTitle>
                <AlertDescription className="sr-only">
                    {description}
                </AlertDescription>
                {onRetry ? (
                    <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={onRetry}>
                        {retryLabel}
                    </Button>
                ) : null}
            </Alert>
        );
    }

    return (
        <Alert className={cn(variantClasses[variant], className)} {...props}>
            <AlertTitle
                className={cn(variant === "panel" ? "text-lg" : "text-base")}>
                {title}
            </AlertTitle>
            <AlertDescription className="mt-2">{description}</AlertDescription>
            {onRetry ? (
                <Button
                    type="button"
                    variant="secondary"
                    className="mt-4"
                    onClick={onRetry}>
                    {retryLabel}
                </Button>
            ) : null}
        </Alert>
    );
}

export type { LoadErrorAlertProps, LoadErrorAlertVariant };
