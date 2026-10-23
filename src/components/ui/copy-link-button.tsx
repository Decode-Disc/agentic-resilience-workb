import { Copy02Icon } from "@hugeicons/core-free-icons";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import Icon from "@/components/icon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Keeps copy confirmation tied to the requested URL and reports clipboard failures without exposing browser errors. */
export function CopyLinkButton({ url }: { url: string }) {
    const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const mounted = useRef(false);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            clearTimeout(timer.current);
        };
    }, []);
    const copied = copiedUrl === url;
    async function copy() {
        try {
            if (!navigator.clipboard?.writeText)
                throw new Error("Clipboard unavailable");
            await navigator.clipboard.writeText(url);
            if (!mounted.current) return;
            setCopiedUrl(url);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopiedUrl(null), 2500);
        } catch {
            if (mounted.current)
                toast.error(
                    "The link could not be copied. Select the address to copy it manually.",
                );
        }
    }
    return (
        <Button
            type="button"
            size="icon-sm"
            variant={copied ? "secondary" : "ghost"}
            aria-label="Copy link"
            title="Copy link"
            onClick={() => void copy()}>
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
    );
}
