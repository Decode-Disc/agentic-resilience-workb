import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion";
import { ArrowDown01Icon, ArrowUp01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactNode } from "react";
import {
    DisclosureAnimationContext,
    DisclosureMotionPanel,
    useDisclosureAnimation,
} from "@/components/ui/disclosure-motion";
import { cn } from "@/lib/utils";

/** Base UI accordion with Motion enabled by default; use animated={false} for native immediate disclosure. */
function Accordion<Value = string>({
    className,
    animated = true,
    keepMounted,
    hiddenUntilFound,
    ...props
}: AccordionPrimitive.Root.Props<Value> & { animated?: boolean }) {
    return (
        <DisclosureAnimationContext.Provider
            value={{ animated, keepMounted, hiddenUntilFound }}>
            <AccordionPrimitive.Root
                data-slot="accordion"
                className={cn(
                    "flex w-full flex-col overflow-hidden rounded-2xl border",
                    className,
                )}
                keepMounted={keepMounted}
                hiddenUntilFound={hiddenUntilFound}
                {...props}
            />
        </DisclosureAnimationContext.Provider>
    );
}

function AccordionItem({ className, ...props }: AccordionPrimitive.Item.Props) {
    return (
        <AccordionPrimitive.Item
            data-slot="accordion-item"
            className={cn("not-last:border-b data-open:bg-muted/50", className)}
            {...props}
        />
    );
}

function AccordionTrigger({
    className,
    children,
    indicator,
    ...props
}: AccordionPrimitive.Trigger.Props & { indicator?: ReactNode }) {
    return (
        <AccordionPrimitive.Header className="flex">
            <AccordionPrimitive.Trigger
                data-slot="accordion-trigger"
                className={cn(
                    "group/accordion-trigger relative flex flex-1 items-start justify-between gap-6 border border-transparent p-4 text-left text-sm font-medium transition-all outline-none hover:underline aria-disabled:pointer-events-none aria-disabled:opacity-50 **:data-[slot=accordion-trigger-icon]:ml-auto **:data-[slot=accordion-trigger-icon]:size-4 **:data-[slot=accordion-trigger-icon]:text-muted-foreground",
                    className,
                )}
                {...props}>
                {children}
                {indicator === undefined ? (
                    <>
                        <HugeiconsIcon
                            icon={ArrowDown01Icon}
                            strokeWidth={2}
                            data-slot="accordion-trigger-icon"
                            className="pointer-events-none shrink-0 group-aria-expanded/accordion-trigger:hidden"
                        />
                        <HugeiconsIcon
                            icon={ArrowUp01Icon}
                            strokeWidth={2}
                            data-slot="accordion-trigger-icon"
                            className="pointer-events-none hidden shrink-0 group-aria-expanded/accordion-trigger:inline"
                        />
                    </>
                ) : (
                    indicator
                )}
            </AccordionPrimitive.Trigger>
        </AccordionPrimitive.Header>
    );
}

function AccordionContent({
    className,
    children,
    keepMounted: keepMountedProp,
    hiddenUntilFound: hiddenUntilFoundProp,
    render,
    ...props
}: AccordionPrimitive.Panel.Props) {
    const options = useDisclosureAnimation();
    const keepMounted = keepMountedProp ?? options.keepMounted ?? false;
    const hiddenUntilFound =
        hiddenUntilFoundProp ?? options.hiddenUntilFound ?? false;
    const animated = options.animated && !hiddenUntilFound;
    return (
        <AccordionPrimitive.Panel
            data-slot="accordion-content"
            className="overflow-hidden text-sm"
            {...props}
            hiddenUntilFound={hiddenUntilFound}
            keepMounted={animated || keepMounted}
            render={
                animated
                    ? (elementProps, state) => (
                          <DisclosureMotionPanel
                              open={state.open}
                              keepMounted={keepMounted}
                              elementProps={elementProps}
                              render={
                                  typeof render === "function"
                                      ? (renderProps) =>
                                            render(renderProps, state)
                                      : render
                              }
                          />
                      )
                    : render
            }>
            <div
                className={cn(
                    "px-4 pt-0 pb-4 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4",
                    className,
                )}>
                {children}
            </div>
        </AccordionPrimitive.Panel>
    );
}

export { Accordion, AccordionContent, AccordionItem, AccordionTrigger };
