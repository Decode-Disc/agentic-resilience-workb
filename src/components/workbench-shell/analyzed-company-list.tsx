import { api } from '@convex/_generated/api';
import {
    Add01Icon,
    Cancel01Icon,
    ChevronDownIcon,
} from '@hugeicons/core-free-icons';
import { Link, useNavigate } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import Icon from '@/components/icon';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import {
    NestedMenu,
    type NestedMenuSectionProps,
} from '@/components/ui/nested-menu';
import { Separator } from '@/components/ui/separator';
import { useResponsive } from '@/hooks/use-responsive';
import { cn } from '@/lib/utils';

export interface CompanyItem {
    id: string;
    name: string;
    ticker?: string;
    status?: string;
}

export interface AnalyzedCompanyListProps {
    activeCompanyId?: string;
    onSelectCompany?: (company: CompanyItem) => void;
    className?: string;
}

const MOCK_COMPANIES: CompanyItem[] = [
    {
        id: 'servicenow',
        name: 'ServiceNow Inc.',
        ticker: 'NOW',
        status: 'completed',
    },
    {
        id: 'ccc-intelligent-solutions',
        name: 'CCC Intelligent Solutions',
        ticker: 'CCCS',
        status: 'completed',
    },
    {
        id: 'crowdstrike',
        name: 'CrowdStrike Holdings',
        ticker: 'CRWD',
        status: 'in_progress',
    },
];

/**
 * AnalyzedCompanyList
 *
 * Consumes analyzed companies directly from Convex (`api.researchRuns.listAnalyzedCompanies`).
 * NOTE: If Convex query returns empty array or is not yet fully populated with company records on backend,
 * it falls back to curated showcase mock companies and displays a visible 'Mock data' indicator.
 */
export function AnalyzedCompanyList({
    activeCompanyId,
    onSelectCompany,
    className,
}: AnalyzedCompanyListProps) {
    const { isMobile } = useResponsive();
    const navigate = useNavigate();

    const convexCompanies = useQuery(api.researchRuns.listAnalyzedCompanies);

    const hasConvexData =
        Array.isArray(convexCompanies) && convexCompanies.length > 0;
    const companies: CompanyItem[] = hasConvexData
        ? convexCompanies.map((c) => ({
            id: c.id,
            name: c.name,
            status: c.status,
        }))
        : MOCK_COMPANIES;

    const isUsingMock = !hasConvexData;

    const activeCompany =
        companies.find((c) => c.id === activeCompanyId) ?? companies[0];

    if (isMobile) {
        const menuSections: NestedMenuSectionProps[] = [
            {
                title: 'Analyzed Companies',
                items: [
                    ...companies.map((company) => {
                        const isActive = activeCompanyId === company.id;
                        return {
                            key: company.id,
                            label: company.ticker
                                ? `${company.name} (${company.ticker})`
                                : company.name,
                            separator: true,
                            icon: isActive
                                ? ({ className }: { className?: string }) => (
                                    <span
                                        className={cn(
                                            'size-2 rounded-full bg-brand-purple shrink-0',
                                            className,
                                        )}
                                        aria-hidden="true"
                                    />
                                )
                                : undefined,
                            onSelect: () => {
                                onSelectCompany?.(company);
                                void navigate({
                                    to: '/prototype/workspace',
                                    search: { variant: 'a' },
                                });
                            },
                        };
                    }),
                    {
                        key: 'start-new-analysis',
                        label: 'Start new analysis',
                        className: buttonVariants({
                            variant: 'secondary',
                            size: 'sm',
                            className: 'w-full my-1',
                        }),
                        icon: ({ className }: { className?: string }) => (
                            <Icon
                                iconNode={Add01Icon}
                                className={cn('size-4', className)}
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
                            {activeCompany ? (
                                <>
                                    <span
                                        className="size-1.5 rounded-full bg-brand-purple shrink-0"
                                        aria-hidden="true"
                                    />
                                    <span className="truncate max-w-[140px]">
                                        {activeCompany.name}
                                    </span>
                                </>
                            ) : (
                                <span>Companies</span>
                            )}
                            <Icon
                                iconNode={ChevronDownIcon}
                                className="size-3.5 text-muted-foreground shrink-0"
                            />
                        </Button>
                    }
                />

                {isUsingMock && (
                    <Badge
                        variant="regular"
                        color="amber"
                        showDot
                        className="text-[10px] font-mono font-medium shrink-0"
                        title="Convex company schema/data pending. Displaying showcase mock companies."
                    >
                        Mock data
                    </Badge>
                )}
            </div>
        );
    }

    return (
        <div
            className={cn(
                'flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5',
                className,
            )}
        >
            <div className="flex items-center gap-2 shrink-0">
                {companies.map((company) => {
                    const isActive = activeCompanyId === company.id;
                    return (
                        <div
                            key={company.id}
                            className="flex items-center gap-0.5"
                        >
                            <Button
                                render={
                                    <Link
                                        to="/prototype/workspace"
                                        search={{ variant: 'a' }}
                                    />
                                }
                                nativeButton={false}
                                variant={isActive ? 'outline' : 'link'}
                                size="sm"
                                onClick={() => onSelectCompany?.(company)}
                                className="h-8 gap-2 px-0 text-xs font-medium"
                            >
                                {isActive && (
                                    <span
                                        className="size-1.5 rounded-full bg-brand-purple"
                                        aria-hidden="true"
                                    />
                                )}
                                <span className="truncate max-w-[140px] sm:max-w-[180px]">
                                    {`${company.name} (${company.ticker})`}
                                </span>
                            </Button>
                            <button
                                type="button"
                                className="cursor-pointer text-muted-foreground hover:text-destructive"
                                aria-label="Remove company"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    e.preventDefault();
                                    console.log(
                                        `Remove company ${company.name}`,
                                    );
                                }}
                            >
                                <Icon
                                    iconNode={Cancel01Icon}
                                    className="size-4"
                                    data-icon="inline-end"
                                />
                            </button>
                            <Separator
                                orientation="vertical"
                                className="shrink-0 mx-2"
                            />
                        </div>
                    );
                })}

                {/* Add / Start new analysis button */}
                <Button
                    render={<Link to="/workspace/start" />}
                    nativeButton={false}
                    variant="ghost"
                    size="icon-sm"
                    className="border border-border/60"
                    aria-label="Start new company analysis"
                    title="Start new company analysis"
                >
                    <Icon iconNode={Add01Icon} data-icon="inline-start" />
                </Button>
            </div>

            {/* Notification when mock data fallback is active */}
            {isUsingMock && (
                <Badge
                    variant="regular"
                    color="amber"
                    showDot
                    className="hidden text-[10px] font-mono font-medium md:inline-flex"
                    title="Convex company schema/data pending. Displaying showcase mock companies."
                >
                    Mock data
                </Badge>
            )}
        </div>
    );
}
