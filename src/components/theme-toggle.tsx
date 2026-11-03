import { Moon02Icon, Sun03Icon } from "@hugeicons/core-free-icons";
import { useHydrated } from "@tanstack/react-router";
import { useTheme } from "next-themes";
import { useId } from "react";
import Icon from "@/components/icon";
import { Button } from "@/components/ui/button";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";

/** Changes the shared document theme through its provider, including persistence. */
export function ThemeToggle() {
    const { resolvedTheme, setTheme } = useTheme();
    const hydrated = useHydrated();
    const theme = hydrated && resolvedTheme === "dark" ? "dark" : "light";
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
                        onClick={() => setTheme(nextTheme)}
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
