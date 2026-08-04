import { api } from '@convex/_generated/api';
import {
    Add01Icon,
    ChevronDownIcon,
    Folder02Icon,
    Tick02Icon,
} from '@hugeicons/core-free-icons';
import { Link, useNavigate } from '@tanstack/react-router';
import { useAction, useQuery } from 'convex/react';
import React, { Component, type ReactNode, useEffect, useRef } from 'react';
import { CompanyFaviconAvatar } from '@/components/company-favicon-avatar';
import Icon from '@/components/icon';
import { Button, buttonVariants } from '@/components/ui/button';
import {
    NestedMenu,
    type NestedMenuSectionProps,
} from '@/components/ui/nested-menu';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useResponsive } from '@/hooks/use-responsive';
import { cn } from '@/lib/utils';

export interface AnalyzedCompanyListProps {
    activeRunId?: string;
    className?: string;
    enabled?: boolean;
    isAdmissionLoading?: boolean;
}

/** Owner-scoped run navigation with explicit loading and empty states. */
export function AnalyzedCompanyList(props: AnalyzedCompanyListProps) {
    return (
        <AnalyzedCompanyListErrorBoundary className={props.className}>
            <AnalyzedCompanyListContent {...props} />
        </AnalyzedCompanyListErrorBoundary>
    );
}

function DossiersButton({ className }: { className?: string }) {
    return (
        <Button
            render={<Link to="/workspace/dossiers" />}
            nativeButton={false}
            variant="secondary"
            size="sm"
            aria-label="Go to dossiers"
            title="Go to dossiers"
            className={cn('gap-2 text-xs font-medium', className)}
        >
            <Icon
                iconNode={Folder02Icon}
                data-icon="inline-start"
                className="text-muted-foreground"
            />
            <span className="hidden">Dossiers</span>
        </Button>
    );
}

function AnalyzedCompanyListContent({
    activeRunId,
    className,
    enabled = true,
    isAdmissionLoading = false,
}: AnalyzedCompanyListProps) {
    const { isMobile } = useResponsive();
    const navigate = useNavigate();
    const runs = useQuery(api.researchRuns.listMine, enabled ? {} : 'skip');
    const ensureRunCompanyWebsite = useAction(
        api.companyResolution.ensureRunCompanyWebsite,
    );
    const requestedWebsiteBackfills = useRef(new Set<string>());
    const availableRuns = runs ?? [];

    useEffect(() => {
        if (!enabled || isAdmissionLoading || runs === undefined) {
            return;
        }
        const legacyRun = availableRuns.find(
            (run) =>
                run.company &&
                !run.company.websiteUrl &&
                !requestedWebsiteBackfills.current.has(run.runId),
        );
        if (!legacyRun) {
            return;
        }

        requestedWebsiteBackfills.current.add(legacyRun.runId);
        void ensureRunCompanyWebsite({ runId: legacyRun.runId }).catch(() => {
            // Backfill is visual metadata only. The company fallback remains
            // intentional when resolution is unavailable.
        });
    }, [
        availableRuns,
        enabled,
        ensureRunCompanyWebsite,
        isAdmissionLoading,
        runs,
    ]);

    if (isAdmissionLoading || (enabled && runs === undefined)) {
        return (
            <div
                role="status"
                className={cn('flex items-center gap-2', className)}
                aria-label="Loading research dossiers"
                aria-busy="true"
            >
                {[...Array(3)].map((_) => (
                    <React.Fragment key={crypto.randomUUID()}>
                        <Skeleton className="h-8 w-44 rounded-sm" />
                        <Separator
                            orientation="vertical"
                            className="mx-2 shrink-0"
                        />
                    </React.Fragment>
                ))}
            </div>
        );
    }

    if (!enabled) {
        return null;
    }

    if (availableRuns.length === 0) {
        return (
            <div className={cn('flex items-center gap-2', className)}>
                <span className="text-xs text-muted-foreground">
                    No research dossiers yet
                </span>
                <DossiersButton />
            </div>
        );
    }

    if (isMobile) {
        const activeRun = availableRuns.find(
            (run) => run.runId === activeRunId,
        );
        const menuSections: NestedMenuSectionProps[] = [
            {
                title: 'Research dossiers',
                items: [
                    ...availableRuns.flatMap((run) =>
                        run.company
                            ? [
                                  {
                                      key: run.runId,
                                      label: `${run.company.legalName} (${run.company.ticker})`,
                                      separator: true,
                                      icon:
                                          activeRunId === run.runId
                                              ? ({
                                                    className: iconClassName,
                                                }: {
                                                    className?: string;
                                                }) => (
                                                    <Icon
                                                        iconNode={Tick02Icon}
                                                        className={cn(
                                                            'size-4 shrink-0 text-brand-purple',
                                                            iconClassName,
                                                        )}
                                                    />
                                                )
                                              : ({
                                                    className: _iconClassName,
                                                }: {
                                                    className?: string;
                                                }) =>
                                                    run.company ? (
                                                        <CompanyFaviconAvatar
                                                            company={
                                                                run.company
                                                            }
                                                        />
                                                    ) : null,
                                      onSelect: () => {
                                          void navigate({
                                              to: '/workspace/$runId',
                                              params: { runId: run.runId },
                                              search: {
                                                  section: 'progress',
                                              },
                                          });
                                      },
                                  },
                              ]
                            : [],
                    ),
                    {
                        key: 'start-new-analysis',
                        label: 'Start a company dossier',
                        className: buttonVariants({
                            variant: 'secondary',
                            size: 'sm',
                            className: 'my-1 w-full',
                        }),
                        icon: ({ className: iconClassName }) => (
                            <Icon
                                iconNode={Add01Icon}
                                className={cn('size-4', iconClassName)}
                            />
                        ),
                        onSelect: () => {
                            void navigate({ to: '/workspace/start' });
                        },
                    },
                ],
            },
        ];

        return (
            <div className={cn('flex items-center gap-2 py-0.5', className)}>
                <NestedMenu
                    sections={menuSections}
                    side="bottom"
                    align="start"
                    trigger={
                        <Button
                            variant="outline"
                            size="sm"
                            className="gap-2 text-xs font-medium"
                        >
                            {activeRun?.company ? (
                                <>
                                    <span
                                        className="size-1.5 shrink-0 rounded-full bg-brand-purple"
                                        aria-hidden="true"
                                    />
                                    <span className="max-w-30 truncate">
                                        {activeRun.company.legalName}
                                    </span>
                                </>
                            ) : (
                                <span>Dossiers</span>
                            )}
                            <Icon
                                iconNode={ChevronDownIcon}
                                className="size-3.5 shrink-0 text-muted-foreground"
                            />
                        </Button>
                    }
                />
            </div>
        );
    }

    return (
        <nav
            className={cn(
                'flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5',
                className,
            )}
            aria-label="Analyzed companies"
        >
            <div className="flex shrink-0 items-center gap-2">
                <DossiersButton />
                {availableRuns.map((run, index) =>
                    run.company ? (
                        <div
                            key={run.runId}
                            className="flex items-center gap-0.5"
                        >
                            <Link
                                to="/workspace/$runId"
                                params={{ runId: run.runId }}
                                search={{ section: 'progress' }}
                                aria-current={
                                    activeRunId === run.runId
                                        ? 'page'
                                        : undefined
                                }
                                className={buttonVariants({
                                    variant: 'outline',
                                    size: 'sm',
                                    className: cn(
                                        'h-8 gap-1 px-0 text-xs font-medium rounded-none!',
                                        activeRunId === run.runId
                                            ? 'bg-accent! border-accent-foreground/50!'
                                            : 'border! border-muted-foreground/50!',
                                    ),
                                })}
                            >
                                {activeRunId === run.runId ? (
                                    <Icon
                                        iconNode={Tick02Icon}
                                        className="size-4 shrink-0 text-brand-purple"
                                    />
                                ) : null}
                                <CompanyFaviconAvatar company={run.company} />
                                <span className="max-w-35 truncate lg:max-w-40">
                                    {`${run.company.legalName} (${run.company.ticker})`}
                                </span>
                            </Link>
                            {index < availableRuns.length - 1 ? (
                                <Separator
                                    orientation="vertical"
                                    className="mx-2 shrink-0"
                                />
                            ) : null}
                        </div>
                    ) : null,
                )}
            </div>
        </nav>
    );
}

class AnalyzedCompanyListErrorBoundary extends Component<
    { children: ReactNode; className?: string },
    { hasError: boolean }
> {
    state = { hasError: false };

    static getDerivedStateFromError() {
        return { hasError: true };
    }

    render() {
        if (!this.state.hasError) {
            return this.props.children;
        }

        return (
            <div
                role="alert"
                className={cn(
                    'flex items-center gap-2 py-0.5 text-xs text-muted-foreground',
                    this.props.className,
                )}
            >
                <span>Research dossiers are temporarily unavailable</span>
                <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => this.setState({ hasError: false })}
                >
                    Retry
                </Button>
            </div>
        );
    }
}
