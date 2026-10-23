import { ExternalLinkIcon, LinkSquare01Icon } from "@hugeicons/core-free-icons";
import type { ReactNode } from "react";

import { FaviconAvatar } from "@/components/favicon-avatar";
import Icon from "@/components/icon";
import { buttonVariants } from "@/components/ui/button";
import { CopyLinkButton } from "@/components/ui/copy-link-button";
import {
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type PreviewState = "loading" | "screenshot" | "unavailable";

/**
 * Presents a public URL as an external destination. When a preview screenshot
 * is available (for pending candidate sources), it displays it with a clear
 * visual-reference label. Otherwise it falls back to the external-link empty
 * state.
 */
export function BrowserView({
    url,
    title,
    actionLabel = "Open page",
    previewState,
    previewDataUrl,
    fallback,
}: {
    url: string;
    title: string;
    actionLabel?: string;
    previewState?: PreviewState;
    previewDataUrl?: string;
    fallback?: ReactNode;
}) {
    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex flex-wrap items-center gap-2 border-b border-border/60 p-2">
                <FaviconAvatar
                    canonicalUrl={url}
                    entityName={title}
                    size="sm"
                />
                <output
                    aria-label="Source address"
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-2 py-1">
                    <Icon
                        iconNode={ExternalLinkIcon}
                        size={13}
                        className="shrink-0 text-muted-foreground"
                    />
                    <span className="truncate font-mono text-[11px] text-muted-foreground">
                        {url}
                    </span>
                </output>
                <div className="flex items-center gap-1">
                    <CopyLinkButton url={url} />
                    <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={actionLabel}
                        title={actionLabel}
                        className={cn(
                            buttonVariants({
                                size: "icon-sm",
                                variant: "ghost",
                            }),
                        )}>
                        <Icon iconNode={ExternalLinkIcon} />
                    </a>
                </div>
            </div>

            {/* Screenshot preview — for pending candidate sources only */}
            {previewState === "loading" ? (
                <div className="flex min-h-0 flex-1 items-center justify-center p-4">
                    <Skeleton className="aspect-[1280/720] w-full max-w-full rounded-lg" />
                </div>
            ) : previewState === "screenshot" && previewDataUrl ? (
                <div className="relative flex min-h-0 flex-1 items-center justify-center bg-muted/20 p-4">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src={previewDataUrl}
                        alt={`Preview of ${title}`}
                        className="max-h-full max-w-full rounded-lg border border-border/60 object-contain shadow-sm"
                    />
                    <span className="absolute bottom-5 left-5 rounded-md border border-border/60 bg-background/80 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground backdrop-blur-sm">
                        Preview — for visual reference only
                    </span>
                </div>
            ) : fallback ? (
                fallback
            ) : (
                /* External-link fallback (default + unavailable) */
                <Empty className="min-h-0 flex-1 rounded-none border-0 p-6">
                    <EmptyHeader>
                        <EmptyMedia variant="icon">
                            <Icon iconNode={LinkSquare01Icon} />
                        </EmptyMedia>
                        <h2 className="font-heading text-lg font-medium tracking-tight">
                            Open {title} in a new tab
                        </h2>
                        <EmptyDescription>
                            Review the original page in a separate browser tab.
                        </EmptyDescription>
                    </EmptyHeader>
                    <EmptyContent>
                        <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`${actionLabel} in a new tab`}
                            className={cn(
                                buttonVariants({ variant: "outline" }),
                            )}>
                            <Icon iconNode={ExternalLinkIcon} />
                            {actionLabel}
                        </a>
                    </EmptyContent>
                </Empty>
            )}
        </div>
    );
}
