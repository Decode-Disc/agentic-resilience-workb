// Adapted from https://uaiblocks.dev/r/message.json for the project primitives and tokens.

import {
    Copy01Icon,
    InformationCircleIcon,
    Tick02Icon,
    UserIcon,
    Wrench01Icon,
} from "@hugeicons/core-free-icons";
import Icon from "@/components/icon";

("use client");

import { cva } from "class-variance-authority";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import {
    type ComponentProps,
    createContext,
    type ReactNode,
    useContext,
    useEffect,
    useId,
    useRef,
    useState,
} from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const MESSAGE_VARIANTS = ["bubble", "plain", "compact"] as const;
export const MESSAGE_ROLES = ["user", "assistant", "system", "tool"] as const;
export type MessageVariant = (typeof MESSAGE_VARIANTS)[number];
export type MessageRole = (typeof MESSAGE_ROLES)[number];
export type MessageProps = ComponentProps<"article"> & {
    variant?: MessageVariant;
    /** Technical role used for alignment and message treatment. */
    from?: MessageRole;
    /** Human-readable identity, independent of the technical message role. */
    authorName?: string;
    /** Marks the message as still receiving content. */
    streaming?: boolean;
};

type MessageContextValue = {
    id: string;
    role: MessageRole;
    authorName: string;
    variant: MessageVariant;
    streaming: boolean;
    contentRef: React.RefObject<HTMLDivElement | null>;
};

const MessageContext = createContext<MessageContextValue | null>(null);

function useMessage(part: string) {
    const context = useContext(MessageContext);
    if (!context) throw new Error(`${part} must be used within Message`);
    return context;
}

const roleDetails: Record<
    MessageRole,
    { label: string; icon: typeof UserIcon }
> = {
    user: { label: "You", icon: UserIcon },
    assistant: { label: "Assistant", icon: InformationCircleIcon },
    system: { label: "System", icon: InformationCircleIcon },
    tool: { label: "Tool", icon: Wrench01Icon },
};

function prefersReducedMotion() {
    return (
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
}

const messageVariants = cva(
    "flex min-w-0 animate-in items-start fade-in-0 slide-in-from-bottom-1 text-[13px]/[18px] text-foreground duration-240 ease-out motion-reduce:animate-none",
    {
        variants: {
            variant: { bubble: "gap-3", plain: "gap-3", compact: "gap-2" },
            alignEnd: { true: "flex-row-reverse", false: "flex-row" },
        },
    },
);

export function Message({
    variant = "bubble",
    from: role = "assistant",
    authorName = roleDetails[role].label,
    streaming = false,
    className,
    children,
    "aria-label": ariaLabel,
    ...props
}: MessageProps) {
    const id = useId();
    const contentRef = useRef<HTMLDivElement>(null);
    const alignEnd = variant === "bubble" && role === "user";
    return (
        <MessageContext.Provider
            value={{ id, role, authorName, variant, streaming, contentRef }}>
            <article
                data-slot="message"
                aria-label={ariaLabel ?? `${authorName} message`}
                className={cn(
                    messageVariants({ variant, alignEnd }),
                    className,
                )}
                {...props}
                aria-busy={streaming || undefined}
                data-variant={variant}
                data-role={role}
                data-streaming={streaming || undefined}>
                {children}
            </article>
        </MessageContext.Provider>
    );
}

export function MessageAvatar({
    children,
    className,
    ...props
}: ComponentProps<"span">) {
    const context = useMessage("MessageAvatar");
    const avatarIcon = roleDetails[context.role].icon;
    const compact = context.variant === "compact";
    return (
        <span
            data-slot="message-avatar"
            aria-hidden="true"
            className={cn(
                "grid flex-none place-items-center overflow-hidden rounded-full font-medium tracking-[0.01em] ring-1 ring-foreground/8",
                compact ? "size-6 text-[10px]" : "size-7 text-[10.5px]",
                context.role === "assistant"
                    ? "bg-[color-mix(in_oklab,var(--primary)_18%,var(--card))] text-brand-purple"
                    : "bg-muted text-muted-foreground",
                className,
            )}
            {...props}>
            {children ?? (
                <Icon
                    iconNode={avatarIcon}
                    size={compact ? 12 : 14}
                    strokeWidth={1.8}
                />
            )}
        </span>
    );
}

export function MessageBody({ className, ...props }: ComponentProps<"div">) {
    const context = useMessage("MessageBody");
    const alignEnd = context.variant === "bubble" && context.role === "user";
    return (
        <div
            data-slot="message-body"
            className={cn(
                "grid min-w-0 flex-auto",
                alignEnd ? "justify-items-end" : "justify-items-start",
                context.variant === "compact" ? "gap-1" : "gap-1.5",
                className,
            )}
            {...props}
        />
    );
}

export function MessageHeader({ className, ...props }: ComponentProps<"div">) {
    useMessage("MessageHeader");
    return (
        <div
            data-slot="message-header"
            className={cn(
                "flex min-w-0 flex-wrap items-baseline gap-1.5 leading-[18px]",
                className,
            )}
            {...props}
        />
    );
}

export function MessageAuthor({
    children,
    className,
    ...props
}: ComponentProps<"span">) {
    const context = useMessage("MessageAuthor");
    return (
        <span
            data-slot="message-author"
            className={cn("text-[12.5px] font-medium", className)}
            {...props}>
            {children ?? context.authorName}
        </span>
    );
}

export function MessageTime({ className, ...props }: ComponentProps<"time">) {
    return (
        <time
            data-slot="message-time"
            className={cn(
                "text-[11.5px] text-muted-foreground tabular-nums",
                className,
            )}
            {...props}
        />
    );
}

function StreamingCaret() {
    const ref = useRef<HTMLSpanElement>(null);
    useEffect(() => {
        if (prefersReducedMotion()) return;
        const animation = ref.current?.animate?.(
            [{ opacity: 1 }, { opacity: 0.2 }, { opacity: 1 }],
            {
                duration: 1000,
                iterations: Number.POSITIVE_INFINITY,
                easing: "ease-in-out",
            },
        );
        return () => animation?.cancel();
    }, []);
    return (
        <span
            ref={ref}
            aria-hidden="true"
            data-message-caret=""
            className="ml-0.5 inline-block h-[15px] w-0.5 rounded-[1px] bg-foreground align-[-3px]"
        />
    );
}

export function MessageContent({
    children,
    className,
    ...props
}: ComponentProps<"div">) {
    const context = useMessage("MessageContent");
    const { role, variant } = context;
    const compact = variant === "compact";
    const bubble = variant !== "plain" && role === "user";
    const tool = role === "tool";
    const system = role === "system";
    return (
        <div
            data-slot="message-content"
            className={cn(
                "max-w-full min-w-0 border-0 text-pretty wrap-anywhere",
                bubble || tool
                    ? compact
                        ? "px-2.5 py-1.5"
                        : "px-3 py-2"
                    : "p-0",
                tool
                    ? compact
                        ? "rounded-lg"
                        : "rounded-[10px]"
                    : compact
                      ? "rounded-xl"
                      : "rounded-2xl",
                bubble ? "bg-muted" : tool ? "bg-muted/55" : "bg-transparent",
                system
                    ? "text-muted-foreground"
                    : tool
                      ? "text-muted-foreground"
                      : "text-foreground",
                tool && "font-mono",
                tool || system
                    ? "text-[12px]/[17px]"
                    : compact
                      ? "text-[12.5px]/[18px]"
                      : "text-[13px]/5",
                className,
            )}
            {...props}
            ref={context.contentRef}
            id={`${context.id}-content`}>
            {children}
            {context.streaming ? <StreamingCaret /> : null}
        </div>
    );
}

export function MessageActions({ className, ...props }: ComponentProps<"div">) {
    const context = useMessage("MessageActions");
    if (context.streaming) return null;
    return (
        <div
            data-slot="message-actions"
            role="group"
            aria-label="Message actions"
            className={cn(
                "-mt-0.5 flex animate-in flex-wrap items-center gap-0 duration-200 ease-out fade-in-0 motion-reduce:animate-none",
                context.variant === "bubble" && context.role === "user"
                    ? "ml-0"
                    : "-ml-1.5",
                className,
            )}
            {...props}
        />
    );
}

/** Shares copy and creation metadata across supplied messages and runtime-backed history. */
export function MessageFooter({
    createdAt,
    text,
}: {
    createdAt?: Date | string;
    text?: string;
}) {
    const date =
        typeof createdAt === "string" ? new Date(createdAt) : createdAt;
    const valid = date && Number.isFinite(date.getTime());
    let label = "Time not recorded";
    if (valid) {
        const now = new Date();
        const calendarDay = (value: Date) =>
            Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
        const days = (calendarDay(now) - calendarDay(date)) / 86_400_000;
        const time = date.toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
        });
        const day =
            days === 0
                ? ""
                : days === 1
                  ? "Yesterday"
                  : days > 1 && days < 7
                    ? date.toLocaleDateString("en-GB", { weekday: "long" })
                    : date.toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                      });
        label = [day, time].filter(Boolean).join(" ");
    }
    return (
        <MessageActions className="chat-message-footer">
            {valid ? (
                <MessageTime
                    dateTime={date.toISOString()}
                    title={date.toLocaleString("en-GB", {
                        weekday: "long",
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        hourCycle: "h23",
                    })}>
                    {label}
                </MessageTime>
            ) : (
                <span data-slot="message-time">{label}</span>
            )}
            <MessageCopy text={text} />
        </MessageActions>
    );
}

const messageActionVariants = cva(
    "cursor-pointer rounded-lg p-0 text-muted-foreground [transition:background-color_120ms_ease-out,color_120ms_ease-out,scale_140ms_cubic-bezier(0.23,1,0.32,1)] hover:bg-accent hover:text-accent-foreground focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-1 focus-visible:outline-ring active:scale-[0.94] motion-reduce:transition-none motion-reduce:active:scale-100 dark:hover:bg-accent [&_svg:not([class*='size-'])]:size-3.5",
    {
        variants: {
            variant: { bubble: "size-7", plain: "size-7", compact: "size-6" },
        },
    },
);

export type MessageActionProps = ComponentProps<"button"> & {
    /** Accessible name for the icon-only action. */
    label: string;
};

export function MessageAction({
    label,
    className,
    ...props
}: MessageActionProps) {
    const context = useMessage("MessageAction");
    return (
        <Button
            data-slot="message-action"
            type="button"
            variant="ghost"
            size="icon"
            aria-label={label}
            title={label}
            className={cn(
                messageActionVariants({ variant: context.variant }),
                className,
            )}
            {...props}
        />
    );
}

export type MessageCopyProps = Omit<ComponentProps<"button">, "children"> & {
    /** Text to copy. Defaults to the text of MessageContent. */
    text?: string;
    onCopied?: (text: string) => void;
    children?: ReactNode;
};

export function MessageCopy({
    text,
    onCopied,
    onClick,
    children,
    className,
    ...props
}: MessageCopyProps) {
    const context = useMessage("MessageCopy");
    const [copied, setCopied] = useState(false);
    const [failed, setFailed] = useState(false);
    const reduceMotion = useReducedMotion();
    useEffect(() => {
        if (!copied) return;
        const timeout = window.setTimeout(() => setCopied(false), 1600);
        return () => window.clearTimeout(timeout);
    }, [copied]);
    return (
        <>
            <Button
                data-slot="message-copy"
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Copy message"
                title={copied ? "Copied" : "Copy message"}
                data-copied={copied || undefined}
                className={cn(
                    messageActionVariants({ variant: context.variant }),
                    className,
                )}
                {...props}
                onClick={async (event) => {
                    onClick?.(event);
                    if (event.defaultPrevented) return;
                    const value =
                        text ?? context.contentRef.current?.textContent ?? "";
                    setFailed(false);
                    try {
                        if (!navigator.clipboard?.writeText)
                            throw new Error("Clipboard unavailable");
                        await navigator.clipboard.writeText(value);
                    } catch {
                        setCopied(false);
                        setFailed(true);
                        return;
                    }
                    setCopied(true);
                    onCopied?.(value);
                }}>
                <AnimatePresence initial={false} mode="wait">
                    <motion.span
                        key={copied ? "copied" : "copy"}
                        initial={
                            reduceMotion
                                ? false
                                : {
                                      opacity: 0,
                                      scale: 0.7,
                                      filter: "blur(2px)",
                                  }
                        }
                        animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                        exit={
                            reduceMotion
                                ? { opacity: 0 }
                                : {
                                      opacity: 0,
                                      scale: 0.7,
                                      filter: "blur(2px)",
                                  }
                        }
                        transition={{
                            duration: reduceMotion ? 0 : 0.12,
                            ease: [0.16, 1, 0.3, 1],
                        }}
                        className="grid place-items-center">
                        {copied ? (
                            <Icon
                                iconNode={Tick02Icon}
                                size={14}
                                aria-hidden="true"
                            />
                        ) : (
                            (children ?? (
                                <Icon
                                    iconNode={Copy01Icon}
                                    size={14}
                                    aria-hidden="true"
                                />
                            ))
                        )}
                    </motion.span>
                </AnimatePresence>
            </Button>
            <span role="status" className="sr-only">
                {copied ? "Copied to clipboard" : ""}
            </span>
            {failed && (
                <span role="alert" data-slot="message-copy-error">
                    Could not copy. Select the message text to copy it manually.
                </span>
            )}
        </>
    );
}
