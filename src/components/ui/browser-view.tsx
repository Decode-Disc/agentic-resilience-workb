import {
    Copy02Icon,
    ExternalLinkIcon,
    LinkSquare01Icon,
} from "@hugeicons/core-free-icons";
import { useState } from "react";

import { FaviconAvatar } from "@/components/favicon-avatar";
import Icon from "@/components/icon";
import { Button, buttonVariants } from "@/components/ui/button";
import {
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";

/**
 * Presents a public URL as an external destination without retrieving or
 * embedding its content in the workbench.
 */
export function BrowserView({
    url,
    title,
    actionLabel = "Open page",
}: {
    url: string;
    title: string;
    actionLabel?: string;
}) {
    const [copied, setCopied] = useState(false);

    async function copyLink() {
        try {
            if (!navigator.clipboard?.writeText) {
                return;
            }
            await navigator.clipboard.writeText(url);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2500);
        } catch {
            // The visible address remains available for manual copying.
        }
    }

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
                    <Button
                        type="button"
                        size="icon-sm"
                        variant={copied ? "secondary" : "ghost"}
                        aria-label="Copy link"
                        title="Copy link"
                        onClick={() => void copyLink()}>
                        <Icon
                            iconNode={Copy02Icon}
                            className={cn(copied && "text-approved")}
                        />
                        {copied ? (
                            <span className="sr-only" role="status">
                                Link copied
                            </span>
                        ) : null}
                    </Button>
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
                        className={cn(buttonVariants({ variant: "outline" }))}>
                        <Icon iconNode={ExternalLinkIcon} />
                        {actionLabel}
                    </a>
                </EmptyContent>
            </Empty>
        </div>
    );
}
