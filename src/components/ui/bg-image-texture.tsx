import type React from 'react';
import debutLight from '@/assets/images/textures/debut-light.png';
import fabricOfSquares from '@/assets/images/textures/fabric-of-squares.png';
import gridNoise from '@/assets/images/textures/grid-noise.png';
import groovepaper from '@/assets/images/textures/groovepaper.png';
import inflicted from '@/assets/images/textures/inflicted.png';
import { cn } from '@/lib/utils';

export type TextureVariant =
    | 'fabric-of-squares'
    | 'grid-noise'
    | 'inflicted'
    | 'debut-light'
    | 'groovepaper'
    | 'none';

interface BackgroundImageTextureProps {
    variant?: TextureVariant;
    opacity?: number;
    className?: string;
    children?: React.ReactNode;
    childrenClassName?: string;
}

const textureMap: Record<Exclude<TextureVariant, 'none'>, string> = {
    'fabric-of-squares': fabricOfSquares,
    'grid-noise': gridNoise,
    inflicted: inflicted,
    'debut-light': debutLight,
    groovepaper: groovepaper,
};

export function BackgroundImageTexture({
    variant = 'fabric-of-squares',
    opacity = 0.5,
    className,
    children,
    childrenClassName,
}: BackgroundImageTextureProps) {
    const textureUrl = variant !== 'none' ? textureMap[variant] : null;

    return (
        <div className={cn('relative', className)}>
            {textureUrl && (
                <div
                    aria-hidden="true"
                    data-slot="bg-image-texture"
                    className="pointer-events-none absolute inset-0"
                    style={{
                        backgroundImage: `url(${textureUrl})`,
                        backgroundRepeat: 'repeat',
                        opacity,
                    }}
                />
            )}
            {children && (
                <div className={cn('relative', childrenClassName)}>
                    {children}
                </div>
            )}
        </div>
    );
}
