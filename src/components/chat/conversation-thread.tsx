// Project composition around assistant-ui conversation behavior.
"use client";

import {
    type AssistantRuntime,
    AssistantRuntimeProvider,
    ThreadPrimitive,
} from "@assistant-ui/react";
import { ArrowDown02Icon } from "@hugeicons/core-free-icons";
import { useReducedMotion } from "motion/react";
import {
    type ComponentProps,
    createContext,
    type ReactNode,
    useContext,
    useLayoutEffect,
    useRef,
    useState,
} from "react";
import Icon from "@/components/icon";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export const CONVERSATION_THREAD_VARIANTS = [
    "chat",
    "document",
    "compact",
] as const;
export type ConversationThreadVariant =
    (typeof CONVERSATION_THREAD_VARIANTS)[number];
export type ConversationThreadProps = ComponentProps<"section"> & {
    variant?: ConversationThreadVariant;
    runtime: AssistantRuntime;
    header?: ReactNode;
};

type ThreadContext = { variant: ConversationThreadVariant };
const Context = createContext<ThreadContext | null>(null);
const SCROLL_END_TOLERANCE_PX = 40;
const SCROLL_JUMP_REVEAL_DELAY_MS = 150;
function useThread(part: string) {
    const context = useContext(Context);
    if (!context)
        throw new Error(`${part} must be used within ConversationThread`);
    return context;
}

/** A conversation column with a scrollable log and a separately anchored composer. */
export function ConversationThread({
    variant = "chat",
    runtime,
    header,
    children,
    className,
    ...props
}: ConversationThreadProps) {
    return (
        <AssistantRuntimeProvider runtime={runtime}>
            <TooltipProvider>
                <Context.Provider value={{ variant }}>
                    <section
                        aria-label="Conversation"
                        data-slot="conversation-thread"
                        data-variant={variant}
                        className={cn(
                            "relative box-border @container flex min-h-0 flex-1 flex-col min-w-0 text-[13px]/[18px] text-foreground",
                            className,
                        )}
                        {...props}>
                        {header}
                        <div
                            data-slot="conversation-thread-body"
                            className={cn(
                                "flex min-h-0 flex-1 flex-col",
                                variant === "compact" ? "gap-3" : "gap-4",
                            )}>
                            {children}
                        </div>
                    </section>
                </Context.Provider>
            </TooltipProvider>
        </AssistantRuntimeProvider>
    );
}

/** Measures the composer and its pending artifact so the transcript can leave room for both. Positioning belongs to the consumer. */
export function ConversationThreadDock({
    className,
    ...props
}: ComponentProps<"div">) {
    useThread("ConversationThreadDock");
    const ref = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        const dock = ref.current;
        const host = dock?.closest<HTMLElement>(
            '[data-slot="conversation-thread"]',
        );
        if (!dock || !host) return;
        const measure = () =>
            host.style.setProperty(
                "--conversation-dock-height",
                `${dock.getBoundingClientRect().height}px`,
            );
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(dock);
        return () => {
            observer.disconnect();
            host.style.removeProperty("--conversation-dock-height");
        };
    }, []);
    return (
        <div
            {...props}
            ref={ref}
            className={className}
            data-slot="conversation-thread-dock"
        />
    );
}

/** Follows growing replies until the reader scrolls away; an explicit control returns to the latest turn. */
export function ConversationThreadLog({
    className,
    children,
    ...props
}: Omit<ComponentProps<"div">, "ref">) {
    const { variant } = useThread("ConversationThreadLog");
    const reduceMotion = useReducedMotion();
    const viewportRef = useRef<HTMLDivElement>(null);
    const [showJump, setShowJump] = useState(false);
    useLayoutEffect(() => {
        const viewport = viewportRef.current;
        const content = viewport?.firstElementChild;
        if (!viewport || !content) return;
        let revealTimeout: ReturnType<typeof setTimeout> | undefined;
        let revealed = false;
        const awayFromEnd = () =>
            viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop >
            SCROLL_END_TOLERANCE_PX;
        const measure = () => {
            if (!awayFromEnd()) {
                clearTimeout(revealTimeout);
                revealTimeout = undefined;
                revealed = false;
                setShowJump(false);
            } else if (!revealed && revealTimeout === undefined) {
                revealTimeout = setTimeout(() => {
                    revealTimeout = undefined;
                    if (!awayFromEnd()) return;
                    revealed = true;
                    setShowJump(true);
                }, SCROLL_JUMP_REVEAL_DELAY_MS);
            }
        };
        viewport.addEventListener("scroll", measure, { passive: true });
        const observer = new ResizeObserver(measure);
        observer.observe(viewport);
        observer.observe(content);
        measure();
        return () => {
            clearTimeout(revealTimeout);
            viewport.removeEventListener("scroll", measure);
            observer.disconnect();
        };
    }, []);
    return (
        <ThreadPrimitive.ViewportProvider>
            <div
                data-slot="conversation-scroll"
                className="relative flex min-h-0 min-w-0 flex-1 flex-col">
                <ThreadPrimitive.Viewport
                    {...props}
                    ref={viewportRef}
                    render={<section />}
                    aria-label="Conversation scroll area"
                    tabIndex={0}
                    data-slot="conversation-thread-log"
                    scrollToBottomOnRunStart={false}
                    scrollToBottomOnInitialize={false}
                    className={cn(
                        "min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain",
                        className,
                    )}>
                    <div data-slot="conversation-scroll-content">
                        <div
                            role="log"
                            aria-live="polite"
                            aria-relevant="additions"
                            aria-label="Conversation"
                            data-slot="conversation-thread-content"
                            className={cn(
                                "flex min-w-0 flex-col",
                                variant === "compact"
                                    ? "gap-3 px-0.5 py-1"
                                    : "gap-5 px-1 pt-1 pb-2",
                            )}>
                            {children}
                        </div>
                    </div>
                </ThreadPrimitive.Viewport>
                {showJump && (
                    <ThreadPrimitive.ScrollToBottom
                        render={<Button variant="outline" size="icon-sm" />}
                        data-slot="conversation-jump-to-latest"
                        aria-label="Jump to latest"
                        behavior={reduceMotion ? "instant" : "smooth"}
                        className="absolute left-1/2 -translate-x-1/2 rounded-full disabled:hidden"
                        style={{
                            bottom: "calc(var(--conversation-dock-height, 0px) + var(--conversation-jump-gap, 40px))",
                        }}>
                        <Icon iconNode={ArrowDown02Icon} size={16} />
                    </ThreadPrimitive.ScrollToBottom>
                )}
            </div>
        </ThreadPrimitive.ViewportProvider>
    );
}
