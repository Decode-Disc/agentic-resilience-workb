import { Moon02Icon, Sun03Icon } from "@hugeicons/core-free-icons";
import { useId } from "react";
import Icon from "@/components/icon";
import { Button } from "@/components/ui/button";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";

/** Switches the supplied theme; persistence and document scope stay with its owner. */
export function ThemeToggle({
    theme,
    onThemeChange,
}: {
    theme: "light" | "dark";
    onThemeChange: (theme: "light" | "dark") => void;
}) {
    const descriptionId = useId();
    const nextTheme = theme === "dark" ? "light" : "dark";
    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <Button
                        data-slot="theme-toggle"
                        variant="ghost"
                        size="icon"
                        aria-label="Switch theme"
                        aria-describedby={descriptionId}
                        onClick={() => onThemeChange(nextTheme)}
                    />
                }>
                <Icon iconNode={theme === "dark" ? Sun03Icon : Moon02Icon} />
            </TooltipTrigger>
            <TooltipContent id={descriptionId} role="tooltip">
                Switch to {nextTheme} theme
            </TooltipContent>
        </Tooltip>
    );
}
