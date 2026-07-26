import { Home01Icon } from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import Icon from '@/components/icon';
import { Button } from '@/components/ui/button';
import { AnalyzedCompanyList } from '@/components/workbench-shell/analyzed-company-list';

export interface WorkbenchShellProps {
    children: ReactNode;
    activeCompanyId?: string;
}

export function WorkbenchShell({
    children,
    activeCompanyId,
}: WorkbenchShellProps) {
    return (
        <div className="min-h-svh bg-background text-foreground">
            <header className="sticky top-0 z-30 border-b border-border/60 bg-background/95 backdrop-blur-md">
                <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
                    <div className="flex min-w-0 items-center gap-3">
                        {/* Home Button / Link using shadcn Button */}
                        <Button
                            render={<Link to="/" />}
                            nativeButton={false}
                            variant="outline"
                            size="sm"
                            aria-label="Go to Home"
                            title="Go to Home"
                        >
                            <Icon
                                iconNode={Home01Icon}
                                data-icon="inline-start"
                                className="text-muted-foreground"
                            />
                            <span className="hidden font-medium sm:inline">
                                Home
                            </span>
                        </Button>

                        <div
                            className="h-4 w-px bg-border/60 shrink-0"
                            aria-hidden="true"
                        />

                        {/* Horizontal Analyzed Companies List */}
                        <AnalyzedCompanyList
                            activeCompanyId={activeCompanyId}
                        />
                    </div>

                    <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                        <span className="hidden rounded-full border border-border/60 bg-muted/50 px-2.5 py-0.5 font-mono text-[11px] font-medium text-muted-foreground sm:inline-block">
                            Research prototype
                        </span>
                    </div>
                </div>
            </header>

            <main className="mx-auto w-full max-w-8xl px-4 py-4 sm:px-6">
                {children}
            </main>
        </div>
    );
}
