import { api } from '@convex/_generated/api';
import { useAuthActions } from '@convex-dev/auth/react';
import {
    ChevronDownIcon,
    Folder02Icon,
    Home01Icon,
    Login02Icon,
    Logout01Icon,
    Settings02Icon,
    UserCircleIcon,
} from '@hugeicons/core-free-icons';
import { Link, useNavigate } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { type ReactNode, useState } from 'react';
import { toast } from 'sonner';

import Icon from '@/components/icon';
import { Button } from '@/components/ui/button';
import {
    NestedMenu,
    type NestedMenuSectionProps,
} from '@/components/ui/nested-menu';
import { Separator } from '@/components/ui/separator';
import { AnalyzedCompanyList } from '@/components/workbench-shell/analyzed-company-list';
import { InvitationAccessDrawer } from '@/components/workspace/invitation-access-drawer';
import { getWorkspaceDestination } from '@/lib/workspace/access-destination';

export interface WorkbenchShellProps {
    children: ReactNode;
    activeRunId?: string;
}

function OperationsMenuIcon({ className }: { className?: string }) {
    return <Icon iconNode={Settings02Icon} className={className} />;
}

function LogoutMenuIcon({ className }: { className?: string }) {
    return <Icon iconNode={Logout01Icon} className={className} />;
}

export function WorkbenchShell({ children, activeRunId }: WorkbenchShellProps) {
    const visitor = useQuery(api.visitors.current);
    const navigate = useNavigate();
    const { signOut } = useAuthActions();
    const [isSigningOut, setIsSigningOut] = useState(false);
    const [invitationOpen, setInvitationOpen] = useState(false);

    const logout = async () => {
        if (isSigningOut) {
            return;
        }
        setIsSigningOut(true);
        try {
            await signOut();
            await navigate({ to: '/workspace/start' });
        } catch {
            toast.error('Could not log out. Try again.');
            setIsSigningOut(false);
        }
    };

    const sessionMenuSections: NestedMenuSectionProps[] = [
        {
            items: [
                ...(visitor?.role === 'admin'
                    ? [
                          {
                              key: 'operations',
                              label: 'Operations',
                              icon: OperationsMenuIcon,
                              onSelect: () => {
                                  void navigate({
                                      to: '/workspace/admin',
                                  });
                              },
                          },
                      ]
                    : []),
                {
                    key: 'logout',
                    label: isSigningOut ? 'Signing out…' : 'Logout',
                    icon: LogoutMenuIcon,
                    variant: 'danger',
                    onSelect: () => {
                        void logout();
                    },
                },
            ],
        },
    ];

    return (
        <div className="min-h-svh bg-background text-foreground">
            <header className="sticky top-0 z-30 border-b border-border bg-card/80 backdrop-blur-md">
                <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
                    <div className="flex min-w-0 items-center gap-3">
                        {/* Home Button / Link using shadcn Button */}
                        <Button
                            render={<Link to="/" />}
                            nativeButton={false}
                            variant="secondary"
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

                        <Button
                            render={<Link to="/workspace/start" />}
                            nativeButton={false}
                            variant="default"
                            size="sm"
                            aria-label="Start a company dossier"
                            title="Start a company dossier"
                            className="rounded-sm"
                        >
                            <span className="start-double-slash">{'//'}</span>
                            <span className="start-label">start</span>
                        </Button>

                        <Separator
                            orientation="vertical"
                            className="shrink-0"
                        />

                        {/* Horizontal Analyzed Companies List */}
                        <AnalyzedCompanyList
                            activeRunId={activeRunId}
                            enabled={visitor !== undefined && visitor !== null}
                            isAdmissionLoading={visitor === undefined}
                        />
                    </div>

                    <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                        {visitor?.status === 'active' ? (
                            <NestedMenu
                                sections={sessionMenuSections}
                                side="bottom"
                                align="end"
                                trigger={
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        className="border border-primary"
                                        size="sm"
                                        aria-label="Workspace menu"
                                    >
                                        <Icon iconNode={UserCircleIcon} />
                                        <span className="hidden sm:inline">
                                            Account
                                        </span>
                                        <Icon
                                            iconNode={ChevronDownIcon}
                                            data-icon="inline-end"
                                        />
                                    </Button>
                                }
                            />
                        ) : visitor === null ? (
                            <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                className="border border-primary"
                                onClick={() => setInvitationOpen(true)}
                            >
                                <Icon iconNode={Login02Icon} />
                                Workspace
                            </Button>
                        ) : null}
                    </div>
                </div>
            </header>

            <main className="mx-auto w-full max-w-8xl px-4 py-4 sm:px-6">
                {children}
            </main>

            {invitationOpen ? (
                <InvitationAccessDrawer
                    open
                    onOpenChange={setInvitationOpen}
                    onAdmitted={({ role }) => {
                        void navigate({
                            to: getWorkspaceDestination(role),
                        });
                    }}
                />
            ) : null}
        </div>
    );
}
