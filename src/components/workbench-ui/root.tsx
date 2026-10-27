import { type ComponentProps, createContext, useContext } from "react";
import { cn } from "@/lib/utils";
import "./styles.css";

const Theme = createContext<"light" | "dark" | undefined>(undefined);

/** Bounds the reference materials and carries their theme into dialog portals. */
export function WorkbenchUiRoot({
    theme,
    className,
    children,
    ...props
}: ComponentProps<"div"> & { theme?: "light" | "dark" }) {
    const inheritedTheme = useContext(Theme);
    const effectiveTheme = theme ?? inheritedTheme;
    return (
        <Theme.Provider value={effectiveTheme}>
            <div
                {...props}
                className={cn("wb-ui", className)}
                data-workbench-ui=""
                data-theme={effectiveTheme}>
                {children}
            </div>
        </Theme.Provider>
    );
}
