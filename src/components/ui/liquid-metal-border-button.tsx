"use client";

import { Slot } from "@radix-ui/react-slot";
import { Sparkles } from "lucide-react";
import type React from "react";
import { cloneElement, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface LiquidMetalBorderButtonProps {
    label?: string;
    children?: React.ReactNode;
    onClick?: () => void;
    viewMode?: "text" | "icon";
    type?: "button" | "submit" | "reset";
    className?: string;
    style?: React.CSSProperties;
    render?: React.ReactElement;
}

export function LiquidMetalBorderButton({
    label = "Get Started",
    onClick,
    children,
    viewMode = "text",
    type = "button",
    className,
    style,
    render,
}: LiquidMetalBorderButtonProps) {
    const [isHovered, setIsHovered] = useState(false);
    const [isPressed, setIsPressed] = useState(false);
    const [ripples, setRipples] = useState<
        Array<{ x: number; y: number; id: number }>
    >([]);
    const shaderRef = useRef<HTMLDivElement>(null);
    // biome-ignore lint/suspicious/noExplicitAny: External library without types
    const shaderMount = useRef<any>(null);
    const buttonRef = useRef<HTMLElement>(null);
    const rippleId = useRef(0);

    useEffect(() => {
        const styleId = "shader-canvas-style-exploded";
        if (!document.getElementById(styleId)) {
            const style = document.createElement("style");
            style.id = styleId;
            style.textContent = `
        .shader-container-exploded canvas {
          width: 100% !important;
          height: 100% !important;
          display: block !important;
          position: absolute !important;
          top: 0 !important;
          left: 0 !important;
          border-radius: 100px !important;
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

        let cancelled = false;
        let idleHandle: number | null = null;
        let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

        const loadShader = async () => {
            try {
                const { liquidMetalFragmentShader, ShaderMount } = await import(
                    "@paper-design/shaders"
                );
                if (cancelled || !shaderRef.current) return;

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
            } catch (error) {
                console.error("[v0] Failed to load shader:", error);
            }
        };

        if (typeof window !== "undefined" && "requestIdleCallback" in window) {
            idleHandle = window.requestIdleCallback(() => {
                void loadShader();
            });
        } else {
            timeoutHandle = setTimeout(() => {
                void loadShader();
            }, 100);
        }

        return () => {
            cancelled = true;
            if (
                idleHandle !== null &&
                typeof window !== "undefined" &&
                "cancelIdleCallback" in window
            ) {
                window.cancelIdleCallback(idleHandle);
            }
            if (timeoutHandle !== null) {
                clearTimeout(timeoutHandle);
            }
            if (shaderMount.current?.destroy) {
                shaderMount.current.destroy();
                shaderMount.current = null;
            }
        };
    }, []);

    const handleMouseEnter = () => {
        setIsHovered(true);
        shaderMount.current?.setSpeed?.(1);
    };

    const handleMouseLeave = () => {
        setIsHovered(false);
        setIsPressed(false);
        shaderMount.current?.setSpeed?.(0.6);
    };

    const handleClick = (e: React.MouseEvent<HTMLElement>) => {
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

        onClick?.();
    };

    const viewModeRender = (mode: "text" | "icon") => {
        return (
            <>
                {mode === "icon" && (
                    <Sparkles
                        size={16}
                        style={{
                            color: "currentColor",
                            filter: "drop-shadow(0px 1px 2px rgba(0, 0, 0, 0.5))",
                            transition: "all 0.3s ease",
                            transform: "scale(1)",
                        }}
                    />
                )}
                {mode === "text" && label}
            </>
        );
    };

    const computeAriaLabel = () => {
        if (label && label !== "Get Started") return label;
        if (typeof children === "string") return children;
        return label || "Button";
    };

    const rippleElements = ripples.map((ripple) => (
        <span
            key={ripple.id}
            style={{
                position: "absolute",
                left: `${ripple.x}px`,
                top: `${ripple.y}px`,
                width: "20px",
                height: "20px",
                borderRadius: "50%",
                background:
                    "radial-gradient(circle, rgba(255, 255, 255, 0.4) 0%, rgba(255, 255, 255, 0) 70%)",
                pointerEvents: "none",
                animation: "ripple-animation 0.6s ease-out",
            }}
        />
    ));

    const isIconMode = viewMode === "icon";

    const interactiveProps = {
        ref: (node: HTMLElement | null) => {
            buttonRef.current = node;
        },
        onClick: handleClick,
        onMouseEnter: handleMouseEnter,
        onMouseLeave: handleMouseLeave,
        onMouseDown: () => setIsPressed(true),
        onMouseUp: () => setIsPressed(false),
        style: {
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            outline: "none",
            zIndex: 40,
            transformStyle: "preserve-3d",
            transform: "translateZ(25px)",
            overflow: "hidden",
            borderRadius: "100px",
        } satisfies React.CSSProperties,
        "aria-label": computeAriaLabel(),
    };

    return (
        <div className={cn("relative inline-block", className)} style={style}>
            <div
                style={{
                    perspective: "1000px",
                    perspectiveOrigin: "50% 50%",
                }}>
                <div
                    style={{
                        position: "relative",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        minWidth: isIconMode ? "46px" : "142px",
                        width: isIconMode ? "46px" : undefined,
                        height: "46px",
                        padding: isIconMode ? "0px" : "0px 18px",
                        transformStyle: "preserve-3d",
                        transform: "none",
                    }}>
                    <div
                        style={{
                            position: "relative",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            transformStyle: "preserve-3d",
                            transform: "translateZ(20px)",
                            zIndex: 30,
                            pointerEvents: "none",
                        }}>
                        <span
                            style={{
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: "8px",
                                fontSize: "14px",
                                fontWeight: 400,
                                color: isHovered ? "#d7d7d7" : "#ffffff",
                                textShadow: "0px 1px 2px rgba(0, 0, 0, 0.5)",
                                transition: "color 0.3s ease",
                                whiteSpace: "nowrap",
                                userSelect: "none",
                            }}>
                            {children ? children : viewModeRender(viewMode)}
                        </span>
                    </div>

                    <div
                        style={{
                            position: "absolute",
                            inset: 0,
                            transformStyle: "preserve-3d",
                            transition:
                                "transform 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)",
                            transform: `translateZ(10px) ${isPressed ? "translateY(1px) scale(0.98)" : "translateY(0) scale(1)"}`,
                            zIndex: 20,
                            pointerEvents: "none",
                        }}>
                        <div
                            style={{
                                position: "absolute",
                                inset: "2px",
                                borderRadius: "100px",
                                background:
                                    "linear-gradient(180deg, #202020 0%, #000000 100%)",
                                boxShadow: isPressed
                                    ? "inset 0px 2px 4px rgba(0, 0, 0, 0.4), inset 0px 1px 2px rgba(0, 0, 0, 0.3)"
                                    : "none",
                                transition:
                                    "box-shadow 0.15s cubic-bezier(0.4, 0, 0.2, 1)",
                            }}
                        />
                    </div>

                    <div
                        style={{
                            position: "absolute",
                            inset: 0,
                            transformStyle: "preserve-3d",
                            transition:
                                "transform 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)",
                            transform: `translateZ(0px) ${isPressed ? "translateY(1px) scale(0.98)" : "translateY(0) scale(1)"}`,
                            zIndex: 10,
                            pointerEvents: "none",
                        }}>
                        <div
                            style={{
                                position: "absolute",
                                inset: 0,
                                borderRadius: "100px",
                                boxShadow: isPressed
                                    ? "0px 0px 0px 1px rgba(0, 0, 0, 0.5), 0px 1px 2px 0px rgba(0, 0, 0, 0.3)"
                                    : isHovered
                                      ? "0px 0px 0px 1px rgba(0, 0, 0, 0.4), 0px 12px 6px 0px rgba(0, 0, 0, 0.05), 0px 8px 5px 0px rgba(0, 0, 0, 0.1), 0px 4px 4px 0px rgba(0, 0, 0, 0.15), 0px 1px 2px 0px rgba(0, 0, 0, 0.2)"
                                      : "0px 0px 0px 1px rgba(0, 0, 0, 0.3), 0px 36px 14px 0px rgba(0, 0, 0, 0.02), 0px 20px 12px 0px rgba(0, 0, 0, 0.08), 0px 9px 9px 0px rgba(0, 0, 0, 0.12), 0px 2px 5px 0px rgba(0, 0, 0, 0.15)",
                                transition:
                                    "box-shadow 0.15s cubic-bezier(0.4, 0, 0.2, 1)",
                                background:
                                    "linear-gradient(135deg, #71717a 0%, #f4f4f5 32%, #27272a 66%, #a1a1aa 100%)",
                            }}>
                            <div
                                ref={shaderRef}
                                className="shader-container-exploded"
                                style={{
                                    borderRadius: "100px",
                                    overflow: "hidden",
                                    position: "absolute",
                                    inset: 0,
                                }}
                            />
                        </div>
                    </div>

                    {render ? (
                        <Slot {...interactiveProps}>
                            {cloneElement(render, undefined, rippleElements)}
                        </Slot>
                    ) : (
                        <button type={type} {...interactiveProps}>
                            {rippleElements}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
