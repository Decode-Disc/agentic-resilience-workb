'use client';

import type * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface LiquidMetalButtonProps
    extends React.ComponentProps<typeof Button> {
    label?: string;
}

export function LiquidMetalButton({
    children,
    className,
    variant = 'default',
    size = 'default',
    label,
    onClick,
    onMouseEnter,
    onMouseLeave,
    onMouseDown,
    onMouseUp,
    ref,
    ...props
}: LiquidMetalButtonProps) {
    const [isHovered, setIsHovered] = useState(false);
    const [isPressed, setIsPressed] = useState(false);
    const [ripples, setRipples] = useState<
        Array<{ x: number; y: number; id: number }>
    >([]);
    const shaderRef = useRef<HTMLDivElement>(null);
    // biome-ignore lint/suspicious/noExplicitAny: External library without types
    const shaderMount = useRef<any>(null);
    const buttonRef = useRef<HTMLButtonElement | null>(null);
    const rippleId = useRef(0);

    const setRefs = (node: HTMLButtonElement | null) => {
        buttonRef.current = node;
        if (typeof ref === 'function') {
            ref(node);
        } else if (ref && typeof ref === 'object') {
            (ref as React.RefObject<HTMLButtonElement | null>).current = node;
        }
    };

    useEffect(() => {
        const styleId = 'shader-canvas-style-exploded';
        if (!document.getElementById(styleId)) {
            const style = document.createElement('style');
            style.id = styleId;
            style.textContent = `
        .shader-container-exploded canvas {
          width: 100% !important;
          height: 100% !important;
          display: block !important;
          position: absolute !important;
          top: 0 !important;
          left: 0 !important;
          border-radius: inherit !important;
        }
        @keyframes ripple-animation {
          0% {
            transform: translate(-50%, -50%) scale(0);
            opacity: 0.6;
          }
          100% {
            transform: translate(-50%, -50%) scale(4);
            opacity: 0;
          }
        }
      `;
            document.head.appendChild(style);
        }

        const loadShader = async () => {
            try {
                const { liquidMetalFragmentShader, ShaderMount } = await import(
                    '@paper-design/shaders'
                );

                if (shaderRef.current) {
                    if (shaderMount.current?.destroy) {
                        shaderMount.current.destroy();
                    }

                    shaderMount.current = new ShaderMount(
                        shaderRef.current,
                        liquidMetalFragmentShader,
                        {
                            u_repetition: 4,
                            u_softness: 0.5,
                            u_shiftRed: 0.3,
                            u_shiftBlue: 0.3,
                            u_distortion: 0,
                            u_contour: 0,
                            u_angle: 45,
                            u_scale: 8,
                            u_shape: 1,
                            u_offsetX: 0.1,
                            u_offsetY: -0.1,
                        },
                        undefined,
                        0.6,
                    );
                }
            } catch (error) {
                console.error(
                    '[LiquidMetalButton] Failed to load shader:',
                    error,
                );
            }
        };

        loadShader();

        return () => {
            if (shaderMount.current?.destroy) {
                shaderMount.current.destroy();
                shaderMount.current = null;
            }
        };
    }, []);

    type MouseEventParam = Parameters<
        NonNullable<React.ComponentProps<typeof Button>['onClick']>
    >[0];

    const handleMouseEnter = (e: MouseEventParam) => {
        setIsHovered(true);
        shaderMount.current?.setSpeed?.(1);
        onMouseEnter?.(e);
    };

    const handleMouseLeave = (e: MouseEventParam) => {
        setIsHovered(false);
        setIsPressed(false);
        shaderMount.current?.setSpeed?.(0.6);
        onMouseLeave?.(e);
    };

    const handleMouseDown = (e: MouseEventParam) => {
        setIsPressed(true);
        onMouseDown?.(e);
    };

    const handleMouseUp = (e: MouseEventParam) => {
        setIsPressed(false);
        onMouseUp?.(e);
    };

    const handleClick = (e: MouseEventParam) => {
        if (shaderMount.current?.setSpeed) {
            shaderMount.current.setSpeed(2.4);
            setTimeout(() => {
                if (isHovered) {
                    shaderMount.current?.setSpeed?.(1);
                } else {
                    shaderMount.current?.setSpeed?.(0.6);
                }
            }, 300);
        }

        if (buttonRef.current) {
            const rect = buttonRef.current.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const ripple = { x, y, id: rippleId.current++ };

            setRipples((prev) => [...prev, ripple]);
            setTimeout(() => {
                setRipples((prev) => prev.filter((r) => r.id !== ripple.id));
            }, 600);
        }

        onClick?.(e);
    };

    const renderContent = () => {
        if (children) {
            return children;
        }
        return label ?? 'Get Started';
    };

    return (
        <Button
            ref={setRefs}
            variant={variant}
            size={size}
            className={cn(
                'group/liquid-metal relative overflow-hidden transition-all duration-300',
                variant === 'default' &&
                'border border-white/20 bg-neutral-950 text-white shadow-md hover:border-white/40 dark:border-white/20 dark:bg-neutral-950 dark:text-white',
                isPressed && 'scale-[0.98]',
                className,
            )}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onClick={handleClick}
            {...props}
        >
            {/* Shader canvas background */}
            <div
                ref={shaderRef}
                className="shader-container-exploded pointer-events-none absolute inset-0 size-full overflow-hidden rounded-[inherit] opacity-80 transition-opacity duration-300 group-hover/liquid-metal:opacity-100"
                aria-hidden="true"
            />

            {/* Subtle inner dark gradient */}
            <div
                className="pointer-events-none absolute inset-0 rounded-[inherit] bg-linear-to-b from-white/10 via-transparent to-black/50 shadow-inner"
                aria-hidden="true"
            />

            {/* Click Ripples */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
                {ripples.map((ripple) => (
                    <span
                        key={ripple.id}
                        style={{
                            left: `${ripple.x}px`,
                            top: `${ripple.y}px`,
                        }}
                        className="pointer-events-none absolute size-5 -translate-x-1/2 -translate-y-1/2 animate-[ripple-animation_0.6s_ease-out] rounded-full bg-radial from-white/40 to-transparent"
                        aria-hidden="true"
                    />
                ))}
            </div>

            {/* Content */}
            <span className="relative z-10 inline-flex items-center gap-1.5 drop-shadow-sm">
                {renderContent()}
            </span>
        </Button>
    );
}
