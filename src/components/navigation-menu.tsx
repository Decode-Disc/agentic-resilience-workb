import { NavigationMenu as NavigationMenuPrimitive } from "@base-ui/react/navigation-menu";
import { ArrowDown01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import type { ComponentProps, ComponentType, SVGProps } from "react";
import Icon from "@/components/icon";
import { GridCard } from "@/components/ui/grid-card";
import { uiLayerClasses } from "@/lib/ui-layers";
import { cn } from "@/lib/utils";

type NavItemType = {
    title: string;
    href: string;
    description?: string;
    icon?: ComponentType<SVGProps<SVGSVGElement>>;
};

function NavigationMenu({
    className,
    children,
    ...props
}: NavigationMenuPrimitive.Root.Props) {
    return (
        <NavigationMenuPrimitive.Root
            data-slot="navigation-menu"
            className={cn(
                "group/navigation-menu flex max-w-max flex-1 items-center justify-center",
                className,
            )}
            {...props}>
            {children}
            <NavigationMenuPrimitive.Portal>
                <NavigationMenuPrimitive.Positioner
                    sideOffset={12}
                    collisionPadding={16}
                    className={cn("outline-none", uiLayerClasses.popup)}>
                    <NavigationMenuPrimitive.Popup
                        data-slot="navigation-menu-popup"
                        className="origin-[var(--transform-origin)] rounded-lg border border-border bg-popover/94 text-popover-foreground shadow-floating backdrop-blur-xl transition-[opacity,transform,width,height] duration-200 ease-out data-ending-style:scale-[.98] data-ending-style:opacity-0 data-starting-style:scale-[.98] data-starting-style:opacity-0">
                        <NavigationMenuPrimitive.Viewport
                            data-slot="navigation-menu-viewport"
                            className="relative h-[var(--popup-height)] w-[var(--popup-width)] overflow-hidden transition-[width,height] duration-200"
                        />
                        <NavigationMenuPrimitive.Arrow className="flex size-3 translate-y-[-6px] rotate-45 border-t border-l border-border bg-popover" />
                    </NavigationMenuPrimitive.Popup>
                </NavigationMenuPrimitive.Positioner>
            </NavigationMenuPrimitive.Portal>
        </NavigationMenuPrimitive.Root>
    );
}

function NavigationMenuList({
    className,
    ...props
}: NavigationMenuPrimitive.List.Props) {
    return (
        <NavigationMenuPrimitive.List
            data-slot="navigation-menu-list"
            className={cn(
                "flex flex-1 list-none items-center justify-center gap-1",
                className,
            )}
            {...props}
        />
    );
}

function NavigationMenuItem(props: NavigationMenuPrimitive.Item.Props) {
    return (
        <NavigationMenuPrimitive.Item
            data-slot="navigation-menu-item"
            {...props}
        />
    );
}

function NavigationMenuTrigger({
    className,
    children,
    ...props
}: NavigationMenuPrimitive.Trigger.Props) {
    return (
        <NavigationMenuPrimitive.Trigger
            data-slot="navigation-menu-trigger"
            className={cn(
                "group inline-flex h-9 items-center justify-center rounded-md px-3 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30 data-popup-open:bg-muted data-popup-open:text-foreground",
                className,
            )}
            {...props}>
            {children}
            <NavigationMenuPrimitive.Icon className="ml-1 transition-transform duration-200 group-data-popup-open:rotate-180">
                <Icon
                    iconNode={ArrowDown01Icon}
                    className="size-3"
                    strokeWidth={2}
                />
            </NavigationMenuPrimitive.Icon>
        </NavigationMenuPrimitive.Trigger>
    );
}

function NavigationMenuContent({
    className,
    ...props
}: NavigationMenuPrimitive.Content.Props) {
    return (
        <NavigationMenuPrimitive.Content
            data-slot="navigation-menu-content"
            className={cn(
                "w-[min(38rem,calc(100vw-2rem))] p-4 outline-none transition-[opacity,transform] duration-200 data-starting-style:opacity-0 data-[activation-direction=left]:data-starting-style:-translate-x-4 data-[activation-direction=right]:data-starting-style:translate-x-4",
                className,
            )}
            {...props}
        />
    );
}

function NavigationMenuLink({
    className,
    ...props
}: NavigationMenuPrimitive.Link.Props) {
    return (
        <NavigationMenuPrimitive.Link
            data-slot="navigation-menu-link"
            className={cn(
                "rounded-md outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30",
                className,
            )}
            {...props}
        />
    );
}

function NavGridCard({
    link,
    ...props
}: ComponentProps<typeof GridCard> & { link: NavItemType }) {
    return (
        <NavigationMenuLink href={link.href} className="block">
            <GridCard {...props}>
                {link.icon ? <link.icon className="relative size-5" /> : null}
                <p className="mt-3 text-sm font-medium">{link.title}</p>
                {link.description ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                        {link.description}
                    </p>
                ) : null}
            </GridCard>
        </NavigationMenuLink>
    );
}

function NavSmallItem({
    item,
    className,
    ...props
}: NavigationMenuPrimitive.Link.Props & {
    item: Omit<NavItemType, "description">;
}) {
    return (
        <NavigationMenuLink
            className={cn(
                "group flex flex-row items-center gap-2 p-2",
                className,
            )}
            {...props}>
            {item.icon ? <item.icon /> : null}
            <span>{item.title}</span>
            <Icon
                iconNode={ArrowRight01Icon}
                className="ml-auto size-4 opacity-0 transition-opacity group-hover:opacity-100"
            />
        </NavigationMenuLink>
    );
}

function NavLargeItem({
    link,
    className,
    ...props
}: NavigationMenuPrimitive.Link.Props & { link: NavItemType }) {
    return (
        <NavigationMenuLink
            className={cn("flex items-center gap-3 border p-4", className)}
            {...props}>
            {link.icon ? <link.icon className="size-5" /> : null}
            <span>
                <span className="block text-sm font-medium">{link.title}</span>
                {link.description ? (
                    <span className="mt-1 block text-xs text-muted-foreground">
                        {link.description}
                    </span>
                ) : null}
            </span>
        </NavigationMenuLink>
    );
}

function NavItemMobile({
    item,
    className,
    ...props
}: ComponentProps<"a"> & { item: NavItemType }) {
    return (
        <a
            className={cn(
                "flex items-center gap-3 rounded-md p-3 hover:bg-muted",
                className,
            )}
            {...props}>
            {item.icon ? <item.icon className="size-5" /> : null}
            <span>
                <span className="block text-sm font-medium">{item.title}</span>
                <span className="block text-xs text-muted-foreground">
                    {item.description}
                </span>
            </span>
        </a>
    );
}

export {
    NavGridCard,
    NavItemMobile,
    type NavItemType,
    NavigationMenu,
    NavigationMenuContent,
    NavigationMenuItem,
    NavigationMenuLink,
    NavigationMenuList,
    NavigationMenuTrigger,
    NavLargeItem,
    NavSmallItem,
};
