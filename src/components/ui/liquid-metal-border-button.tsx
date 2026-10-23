"use client";

import { Slot } from "@radix-ui/react-slot";
import { Sparkles } from "lucide-react";
import type React from "react";
import { cloneElement, useEffect, useMemo, useRef, useState } from "react";
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
    const [contentWidth, setContentWidth] = useState<number>(0);
    const contentRef = useRef<HTMLSpanElement>(null);
    const shaderRef = useRef<HTMLDivElement>(null);
    // biome-ignore lint/suspicious/noExplicitAny: External library without types
    const shaderMount = useRef<any>(null);
    const buttonRef = useRef<HTMLElement>(null);
    const rippleId = useRef(0);

    useEffect(() => {
        if (!contentRef.current) return;
        const updateWidth = () => {
            if (contentRef.current) {
                setContentWidth(
                    contentRef.current.offsetWidth ||
                        contentRef.current.getBoundingClientRect().width,
                );
            }
        };
        updateWidth();
        const observer = new ResizeObserver(updateWidth);
        observer.observe(contentRef.current);
        return () => observer.disconnect();
    }, [children, label, viewMode]);

    const dimensions = useMemo(() => {
        if (viewMode === "icon") {
            return {
                width: 46,
                height: 46,
                innerWidth: 42,
                innerHeight: 42,
                shaderWidth: 46,
                shaderHeight: 46,
            };
        } else {
            const calculatedWidth =
                contentWidth > 0
                    ? Math.max(142, Math.ceil(contentWidth + 36))
                    : 142;
            return {
                width: calculatedWidth,
                height: 46,
                innerWidth: calculatedWidth - 4,
                innerHeight: 42,
                shaderWidth: calculatedWidth,
                shaderHeight: 46,
            };
        }
    }, [viewMode, contentWidth]);

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

        const loadShader = async () => {
            try {
                const { liquidMetalFragmentShader, ShaderMount } = await import(
                    "@paper-design/shaders"
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
                console.error("[v0] Failed to load shader:", error);
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
            top: 0,
            left: 0,
            width: `${dimensions.width}px`,
            height: `${dimensions.height}px`,
            background: "transparent",
            border: "none",
            cursor: "pointer",
            outline: "none",
            zIndex: 40,
            transformStyle: "preserve-3d",
            transform: "translateZ(25px)",
            transition:
                "all 0.8s cubic-bezier(0.34, 1.56, 0.64, 1), width 0.4s ease, height 0.4s ease",
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
                        width: `${dimensions.width}px`,
                        height: `${dimensions.height}px`,
                        transformStyle: "preserve-3d",
                        transition:
                            "all 0.8s cubic-bezier(0.34, 1.56, 0.64, 1), width 0.4s ease, height 0.4s ease",
                        transform: "none",
                    }}>
                    <div
                        style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: `${dimensions.width}px`,
                            height: `${dimensions.height}px`,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            transformStyle: "preserve-3d",
                            transition:
                                "all 0.8s cubic-bezier(0.34, 1.56, 0.64, 1), width 0.4s ease, height 0.4s ease",
                            transform: "translateZ(20px)",
                            zIndex: 30,
                            pointerEvents: "none",
                        }}>
                        <span
                            ref={contentRef}
                            style={{
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: "8px",
                                fontSize: "14px",
                                fontWeight: 400,
                                color: isHovered ? "#d7d7d7" : "#ffffff",
                                textShadow: "0px 1px 2px rgba(0, 0, 0, 0.5)",
                                transition: "all 0.3s ease",
                                whiteSpace: "nowrap",
                                userSelect: "none",
                            }}>
                            {children ? children : viewModeRender(viewMode)}
                        </span>
                    </div>

                    <div
                        style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: `${dimensions.width}px`,
                            height: `${dimensions.height}px`,
                            transformStyle: "preserve-3d",
                            transition:
                                "all 0.8s cubic-bezier(0.34, 1.56, 0.64, 1), width 0.4s ease, height 0.4s ease",
                            transform: `translateZ(10px) ${isPressed ? "translateY(1px) scale(0.98)" : "translateY(0) scale(1)"}`,
                            zIndex: 20,
                        }}>
                        <div
                            style={{
                                width: `${dimensions.innerWidth}px`,
                                height: `${dimensions.innerHeight}px`,
                                margin: "2px",
                                borderRadius: "100px",
                                background:
                                    "linear-gradient(180deg, #202020 0%, #000000 100%)",
                                boxShadow: isPressed
                                    ? "inset 0px 2px 4px rgba(0, 0, 0, 0.4), inset 0px 1px 2px rgba(0, 0, 0, 0.3)"
                                    : "none",
                                transition:
                                    "all 0.8s cubic-bezier(0.34, 1.56, 0.64, 1), width 0.4s ease, height 0.4s ease, box-shadow 0.15s cubic-bezier(0.4, 0, 0.2, 1)",
                            }}
                        />
                    </div>

                    <div
                        style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: `${dimensions.width}px`,
                            height: `${dimensions.height}px`,
                            transformStyle: "preserve-3d",
                            transition:
                                "all 0.8s cubic-bezier(0.34, 1.56, 0.64, 1), width 0.4s ease, height 0.4s ease",
                            transform: `translateZ(0px) ${isPressed ? "translateY(1px) scale(0.98)" : "translateY(0) scale(1)"}`,
                            zIndex: 10,
                        }}>
                        <div
                            style={{
                                height: `${dimensions.height}px`,
                                width: `${dimensions.width}px`,
                                borderRadius: "100px",
                                boxShadow: isPressed
                                    ? "0px 0px 0px 1px rgba(0, 0, 0, 0.5), 0px 1px 2px 0px rgba(0, 0, 0, 0.3)"
                                    : isHovered
                                      ? "0px 0px 0px 1px rgba(0, 0, 0, 0.4), 0px 12px 6px 0px rgba(0, 0, 0, 0.05), 0px 8px 5px 0px rgba(0, 0, 0, 0.1), 0px 4px 4px 0px rgba(0, 0, 0, 0.15), 0px 1px 2px 0px rgba(0, 0, 0, 0.2)"
                                      : "0px 0px 0px 1px rgba(0, 0, 0, 0.3), 0px 36px 14px 0px rgba(0, 0, 0, 0.02), 0px 20px 12px 0px rgba(0, 0, 0, 0.08), 0px 9px 9px 0px rgba(0, 0, 0, 0.12), 0px 2px 5px 0px rgba(0, 0, 0, 0.15)",
                                transition:
                                    "all 0.8s cubic-bezier(0.34, 1.56, 0.64, 1), width 0.4s ease, height 0.4s ease, box-shadow 0.15s cubic-bezier(0.4, 0, 0.2, 1)",
                                background: "rgb(0 0 0 / 0)",
                            }}>
                            <div
                                ref={shaderRef}
                                className="shader-container-exploded"
                                style={{
                                    borderRadius: "100px",
                                    overflow: "hidden",
                                    position: "relative",
                                    width: `${dimensions.shaderWidth}px`,
                                    maxWidth: `${dimensions.shaderWidth}px`,
                                    height: `${dimensions.shaderHeight}px`,
                                    transition:
                                        "width 0.4s ease, height 0.4s ease",
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
