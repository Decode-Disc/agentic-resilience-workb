import type { ReactElement, ReactNode } from "react";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import styles from "./help-tip.module.css";
import { WorkbenchUiRoot } from "./root";

/**
 * Short explanation that opens on hover or keyboard focus with a pointer and
 * on tap with touch. The trigger must be focusable and carry its own
 * accessible name; repeat essential content in that name or a description.
 */
export function HelpTip({
    trigger,
    children,
    side = "top",
}: {
    trigger: ReactElement;
    children: ReactNode;
    side?: "top" | "bottom" | "left" | "right";
}) {
    return (
        <Popover>
            <PopoverTrigger openOnHover delay={150} render={trigger} />
            <PopoverContent
                side={side}
                sideOffset={8}
                render={<WorkbenchUiRoot />}
                className={styles.tip}>
                {children}
            </PopoverContent>
        </Popover>
    );
}
