"use client";

import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
import {
    DisclosureAnimationContext,
    DisclosureMotionPanel,
    useDisclosureAnimation,
} from "@/components/ui/disclosure-motion";

/** Base UI collapsible with Motion enabled by default; use animated={false} to disable it. */
function Collapsible({
    animated = true,
    ...props
}: CollapsiblePrimitive.Root.Props & { animated?: boolean }) {
    return (
        <DisclosureAnimationContext.Provider value={{ animated }}>
            <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />
        </DisclosureAnimationContext.Provider>
    );
}

function CollapsibleTrigger({ ...props }: CollapsiblePrimitive.Trigger.Props) {
    return (
        <CollapsiblePrimitive.Trigger
            data-slot="collapsible-trigger"
            {...props}
        />
    );
}

function CollapsibleContent({
    keepMounted = false,
    hiddenUntilFound = false,
    render,
    ...props
}: CollapsiblePrimitive.Panel.Props) {
    const options = useDisclosureAnimation();
    const animated = options.animated && !hiddenUntilFound;
    return (
        <CollapsiblePrimitive.Panel
            data-slot="collapsible-content"
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
            }
        />
    );
}

export { Collapsible, CollapsibleContent, CollapsibleTrigger };
