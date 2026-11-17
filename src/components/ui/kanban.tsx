"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import type {
    DragEndEvent,
    DraggableAttributes,
    DraggableSyntheticListeners,
    DragOverEvent,
    DragStartEvent,
    DropAnimation,
    Modifiers,
    UniqueIdentifier,
} from "@dnd-kit/core";
import {
    DndContext,
    DragOverlay,
    defaultDropAnimationSideEffects,
    KeyboardSensor,
    MeasuringStrategy,
    PointerSensor,
    useSensor,
    useSensors,
} from "@dnd-kit/core";
import {
    type AnimateLayoutChanges,
    arrayMove,
    defaultAnimateLayoutChanges,
    rectSortingStrategy,
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type React from "react";
import type { CSSProperties, ReactNode } from "react";
import {
    createContext,
    useCallback,
    useContext,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { createPortal } from "react-dom";
import { uiLayerOrder } from "@/lib/ui-layers";

import { cn } from "@/lib/utils";

// Stable module-level constants — never recreated, won't trigger dnd-kit effects
const measuringConfig = {
    droppable: { strategy: MeasuringStrategy.Always },
};

const pointerActivationConstraint = { distance: 10 };

interface KanbanContextProps<T> {
    columns: Record<string, T[]>;
    setColumns: (columns: Record<string, T[]>) => void;
    getItemId: (item: T) => string;
    columnIds: string[];
    activeId: UniqueIdentifier | null;
    setActiveId: (id: UniqueIdentifier | null) => void;
    findContainer: (id: UniqueIdentifier) => string | undefined;
    isColumn: (id: UniqueIdentifier) => boolean;
    modifiers?: Modifiers;
}

const KanbanContext = createContext<KanbanContextProps<unknown>>({
    columns: {},
    setColumns: () => {},
    getItemId: () => "",
    columnIds: [],
    activeId: null,
    setActiveId: () => {},
    findContainer: () => undefined,
    isColumn: () => false,
    modifiers: undefined,
});

const ColumnContext = createContext<{
    attributes: DraggableAttributes;
    listeners: DraggableSyntheticListeners | undefined;
    isDragging?: boolean;
    disabled?: boolean;
}>({
    attributes: {} as DraggableAttributes,
    listeners: undefined,
    isDragging: false,
    disabled: false,
});

const ItemContext = createContext<{
    attributes: DraggableAttributes;
    listeners: DraggableSyntheticListeners | undefined;
    setActivatorNodeRef: (element: HTMLElement | null) => void;
    isDragging?: boolean;
    disabled?: boolean;
}>({
    attributes: {} as DraggableAttributes,
    listeners: undefined,
    setActivatorNodeRef: () => {},
    isDragging: false,
    disabled: false,
});

const IsOverlayContext = createContext(false);

const animateLayoutChanges: AnimateLayoutChanges = (args) =>
    defaultAnimateLayoutChanges({ ...args, wasDragging: true });

const dropAnimationConfig: DropAnimation = {
    sideEffects: defaultDropAnimationSideEffects({
        styles: { active: { opacity: "0.4" } },
    }),
};

export interface KanbanMoveEvent {
    event: DragEndEvent;
    activeContainer: string;
    activeIndex: number;
    overContainer: string;
    overIndex: number;
}

export interface KanbanRootProps<T>
    extends Omit<useRender.ComponentProps<"div">, "children"> {
    value: Record<string, T[]>;
    onValueChange: (value: Record<string, T[]>) => void;
    getItemValue: (item: T) => string;
    children: ReactNode;
    onMove?: (event: KanbanMoveEvent) => void;
    modifiers?: Modifiers;
}

function Kanban<T>({
    value,
    onValueChange,
    getItemValue,
    children,
    className,
    render,
    onMove,
    modifiers,
    ...props
}: KanbanRootProps<T>) {
    const columns = value;
    const setColumns = onValueChange;
    const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);

    // Refs so all callbacks read the latest values without being recreated on every render.
    // This breaks the cascade: columns change → callbacks recreate → DndContext re-registers → loop.
    const columnsRef = useRef(columns);

    columnsRef.current = columns;

    const getItemValueRef = useRef(getItemValue);

    getItemValueRef.current = getItemValue;

    const onMoveRef = useRef(onMove);

    onMoveRef.current = onMove;

    // Sensor config objects are stable module-level constants, so useSensors result is stable.
    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: pointerActivationConstraint,
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        }),
    );

    const columnIds = useMemo(() => Object.keys(columns), [columns]);

    // isColumn only depends on columnIds (the keys, not the item arrays). Column keys don't
    // change when items are moved, so columnIds array values are stable during drags.
    const isColumn = useCallback(
        (id: UniqueIdentifier) => columnIds.includes(id as string),
        [columnIds],
    );

    // findContainer reads columnsRef so it doesn't need columns or getItemValue in its deps.
    const findContainer = useCallback(
        (id: UniqueIdentifier) => {
            if (isColumn(id)) return id as string;
            const cols = columnsRef.current;
            const getId = getItemValueRef.current;

            return Object.keys(cols).find((key) =>
                cols[key]?.some((item) => getId(item) === id),
            );
        },
        [isColumn],
    );

    const handleDragStart = useCallback((event: DragStartEvent) => {
        setActiveId(event.active.id);
    }, []);

    // RAF refs throttle onDragOver: we only process the latest event per animation frame.
    // This prevents React from receiving dozens of setState calls per frame during rapid drags,
    // which is what causes "Maximum update depth exceeded".
    const dragOverRafRef = useRef<number | null>(null);
    const pendingDragOverRef = useRef<DragOverEvent | null>(null);

    const handleDragOver = useCallback(
        (event: DragOverEvent) => {
            if (onMoveRef.current) return;

            // Always capture the latest event; only one RAF runs at a time.
            pendingDragOverRef.current = event;
            if (dragOverRafRef.current !== null) return;

            dragOverRafRef.current = requestAnimationFrame(() => {
                dragOverRafRef.current = null;
                const latestEvent = pendingDragOverRef.current;

                pendingDragOverRef.current = null;
                if (!latestEvent) return;

                const { active, over } = latestEvent;

                if (!over) return;
                if (isColumn(active.id)) return;

                const activeContainer = findContainer(active.id);
                const overContainer = findContainer(over.id);

                // Only reorder within the same column during drag. Cross-column moves are
                // committed in onDragEnd instead — moving an item to another column unmounts
                // its DOM node and remounts it, which releases pointer capture and causes the
                // drag to end prematurely when the kanban is rendered inside an iframe.
                if (
                    !activeContainer ||
                    !overContainer ||
                    activeContainer !== overContainer
                )
                    return;

                const cols = columnsRef.current;
                const getId = getItemValueRef.current;
                const activeItems = cols[activeContainer];

                if (!activeItems) return;

                const activeIndex = activeItems.findIndex(
                    (item: T) => getId(item) === active.id,
                );
                const overIndex = activeItems.findIndex(
                    (item: T) => getId(item) === over.id,
                );

                if (activeIndex === overIndex) return;

                setColumns({
                    ...cols,
                    [activeContainer]: arrayMove(
                        activeItems,
                        activeIndex,
                        overIndex,
                    ),
                });
            });
        },
        [findContainer, isColumn, setColumns],
    );

    const flushPendingDragOver = useCallback(() => {
        if (dragOverRafRef.current !== null) {
            cancelAnimationFrame(dragOverRafRef.current);
            dragOverRafRef.current = null;
        }

        pendingDragOverRef.current = null;
    }, []);

    const handleDragCancel = useCallback(() => {
        flushPendingDragOver();
        setActiveId(null);
    }, [flushPendingDragOver]);

    const handleDragEnd = useCallback(
        (event: DragEndEvent) => {
            flushPendingDragOver();

            const { active, over } = event;

            setActiveId(null);

            if (!over) return;

            if (onMoveRef.current && !isColumn(active.id)) {
                const cols = columnsRef.current;
                const getId = getItemValueRef.current;
                const activeContainer = findContainer(active.id);
                const overContainer = findContainer(over.id);

                if (activeContainer && overContainer) {
                    const activeItems = cols[activeContainer];
                    const overItems = cols[overContainer];

                    if (!activeItems || !overItems) return;

                    const activeIndex = activeItems.findIndex(
                        (item: T) => getId(item) === active.id,
                    );

                    const overIndex = isColumn(over.id)
                        ? overItems.length
                        : overItems.findIndex(
                              (item: T) => getId(item) === over.id,
                          );

                    onMoveRef.current({
                        event,
                        activeContainer,
                        activeIndex,
                        overContainer,
                        overIndex,
                    });
                }

                return;
            }

            if (isColumn(active.id) && isColumn(over.id)) {
                const cols = columnsRef.current;
                const keys = Object.keys(cols);
                const activeIndex = keys.indexOf(active.id as string);
                const overIndex = keys.indexOf(over.id as string);

                if (activeIndex !== overIndex) {
                    const newOrder = arrayMove(keys, activeIndex, overIndex);
                    const newColumns: Record<string, T[]> = {};

                    newOrder.forEach((key) => {
                        const items = cols[key];

                        if (items) newColumns[key] = items;
                    });

                    setColumns(newColumns);
                }

                return;
            }

            const activeContainer = findContainer(active.id);
            const overContainer = findContainer(over.id);

            if (!activeContainer || !overContainer) return;

            const cols = columnsRef.current;
            const getId = getItemValueRef.current;
            const activeItems = cols[activeContainer];
            const overItems = cols[overContainer];

            if (!activeItems || !overItems) return;

            const activeIndex = activeItems.findIndex(
                (item: T) => getId(item) === active.id,
            );

            if (activeContainer === overContainer) {
                const overIndex = overItems.findIndex(
                    (item: T) => getId(item) === over.id,
                );

                if (activeIndex !== overIndex) {
                    setColumns({
                        ...cols,
                        [activeContainer]: arrayMove(
                            activeItems,
                            activeIndex,
                            overIndex,
                        ),
                    });
                }

                return;
            }

            const overIndex = isColumn(over.id)
                ? overItems.length
                : overItems.findIndex((item: T) => getId(item) === over.id);

            const newActiveItems = [...activeItems];
            const newOverItems = [...overItems];
            const [movedItem] = newActiveItems.splice(activeIndex, 1);

            if (movedItem === undefined) return;

            newOverItems.splice(overIndex, 0, movedItem);

            setColumns({
                ...cols,
                [activeContainer]: newActiveItems,
                [overContainer]: newOverItems,
            });
        },
        [findContainer, isColumn, setColumns, flushPendingDragOver],
    );

    // Stable getItemId wrapper so context consumers don't re-render when the parent
    // passes a new inline arrow function reference.
    const stableGetItemId = useCallback(
        (item: T) => getItemValueRef.current(item),
        [],
    );

    const contextValue = useMemo(
        () => ({
            columns,
            setColumns,
            getItemId: stableGetItemId,
            columnIds,
            activeId,
            setActiveId,
            findContainer,
            isColumn,
            modifiers,
        }),
        [
            columns,
            setColumns,
            stableGetItemId,
            columnIds,
            activeId,
            findContainer,
            isColumn,
            modifiers,
        ],
    );

    const defaultProps = {
        "data-slot": "kanban",
        "data-dragging": activeId !== null,
        className: cn(activeId !== null && "cursor-grabbing!", className),
        children,
    };

    return (
        <KanbanContext.Provider
            value={contextValue as KanbanContextProps<unknown>}>
            <DndContext
                sensors={sensors}
                modifiers={modifiers}
                measuring={measuringConfig}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragEnd={handleDragEnd}
                onDragCancel={handleDragCancel}>
                {useRender({
                    defaultTagName: "div",
                    render,
                    props: mergeProps<"div">(defaultProps, props),
                })}
            </DndContext>
        </KanbanContext.Provider>
    );
}

export type KanbanBoardProps = useRender.ComponentProps<"div">;

function KanbanBoard({ className, render, ...props }: KanbanBoardProps) {
    const { columnIds } = useContext(KanbanContext);

    const defaultProps = {
        "data-slot": "kanban-board",
        className: cn("grid auto-rows-fr gap-4 sm:grid-cols-3", className),
        children: props.children,
    };

    return (
        <SortableContext items={columnIds} strategy={rectSortingStrategy}>
            {useRender({
                defaultTagName: "div",
                render,
                props: mergeProps<"div">(defaultProps, props),
            })}
        </SortableContext>
    );
}

export interface KanbanColumnProps extends useRender.ComponentProps<"div"> {
    value: string;
    disabled?: boolean;
}

function KanbanColumn({
    value,
    className,
    render,
    disabled,
    ...props
}: KanbanColumnProps) {
    const isOverlay = useContext(IsOverlayContext);
    const { activeId, isColumn } = useContext(KanbanContext);

    const {
        setNodeRef,
        transform,
        transition,
        attributes,
        listeners,
        isDragging: isSortableDragging,
    } = useSortable({
        id: value,
        disabled: disabled || isOverlay,
        animateLayoutChanges,
    });

    const isColumnDragging = activeId ? isColumn(activeId) : false;
    const style = {
        transition,
        transform: CSS.Transform.toString(transform),
    } as CSSProperties;
    const defaultProps = isOverlay
        ? {
              "data-slot": "kanban-column",
              "data-value": value,
              "data-dragging": true,
              className: cn("group/kanban-column flex flex-col", className),
              children: props.children,
          }
        : {
              "data-slot": "kanban-column",
              "data-value": value,
              "data-dragging": isSortableDragging,
              "data-disabled": disabled,
              ref: setNodeRef,
              style,
              className: cn(
                  "group/kanban-column flex flex-col",
                  isSortableDragging && "opacity-50 z-50",
                  disabled && "opacity-50",
                  className,
              ),
              children: props.children,
          };
    const contextValue = isOverlay
        ? {
              attributes: {} as DraggableAttributes,
              listeners: undefined,
              isDragging: true,
              disabled: false,
          }
        : {
              attributes,
              listeners,
              isDragging: isColumnDragging,
              disabled,
          };
    const element = useRender({
        defaultTagName: "div",
        render,
        props: mergeProps<"div">(defaultProps, props),
    });

    return (
        <ColumnContext.Provider value={contextValue}>
            {element}
        </ColumnContext.Provider>
    );
}

export interface KanbanColumnHandleProps
    extends useRender.ComponentProps<"div"> {
    cursor?: boolean;
}

function KanbanColumnHandle({
    className,
    render,
    cursor = true,
    ...props
}: KanbanColumnHandleProps) {
    const { attributes, listeners, isDragging, disabled } =
        useContext(ColumnContext);

    const defaultProps = {
        "data-slot": "kanban-column-handle",
        "data-dragging": isDragging,
        "data-disabled": disabled,
        suppressHydrationWarning: true,
        ...attributes,
        ...listeners,
        className: cn(
            "opacity-0 transition-opacity group-hover/kanban-column:opacity-100",
            cursor && (isDragging ? "cursor-grabbing!" : "cursor-grab!"),
            className,
        ),
        children: props.children,
    };

    return useRender({
        defaultTagName: "div",
        render,
        props: mergeProps<"div">(defaultProps, props),
    });
}

export interface KanbanItemProps extends useRender.ComponentProps<"div"> {
    value: string;
    disabled?: boolean;
}

function KanbanItem({
    value,
    className,
    render,
    disabled,
    ...props
}: KanbanItemProps) {
    const isOverlay = useContext(IsOverlayContext);
    const { activeId, isColumn } = useContext(KanbanContext);

    const {
        setNodeRef,
        transform,
        transition,
        attributes,
        listeners,
        setActivatorNodeRef,
        isDragging: isSortableDragging,
    } = useSortable({
        id: value,
        disabled: disabled || isOverlay,
        animateLayoutChanges,
    });

    const isItemDragging = activeId ? !isColumn(activeId) : false;
    const style = {
        transition,
        transform: CSS.Transform.toString(transform),
    } as CSSProperties;
    const defaultProps = isOverlay
        ? {
              "data-slot": "kanban-item",
              "data-value": value,
              "data-dragging": true,
              className: cn(className),
              children: props.children,
          }
        : {
              "data-slot": "kanban-item",
              "data-value": value,
              "data-dragging": isSortableDragging,
              "data-disabled": disabled,
              suppressHydrationWarning: true,
              ref: setNodeRef,
              style,
              className: cn(
                  isSortableDragging && "opacity-50 z-50",
                  disabled && "opacity-50",
                  className,
              ),
              children: props.children,
          };
    const contextValue = isOverlay
        ? {
              attributes: {} as DraggableAttributes,
              listeners: undefined,
              setActivatorNodeRef: () => {},
              isDragging: true,
              disabled: false,
          }
        : {
              attributes,
              listeners,
              setActivatorNodeRef,
              isDragging: isItemDragging,
              disabled,
          };
    const element = useRender({
        defaultTagName: "div",
        render,
        props: mergeProps<"div">(defaultProps, props),
    });

    return (
        <ItemContext.Provider value={contextValue}>
            {element}
        </ItemContext.Provider>
    );
}

export interface KanbanItemHandleProps extends useRender.ComponentProps<"div"> {
    cursor?: boolean;
}

function KanbanItemHandle({
    className,
    render,
    cursor = true,
    ...props
}: KanbanItemHandleProps) {
    const { attributes, listeners, setActivatorNodeRef, isDragging, disabled } =
        useContext(ItemContext);

    const defaultProps = {
        "data-slot": "kanban-item-handle",
        "data-dragging": isDragging,
        "data-disabled": disabled,
        ref: setActivatorNodeRef,
        ...attributes,
        ...listeners,
        className: cn(
            cursor && (isDragging ? "cursor-grabbing!" : "cursor-grab!"),
            className,
        ),
        children: props.children,
    };

    return useRender({
        defaultTagName: "div",
        render,
        props: mergeProps<"div">(defaultProps, props),
    });
}

export interface KanbanColumnContentProps
    extends useRender.ComponentProps<"div"> {
    value: string;
}

function KanbanColumnContent({
    value,
    className,
    render,
    ...props
}: KanbanColumnContentProps) {
    const { columns, getItemId } = useContext(KanbanContext);

    const itemIds = useMemo(
        () => (columns[value] ?? []).map(getItemId),
        [columns, getItemId, value],
    );

    const defaultProps = {
        "data-slot": "kanban-column-content",
        className: cn("flex flex-col gap-2", className),
        children: props.children,
    };

    return (
        <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
            {useRender({
                defaultTagName: "div",
                render,
                props: mergeProps<"div">(defaultProps, props),
            })}
        </SortableContext>
    );
}

export interface KanbanOverlayProps
    extends Omit<React.ComponentProps<typeof DragOverlay>, "children"> {
    children?:
        | ReactNode
        | ((params: {
              value: UniqueIdentifier;
              variant: "column" | "item";
          }) => ReactNode);
}

function KanbanOverlay({ children, className, ...props }: KanbanOverlayProps) {
    const { activeId, isColumn, modifiers } = useContext(KanbanContext);
    const [mounted, setMounted] = useState(false);

    useLayoutEffect(() => setMounted(true), []);

    const variant = activeId
        ? isColumn(activeId)
            ? "column"
            : "item"
        : "item";

    const content =
        activeId && children
            ? typeof children === "function"
                ? children({ value: activeId, variant })
                : children
            : null;

    if (!mounted) return null;

    return createPortal(
        <DragOverlay
            dropAnimation={dropAnimationConfig}
            modifiers={modifiers}
            className={cn(activeId && "cursor-grabbing", className)}
            {...props}
            zIndex={uiLayerOrder.popup}>
            <IsOverlayContext.Provider value={true}>
                {content}
            </IsOverlayContext.Provider>
        </DragOverlay>,
        document.body,
    );
}

export {
    Kanban,
    KanbanBoard,
    KanbanColumn,
    KanbanColumnContent,
    KanbanColumnHandle,
    KanbanItem,
    KanbanItemHandle,
    KanbanOverlay,
};
