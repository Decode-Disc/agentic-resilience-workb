import { HugeiconsIcon } from "@hugeicons/react";
import type { LucideProps } from "lucide-react";
import type { ComponentType, CSSProperties } from "react";
import { cn } from "@/lib/utils";
import type { PlatformIcon } from "@/types/ui";

interface IconProps {
    iconNode: PlatformIcon;
    className?: string;
    size?: number | string;
    strokeWidth?: number;
    color?: string;
    covered?: boolean;
    coverClassName?: string;
}

export default function Icon({
    iconNode,
    className = "size-4",
    size,
    strokeWidth,
    color,
    covered,
    coverClassName,
}: IconProps) {
    function CoverComponent({ children }: { children: React.ReactNode }) {
        return covered ? (
            <span
                className={cn(
                    "flex items-center justify-center rounded-full bg-primary-foreground/10 p-2 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-1",
                    coverClassName,
                )}>
                {children}
            </span>
        ) : (
            children
        );
    }

    const iconStyle: CSSProperties | undefined =
        size !== undefined
            ? {
                  width: typeof size === "number" ? `${size}px` : size,
                  height: typeof size === "number" ? `${size}px` : size,
              }
            : undefined;

    if (Array.isArray(iconNode)) {
        return (
            <CoverComponent>
                <HugeiconsIcon
                    icon={iconNode}
                    className={cn(className)}
                    {...(size !== undefined && { size })}
                    {...(strokeWidth !== undefined && { strokeWidth })}
                    {...(color !== undefined && { color })}
                    style={iconStyle}
                />
            </CoverComponent>
        );
    }

    const LucideComponent = iconNode as ComponentType<LucideProps>;
    return (
        <CoverComponent>
            <LucideComponent
                className={cn(className)}
                {...(size !== undefined && { size })}
                {...(strokeWidth !== undefined && { strokeWidth })}
                {...(color !== undefined && { color })}
                style={iconStyle}
            />
        </CoverComponent>
    );
}
