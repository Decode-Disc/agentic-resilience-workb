'use client';

import { api } from '@convex/_generated/api';
import {
    ArrowLeft01Icon,
    ArrowRight01Icon,
    Building2Icon,
    Cancel01Icon,
    ChevronDownIcon,
    Plus,
    Search01Icon,
} from '@hugeicons/core-free-icons';
import { useNavigate } from '@tanstack/react-router';
import { useAction, useQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useRef, useState } from 'react';
import { CompanyFaviconAvatar } from '@/components/company-favicon-avatar';
import Icon from '@/components/icon';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    InputGroup,
    InputGroupAddon,
    InputGroupInput,
} from '@/components/ui/input-group';
import { Skeleton } from '@/components/ui/skeleton';
import { SmoothDropdwon } from '@/components/ui/smooth-dropdown';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { AddSourceDialog } from '@/components/workspace/add-source-dialog';
import { CompanyResolutionCard } from '@/components/workspace/company-resolution-card';
import {
    MoreOptionsButton,
    ToolbarIconButton,
} from '@/components/workspace/composer-toolbar-actions';
import {
    type CoveragePreset,
    CoveragePresetPicker,
} from '@/components/workspace/coverage-preset-picker';
import { useInvitationAccess } from '@/components/workspace/invitation-access-context';
import { useAnonymousSession } from '@/hooks/use-anonymous-session';
import { useResponsive } from '@/hooks/use-responsive';
import { companyLookupErrorMessage } from '@/lib/presentation/research-copy';
import { cn } from '@/lib/utils';

type PreflightResult = FunctionReturnType<
    typeof api.companyResolution.preflight
>;
type CompanyCandidate = FunctionReturnType<
    typeof api.companyResolution.search
>[number];

const viewEnterTransition = {
    type: 'spring' as const,
    stiffness: 360,
    damping: 30,
    mass: 0.8,
};
const viewExitTransition = {
    duration: 0.14,
    ease: [0.32, 0.72, 0, 1] as const,
};

export interface ResearchComposerProps {
    className?: string;
    placeholderText?: string;
}

/**
 * Preserves the established research composer while owning the real two-step
 * company resolution and launch boundary.
 */
export function ResearchComposer({
    className,
    placeholderText = 'How can I help? Describe the resilience question to investigate.',
}: ResearchComposerProps) {
    const navigate = useNavigate();
    const searchCompanies = useAction(api.companyResolution.search);
    const preflight = useAction(api.companyResolution.preflight);
    const confirmAndStart = useAction(api.researchLaunch.confirmAndStart);
    const reduceMotion = useReducedMotion();
    const { isSessionReady, sessionError } = useAnonymousSession();
    const visitor = useQuery(
        api.visitors.current,
        isSessionReady ? {} : 'skip',
    );
    const [researchAngle, setResearchAngle] = useState('');
    const [companyQuery, setCompanyQuery] = useState('');
    const [coveragePreset, setCoveragePreset] =
        useState<CoveragePreset>('balanced');
    const [resolution, setResolution] = useState<PreflightResult | null>(null);
    const [companyCandidates, setCompanyCandidates] = useState<
        Array<CompanyCandidate>
    >([]);
    const { isMobile } = useResponsive();
    const [hasSearched, setHasSearched] = useState(false);
    const [view, setView] = useState<'compose' | 'confirm'>('compose');
    const [pickerOpen, setPickerOpen] = useState(false);
    const [isSearching, setIsSearching] = useState(false);
    const [selectingCik, setSelectingCik] = useState<string | null>(null);
    const [isLaunching, setIsLaunching] = useState(false);
    const [lookupError, setLookupError] = useState<string | null>(null);
    const [launchError, setLaunchError] = useState<string | null>(null);
    const { openInvitationDrawer } = useInvitationAccess();
    const [referencesOpen, setReferencesOpen] = useState(false);
    const [manualSourceUrls, setManualSourceUrls] = useState<Array<string>>([]);
    const launchKey = useRef<string | null>(null);

    const searchForCompanies = async () => {
        if (!isSessionReady) {
            setLookupError(
                sessionError ?? 'Preparing your research workspace…',
            );
            setPickerOpen(true);
            return;
        }

        const query = companyQuery.trim();
        if (!query) {
            setLookupError('Enter a company name, ticker, CIK, or SEC URL.');
            setPickerOpen(true);
            return;
        }

        setLookupError(null);
        setLaunchError(null);
        setIsSearching(true);
        setHasSearched(false);

        try {
            const results = await searchCompanies({ query });
            setCompanyCandidates([...results]);
            setHasSearched(true);
            setPickerOpen(true);
        } catch {
            setCompanyCandidates([]);
            setLookupError("We couldn't search for companies. Try again.");
            setHasSearched(true);
        } finally {
            setIsSearching(false);
        }
    };

    const selectCompany = async (candidate: CompanyCandidate) => {
        if (selectingCik) {
            return;
        }
        setLookupError(null);
        setSelectingCik(candidate.cik);
        try {
            const result = await preflight({ cik: candidate.cik });
            setResolution(result);
            setPickerOpen(false);
            launchKey.current = null;
        } catch (error) {
            setLookupError(companyLookupErrorMessage(error));
            setPickerOpen(true);
        } finally {
            setSelectingCik(null);
        }
    };

    const clearResolution = () => {
        setResolution(null);
        setCompanyQuery('');
        setCompanyCandidates([]);
        setHasSearched(false);
        setView('compose');
        setLookupError(null);
        setLaunchError(null);
        launchKey.current = null;
    };

    const startResearch = async () => {
        if (!resolution || isLaunching) {
            if (!resolution) {
                setPickerOpen(true);
            }
            return;
        }

        setIsLaunching(true);
        setLaunchError(null);
        launchKey.current ??= crypto.randomUUID();

        try {
            const result = await confirmAndStart({
                preflightId: resolution.preflightId,
                idempotencyKey: launchKey.current,
                coveragePreset,
                researchAngle: researchAngle.trim() || undefined,
                manualSourceUrls:
                    manualSourceUrls.length > 0 ? manualSourceUrls : undefined,
            });
            await navigate({
                to: '/workspace/$runId',
                params: { runId: result.runId },
                search: { section: 'progress' },
            });
        } catch {
            setLaunchError(
                "We couldn't start this research dossier. Try again.",
            );
            setIsLaunching(false);
        }
    };

    const launch = () => {
        if (!resolution || isLaunching) {
            if (!resolution) {
                setPickerOpen(true);
            }
            return;
        }

        if (visitor?.status !== 'active') {
            openInvitationDrawer({
                onSuccess: () => {
                    void startResearch();
                },
            });
            return;
        }

        void startResearch();
    };

    return (
        <>
            <section
                className={cn('w-full overflow-visible', className)}
                aria-label="Research launch"
            >
                <AnimatePresence initial={false} mode="wait">
                    {view === 'compose' ? (
                        <motion.div
                            key="compose"
                            className="rounded-lg border border-accent/60 bg-card shadow-lg"
                            initial={
                                reduceMotion
                                    ? false
                                    : { opacity: 0, scale: 0.97 }
                            }
                            animate={{ opacity: 1, scale: 1 }}
                            exit={
                                reduceMotion
                                    ? {
                                          opacity: 1,
                                          transition: { duration: 0 },
                                      }
                                    : {
                                          opacity: 0,
                                          scale: 0.985,
                                          transition: viewExitTransition,
                                      }
                            }
                            transition={
                                reduceMotion
                                    ? { duration: 0 }
                                    : viewEnterTransition
                            }
                            style={{ transformOrigin: '50% 45%' }}
                        >
                            <div className="relative">
                                {resolution ? (
                                    <CompanyContextBadge
                                        company={resolution.company}
                                        onRemove={clearResolution}
                                    />
                                ) : null}
                                <label
                                    htmlFor="research-angle"
                                    className="sr-only"
                                >
                                    Research request — optional research angle
                                </label>
                                <textarea
                                    id="research-angle"
                                    value={researchAngle}
                                    onChange={(event) =>
                                        setResearchAngle(event.target.value)
                                    }
                                    placeholder={placeholderText}
                                    rows={3}
                                    className={cn(
                                        'block w-full resize-none rounded-t-lg bg-transparent px-5 pt-5 pb-3 text-[15px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground',
                                        resolution && 'pt-14',
                                    )}
                                />
                            </div>

                            <div className="flex items-center justify-between gap-3 border-t border-border/20 px-3 py-3">
                                <div className="flex items-center gap-2 rounded-sm bg-secondary/30 p-1">
                                    <SmoothDropdwon
                                        items={companyCandidates.map(
                                            (candidate) => ({
                                                id: `${candidate.cik}-${candidate.ticker}`,
                                                label: `${candidate.legalName} ${candidate.ticker} ${candidate.exchange} CIK ${candidate.cik}`,
                                                closeOnSelect: false,
                                                onSelect: () =>
                                                    void selectCompany(
                                                        candidate,
                                                    ),
                                                renderLabel: () => (
                                                    <CompanyCandidateLabel
                                                        company={candidate}
                                                        selecting={
                                                            selectingCik ===
                                                            candidate.cik
                                                        }
                                                    />
                                                ),
                                            }),
                                        )}
                                        open={pickerOpen}
                                        onOpenChange={setPickerOpen}
                                        openWidth={isMobile ? 300 : 400}
                                        closedWidth={215}
                                        closedHeight={36}
                                        itemsAriaLabel="Company search results"
                                        className={
                                            pickerOpen ? 'z-10' : undefined
                                        }
                                        trigger={
                                            <CompanyPickerTrigger
                                                label={
                                                    resolution
                                                        ? resolution.company
                                                              .legalName
                                                        : 'Company to investigate'
                                                }
                                                ticker={
                                                    resolution?.company.ticker
                                                }
                                                highlighted={
                                                    resolution !== null
                                                }
                                            />
                                        }
                                        header={
                                            <CompanyLookup
                                                companyQuery={companyQuery}
                                                isSearching={isSearching}
                                                lookupError={
                                                    sessionError ?? lookupError
                                                }
                                                hasResolution={
                                                    resolution !== null
                                                }
                                                hasSearched={hasSearched}
                                                resultCount={
                                                    companyCandidates.length
                                                }
                                                onCompanyQueryChange={(
                                                    next,
                                                ) => {
                                                    setCompanyQuery(next);
                                                    setHasSearched(false);
                                                    setCompanyCandidates([]);
                                                    setLookupError(null);
                                                }}
                                                onClear={clearResolution}
                                                onSearch={() =>
                                                    void searchForCompanies()
                                                }
                                                sessionReady={isSessionReady}
                                            />
                                        }
                                    />
                                    <ToolbarIconButton
                                        label="Attach references"
                                        icon={Plus}
                                        count={manualSourceUrls.length}
                                        onClick={() => setReferencesOpen(true)}
                                    />
                                    <MoreOptionsButton />
                                </div>

                                <Button
                                    type="button"
                                    aria-label={
                                        resolution ? 'Continue' : 'Send request'
                                    }
                                    onClick={() =>
                                        resolution
                                            ? setView('confirm')
                                            : setPickerOpen(true)
                                    }
                                    className="size-10 rounded-full"
                                >
                                    <Icon
                                        iconNode={ArrowRight01Icon}
                                        size={18}
                                    />
                                </Button>
                            </div>
                        </motion.div>
                    ) : resolution ? (
                        <motion.div
                            key="confirm"
                            className="rounded-lg space-y-5 bg-card/60 px-4 py-5"
                            initial={
                                reduceMotion
                                    ? false
                                    : { opacity: 0, scale: 0.96 }
                            }
                            animate={{ opacity: 1, scale: 1 }}
                            exit={
                                reduceMotion
                                    ? {
                                          opacity: 1,
                                          transition: { duration: 0 },
                                      }
                                    : {
                                          opacity: 0,
                                          scale: 0.985,
                                          transition: viewExitTransition,
                                      }
                            }
                            transition={
                                reduceMotion
                                    ? { duration: 0 }
                                    : viewEnterTransition
                            }
                            style={{ transformOrigin: '50% 45%' }}
                        >
                            <CompanyResolutionCard
                                company={resolution.company}
                            />
                            <CoveragePresetPicker
                                value={coveragePreset}
                                onChange={setCoveragePreset}
                            />
                            {launchError ? (
                                <p
                                    role="alert"
                                    className="text-sm text-destructive"
                                >
                                    {launchError}
                                </p>
                            ) : null}
                            <div className="flex items-center justify-between gap-3 border-t border-border/40 pt-4">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => setView('compose')}
                                    disabled={isLaunching}
                                >
                                    <Icon iconNode={ArrowLeft01Icon} />
                                    Back
                                </Button>
                                <Button
                                    type="button"
                                    aria-label="Confirm and start"
                                    onClick={launch}
                                    disabled={isLaunching}
                                    className="rounded-full px-4"
                                >
                                    {isLaunching
                                        ? 'Starting…'
                                        : 'Confirm and start'}
                                    <Icon
                                        iconNode={ArrowRight01Icon}
                                        size={18}
                                    />
                                </Button>
                            </div>
                        </motion.div>
                    ) : null}
                </AnimatePresence>
            </section>

            <AddSourceDialog
                open={referencesOpen}
                onOpenChange={setReferencesOpen}
                urls={manualSourceUrls}
                onUrlsChange={setManualSourceUrls}
            />
        </>
    );
}

function CompanyLookup({
    companyQuery,
    isSearching,
    lookupError,
    hasResolution,
    hasSearched,
    resultCount,
    onCompanyQueryChange,
    onClear,
    onSearch,
    sessionReady,
}: {
    companyQuery: string;
    isSearching: boolean;
    lookupError: string | null;
    hasResolution: boolean;
    hasSearched: boolean;
    resultCount: number;
    onCompanyQueryChange: (next: string) => void;
    onClear: () => void;
    onSearch: () => void;
    sessionReady: boolean;
}) {
    return (
        <form
            aria-label="Company lookup"
            className="flex flex-col gap-2"
            onSubmit={(event) => {
                event.preventDefault();
                onSearch();
            }}
        >
            <InputGroup>
                <InputGroupAddon>
                    <Icon
                        iconNode={Search01Icon}
                        size={15}
                        className="text-muted-foreground"
                    />
                </InputGroupAddon>
                <InputGroupInput
                    value={companyQuery}
                    onChange={(event) =>
                        onCompanyQueryChange(event.target.value)
                    }
                    placeholder="Search company by Name, ticker, CIK, or SEC URL"
                    aria-label="Company search"
                    aria-invalid={Boolean(lookupError)}
                    autoComplete="off"
                />
            </InputGroup>
            <div className="flex items-center gap-2">
                <Button
                    type="submit"
                    variant="secondary"
                    size="sm"
                    disabled={isSearching || !sessionReady}
                    className="flex-1"
                >
                    <Icon iconNode={Search01Icon} />
                    {isSearching
                        ? 'Searching…'
                        : sessionReady
                          ? 'Search'
                          : 'Preparing workspace…'}
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onClear}
                    disabled={!hasResolution && companyQuery.length === 0}
                >
                    <Icon iconNode={Cancel01Icon} />
                    Clear
                </Button>
            </div>
            {isSearching ? (
                <div
                    role="status"
                    aria-label="Searching companies"
                    aria-busy="true"
                    className="space-y-2 rounded-lg border border-border/60 p-3"
                >
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                </div>
            ) : lookupError ? (
                <p role="alert" className="px-1 text-xs text-destructive">
                    {lookupError}
                </p>
            ) : hasSearched && resultCount === 0 ? (
                <p role="status" className="px-1 text-xs text-muted-foreground">
                    No matching companies.
                </p>
            ) : null}
        </form>
    );
}

function CompanyCandidateLabel({
    company,
    selecting,
}: {
    company: CompanyCandidate;
    selecting: boolean;
}) {
    return (
        <span className="flex min-w-0 items-center gap-3 pr-2">
            <CompanyFaviconAvatar company={company} />
            <Tooltip>
                <TooltipTrigger
                    render={
                        <span className="min-w-0 flex-1">
                            <span className="block max-w-60 md:max-w-80 truncate font-medium text-foreground">
                                {company.legalName}
                            </span>
                            <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">
                                {company.ticker} · {company.exchange} · CIK{' '}
                                {company.cik}
                            </span>
                        </span>
                    }
                />
                <TooltipContent>
                    <p>{company.legalName}</p>
                </TooltipContent>
            </Tooltip>
            {selecting ? (
                <span className="shrink-0 text-xs text-muted-foreground">
                    Selecting…
                </span>
            ) : null}
        </span>
    );
}

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
            type="button"
            variant="ghost"
            className={cn(
                'inline-flex h-9 w-full items-center gap-2 text-sm transition-colors',
                highlighted && 'ring-2 ring-primary text-accent-foreground',
            )}
        >
            <Icon
                iconNode={Building2Icon}
                size={16}
                className="text-muted-foreground"
            />
            <span className="min-w-0 flex-1 truncate text-left font-medium">
                {label}
            </span>
            {ticker ? (
                <span className="font-mono text-[11px] text-muted-foreground">
                    {ticker}
                </span>
            ) : null}
            <Icon iconNode={ChevronDownIcon} size={14} />
        </Button>
    );
}

function CompanyContextBadge({
    company,
    onRemove,
}: {
    company: PreflightResult['company'];
    onRemove: () => void;
}) {
    return (
        <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex">
            <Badge
                variant="outline"
                color="sky"
                showDot
                className="rounded-none pointer-events-auto inline-flex max-w-full items-center gap-1.5 px-1 text-xs shadow-sm backdrop-blur-sm"
            >
                <span className="text-micro">Selected company:</span>
                <span className="max-w-60 truncate font-medium">
                    {company.legalName}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">
                    {company.ticker}
                </span>
                <button
                    type="button"
                    aria-label="Remove selected company"
                    onClick={onRemove}
                    className="ml-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
                >
                    <Icon iconNode={Cancel01Icon} size={12} />
                </button>
            </Badge>
        </div>
    );
}
