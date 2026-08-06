import type React from "react";
import { cn } from "@/lib/utils";

export type TextureVariant =
    | "fabric-of-squares"
    | "grid-noise"
    | "inflicted"
    | "debut-light"
    | "groovepaper"
    | "none";

interface BackgroundImageTextureProps {
    variant?: TextureVariant;
    opacity?: number;
    className?: string;
    children?: React.ReactNode;
    childrenClassName?: string;
}

const textureMap: Record<Exclude<TextureVariant, "none">, string> = {
    "fabric-of-squares": "/images/textures/fabric-of-squares.png",
    "grid-noise": "/images/textures/grid-noise.png",
    inflicted: "/images/textures/inflicted.png",
    "debut-light": "/images/textures/debut-light.png",
    groovepaper: "/images/textures/groovepaper.png",
};

export function BackgroundImageTexture({
    variant = "fabric-of-squares",
    opacity = 0.5,
    className,
    children,
    childrenClassName,
}: BackgroundImageTextureProps) {
    const textureUrl = variant !== "none" ? textureMap[variant] : null;

    return (
        <div className={cn("relative", className)}>
            {textureUrl && (
                <div
                    aria-hidden="true"
                    data-slot="bg-image-texture"
                    className="pointer-events-none absolute inset-0"
                    style={{
                        backgroundImage: `url(${textureUrl})`,
                        backgroundRepeat: "repeat",
                        opacity,
                    }}
                />
            )}
            {children && (
                <div className={cn("relative", childrenClassName)}>
                    {children}
                </div>
            )}
        </div>
    );
}
