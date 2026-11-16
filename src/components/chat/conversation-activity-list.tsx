import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import {
    createContext,
    type ReactElement,
    useCallback,
    useContext,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { ScrollArea } from "@/components/ui/scroll-area";

/** Pauses DOM observation while the containing disclosure is hidden, retaining measured sizes and reading position. */
export const ConversationActivityVisibility = createContext(true);

const ESTIMATED_ACTIVITY_HEIGHT = 48;
const UNVIRTUALIZED_ACTIVITY_COUNT = 6;

/** A continuous activity reader. Stable child keys preserve the inspected entry as the live window changes; the virtualizer owns measurement and conditional end-following. */
export function ConversationActivityList({
    children,
}: {
    children: readonly (ReactElement | null)[];
}) {
    const entries = useMemo(
        () => children.filter((entry): entry is ReactElement => entry !== null),
        [children],
    );
    const open = useContext(ConversationActivityVisibility);
    const followEnd = useRef(true);
    const viewport = useRef<HTMLDivElement>(null);
    const [focusedKey, setFocusedKey] = useState<ReactElement["key"]>(null);
    const virtualized = entries.length > UNVIRTUALIZED_ACTIVITY_COUNT;
    const getItemKey = useCallback(
        (index: number) => entries[index]?.key ?? index,
        [entries],
    );
    const virtualizer = useVirtualizer({
        count: entries.length,
        getScrollElement: () => (open ? viewport.current : null),
        getItemKey,
        estimateSize: () => ESTIMATED_ACTIVITY_HEIGHT,
        overscan: 2,
        useAnimationFrameWithResizeObserver: true,
        enabled: virtualized,
        anchorTo: "end",
        followOnAppend: "auto",
        scrollEndThreshold: 1,
        initialOffset: () => entries.length * ESTIMATED_ACTIVITY_HEIGHT,
        rangeExtractor: (range) => {
            const visible = defaultRangeExtractor(range);
            const focused =
                focusedKey === null
                    ? -1
                    : entries.findIndex((entry) => entry.key === focusedKey);
            return focused < 0 || visible.includes(focused)
                ? visible
                : [...visible, focused].sort((a, b) => a - b);
        },
    });
    useLayoutEffect(() => {
        const element = viewport.current;
        if (!element || !open) return;
        const initialize = () => {
            if (followEnd.current && element.clientHeight > 0) {
                if (virtualized) virtualizer.scrollToEnd();
                else element.scrollTop = element.scrollHeight;
            }
        };
        initialize();
        const observer = new ResizeObserver(initialize);
        observer.observe(element);
        return () => observer.disconnect();
    }, [open, virtualized, virtualizer]);
    if (entries.length === 0) return null;
    return (
        <ScrollArea
            className="chat-activity-list"
            viewportRef={viewport}
            viewportClassName="chat-activity-viewport"
            onViewportScroll={(state) => {
                if (open && state.clientHeight > 0)
                    followEnd.current =
                        state.scrollHeight -
                            state.scrollTop -
                            state.clientHeight <=
                        1;
            }}
            viewportProps={{
                role: "region",
                "aria-label": "Agent activities",
                tabIndex: 0,
                onKeyDown: (event) => {
                    if (
                        event.target !== event.currentTarget ||
                        event.altKey ||
                        event.ctrlKey ||
                        event.metaKey ||
                        event.shiftKey
                    )
                        return;
                    if (event.key !== "Home" && event.key !== "End") return;
                    event.preventDefault();
                    if (virtualized) {
                        if (event.key === "End") virtualizer.scrollToEnd();
                        else virtualizer.scrollToIndex(0, { align: "start" });
                    } else
                        event.currentTarget.scrollTop =
                            event.key === "Home"
                                ? 0
                                : event.currentTarget.scrollHeight;
                },
            }}>
            <div
                className="chat-activity-items"
                style={
                    virtualized
                        ? {
                              height: virtualizer.getTotalSize(),
                              position: "relative",
                          }
                        : undefined
                }>
                {virtualized
                    ? virtualizer.getVirtualItems().map((item) => (
                          <div
                              key={item.key}
                              data-index={item.index}
                              ref={virtualizer.measureElement}
                              onFocusCapture={() =>
                                  setFocusedKey(
                                      entries[item.index]?.key ?? null,
                                  )
                              }
                              onBlurCapture={(event) => {
                                  if (
                                      !event.currentTarget.contains(
                                          event.relatedTarget,
                                      )
                                  )
                                      setFocusedKey(null);
                              }}
                              className="chat-activity-item"
                              style={{
                                  position: "absolute",
                                  top: 0,
                                  left: 0,
                                  width: "100%",
                                  transform: `translateY(${item.start}px)`,
                              }}>
                              {entries[item.index]}
                          </div>
                      ))
                    : entries}
            </div>
        </ScrollArea>
    );
}
