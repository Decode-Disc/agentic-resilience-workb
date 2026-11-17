"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import {
    AnimatePresence,
    LayoutGroup,
    MotionConfig,
    motion,
    type Transition,
    useReducedMotion,
} from "motion/react";
import {
    type ComponentProps,
    createContext,
    type ReactNode,
    type RefObject,
    useContext,
    useId,
    useRef,
    useState,
} from "react";
import Icon from "@/components/icon";
import { uiLayerClasses } from "@/lib/ui-layers";
import { cn } from "@/lib/utils";

const MotionTrigger = motion.create(DialogPrimitive.Trigger);
const MotionPopup = motion.create(DialogPrimitive.Popup);
const MotionClose = motion.create(DialogPrimitive.Close);
const MotionTitle = motion.create(DialogPrimitive.Title);
const MotionDescription = motion.create(DialogPrimitive.Description);

const DialogContext = createContext<{
    open: boolean;
    id: string;
    reduced: boolean;
    actionsRef: RefObject<DialogPrimitive.Root.Actions | null>;
} | null>(null);

function useDialog() {
    const context = useContext(DialogContext);
    if (!context) throw new Error("Linear modal parts require a Dialog parent");
    return context;
}

/** Morphs from the trigger while Base UI owns modal semantics, focus and dismissal. */
function Dialog({
    children,
    open: controlledOpen,
    defaultOpen = false,
    onOpenChange,
    transition = { type: "spring", stiffness: 340, damping: 34, mass: 0.9 },
    ...props
}: Omit<DialogPrimitive.Root.Props, "children" | "actionsRef"> & {
    children: ReactNode;
    transition?: Transition;
}) {
    const [localOpen, setLocalOpen] = useState(defaultOpen);
    const open = controlledOpen ?? localOpen;
    const id = useId();
    const reduced = useReducedMotion() === true;
    const actionsRef = useRef<DialogPrimitive.Root.Actions>(null);
    return (
        <MotionConfig reducedMotion="user" transition={transition}>
            <LayoutGroup id={id}>
                <DialogContext.Provider
                    value={{ open, id, reduced, actionsRef }}>
                    <DialogPrimitive.Root
                        {...props}
                        open={open}
                        actionsRef={actionsRef}
                        onOpenChange={(next, details) => {
                            onOpenChange?.(next, details);
                            if (details.isCanceled) return;
                            if (!next && !reduced)
                                details.preventUnmountOnClose();
                            if (controlledOpen === undefined)
                                setLocalOpen(next);
                        }}>
                        {children}
                    </DialogPrimitive.Root>
                </DialogContext.Provider>
            </LayoutGroup>
        </MotionConfig>
    );
}

function DialogTrigger({
    triggerRef,
    ref,
    style,
    ...props
}: ComponentProps<typeof MotionTrigger> & {
    triggerRef?: RefObject<HTMLButtonElement | null>;
}) {
    const context = useDialog();
    return (
        <MotionTrigger
            {...props}
            ref={ref ?? triggerRef}
            style={
                context.reduced && context.open
                    ? { ...style, opacity: 0 }
                    : style
            }
            layoutId={context.reduced ? undefined : `dialog-${context.id}`}
        />
    );
}

function DialogContainer({
    children,
    className,
    overlayClassName,
    style,
    container,
    render,
}: {
    children: ReactNode;
    className?: string;
    overlayClassName?: string;
    style?: ComponentProps<"div">["style"];
    container?: DialogPrimitive.Portal.Props["container"];
    render?: DialogPrimitive.Portal.Props["render"];
}) {
    const { open, id, reduced, actionsRef } = useDialog();
    return (
        <DialogPrimitive.Portal
            container={container}
            render={render}
            keepMounted>
            <AnimatePresence
                initial={false}
                onExitComplete={() => {
                    if (!open) actionsRef.current?.unmount();
                }}>
                {open && (
                    <motion.div
                        key={id}
                        className={cn(
                            "fixed inset-0",
                            uiLayerClasses.modal,
                            className,
                        )}
                        style={style}>
                        <DialogPrimitive.Backdrop
                            className={cn(
                                "absolute inset-0 bg-black/30",
                                overlayClassName,
                            )}
                            render={
                                <motion.div
                                    initial={reduced ? false : { opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    transition={{ duration: reduced ? 0 : 0.2 }}
                                />
                            }
                        />
                        {children}
                    </motion.div>
                )}
            </AnimatePresence>
        </DialogPrimitive.Portal>
    );
}

function DialogContent({
    children,
    className,
    ...props
}: ComponentProps<typeof MotionPopup>) {
    const { id, reduced } = useDialog();
    return (
        <MotionPopup
            {...props}
            layoutId={reduced ? undefined : `dialog-${id}`}
            className={cn("overflow-hidden outline-none", className)}
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ opacity: { duration: reduced ? 0 : 0.16 } }}>
            {children}
        </MotionPopup>
    );
}

function DialogTitle(props: ComponentProps<typeof MotionTitle>) {
    const { id, reduced } = useDialog();
    return (
        <MotionTitle
            {...props}
            layoutId={reduced ? undefined : `dialog-title-${id}`}
        />
    );
}

function DialogSubtitle(props: ComponentProps<typeof motion.div>) {
    const { id, reduced } = useDialog();
    return (
        <motion.div
            {...props}
            layoutId={reduced ? undefined : `dialog-subtitle-${id}`}
        />
    );
}

function DialogDescription({
    disableLayoutAnimation = false,
    ...props
}: ComponentProps<typeof MotionDescription> & {
    disableLayoutAnimation?: boolean;
}) {
    const { id, reduced } = useDialog();
    return (
        <MotionDescription
            {...props}
            layoutId={
                reduced || disableLayoutAnimation
                    ? undefined
                    : `dialog-description-${id}`
            }
        />
    );
}

function DialogImage(props: ComponentProps<typeof motion.img>) {
    const { id, reduced } = useDialog();
    return (
        <motion.img
            {...props}
            layoutId={reduced ? undefined : `dialog-image-${id}`}
        />
    );
}

function DialogClose({
    children,
    ...props
}: ComponentProps<typeof MotionClose>) {
    return (
        <MotionClose
            aria-label={children ? undefined : "Close dialog"}
            {...props}>
            {children ?? <Icon iconNode={Cancel01Icon} size={24} />}
        </MotionClose>
    );
}

export {
    Dialog,
    DialogClose,
    DialogContainer,
    DialogContent,
    DialogDescription,
    DialogImage,
    DialogSubtitle,
    DialogTitle,
    DialogTrigger,
};
