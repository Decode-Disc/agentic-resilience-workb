"use client";

import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import type { ReactNode } from "react";

import Icon from "@/components/icon";
import { Button } from "@/components/ui/button";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/**
 * Keeps secondary technical detail behind one consistent disclosure instead of
 * repeating Collapsible wiring in every admin row.
 */
export function AdminDetailDisclosure({
    label,
    children,
    className,
}: {
    label: string;
    children: ReactNode;
    className?: string;
}) {
    return (
        <Collapsible className={cn("mt-1", className)}>
            <CollapsibleTrigger
                render={<Button type="button" variant="ghost" size="sm" />}
                className="group -ml-2 h-7 gap-1.5 px-2 text-xs font-normal text-muted-foreground">
                <Icon
                    iconNode={ArrowRight01Icon}
                    className="size-3.5 transition-transform group-aria-expanded:rotate-90 motion-reduce:transition-none"
                />
                {label}
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-1 pt-1">
                {children}
            </CollapsibleContent>
        </Collapsible>
    );
}
