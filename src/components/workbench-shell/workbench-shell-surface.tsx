import type { ReactNode } from "react";
import { BackgroundImageTexture } from "@/components/ui/bg-image-texture";
import { cn } from "@/lib/utils";

/** Shared workspace backdrop and texture, independent of navigation data and authentication. */
export function WorkbenchShellSurface({
    header,
    className,
    contentClassName,
    children,
}: {
    className?: string;
    contentClassName?: string;
    header?: ReactNode;
    children: ReactNode;
}) {
    return (
        <div
            className={cn(
                "relative isolate min-h-svh overflow-x-clip bg-(image:--workspace-gradient) bg-fixed text-foreground",
                className,
            )}>
            <div
                aria-hidden="true"
                className="pointer-events-none fixed inset-0 -z-10 bg-(image:--workspace-grid) bg-[size:38px_38px] [mask-image:radial-gradient(ellipse_75%_60%_at_50%_0%,#000_55%,transparent_100%)] [-webkit-mask-image:radial-gradient(ellipse_75%_60%_at_50%_0%,#000_55%,transparent_100%)] [mask-repeat:no-repeat] [-webkit-mask-repeat:no-repeat]"
            />
            {header}

            <BackgroundImageTexture
                opacity={0.25}
                variant="fabric-of-squares"
                className={contentClassName}
                childrenClassName={contentClassName}>
                {children}
            </BackgroundImageTexture>
        </div>
    );
}
