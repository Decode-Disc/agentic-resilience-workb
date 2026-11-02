import { PlusSignIcon } from "@hugeicons/core-free-icons";
import type { ReactNode } from "react";
import Icon from "@/components/icon";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PlatformIcon } from "@/types/ui";

type ComposerTool = {
    label: string;
    description?: string;
    icon?: PlatformIcon;
    onSelect: () => void;
    disabled?: boolean;
};

/** Pasta UI-inspired tool rows; Base UI owns selection, focus and dismissal. */
export function ComposerToolItem({
    label,
    description,
    icon,
    onSelect,
    disabled,
}: ComposerTool) {
    return (
        <DropdownMenuItem
            aria-label={label}
            disabled={disabled}
            onClick={onSelect}
            className="composer-tool-item">
            {icon && <Icon iconNode={icon} size={18} />}
            <span className="composer-tool-copy">
                <span>{label}</span>
                {description && (
                    <span className="composer-tool-description">
                        {description}
                    </span>
                )}
            </span>
        </DropdownMenuItem>
    );
}

/** Adapts Pasta UI PromptToolsMenu (MIT; see pasta-ui.LICENSE.txt) to the available Workbench actions. */
export function ComposerToolsMenu({
    items = [],
    children,
    count,
    onOpenChange,
}: {
    items?: readonly ComposerTool[];
    children?: ReactNode;
    count?: number;
    onOpenChange?: (open: boolean) => void;
}) {
    return (
        <DropdownMenu onOpenChange={onOpenChange}>
            <DropdownMenuTrigger
                render={
                    <Button
                        variant="secondary"
                        size="icon-sm"
                        className="composer-plus"
                    />
                }
                aria-label={
                    count ? `Composer tools (${count})` : "Composer tools"
                }>
                <Icon iconNode={PlusSignIcon} size={18} />
                {!!count && (
                    <span className="composer-tool-count">{count}</span>
                )}
            </DropdownMenuTrigger>
            <DropdownMenuContent
                side="top"
                align="start"
                className="composer-tools-menu">
                {items.map((item) => (
                    <ComposerToolItem key={item.label} {...item} />
                ))}
                {children}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
