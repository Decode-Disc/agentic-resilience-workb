// Adapted from https://uaiblocks.dev/r/conversation-thread.json; START uses one column.
"use client";

import { ArrowDown02Icon } from "@hugeicons/core-free-icons";
import {
    type ComponentProps,
    createContext,
    useContext,
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState,
} from "react";
import Icon from "@/components/icon";

import { Button } from "@/components/ui/button";
import {
    Message,
    type MessageProps,
    type MessageVariant,
} from "@/components/ui/uai/message";
import {
    PromptComposer,
    type PromptComposerProps,
    type PromptComposerVariant,
} from "@/components/ui/uai/prompt-composer";
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
};

type ThreadContext = { id: string; variant: ConversationThreadVariant };
const Context = createContext<ThreadContext | null>(null);
function useThread(part: string) {
    const context = useContext(Context);
    if (!context)
        throw new Error(`${part} must be used within ConversationThread`);
    return context;
}

const messageVariants: Record<ConversationThreadVariant, MessageVariant> = {
    chat: "bubble",
    document: "plain",
    compact: "compact",
};
const composerVariants: Record<
    ConversationThreadVariant,
    PromptComposerVariant
> = {
    chat: "rounded",
    document: "rounded",
    compact: "compact",
};

/** A conversation column with a scrollable log and a separately anchored composer. */
export function ConversationThread({
    variant = "chat",
    children,
    className,
    ...props
}: ConversationThreadProps) {
    const id = useId();
    return (
        <Context.Provider value={{ id, variant }}>
            <section
                aria-label="Conversation"
                data-slot="conversation-thread"
                data-variant={variant}
                className={cn(
                    "relative box-border @container flex min-h-0 flex-1 flex-col min-w-0 text-[13px]/[18px] text-foreground",
                    className,
                )}
                {...props}>
                <div
                    className={cn(
                        "flex min-h-0 flex-1 flex-col",
                        variant === "compact" ? "gap-3" : "gap-4",
                    )}>
                    {children}
                </div>
            </section>
        </Context.Provider>
    );
}

export function ConversationThreadHeader({
    className,
    ...props
}: ComponentProps<"header">) {
    useThread("ConversationThreadHeader");
    return (
        <header
            data-slot="conversation-thread-header"
            className={cn(
                "grid min-w-0 gap-1 @min-[760px]:col-span-full",
                className,
            )}
            {...props}
        />
    );
}

export function ConversationThreadTitle({
    className,
    ...props
}: ComponentProps<"h2">) {
    const { id, variant } = useThread("ConversationThreadTitle");
    return (
        <h2
            data-slot="conversation-thread-title"
            className={cn(
                "m-0 font-semibold tracking-[-0.01em] wrap-anywhere",
                variant === "compact" ? "text-[15px]/5" : "text-lg/6",
                className,
            )}
            {...props}
            id={`${id}-title`}
        />
    );
}

export function ConversationThreadDescription({
    className,
    ...props
}: ComponentProps<"p">) {
    return (
        <p
            data-slot="conversation-thread-description"
            className={cn("m-0 text-pretty text-muted-foreground", className)}
            {...props}
        />
    );
}

/** The conversation column: the log, the response status, and the composer. */
export function ConversationThreadMain({
    className,
    ...props
}: ComponentProps<"div">) {
    const { variant } = useThread("ConversationThreadMain");
    return (
        <div
            data-slot="conversation-thread-main"
            className={cn(
                "grid min-w-0 content-start",
                variant === "compact" ? "gap-2" : "gap-3",
                className,
            )}
            {...props}
        />
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
    onScroll,
    className,
    children,
    ...props
}: ComponentProps<"section">) {
    const { variant } = useThread("ConversationThreadLog");
    const viewportRef = useRef<HTMLElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const following = useRef(true);
    const gliding = useRef(false);
    const [atLatest, setAtLatest] = useState(true);
    const follow = () => {
        const node = viewportRef.current;
        if (node && following.current && !gliding.current)
            node.scrollTop = node.scrollHeight;
    };
    useLayoutEffect(follow);
    useEffect(() => {
        const viewport = viewportRef.current;
        const content = contentRef.current;
        if (!viewport || !content) return;
        const observer = new ResizeObserver(() => {
            if (following.current && !gliding.current)
                viewport.scrollTop = viewport.scrollHeight;
            setAtLatest(
                viewport.scrollHeight -
                    viewport.scrollTop -
                    viewport.clientHeight <
                    32,
            );
        });
        observer.observe(content);
        observer.observe(viewport);
        const settle = () => {
            gliding.current = false;
        };
        viewport.addEventListener("scrollend", settle);
        return () => {
            observer.disconnect();
            viewport.removeEventListener("scrollend", settle);
        };
    }, []);
    const stopFollowing = () => {
        following.current = false;
        gliding.current = false;
    };
    return (
        <div
            data-slot="conversation-scroll"
            className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            <section
                {...props}
                ref={viewportRef}
                aria-label="Conversation scroll area"
                // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users must be able to scroll the transcript.
                tabIndex={0}
                data-slot="conversation-thread-log"
                className={cn(
                    "min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain",
                    className,
                )}
                onWheel={(event) => {
                    if (event.deltaY < 0) stopFollowing();
                    props.onWheel?.(event);
                }}
                onTouchStart={(event) => {
                    stopFollowing();
                    props.onTouchStart?.(event);
                }}
                onPointerDownCapture={(event) => {
                    if (
                        (event.target as HTMLElement).closest(
                            "button, summary, a, input, textarea",
                        )
                    )
                        stopFollowing();
                    props.onPointerDownCapture?.(event);
                }}
                onKeyDown={(event) => {
                    if (["ArrowUp", "PageUp", "Home"].includes(event.key))
                        stopFollowing();
                    if (
                        ["Enter", " "].includes(event.key) &&
                        (event.target as HTMLElement).closest(
                            "button, summary, a",
                        )
                    )
                        stopFollowing();
                    props.onKeyDown?.(event);
                }}
                onScroll={(event) => {
                    onScroll?.(event);
                    const node = event.currentTarget;
                    const latest =
                        node.scrollHeight - node.scrollTop - node.clientHeight <
                        32;
                    if (!gliding.current) following.current = latest;
                    setAtLatest(latest);
                }}>
                <div ref={contentRef} data-slot="conversation-scroll-content">
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
            </section>
            {!atLatest && (
                <Button
                    variant="outline"
                    size="icon"
                    aria-label="Jump to latest"
                    className="absolute left-1/2 -translate-x-1/2 rounded-full shadow-sm"
                    style={{
                        bottom: "calc(var(--conversation-dock-height, 0px) + 40px)",
                    }}
                    onClick={() => {
                        const node = viewportRef.current;
                        if (!node) return;
                        following.current = true;
                        const reduce = window.matchMedia(
                            "(prefers-reduced-motion: reduce)",
                        ).matches;
                        gliding.current = !reduce;
                        node.scrollTo({
                            top: node.scrollHeight,
                            behavior: reduce ? "instant" : "smooth",
                        });
                    }}>
                    <Icon iconNode={ArrowDown02Icon} size={16} />
                </Button>
            )}
        </div>
    );
}

export type ConversationThreadMessageProps = Omit<MessageProps, "variant">;

/** One turn in the conversation. Compose Message parts inside it. */
export function ConversationThreadMessage(
    props: ConversationThreadMessageProps,
) {
    const { variant } = useThread("ConversationThreadMessage");
    return <Message {...props} variant={messageVariants[variant]} />;
}

/** The prompt form. Compose Prompt Composer parts inside it. */
export function ConversationThreadComposer(
    props: Omit<PromptComposerProps, "variant">,
) {
    const { variant } = useThread("ConversationThreadComposer");
    return <PromptComposer {...props} variant={composerVariants[variant]} />;
}
