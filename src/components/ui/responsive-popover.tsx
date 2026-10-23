import { Cancel01Icon } from "@hugeicons/core-free-icons";
import {
    type ComponentProps,
    type ReactElement,
    type ReactNode,
    useState,
} from "react";
import Icon from "@/components/icon";
import { Button } from "@/components/ui/button";
import {
    Drawer,
    DrawerContent,
    DrawerDescription,
    DrawerTitle,
    DrawerTrigger,
} from "@/components/ui/drawer";
import {
    Popover,
    PopoverContent,
    PopoverDescription,
    PopoverTitle,
    PopoverTrigger,
} from "@/components/ui/popover";
import { useMediaQuery } from "@/hooks/use-responsive";
import { cn } from "@/lib/utils";

/** Gives contextual information one trigger and focus lifecycle across popovers and narrow-screen drawers. */
export function ResponsivePopover({
    trigger,
    title,
    description,
    closeLabel = "Close",
    children,
    side = "bottom",
    className,
}: {
    trigger: ReactElement;
    title: string;
    description: string;
    closeLabel?: string;
    children: ReactNode;
    side?: ComponentProps<typeof PopoverContent>["side"];
    className?: string;
}) {
    const [open, setOpen] = useState(false);
    const small = useMediaQuery("(width < 40rem)");
    const Title = small ? DrawerTitle : PopoverTitle;
    const Description = small ? DrawerDescription : PopoverDescription;
    const content = (
        <>
            <div className="flex items-start justify-between gap-3 border-b border-border/60 px-5 py-4">
                <div>
                    <Title className="text-sm font-medium">{title}</Title>
                    <Description className="sr-only">{description}</Description>
                </div>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={closeLabel}
                    onClick={() => setOpen(false)}>
                    <Icon iconNode={Cancel01Icon} />
                </Button>
            </div>
            <div className="min-h-0 overflow-y-auto p-5">{children}</div>
        </>
    );
    return small ? (
        <Drawer open={open} onOpenChange={setOpen}>
            <DrawerTrigger render={trigger} />
            <DrawerContent
                className={cn(
                    "max-h-[85dvh] motion-reduce:transition-none",
                    className,
                )}>
                {content}
            </DrawerContent>
        </Drawer>
    ) : (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger render={trigger} />
            <PopoverContent
                side={side}
                align="start"
                sideOffset={12}
                className={cn(
                    "w-80 max-w-[calc(100vw-2rem)] gap-0 rounded-xl p-0 motion-reduce:animate-none",
                    className,
                )}>
                {content}
            </PopoverContent>
        </Popover>
    );
}
