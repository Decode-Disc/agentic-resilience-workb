"use client"

import {
    AnimatePresence,
    type Easing,
    type HTMLMotionProps,
    motion,
    type TargetAndTransition,
    type Transition,
    useInView,
} from "motion/react"
import type React from "react"
import { useRef } from "react"

export type AnimatePresenceMode = "sync" | "wait" | "popLayout"

export type AnimationPreset =
    | "scale"
    | "fade"
    | "slide-up"
    | "slide-down"
    | "slide-left"
    | "slide-right"
    | "scale-up"
    | "zoom"
    | "blur"
    | "flip-x"
    | "flip-y"

export interface PresetDefinition {
    initial: TargetAndTransition
    animate: TargetAndTransition
    exit: TargetAndTransition
    transition?: Transition
}

type UseInViewOptions = NonNullable<Parameters<typeof useInView>[1]>

const defaultEase: Easing = [0.26, 0.02, 0.23, 0.94]
const waitEaseIn: Easing = [0.02, 0.35, 0.25, 0.99]
const waitEaseOut: Easing = [0.46, 0.04, 0.97, 0.44]

export const MOTION_PRESETS: Record<AnimationPreset | (string & {}), PresetDefinition> = {
    scale: {
        initial: { opacity: 0, scale: 0.6 },
        animate: { opacity: 1, scale: 1 },
        exit: { opacity: 0, scale: 0.8 },
        transition: { duration: 0.3, ease: defaultEase },
    },
    fade: {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: { duration: 0.25, ease: "easeInOut" },
    },
    "slide-up": {
        initial: { opacity: 0, y: 20 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -20 },
        transition: { duration: 0.3, ease: defaultEase },
    },
    "slide-down": {
        initial: { opacity: 0, y: -20 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: 20 },
        transition: { duration: 0.3, ease: defaultEase },
    },
    "slide-left": {
        initial: { opacity: 0, x: 20 },
        animate: { opacity: 1, x: 0 },
        exit: { opacity: 0, x: -20 },
        transition: { duration: 0.3, ease: defaultEase },
    },
    "slide-right": {
        initial: { opacity: 0, x: -20 },
        animate: { opacity: 1, x: 0 },
        exit: { opacity: 0, x: 20 },
        transition: { duration: 0.3, ease: defaultEase },
    },
    "scale-up": {
        initial: { opacity: 0, scale: 0.95 },
        animate: { opacity: 1, scale: 1 },
        exit: { opacity: 0, scale: 1.05 },
        transition: { duration: 0.3, ease: defaultEase },
    },
    zoom: {
        initial: { opacity: 0, scale: 0.5 },
        animate: { opacity: 1, scale: 1 },
        exit: { opacity: 0, scale: 0.5 },
        transition: { type: "spring", bounce: 0.25, duration: 0.4 },
    },
    blur: {
        initial: { opacity: 0, filter: "blur(8px)" },
        animate: { opacity: 1, filter: "blur(0px)" },
        exit: { opacity: 0, filter: "blur(8px)" },
        transition: { duration: 0.3, ease: defaultEase },
    },
    "flip-x": {
        initial: { opacity: 0, rotateX: 90 },
        animate: { opacity: 1, rotateX: 0 },
        exit: { opacity: 0, rotateX: -90 },
        transition: { duration: 0.4, ease: defaultEase },
    },
    "flip-y": {
        initial: { opacity: 0, rotateY: 90 },
        animate: { opacity: 1, rotateY: 0 },
        exit: { opacity: 0, rotateY: -90 },
        transition: { duration: 0.4, ease: defaultEase },
    },
}

export function registerMotionPreset(
    name: string,
    definition: PresetDefinition
): void {
    MOTION_PRESETS[name] = definition
}

export interface MotionAnimatePresenceProps
    extends Omit<HTMLMotionProps<"div">, "children" | "mode"> {
    children?: React.ReactNode
    mode?: AnimatePresenceMode
    preset?: AnimationPreset | (string & {})
    presetMap?: Record<string, PresetDefinition>
    infinite?: boolean
    show?: boolean
    duration?: number
    delay?: number
    contentKey?: React.Key
    viewportMargin?: UseInViewOptions["margin"]
    viewportAmount?: UseInViewOptions["amount"]
    wrapperClassName?: string
    wrapperStyle?: React.CSSProperties
}

export function MotionAnimatePresence({
    children,
    mode = "wait",
    preset = "scale",
    presetMap = MOTION_PRESETS,
    infinite = false,
    show = true,
    duration,
    delay,
    contentKey,
    viewportMargin = "0px",
    viewportAmount = "some",
    wrapperClassName,
    wrapperStyle,
    initial: customInitial,
    animate: customAnimate,
    exit: customExit,
    transition: customTransition,
    className,
    style,
    ...restProps
}: MotionAnimatePresenceProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const isInView = useInView(containerRef, {
        once: !infinite,
        margin: viewportMargin,
        amount: viewportAmount,
        initial: true,
    })

    const selectedPreset = presetMap[preset] || MOTION_PRESETS.scale

    const initial = customInitial ?? selectedPreset.initial
    const animateConfig = customAnimate ?? selectedPreset.animate
    const exit = customExit ?? selectedPreset.exit

    let transition: Transition = {
        ...selectedPreset.transition,
        ...customTransition,
    }

    if (duration !== undefined) {
        transition.duration = duration
    }

    if (delay !== undefined) {
        transition.delay = delay
    }

    if (mode === "wait" && transition && !customTransition && Array.isArray(transition.ease)) {
        transition = {
            ...transition,
            ease: waitEaseIn,
        }
    }

    const isVisible = show && (!infinite || isInView)

    const exitConfig =
        mode === "wait" &&
        selectedPreset.exit &&
        typeof exit === "object" &&
        exit !== null &&
        !Array.isArray(exit)
            ? {
                  ...exit,
                  transition: {
                      ...transition,
                      duration: transition.duration ?? 0.3,
                      ease: waitEaseOut,
                  },
              }
            : exit

    return (
        <div ref={containerRef} className={wrapperClassName} style={wrapperStyle}>
            <AnimatePresence mode={mode}>
                {isVisible && (
                    <motion.div
                        key={contentKey ?? (infinite ? `inf-${isInView}` : "presence-content")}
                        initial={initial}
                        animate={animateConfig}
                        exit={exitConfig}
                        transition={transition}
                        className={className}
                        style={style}
                        {...restProps}
                    >
                        {children}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}

export default MotionAnimatePresence
