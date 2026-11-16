import type { ReactNode } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

/**
 * Gives an administration list its own bounded scroll so long histories never stretch the page. One owner
 * keeps every admin list at the same height and keyboard-scrollable.
 */
export function AdminScrollList({
    label,
    children,
    className,
}: {
    /** Names the scrollable region for assistive technology. */
    label: string;
    children: ReactNode;
    className?: string;
}) {
    return (
        <ScrollArea
            className={cn("-mx-1", className)}
            viewportClassName="max-h-[min(58svh,32rem)] px-1"
            viewportProps={{
                "aria-label": label,
                role: "region",
                tabIndex: 0,
            }}>
            {children}
        </ScrollArea>
    );
}
