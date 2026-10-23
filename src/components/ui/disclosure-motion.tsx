import { type HTMLProps, useRender } from "@base-ui/react/use-render";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { createContext, useContext, useEffect, useState } from "react";

export const DisclosureAnimationContext = createContext<{
    animated: boolean;
    keepMounted?: boolean;
    hiddenUntilFound?: boolean;
}>({ animated: true });

/** Combines the component's animation preference with the user's motion preference. */
export function useDisclosureAnimation() {
    const options = useContext(DisclosureAnimationContext);
    const reducedMotion = useReducedMotion();
    return { ...options, animated: options.animated && !reducedMotion };
}

/** Retains exiting content for Motion while Base UI continues to own disclosure state and ARIA. */
export function DisclosureMotionPanel({
    open,
    keepMounted,
    elementProps,
    render,
}: {
    open: boolean;
    keepMounted: boolean;
    elementProps: HTMLProps<HTMLDivElement>;
    render?: useRender.RenderProp;
}) {
    const [retained, setRetained] = useState(open);
    useEffect(() => {
        if (open) setRetained(true);
    }, [open]);
    const { children, ref, ...props } = elementProps;
    const finishExit = () => {
        if (!open) setRetained(false);
    };
    return useRender({
        render,
        ref,
        props: {
            ...props,
            hidden: open ? props.hidden : !retained,
            "aria-hidden": open ? props["aria-hidden"] : true,
            inert: open ? props.inert : true,
            children: (
                <AnimatePresence initial={false} onExitComplete={finishExit}>
                    {(open || keepMounted) && (
                        <motion.div
                            key="content"
                            initial={{ height: 0, opacity: 0 }}
                            animate={{
                                height: open ? "auto" : 0,
                                opacity: open ? 1 : 0,
                            }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{
                                duration: 0.2,
                                ease: [0.22, 1, 0.36, 1],
                            }}
                            onAnimationComplete={finishExit}
                            className="overflow-hidden">
                            {children}
                        </motion.div>
                    )}
                </AnimatePresence>
            ),
        },
    });
}
