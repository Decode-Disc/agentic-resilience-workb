"use client";

import {
    Cancel01Icon,
    Delete02Icon,
    File01Icon,
    LinkSquare01Icon,
    Loading02Icon,
    PlusIcon,
} from "@hugeicons/core-free-icons";
import { type ComponentProps, type ReactElement, useState } from "react";
import Icon from "@/components/icon";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { FileDropzone } from "@/components/ui/file-dropzone";
import {
    InputGroup,
    InputGroupAddon,
    InputGroupInput,
} from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { sourceAddErrorMessage } from "@/lib/presentation/research-copy";

/**
 * Pure helper for validating public HTTPS source URLs.
 * Rejects non-HTTPS schemes, empty input, invalid URLs, and embedded credentials.
 */
export function validatePublicSourceUrl(url: string): boolean {
    const candidate = url.trim();
    if (!candidate) return false;
    let parsed: URL;
    try {
        parsed = new URL(candidate);
    } catch {
        return false;
    }
    return (
        parsed.protocol === "https:" &&
        parsed.username === "" &&
        parsed.password === ""
    );
}

export interface AddSourceDialogProps {
    /** Optional trigger element (e.g. Button) to open the dialog. */
    trigger?: ReactElement;
    /** Controlled open state. */
    open?: boolean;
    /** Controlled open change handler. */
    onOpenChange?: (open: boolean) => void;
    /** Optional list of staged URLs managed by parent state (e.g. the dossier-creation screen). */
    urls?: ReadonlyArray<string>;
    /** Optional handler for staged URL updates. */
    onUrlsChange?: (urls: Array<string>) => void;
    /** Optional direct callback for adding a single source URL to a live run. */
    onAdd?: (url: string) => void | Promise<void>;
    finalFocus?: ComponentProps<typeof DialogContent>["finalFocus"];
    className?: string;
}

/**
 * Reusable modal for adding public source links to research runs or staging references.
 *
 * Prototype invariant:
 * File upload ingestion is shown via FileDropzone but set to disabled, with a tooltip
 * explaining that file ingestion is unsupported in this prototype and only public
 * HTTPS source links are accepted.
 */
export function AddSourceDialog({
    trigger,
    open: openProp,
    onOpenChange: onOpenChangeProp,
    urls,
    onUrlsChange,
    onAdd,
    finalFocus,
}: AddSourceDialogProps) {
    const isControlled = openProp !== undefined;
    const [internalOpen, setInternalOpen] = useState(false);
    const open = isControlled ? openProp : internalOpen;

    const [urlInput, setUrlInput] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [confirmation, setConfirmation] = useState<string | null>(null);

    const handleOpenChange = (nextOpen: boolean) => {
        if (!isControlled) {
            setInternalOpen(nextOpen);
        }
        onOpenChangeProp?.(nextOpen);
        if (!nextOpen) {
            setUrlInput("");
            setError(null);
            setConfirmation(null);
        }
    };

    const handleAddSource = async () => {
        const candidate = urlInput.trim();
        if (!validatePublicSourceUrl(candidate)) {
            setError(
                "Enter a valid public source link beginning with https://.",
            );
            return;
        }

        setIsSubmitting(true);
        setError(null);
        setConfirmation(null);

        try {
            if (onAdd) {
                await onAdd(candidate);
                setUrlInput("");
                setConfirmation("Source added for your review.");
            } else if (urls && onUrlsChange) {
                if (urls.includes(candidate)) {
                    setError("This reference has already been added.");
                    setIsSubmitting(false);
                    return;
                }
                onUrlsChange([...urls, candidate]);
                setUrlInput("");
                setConfirmation("Source added for your review.");
            }
        } catch (caught) {
            setError(sourceAddErrorMessage(caught));
        } finally {
            setIsSubmitting(false);
        }
    };

    const content = (
        <DialogContent finalFocus={finalFocus}>
            <DialogHeader>
                <DialogTitle>Add public sources</DialogTitle>
                <DialogDescription>
                    Add public links or review file ingestion options for your
                    research dossier.
                </DialogDescription>
            </DialogHeader>

            <div className="max-h-[50vh] overflow-y-auto space-y-5 py-2">
                {/* Public Source Link Form */}
                <form
                    className="space-y-3 border-t border-border/40 pt-4"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void handleAddSource();
                    }}>
                    <div className="space-y-2">
                        <Label
                            htmlFor="add-source-public-url"
                            className="flex items-center gap-1.5 font-medium">
                            <Icon
                                iconNode={LinkSquare01Icon}
                                size={14}
                                className="opacity-70"
                            />
                            Public source link
                        </Label>
                        <div className="flex flex-col gap-1 sm:flex-row">
                            <InputGroup className="flex-1">
                                <InputGroupInput
                                    id="add-source-public-url"
                                    type="url"
                                    value={urlInput}
                                    onChange={(event) => {
                                        setUrlInput(event.target.value);
                                        setError(null);
                                        setConfirmation(null);
                                    }}
                                    placeholder="https://company.example/report"
                                    aria-invalid={error ? true : undefined}
                                    autoComplete="url"
                                />
                                {urlInput.trim() !== "" ? (
                                    <InputGroupAddon align="inline-end">
                                        <button
                                            type="button"
                                            aria-label="Clear input"
                                            onClick={() => setUrlInput("")}>
                                            <Icon
                                                iconNode={Cancel01Icon}
                                                className="text-muted-foreground hover:text-foreground size-4"
                                            />
                                        </button>
                                    </InputGroupAddon>
                                ) : null}
                            </InputGroup>
                            <Button
                                type="submit"
                                aria-label="Add"
                                variant="secondary"
                                size="icon"
                                className="mx-0 rounded-full"
                                disabled={
                                    isSubmitting || urlInput.trim() === ""
                                }>
                                <Icon
                                    iconNode={
                                        isSubmitting ? Loading02Icon : PlusIcon
                                    }
                                    className={
                                        isSubmitting ? "animate-spin" : ""
                                    }
                                />
                            </Button>
                        </div>
                        {error ? (
                            <p
                                role="alert"
                                className="text-xs text-destructive">
                                {error}
                            </p>
                        ) : null}
                        {confirmation ? (
                            <p
                                role="status"
                                className="text-xs text-foreground">
                                {confirmation}
                            </p>
                        ) : null}
                    </div>

                    {/* Staged references list */}
                    {urls && urls.length > 0 ? (
                        <div className="space-y-2 pt-2">
                            <Label className="text-xs text-muted-foreground">
                                Staged references ({urls.length})
                            </Label>
                            <ul
                                aria-label="Added public references"
                                className="max-h-44 space-y-2 overflow-y-auto">
                                {urls.map((referenceUrl) => (
                                    <li
                                        key={referenceUrl}
                                        className="surface-panel flex items-center gap-2 rounded-lg px-3 py-2">
                                        <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                                            {referenceUrl}
                                        </span>
                                        {onUrlsChange ? (
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon-xs"
                                                aria-label={`Remove ${referenceUrl}`}
                                                onClick={() =>
                                                    onUrlsChange(
                                                        urls.filter(
                                                            (item) =>
                                                                item !==
                                                                referenceUrl,
                                                        ),
                                                    )
                                                }>
                                                <Icon
                                                    iconNode={Delete02Icon}
                                                    size={14}
                                                    className="text-destructive"
                                                />
                                            </Button>
                                        ) : null}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ) : null}
                </form>

                {/* Document Ingestion (Prototype) section */}
                <div className="space-y-2">
                    <Label
                        aria-disabled
                        className="flex items-center gap-1.5 font-medium text-muted-foreground">
                        <Icon
                            iconNode={File01Icon}
                            size={14}
                            className="opacity-70"
                        />
                        Document ingestion
                    </Label>

                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger
                                render={
                                    <div className="relative">
                                        <FileDropzone
                                            disabled={true}
                                            onFilesDropped={() => undefined}
                                            acceptedFileTypes={[
                                                "PDF",
                                                "SEC",
                                                "HTML",
                                                "TXT",
                                            ]}
                                        />
                                    </div>
                                }
                            />
                            <TooltipContent
                                side="top"
                                align="center"
                                className="max-w-xs text-center">
                                File upload is not supported in this prototype.
                                Add only public source links.
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
            </div>

            <DialogFooter>
                <Button
                    type="button"
                    size="lg"
                    onClick={() => handleOpenChange(false)}>
                    Done
                </Button>
            </DialogFooter>
        </DialogContent>
    );

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            {trigger ? <DialogTrigger render={trigger} /> : null}
            {content}
        </Dialog>
    );
}
