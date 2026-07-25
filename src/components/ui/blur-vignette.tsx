'use client';
import type React from 'react';
import { createContext, useContext } from 'react';
import { cn } from '@/lib/utils';

interface BlurVignetteContextProps {
    radius?: string;
    inset?: string;
    transitionLength?: string;
    blur?: string;
}

const BlurVignetteContext = createContext<BlurVignetteContextProps>({
    radius: '24px',
    inset: '20px',
    transitionLength: '44px',
    blur: '6px',
});

export const useBlurVignetteContext = () => useContext(BlurVignetteContext);

interface BlurVignetteProps {
    className?: string;
    children: React.ReactNode;
    radius?: string;
    inset?: string;
    transitionLength?: string;
    blur?: string;
}

export const BlurVignette: React.FC<BlurVignetteProps> = ({
    className,
    children,
    radius = '24px',
    inset = '20px',
    transitionLength = '44px',
    blur = '6px',
}) => {
    return (
        <BlurVignetteContext.Provider
            value={{ radius, inset, transitionLength, blur }}
        >
            <div
                className={cn('relative overflow-hidden', className)}
                style={{ borderRadius: radius }}
            >
                {children}
            </div>
        </BlurVignetteContext.Provider>
    );
};
interface BlurVignetteArticleProps {
    children?: React.ReactNode;
    className?: string;
}

export const BlurVignetteArticle: React.FC<BlurVignetteArticleProps> = ({
    children,
    className,
}) => {
    const { radius, inset, transitionLength, blur } = useBlurVignetteContext();

    return (
        <div
            className={cn('absolute inset-0 z-1', className)}
            style={
                {
                    '--radius': radius,
                    '--inset': inset,
                    '--transition-length': transitionLength,
                    '--blur': blur,
                    filter: 'blur(var(--blur))',
                    maskImage:
                        'radial-gradient(ellipse at center, transparent 0 30%, black 66%, transparent 100%)',
                    WebkitMaskImage:
                        'radial-gradient(ellipse at center, transparent 0 30%, black 66%, transparent 100%)',
                } as React.CSSProperties
            }
        >
            {children}
        </div>
    );
};
