import type { ReactNode } from "react";
import { BackgroundImageTexture } from "@/components/ui/bg-image-texture";
import { cn } from "@/lib/utils";

/** Keeps dossier content mounted while its requested viewport changes the workspace backdrop. */
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
                plain && "bg-card bg-none",
                className,
            )}>
            {!plain && (
                <div
                    aria-hidden="true"
                    className="pointer-events-none fixed inset-0 -z-10 bg-(image:--workspace-grid) bg-[size:38px_38px] [mask-image:radial-gradient(ellipse_75%_60%_at_50%_0%,#000_55%,transparent_100%)] [-webkit-mask-image:radial-gradient(ellipse_75%_60%_at_50%_0%,#000_55%,transparent_100%)] [mask-repeat:no-repeat] [-webkit-mask-repeat:no-repeat]"
                />
            )}
            {header}

            <BackgroundImageTexture
                opacity={0.25}
                variant={plain ? "none" : "fabric-of-squares"}
                className={contentClassName}
                childrenClassName={cn(contentClassName, plain && "flex-1")}>
                {children}
            </BackgroundImageTexture>
        </div>
    );
}
