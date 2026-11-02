import {
    ComposerPrimitive,
    QueueItemPrimitive,
    useAui,
    useAuiState,
} from "@assistant-ui/react";
import {
    ArrowTurnForwardIcon,
    ArrowUp02Icon,
    Cancel01Icon,
    MoreHorizontalIcon,
    PlayIcon,
    Playlist02Icon,
    StopIcon,
} from "@hugeicons/core-free-icons";
import { useEffect, useState } from "react";
import Icon from "@/components/icon";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";

/** The runtime owns draft, queue and cancellation; this surface selects the corresponding primary action. */
export function ConversationComposerActions({
    actionLabel,
    onResumeQueue,
    onSendCommand,
}: {
    actionLabel?: string;
    onResumeQueue?: () => void;
    onSendCommand?: () => boolean;
}) {
    const aui = useAui();
    const running = useAuiState((s) => s.thread.isRunning);
    const cancel = useAuiState((s) => s.thread.capabilities.cancel);
    const queue = useAuiState((s) => s.thread.capabilities.queue);
    const text = useAuiState((s) => s.composer.text);
    const canSend = useAuiState((s) => s.composer.canSend);
    const [alternate, setAlternate] = useState(false);
    const [optionsOpen, setOptionsOpen] = useState(false);
    useEffect(() => {
        const modifiers = (event: KeyboardEvent) =>
            setAlternate(event.ctrlKey || event.metaKey);
        const reset = () => setAlternate(false);
        window.addEventListener("keydown", modifiers);
        window.addEventListener("keyup", modifiers);
        window.addEventListener("blur", reset);
        return () => {
            window.removeEventListener("keydown", modifiers);
            window.removeEventListener("keyup", modifiers);
            window.removeEventListener("blur", reset);
        };
    }, []);
    const stop = running && cancel && !text.trim() && !actionLabel;
    const resume = !running && !text.trim() && onResumeQueue;
    const dispatch = (steer: boolean) => {
        setOptionsOpen(false);
        if (onSendCommand?.()) return;
        aui.composer().send({ steer });
    };
    const label = stop
        ? "Stop generation"
        : resume
          ? "Resume queue"
          : (actionLabel ??
            (running && queue
                ? alternate
                    ? "Steer message"
                    : "Queue message"
                : "Send refinement"));
    return (
        <div className="chat-primary-actions">
            {running && queue && text.trim() && !actionLabel && (
                <DropdownMenu open={optionsOpen} onOpenChange={setOptionsOpen}>
                    <DropdownMenuTrigger
                        render={<Button variant="ghost" size="icon-xs" />}
                        aria-label="Message delivery options">
                        <Icon iconNode={MoreHorizontalIcon} size={16} />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        align="end"
                        side="top"
                        className="chat-delivery-options">
                        <DropdownMenuItem onClick={() => dispatch(false)}>
                            Queue message
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => dispatch(true)}>
                            Steer message
                        </DropdownMenuItem>
                        {cancel && (
                            <DropdownMenuItem
                                onClick={() => {
                                    setOptionsOpen(false);
                                    aui.thread().cancelRun();
                                }}>
                                Stop generation
                            </DropdownMenuItem>
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>
            )}
            <Tooltip>
                <TooltipTrigger
                    render={
                        <Button
                            type="button"
                            variant="round"
                            size="icon"
                            data-slot="prompt-composer-submit"
                            className={stop ? "chat-stop-control" : undefined}
                            aria-label={label}
                            disabled={!stop && !resume && !canSend}
                            onClick={(event) => {
                                if (stop) aui.thread().cancelRun();
                                else if (resume) onResumeQueue?.();
                                else
                                    dispatch(
                                        !actionLabel &&
                                            (event.ctrlKey || event.metaKey),
                                    );
                            }}
                        />
                    }>
                    {stop ? (
                        <Icon
                            iconNode={StopIcon}
                            size={12}
                            className="chat-stop-glyph"
                        />
                    ) : resume ? (
                        <Icon iconNode={PlayIcon} size={16} />
                    ) : (
                        (actionLabel ?? (
                            <Icon
                                iconNode={
                                    running && queue
                                        ? alternate
                                            ? ArrowTurnForwardIcon
                                            : Playlist02Icon
                                        : ArrowUp02Icon
                                }
                                size={16}
                            />
                        ))
                    )}
                </TooltipTrigger>
                <TooltipContent>
                    {stop
                        ? "Interrupt"
                        : running && queue
                          ? "Queue message · Ctrl/Cmd-click or Ctrl/Cmd+Enter to steer"
                          : label}
                </TooltipContent>
            </Tooltip>
        </div>
    );
}

/** Displays the runtime's pending instructions above the field without adding duplicate transcript messages. */
export function ConversationQueue() {
    const count = useAuiState((s) => s.composer.queue.length);
    const running = useAuiState((s) => s.thread.isRunning);
    if (!count) return null;
    return (
        <section className="chat-message-queue" aria-label="Queued messages">
            <p>
                {count} {count === 1 ? "message" : "messages"} queued
            </p>
            <ScrollArea
                className="chat-queued-items"
                viewportClassName="chat-queued-viewport"
                viewportProps={{
                    role: "region",
                    "aria-label": "Pending messages",
                    tabIndex: 0,
                }}>
                <ComposerPrimitive.Queue>
                    {({ queueItem }) => (
                        <div className="chat-queued-message">
                            <span>
                                <QueueItemPrimitive.Text />
                            </span>
                            {running && (
                                <QueueItemPrimitive.Steer
                                    render={
                                        <Button
                                            variant="ghost"
                                            size="icon-xs"
                                        />
                                    }
                                    aria-label={`Steer: ${queueItem.prompt}`}
                                    title="Steer">
                                    <Icon
                                        iconNode={ArrowTurnForwardIcon}
                                        size={14}
                                    />
                                </QueueItemPrimitive.Steer>
                            )}
                            <QueueItemPrimitive.Remove
                                render={
                                    <Button variant="ghost" size="icon-xs" />
                                }
                                aria-label={`Remove queued message: ${queueItem.prompt}`}
                                title="Remove">
                                <Icon iconNode={Cancel01Icon} size={14} />
                            </QueueItemPrimitive.Remove>
                        </div>
                    )}
                </ComposerPrimitive.Queue>
            </ScrollArea>
        </section>
    );
}
