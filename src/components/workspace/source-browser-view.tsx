import type { api } from '@convex/_generated/api';
import {
    Copy02Icon,
    ExternalLinkIcon,
    Refresh01Icon,
} from '@hugeicons/core-free-icons';
import type { FunctionReturnType } from 'convex/server';
import { useState } from 'react';

import Icon from '@/components/icon';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { FaviconAvatar } from '@/components/favicon-avatar';
import { cn } from '@/lib/utils';

type SourceContext = FunctionReturnType<
    typeof api.sources.listForReview
>['sources'][number];

const FRAME_SANDBOX = [
    'allow-scripts',
    'allow-same-origin',
    'allow-popups',
    'allow-popups-to-escape-sandbox',
    'allow-forms',
].join(' ');

/**
 * Best-effort embedded browser preview for an approved candidate source.
 *
 * Publishers can forbid framing through CSP `frame-ancestors` or
 * `X-Frame-Options`. Browsers do not surface that refusal to the parent in a
 * way the UI can observe, so we always keep a clear, non-technical note and an
 * explicit "Open original" action. The iframe is sandboxed and never given
 * `allow-top-navigation` so a framed source cannot hijack the workbench.
 */
export function SourceBrowserView({ source }: { source: SourceContext }) {
    const [previewKey, setPreviewKey] = useState(0);
    const [isLoading, setIsLoading] = useState(true);

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex flex-wrap items-center gap-2 border-b border-border/60 p-2">
                <FaviconAvatar
                    canonicalUrl={source.canonicalUrl}
                    size="sm"
                />
                <output
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-2 py-1"
                    aria-label="Source address"
                >
                    <Icon
                        iconNode={ExternalLinkIcon}
                        size={13}
                        className="shrink-0 text-muted-foreground"
                    />
                    <span className="truncate font-mono text-[11px] text-muted-foreground">
                        {source.canonicalUrl}
                    </span>
                </output>
                <div className="flex items-center gap-1">
                    <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Refresh preview"
                        title="Refresh preview"
                        onClick={() => {
                            setIsLoading(true);
                            setPreviewKey((value) => value + 1);
                        }}
                    >
                        <Icon iconNode={Refresh01Icon} />
                    </Button>
                    <CopyLinkButton url={source.canonicalUrl} />
                    <a
                        href={source.canonicalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Open original"
                        title="Open original"
                        className={cn(
                            buttonVariants({
                                size: 'icon-sm',
                                variant: 'ghost',
                            }),
                        )}
                    >
                        <Icon iconNode={ExternalLinkIcon} />
                    </a>
                </div>
            </div>

            <div className="relative min-h-0 flex-1 overflow-hidden bg-muted/30">
                {isLoading ? (
                    <div
                        className="absolute inset-0 grid place-items-center p-6"
                        aria-hidden={!isLoading}
                    >
                        <Skeleton className="h-full w-full rounded-none" />
                    </div>
                ) : null}
                <iframe
                    key={previewKey}
                    title={`Preview of ${source.title}`}
                    data-preview-key={previewKey}
                    src={source.canonicalUrl}
                    sandbox={FRAME_SANDBOX}
                    referrerPolicy="no-referrer"
                    loading="lazy"
                    onLoad={() => setIsLoading(false)}
                    className="size-full border-0 bg-background"
                />
            </div>

            <p className="border-t border-border/60 p-2 text-[11px] leading-relaxed text-muted-foreground">
                Preview depends on the publisher. If the page stays blank, open
                the original — some publishers disallow embedded previews.
            </p>
        </div>
    );
}

function CopyLinkButton({ url }: { url: string }) {
    const [copied, setCopied] = useState(false);

    async function copy() {
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(url);
            } else {
                throw new Error('Clipboard API unavailable');
            }
        } catch {
            // Fall back silently: the URL is already visible in the address
            // bar above, so the user can select and copy it manually.
            return;
        }
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2500);
    }

    return (
        <Button
            type="button"
            size="icon-sm"
            variant={copied ? 'secondary' : 'ghost'}
            aria-label="Copy link"
            title="Copy link"
            onClick={() => void copy()}
        >
            <Icon
                iconNode={Copy02Icon}
                className={cn(copied && 'text-approved')}
            />
            {copied ? (
                <span className="sr-only" role="status">
                    Link copied
                </span>
            ) : null}
        </Button>
    );
}
