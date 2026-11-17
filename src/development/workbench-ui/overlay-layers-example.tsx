import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    Drawer,
    DrawerContent,
    DrawerTitle,
    DrawerTrigger,
} from "@/components/ui/drawer";
import {
    Popover,
    PopoverContent,
    PopoverTitle,
    PopoverTrigger,
} from "@/components/ui/popover";
import {
    Sheet,
    SheetContent,
    SheetTitle,
    SheetTrigger,
} from "@/components/ui/sheet";

/** Exercises overlapping real portals without authentication or provider calls. */
export function OverlayLayersExample() {
    const [kind, setKind] = useState("drawer");
    const Root = kind === "drawer" ? Drawer : kind === "sheet" ? Sheet : Dialog;
    const Trigger =
        kind === "drawer"
            ? DrawerTrigger
            : kind === "sheet"
              ? SheetTrigger
              : DialogTrigger;
    const Content =
        kind === "drawer"
            ? DrawerContent
            : kind === "sheet"
              ? SheetContent
              : DialogContent;
    const Title =
        kind === "drawer"
            ? DrawerTitle
            : kind === "sheet"
              ? SheetTitle
              : DialogTitle;
    return (
        <div className="min-h-screen p-6">
            <label>
                Modal type{" "}
                <select
                    aria-label="Modal type"
                    value={kind}
                    onChange={(e) => setKind(e.target.value)}>
                    <option>drawer</option>
                    <option>sheet</option>
                    <option>dialog</option>
                </select>
            </label>
            <Popover
                defaultOpen
                modal={false}
                onOpenChange={(_, details) => details.cancel()}>
                <PopoverTrigger render={<Button variant="outline" />}>
                    Background context
                </PopoverTrigger>
                <PopoverContent layer="context">
                    <PopoverTitle>Background research context</PopoverTitle>
                    Retained material
                </PopoverContent>
            </Popover>
            <Root>
                <Trigger render={<Button />}>Open modal</Trigger>
                <Content>
                    <Title>Access verification</Title>
                    <Popover>
                        <PopoverTrigger render={<Button />}>
                            Modal options
                        </PopoverTrigger>
                        <PopoverContent>
                            <PopoverTitle>Options in modal</PopoverTitle>
                            <Button>Choose option</Button>
                        </PopoverContent>
                    </Popover>
                    <Drawer>
                        <DrawerTrigger render={<Button />}>
                            Open nested modal
                        </DrawerTrigger>
                        <DrawerContent>
                            <DrawerTitle>Nested verification</DrawerTitle>
                            <Popover>
                                <PopoverTrigger render={<Button />}>
                                    Nested options
                                </PopoverTrigger>
                                <PopoverContent>
                                    <PopoverTitle>Nested choices</PopoverTitle>
                                    <Button>Choose nested option</Button>
                                </PopoverContent>
                            </Popover>
                        </DrawerContent>
                    </Drawer>
                </Content>
            </Root>
        </div>
    );
}
