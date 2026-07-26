'use client';

import {
    ArrowRight01Icon,
    Building2Icon,
    Cancel01Icon,
    ChevronDownIcon,
    FileAddIcon,
    Plus,
    Search01Icon,
} from '@hugeicons/core-free-icons';
import { useMemo, useRef, useState } from 'react';

import Icon from '@/components/icon';
import { Button } from '@/components/ui/button';
import {
    InputGroup,
    InputGroupAddon,
    InputGroupInput,
} from '@/components/ui/input-group';
import type { SmoothDropdownItem } from '@/components/ui/smooth-dropdown';
import { SmoothDropdwon } from '@/components/ui/smooth-dropdown';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { PlatformIcon } from '@/types/ui';

/**
 * Fictional company result surfaced by the "Company to investigate" picker.
 *
 * This prototype only persists UI state — these rows stand in for a future
 * Convex-backed SEC company lookup and are deliberately synthetic. Results
 * only appear once the analyst types a query; until then the picker shows an
 * empty-state hint. Selecting a result moves that company into the dossier
 * research context.
 */
interface CompanyResult {
    id: string;
    name: string;
    ticker: string;
    sector: string;
}

const COMPANY_CATALOG: readonly CompanyResult[] = [
    {
        id: 'snow',
        name: 'ServiceNow',
        ticker: 'NOW',
        sector: 'Enterprise software',
    },
    {
        id: 'crm',
        name: 'Salesforce',
        ticker: 'CRM',
        sector: 'Enterprise software',
    },
    {
        id: 'mdb',
        name: 'MongoDB',
        ticker: 'MDB',
        sector: 'Data infrastructure',
    },
    {
        id: 'ddog',
        name: 'Datadog',
        ticker: 'DDOG',
        sector: 'Observability',
    },
    {
        id: 'nety',
        name: 'NetEase',
        ticker: 'NTES',
        sector: 'Consumer internet',
    },
] as const;

export interface ResearchComposerProps {
    className?: string;
    placeholderText?: string;
}

/**
 * Central research composer for `/workspace/start`, adapted from the Qatalog
 * central zone reference (`docs/examples/qatalog-central-zone.md`):
 *
 * - One textarea where the analyst writes the research request directly
 *   (replaces the separate "Company" + "Focus" inputs).
 * - A "Company to investigate" SmoothDropdown bound to a fictional company lookup.
 *   Results render only once a query is typed, and selecting one sets it as the
 *   dossier's research context. The catalog stands in for the future SEC lookup.
 * - Composing surface only: maintains local prompt + selected company state.
 *   No workflow, no Convex writes — those come with the resolution slice.
 */
export function ResearchComposer({
    className,
    placeholderText = 'How can I help? Describe the resilience question to investigate.',
}: ResearchComposerProps) {
    const [prompt, setPrompt] = useState('');
    const [selectedCompany, setSelectedCompany] =
        useState<CompanyResult | null>(null);
    const [companyQuery, setCompanyQuery] = useState('');
    const [pickerOpen, setPickerOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const filteredCompanies = useMemo(() => {
        const q = companyQuery.trim().toLowerCase();
        if (!q) return [];
        return COMPANY_CATALOG.filter(
            (c) =>
                c.name.toLowerCase().includes(q) ||
                c.ticker.toLowerCase().includes(q) ||
                c.sector.toLowerCase().includes(q),
        );
    }, [companyQuery]);

    const hasQuery = companyQuery.trim().length > 0;

    const clearSelection = () => {
        setSelectedCompany(null);
        setCompanyQuery('');
    };

    const companyItems: SmoothDropdownItem[] = filteredCompanies.map(
        (company) => ({
            id: company.id,
            label: company.name,
            icon: Building2Icon,
            onSelect: () => setSelectedCompany(company),
            renderLabel: () => (
                <span className="flex flex-col">
                    <span className="text-sm font-medium text-foreground">
                        {company.name}
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground">
                        {company.ticker} · {company.sector}
                    </span>
                </span>
            ),
        }),
    );

    // The send button stays UX-enabled at all times. Programmatic gating in
    // `handleSend` decides whether to actually start the analysis or to nudge
    // the analyst toward the missing precondition first — a disabled button
    // hides the intent, an attention nudge teaches the flow.
    const companyResolved = selectedCompany !== null;

    const handleSend = () => {
        if (!companyResolved) {
        // No target company yet: surface the picker to attract attention
        // rather than failing silently. Selecting a company remains the
        // precondition to actually start the analysis.
            setPickerOpen(true);
            return;
        }
        // Real submission ships with the resolution slice. For now the
        // surface is intentionally inert once the precondition is met.
    };

    return (
        <div
            ref={containerRef}
            className={cn(
                'w-full rounded-lg border border-primary/80 bg-card shadow-lg',
                className,
            )}
        >
            {/* Prompt area + resolved company badge */}
            <div className="relative">
                {selectedCompany ? (
                    <CompanyContextBadge
                        company={selectedCompany}
                        onRemove={clearSelection}
                    />
                ) : null}
                <textarea
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    placeholder={placeholderText}
                    aria-label="Research request"
                    rows={3}
                    className={cn(
                        'block w-full resize-none rounded-t-2xl bg-transparent px-5 pt-5 pb-3 text-[15px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground',
                        selectedCompany && 'pt-12',
                    )}
                />
            </div>

            {/* Inline toolbar */}
            <div className="flex items-center justify-between gap-3 border-t border-border/20 px-3 py-3">
                <div className="bg-secondary/30 p-1 rounded-sm flex items-center gap-2">
                    <SmoothDropdwon
                        items={companyItems}
                        open={pickerOpen}
                        onOpenChange={setPickerOpen}
                        openWidth={320}
                        closedWidth={215}
                        closedHeight={36}
                        defaultActiveItemId={selectedCompany?.id}
                        trigger={
                            <CompanyPickerTrigger
                                label={
                                    selectedCompany?.name ??
                                    'Company to investigate'
                                }
                                ticker={selectedCompany?.ticker}
                                highlighted={selectedCompany !== null}
                            />
                        }
                        header={
                            <div className="flex flex-col gap-2">
                                <CompanySearchField
                                    value={companyQuery}
                                    onChange={setCompanyQuery}
                                />
                                <ClearSelectionButton
                                    disabled={selectedCompany === null}
                                    onClick={clearSelection}
                                />
                                {!hasQuery ? (
                                    <span className="px-2 py-1 text-xs text-muted-foreground">
                                        Type a name or ticker to search for a
                                        company to investigate.
                                    </span>
                                ) : filteredCompanies.length === 0 ? (
                                    <span className="px-2 py-1 text-xs text-muted-foreground">
                                        No matching company. Try another ticker
                                        or name.
                                    </span>
                                ) : null}
                            </div>
                        }
                    />
                    <ToolbarIconButton
                        label="Attach reference"
                        icon={FileAddIcon}
                    />
                    <ToolbarIconButton
                        label="More options"
                        icon={Plus}
                    />
                </div>

                <Button
                    type="button"
                    aria-label="Send request"
                    onClick={handleSend}
                    className="size-10 rounded-full"
                >
                    <Icon iconNode={ArrowRight01Icon} size={18} />
                </Button>
            </div>
        </div>
    );
}

/**
 * Pill-shaped trigger shown when the company picker is closed. Shows a
 * building mark, the resolved company (or the "Company to investigate" placeholder
 * before any selection), and a chevron.
 */
function CompanyPickerTrigger({
    label,
    ticker,
    highlighted,
}: {
    label: string;
    ticker?: string;
    highlighted: boolean;
}) {
    return (
        <Button
            variant="ghost"
            className={cn(
                'inline-flex h-9 items-center gap-2 text-sm transition-colors w-full',
                highlighted && 'ring-2 ring-primary text-accent-foreground',
            )}
        >
            <Icon
                iconNode={Building2Icon}
                size={16}
                className="text-muted-foreground"
            />
            <span className="font-medium">{label}</span>
            {ticker ? (
                <span className="font-mono text-[11px] text-muted-foreground">
                    {ticker}
                </span>
            ) : null}
            <Icon iconNode={ChevronDownIcon} size={14} />
        </Button>
    );
}

/**
 * Removable company badge anchored at the top-left of the prompt area.
 * Surfaces the resolved dossier context and exposes a cancel control that
 * clears the selection (and the picker query) without touching the prompt.
 */
function CompanyContextBadge({
    company,
    onRemove,
}: {
    company: CompanyResult;
    onRemove: () => void;
}) {
    return (
        <div
            data-testid="research-company-badge"
            className="pointer-events-none absolute inset-x-3 top-3 z-10 flex"
        >
            <span className="pointer-events-auto inline-flex items-center gap-1.5 bg-accent/20 px-1 text-xs text-foreground shadow-sm backdrop-blur-sm">
                <span className="text-micro">Context company:</span>
                <span className="font-semibold">{company.name}</span>
                <span className="font-mono text-[10px] text-muted-foreground">
                    {company.ticker}
                </span>
                <button
                    type="button"
                    aria-label="Remove company from context"
                    onClick={onRemove}
                    className="ml-0.5 inline-flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
                >
                    <Icon iconNode={Cancel01Icon} size={12} />
                </button>
            </span>
        </div>
    );
}

/**
 * Search input rendered inside the SmoothDropdown header. Local-only filter
 * until the company resolution lookup ships.
 */
function CompanySearchField({
    value,
    onChange,
}: {
    value: string;
    onChange: (next: string) => void;
}) {
    return (
        <InputGroup className="">
            <InputGroupAddon>
                <Icon
                    iconNode={Search01Icon}
                    size={15}
                    className="text-muted-foreground"
                />
            </InputGroupAddon>
            <InputGroupInput
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder="Search company or ticker"
                aria-label="Search companies"
            />
        </InputGroup>
    );
}

/**
 * Dedicated "Clear selection" control rendered in the dropdown header, right
 * under the search field. Stays always visible but is inert until a company
 * is resolved, so it never collides visually with the result rows below it.
 */
function ClearSelectionButton({
    disabled,
    onClick,
}: {
    disabled: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            aria-label="Clear selection"
            className={cn(
                'inline-flex items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
                disabled
                    ? 'cursor-not-allowed border-border/40 text-muted-foreground/40'
                    : 'border-border/70 bg-card text-muted-foreground hover:border-destructive/40 hover:bg-destructive/5 hover:text-destructive',
            )}
        >
            <Icon iconNode={Cancel01Icon} size={13} />
            Clear selection
        </button>
    );
}

/**
 * Compact icon button used on the composer toolbar (search / attach / clear).
 */
function ToolbarIconButton({
    label,
    icon,
    onClick,
    disabled = false,
}: {
    label: string;
    icon: PlatformIcon;
        onClick?: () => void;
        disabled?: boolean;
}) {
    return (
        <Tooltip>
            <TooltipTrigger render={<Button
            type="button"
                variant="secondary"
            aria-label={label}
            onClick={onClick}
            disabled={disabled}
                className="size-8 rounded-full"
        >
            <Icon iconNode={icon} size={16} />
            </Button>} />
            <TooltipContent side="top" align="center">
                <span className="text-xs opacity-80">{label}</span>
            </TooltipContent>
        </Tooltip>
    );
}
