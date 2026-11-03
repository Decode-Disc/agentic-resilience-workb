import type { ReactNode } from "react";
import { BackgroundImageTexture } from "@/components/ui/bg-image-texture";
import { cn } from "@/lib/utils";
import styles from "./workbench-shell.module.css";

/** Applies the shell layout declared by its page without remounting dossier content. */
export function WorkbenchShellSurface({
    plain = false,
    header,
    className,
    contentClassName,
    children,
}: {
    plain?: boolean;
    className?: string;
    contentClassName?: string;
    header?: ReactNode;
    children: ReactNode;
}) {
    return (
        <div
            className={cn(
                "relative isolate min-h-svh overflow-x-clip bg-(image:--workspace-gradient) bg-fixed text-foreground",
                styles.surface,
                plain && "bg-card bg-none",
                className,
            )}>
            {!plain && (
                <div
                    data-slot="workbench-grid"
                    aria-hidden="true"
                    className="pointer-events-none fixed inset-0 -z-10 bg-(image:--workspace-grid) bg-[size:38px_38px] [mask-image:radial-gradient(ellipse_75%_60%_at_50%_0%,#000_55%,transparent_100%)] [-webkit-mask-image:radial-gradient(ellipse_75%_60%_at_50%_0%,#000_55%,transparent_100%)] [mask-repeat:no-repeat] [-webkit-mask-repeat:no-repeat]"
                />
            )}
            {header}

            <BackgroundImageTexture
                opacity={0.25}
                variant={plain ? "none" : "fabric-of-squares"}
                className={cn(styles.body, contentClassName)}
                childrenClassName={cn(
                    styles.content,
                    contentClassName,
                    plain && "flex-1",
                )}>
                {children}
            </BackgroundImageTexture>
        </div>
    );
}
