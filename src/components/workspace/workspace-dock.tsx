import { LockIcon } from "@hugeicons/core-free-icons";
import { cloneElement, type ReactElement, type ReactNode, useId } from "react";
import Icon from "@/components/icon";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { stageIcons } from "@/lib/presentation/stage-icons";
import { cn } from "@/lib/utils";


export interface WorkspaceDockSection {
    key: keyof typeof stageIcons;
    label: string;
    current: boolean;
    /** Why the section cannot open yet; it stays visible, locked, with this explanation. */
    unavailable?: string;
    /** The navigation element for an available section, such as a router Link. */
    render: ReactElement<{
        className?: string;
        children?: ReactNode;
        "aria-label"?: string;
        "aria-current"?: "page";
    }>;
}

const item =
    "inline-flex h-9 shrink-0 items-center gap-2 rounded-2xl px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * Workspace sections and actions in one floating dock. Every section keeps
 * its icon; on narrow screens only the current one keeps its label and the
 * dock spans the row, so it fits one line without a menu.
 */
export function WorkspaceDock({
    sections,
    actions,
    compact = false,
    label = "Research workspace sections",
}: {
    sections: readonly WorkspaceDockSection[];
    /** Workspace-wide controls after a separator, such as the inventory. */
    actions?: ReactNode;
    compact?: boolean;
    label?: string;
}) {
    const id = useId();
    return (
        <div
            className={cn(
                "flex max-w-full min-w-0 items-center gap-1 rounded-2xl bg-surface-float p-1 shadow-float ring-1 ring-foreground/8 backdrop-blur-glass",
                compact && "w-full",
            )}>
            <nav
                aria-label={label}
                className={cn(
                    "flex min-w-0 items-center gap-1",
                    compact && "flex-1",
                )}>
                {sections.map((section) => {
                    const showLabel = !compact || section.current;
                    const content = (
                        <>
                            <Icon
                                iconNode={stageIcons[section.key]}
                                className="size-4"
                            />
                            {showLabel ? section.label : null}
                        </>
                    );
                    if (section.unavailable)
                        return (
                            <Tooltip key={section.key}>
                                <TooltipTrigger
                                    render={
                                        <button
                                            type="button"
                                            aria-disabled="true"
                                            aria-label={section.label}
                                            aria-describedby={`${id}-${section.key}`}
                                            className={cn(
                                                item,
                                                "cursor-default text-muted-foreground/55",
                                                compact &&
                                                    "grow justify-center px-2.5",
                                            )}
                                        />
                                    }>
                                    {content}
                                    {showLabel ? (
                                        <Icon
                                            iconNode={LockIcon}
                                            className="size-3 opacity-70"
                                        />
                                    ) : null}
                                </TooltipTrigger>
                                <span
                                    id={`${id}-${section.key}`}
                                    className="sr-only">
                                    {section.unavailable}
                                </span>
                                <TooltipContent>
                                    {section.unavailable}
                                </TooltipContent>
                            </Tooltip>
                        );
                    return cloneElement(
                        section.render,
                        {
                            key: section.key,
                            "aria-label": section.label,
                            "aria-current": section.current
                                ? "page"
                                : undefined,
                            className: cn(
                                item,
                                section.current
                                    ? "bg-tint-violet text-accent-foreground shadow-[inset_0_0_0_1px_var(--chip-edge)]"
                                    : "text-muted-foreground hover:bg-foreground/6 hover:text-foreground",
                                compact && "grow justify-center",
                                compact && !section.current && "px-2.5",
                            ),
                        },
                        content,
                    );
                })}
            </nav>
            {actions ? (
                <>
                    <span
                        aria-hidden="true"
                        className="mx-1 h-5 w-px shrink-0 bg-foreground/10"
                    />
                    {actions}
                </>
            ) : null}
        </div>
    );
}

/** The dock's inventory control: ink, so the evidence count stands out from the sections. */
export const workspaceDockActionClass =
    "inline-flex h-9 shrink-0 items-center gap-2 rounded-2xl bg-foreground px-3 text-sm font-medium text-background shadow-raised transition-colors hover:bg-foreground/88 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
