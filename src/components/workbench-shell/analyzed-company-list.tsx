import { api } from '@convex/_generated/api';
import { Add01Icon, ChevronDownIcon, Tick02Icon } from '@hugeicons/core-free-icons';
import { Link, useNavigate } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import React, { Component, type ReactNode } from 'react';
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

function StartButton({ className }: { className?: string }) {
    return (
        <Button
            render={<Link to="/workspace/start" />}
            nativeButton={false}
            variant="ghost"
            size="sm"
            aria-label="Start a company dossier"
            title="Start a company dossier"
            className={cn('rounded-sm bg-background', className)}
        >
            <span className="start-double-slash">{'//'}</span>
            <span className="start-label">start</span>
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
                        <Skeleton
                            className="h-8 w-44 rounded-sm"
                        />
                        <Separator orientation="vertical" className="mx-2 shrink-0" />
                    </React.Fragment>
                ))}
            </div>
        );
    }

    if (!enabled) {
        return null;
    }

    const availableRuns = runs ?? [];

    if (availableRuns.length === 0) {
        return (
            <div className={cn('flex items-center gap-2', className)}>
                <span className="text-xs text-muted-foreground">
                    No research dossiers yet
                </span>
                <StartButton />
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
                                                  <Icon iconNode={Tick02Icon} className={cn('size-4 shrink-0 text-brand-purple', iconClassName)} />
                                                )
                                              : undefined,
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
                                    <span className="max-w-[140px] truncate">
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
                <StartButton />
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
                                    className:
                                        cn('h-8 gap-1 px-0 text-xs font-medium *',
                                            activeRunId === run.runId
                                                ? 'bg-accent/40! border-accent-foreground/50!'
                                                : 'border-none'),
                                })}
                            >
                                {activeRunId === run.runId ? (
                                    <Icon iconNode={Tick02Icon} className="size-4 shrink-0 text-brand-purple" />
                                ) : null}
                                <span className="max-w-[140px] truncate sm:max-w-[180px]">
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
