'use client';

import {
    Cancel01Icon,
    Delete02Icon,
    MoreVerticalSquare01Icon,
} from '@hugeicons/core-free-icons';
import { useState } from 'react';

import Icon from '@/components/icon';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import type { PlatformIcon } from '@/types/ui';

export interface ToolbarIconButtonProps {
    label: string;
    icon: PlatformIcon;
    onClick?: () => void;
    disabled?: boolean;
    count?: number;
}

/**
 * Preserves the compact icon action used throughout the composer toolbar.
 */
export function ToolbarIconButton({
    label,
    icon,
    onClick,
    disabled = false,
    count,
}: ToolbarIconButtonProps) {
    const visibleCount = count && count > 0 ? count : undefined;
    const accessibleLabel = visibleCount ? `${label} (${visibleCount})` : label;

    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <Button
                        type="button"
                        variant="secondary"
                        size="icon-sm"
                        aria-label={accessibleLabel}
                        onClick={onClick}
                        disabled={disabled}
                        className="relative overflow-visible rounded-full"
                    />
                }
            >
                <Icon iconNode={icon} size={16} />
                {visibleCount ? (
                    <span
                        aria-hidden="true"
                        className="pointer-events-none absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-mono text-[9px] leading-none font-semibold text-primary-foreground"
                    >
                        {visibleCount}
                    </span>
                ) : null}
            </TooltipTrigger>
            <TooltipContent side="top" align="center">
                {label}
            </TooltipContent>
        </Tooltip>
    );
}

export interface PublicReferencesDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    urls: ReadonlyArray<string>;
    onUrlsChange: (urls: Array<string>) => void;
}

/**
 * Collects public source links for server validation during research launch.
 */
export function PublicReferencesDialog({
    open,
    onOpenChange,
    urls,
    onUrlsChange,
}: PublicReferencesDialogProps) {
    const [url, setUrl] = useState('');
    const [error, setError] = useState<string | null>(null);

    const addReference = () => {
        const candidate = url.trim();
        let parsed: URL;
        try {
            parsed = new URL(candidate);
        } catch {
            setError(
                'Enter a valid public source link beginning with https://.',
            );
            return;
        }
        if (
            parsed.protocol !== 'https:' ||
            parsed.username !== '' ||
            parsed.password !== ''
        ) {
            setError(
                'Enter a valid public source link beginning with https://.',
            );
            return;
        }
        if (urls.includes(candidate)) {
            setError('This reference has already been added.');
            return;
        }

        onUrlsChange([...urls, candidate]);
        setUrl('');
        setError(null);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Add public references</DialogTitle>
                    <DialogDescription>
                        Add public links you want considered during source
                        review.
                    </DialogDescription>
                </DialogHeader>

                <form
                    className="space-y-4"
                    onSubmit={(event) => {
                        event.preventDefault();
                        addReference();
                    }}
                >
                    <div className="space-y-2">
                        <Label htmlFor="composer-public-reference">
                            Public source link
                        </Label>
                        <div className="flex flex-col gap-2 sm:flex-row">
                            <InputGroup>
                                <InputGroupInput
                                    id="composer-public-reference"
                                    type="url"
                                    value={url}
                                    onChange={(event) => {
                                        setUrl(event.target.value);
                                        setError(null);
                                    }}
                                    placeholder="https://company.example/report"
                                    aria-invalid={error ? true : undefined}
                                    autoComplete="url"
                                />
                                {url.trim() !== '' ? (
                                    <InputGroupAddon align="inline-end">
                                        <Button type="button" variant="ghost" size="icon-xs" aria-label="Clear input" onClick={() => setUrl('')}>
                                            <Icon iconNode={Cancel01Icon} className="text-muted-foreground" />
                                        </Button>
                                    </InputGroupAddon>) : null}
                            </InputGroup>
                            <Button
                                type="submit"
                                variant="secondary"
                                disabled={url.trim() === ''}
                            >
                                Save
                            </Button>
                        </div>
                        {error ? (
                            <p
                                role="alert"
                                className="text-xs text-destructive"
                            >
                                {error}
                            </p>
                        ) : null}
                    </div>

                    {urls.length > 0 ? (
                        <ul
                            aria-label="Added public references"
                            className="max-h-52 space-y-2 overflow-y-auto"
                        >
                            {urls.map((referenceUrl) => (
                                <li
                                    key={referenceUrl}
                                    className="surface-panel flex items-center gap-2 rounded-lg px-3 py-2"
                                >
                                    <span className="min-w-0 flex-1 truncate font-mono text-xs">
                                        {referenceUrl}
                                    </span>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-xs"
                                        aria-label={`Remove ${referenceUrl}`}
                                        onClick={() =>
                                            onUrlsChange(
                                                urls.filter(
                                                    (item) =>
                                                        item !== referenceUrl,
                                                ),
                                            )
                                        }
                                    >
                                        <Icon
                                            iconNode={Delete02Icon}
                                            size={14}
                                            className="text-destructive"
                                        />
                                    </Button>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-xs text-muted-foreground">
                            No references added yet.
                        </p>
                    )}
                </form>

                <DialogFooter>
                    <Button type="button" onClick={() => onOpenChange(false)}>
                        Done
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

/**
 * Keeps the established overflow action available for future composer tools.
 */
export function MoreOptionsButton() {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                render={
                    <Button
                        type="button"
                        variant="secondary"
                        size="icon-sm"
                        aria-label="More options"
                        aria-haspopup="menu"
                        className="rounded-full"
                    />
                }
            >
                <Icon iconNode={MoreVerticalSquare01Icon} size={16} />
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align="start"
                sideOffset={6}
                className="min-w-52"
            >
                <DropdownMenuGroup>
                    <DropdownMenuLabel>More options</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem disabled>
                        No additional options
                    </DropdownMenuItem>
                </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
