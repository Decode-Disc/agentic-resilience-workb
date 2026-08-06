import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
import * as React from "react";

import { cn } from "@/lib/utils";

export type ScrollAreaViewportState = {
    scrollLeft: number;
    scrollTop: number;
    scrollWidth: number;
    scrollHeight: number;
    clientWidth: number;
    clientHeight: number;
    canScrollLeft: boolean;
    canScrollRight: boolean;
    canScrollUp: boolean;
    canScrollDown: boolean;
};

const SCROLL_EDGE_TOLERANCE = 1;

function assignRef<T>(ref: React.Ref<T> | undefined, value: T): void {
    if (!ref) {
        return;
    }

    if (typeof ref === "function") {
        ref(value);
        return;
    }

    (ref as React.RefObject<T>).current = value;
}

type ScrollAreaProps = ScrollAreaPrimitive.Root.Props & {
    viewportRef?: React.Ref<HTMLDivElement | null>;
    viewportClassName?: string;
    onViewportScroll?: (viewportState: ScrollAreaViewportState) => void;
    viewportProps?: Omit<
        ScrollAreaPrimitive.Viewport.Props,
        "className" | "children" | "ref"
    >;
};

function ScrollArea({
    className,
    children,
    viewportRef,
    viewportClassName,
    onViewportScroll,
    viewportProps,
    ...props
}: ScrollAreaProps) {
    const internalViewportRef = React.useRef<HTMLDivElement | null>(null);

    const emitViewportState = React.useCallback(() => {
        if (!onViewportScroll || !internalViewportRef.current) {
            return;
        }

        const viewport = internalViewportRef.current;
        const maxScrollLeft = Math.max(
            viewport.scrollWidth - viewport.clientWidth,
            0,
        );
        const maxScrollTop = Math.max(
            viewport.scrollHeight - viewport.clientHeight,
            0,
        );

        onViewportScroll({
            scrollLeft: viewport.scrollLeft,
            scrollTop: viewport.scrollTop,
            scrollWidth: viewport.scrollWidth,
            scrollHeight: viewport.scrollHeight,
            clientWidth: viewport.clientWidth,
            clientHeight: viewport.clientHeight,
            canScrollLeft: viewport.scrollLeft > SCROLL_EDGE_TOLERANCE,
            canScrollRight:
                viewport.scrollLeft < maxScrollLeft - SCROLL_EDGE_TOLERANCE,
            canScrollUp: viewport.scrollTop > SCROLL_EDGE_TOLERANCE,
            canScrollDown:
                viewport.scrollTop < maxScrollTop - SCROLL_EDGE_TOLERANCE,
        });
    }, [onViewportScroll]);

    const handleViewportRef = React.useCallback(
        (node: HTMLDivElement | null) => {
            internalViewportRef.current = node;
            assignRef(viewportRef, node);
        },
        [viewportRef],
    );

    React.useEffect(() => {
        if (!onViewportScroll || !internalViewportRef.current) {
            return;
        }

        const viewport = internalViewportRef.current;
        const contentElement = viewport.firstElementChild;
        const resizeObserver =
            typeof ResizeObserver !== "undefined"
                ? new ResizeObserver(() => {
                      emitViewportState();
                  })
                : null;

        emitViewportState();
        viewport.addEventListener("scroll", emitViewportState, {
            passive: true,
        });
        window.addEventListener("resize", emitViewportState, { passive: true });
        resizeObserver?.observe(viewport);

        if (contentElement instanceof HTMLElement) {
            resizeObserver?.observe(contentElement);
        }

        return () => {
            viewport.removeEventListener("scroll", emitViewportState);
            window.removeEventListener("resize", emitViewportState);
            resizeObserver?.disconnect();
        };
    }, [emitViewportState, onViewportScroll]);

    /**
     * Base UI peut appliquer un display intrinsèque au viewport. Le normaliser
     * en block évite qu'il élargisse le layout mobile, sans modifier le display
     * du contenu fourni par l'appelant (flex, grid, etc.).
     */
    React.useLayoutEffect(() => {
        const viewport = internalViewportRef.current;
        if (!viewport) return;
        viewport.style.display = "block";
    });

    return (
        <ScrollAreaPrimitive.Root
            data-slot="scroll-area"
            className={cn("relative", className)}
            {...props}>
            <ScrollAreaPrimitive.Viewport
                data-slot="scroll-area-viewport"
                ref={handleViewportRef}
                className={cn(
                    "size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1",
                    viewportClassName,
                )}
                {...viewportProps}>
                {children}
            </ScrollAreaPrimitive.Viewport>
            <ScrollBar />
            <ScrollAreaPrimitive.Corner />
        </ScrollAreaPrimitive.Root>
    );
}

function ScrollBar({
    className,
    orientation = "vertical",
    ...props
}: ScrollAreaPrimitive.Scrollbar.Props) {
    return (
        <ScrollAreaPrimitive.Scrollbar
            data-slot="scroll-area-scrollbar"
            data-orientation={orientation}
            orientation={orientation}
            className={cn(
                "flex touch-none p-px transition-colors select-none data-horizontal:h-2.5 data-horizontal:flex-col data-horizontal:border-t data-horizontal:border-t-transparent data-vertical:h-full data-vertical:w-2.5 data-vertical:border-l data-vertical:border-l-transparent",
                className,
            )}
            {...props}>
            <ScrollAreaPrimitive.Thumb
                data-slot="scroll-area-thumb"
                className="relative flex-1 rounded-full bg-border"
            />
        </ScrollAreaPrimitive.Scrollbar>
    );
}

export { ScrollArea, ScrollBar };
