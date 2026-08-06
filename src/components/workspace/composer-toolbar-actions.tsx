"use client";

import { MoreVerticalSquare01Icon } from "@hugeicons/core-free-icons";

import Icon from "@/components/icon";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import type { PlatformIcon } from "@/types/ui";

export interface ToolbarIconButtonProps {
    label: string;
    icon: PlatformIcon;
    onClick?: () => void;
    disabled?: boolean;
    count?: number;
}

/**
 * Preserves the compact icon action used throughout the composer toolbar.
 */
export function ToolbarIconButton({
    label,
    icon,
    onClick,
    disabled = false,
    count,
}: ToolbarIconButtonProps) {
    const visibleCount = count && count > 0 ? count : undefined;
    const accessibleLabel = visibleCount ? `${label} (${visibleCount})` : label;

    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <Button
                        type="button"
                        variant="secondary"
                        size="icon-sm"
                        aria-label={accessibleLabel}
                        onClick={onClick}
                        disabled={disabled}
                        className="relative overflow-visible rounded-full"
                    />
                }>
                <Icon iconNode={icon} size={16} />
                {visibleCount ? (
                    <span
                        aria-hidden="true"
                        className="pointer-events-none absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-mono text-[9px] leading-none font-semibold text-primary-foreground">
                        {visibleCount}
                    </span>
                ) : null}
            </TooltipTrigger>
            <TooltipContent side="top" align="center">
                {label}
            </TooltipContent>
        </Tooltip>
    );
}

/**
 * Keeps the established overflow action available for future composer tools.
 */
export function MoreOptionsButton() {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                render={
                    <Button
                        type="button"
                        variant="secondary"
                        size="icon-sm"
                        aria-label="More options"
                        aria-haspopup="menu"
                        className="rounded-full"
                    />
                }>
                <Icon iconNode={MoreVerticalSquare01Icon} size={16} />
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align="start"
                sideOffset={6}
                className="min-w-52">
                <DropdownMenuGroup>
                    <DropdownMenuLabel>More options</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem disabled>
                        No additional options
                    </DropdownMenuItem>
                </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
