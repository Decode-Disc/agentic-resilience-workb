import { api } from "@convex/_generated/api";
import { useAuthActions } from "@convex-dev/auth/react";
import {
    ChevronDownIcon,
    Home01Icon,
    Login02Icon,
    Logout01Icon,
    Settings02Icon,
    UserCircleIcon,
} from "@hugeicons/core-free-icons";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";

import Icon from "@/components/icon";
import { LoadErrorBoundary } from "@/components/load-error-boundary";
import { Button } from "@/components/ui/button";
import {
    NestedMenu,
    type NestedMenuSectionProps,
} from "@/components/ui/nested-menu";
import { AnalyzedCompanyList } from "@/components/workbench-shell/analyzed-company-list";
import { useInvitationAccess } from "@/components/workspace/invitation-access-context";
import { useResponsive } from "@/hooks/use-responsive";
import { uiLayerClasses } from "@/lib/ui-layers";
import { cn } from "@/lib/utils";
import { getWorkspaceDestination } from "@/lib/workspace/access-destination";
import { WorkbenchShellSurface } from "./workbench-shell-surface";

export interface WorkbenchShellProps {
    children: ReactNode;
    activeRunId?: string;
}

function AdministrationMenuIcon({ className }: { className?: string }) {
    return <Icon iconNode={Settings02Icon} className={className} />;
}

function LogoutMenuIcon({ className }: { className?: string }) {
    return <Icon iconNode={Logout01Icon} className={className} />;
}

export function WorkbenchShell({ children, activeRunId }: WorkbenchShellProps) {
    return (
        <WorkbenchShellSurface
            header={
                <LoadErrorBoundary
                    title="Workspace navigation unavailable"
                    description="We couldn’t load the workspace navigation. Try again."
                    retryLabel="Retry"
                    variant="compact"
                    className="max-width-container py-2.5">
                    <WorkbenchHeader activeRunId={activeRunId} />
                </LoadErrorBoundary>
            }>
            <main className="max-width-container min-h-[calc(100svh-var(--bar-height))] py-4">
                {children}
            </main>
        </WorkbenchShellSurface>
    );
}

function WorkbenchHeader({ activeRunId }: { activeRunId?: string }) {
    const visitor = useQuery(api.visitors.current);
    const navigate = useNavigate();
    const { signOut } = useAuthActions();
    const { openInvitationDrawer } = useInvitationAccess();
    const { isMobile } = useResponsive();
    const [isSigningOut, setIsSigningOut] = useState(false);

    const logout = async () => {
        if (isSigningOut) {
            return;
        }
        setIsSigningOut(true);
        try {
            await signOut();
            await navigate({ to: "/workspace/start" });
        } catch {
            toast.error("Could not log out. Try again.");
            setIsSigningOut(false);
        }
    };

    const sessionMenuSections: NestedMenuSectionProps[] = [
        {
            items: [
                ...(visitor?.role === "admin"
                    ? [
                          {
                              key: "administration",
                              label: "Administration",
                              icon: AdministrationMenuIcon,
                              onSelect: () => {
                                  void navigate({
                                      to: "/workspace/admin",
                                  });
                              },
                          },
                      ]
                    : []),
                {
                    key: "logout",
                    label: isSigningOut ? "Signing out…" : "Logout",
                    icon: LogoutMenuIcon,
                    variant: "danger",
                    onSelect: () => {
                        void logout();
                    },
                },
            ],
        },
    ];

    return (
        <header
            className={cn(
                "sticky top-0 z-30 border-b border-divider bg-surface-bar backdrop-blur-bar",
                uiLayerClasses.workbenchShellHeader,
            )}>
            <div className="max-width-container grid min-h-(--bar-height) grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-2">
                <div className="min-w-0 flex items-center gap-3">
                    <Button
                        render={<Link to="/" />}
                        nativeButton={false}
                        variant="secondary"
                        size="sm"
                        className="rounded-tile bg-fill-quiet"
                        aria-label="Go to Home"
                        title="Go to Home">
                        <Icon
                            iconNode={Home01Icon}
                            data-icon="inline-start"
                            className="text-muted-foreground"
                        />
                        <span className="hidden font-medium sm:inline">
                            Home
                        </span>
                    </Button>
                    {!isMobile &&
                    visitor?.workspace?.canStartDossier !== false ? (
                        <Button
                            render={<Link to="/workspace/start" />}
                            nativeButton={false}
                            variant="secondary"
                            size="sm"
                            aria-label="Start a company dossier"
                            title="Start a company dossier"
                            className="rounded-tile bg-nav-current">
                            <span className="start-double-slash">{"//"}</span>
                            <span className="start-label text-primary">
                                start
                            </span>
                        </Button>
                    ) : null}
                </div>
                <div className="flex min-w-0 flex-col items-center gap-1 md:flex-row">
                    {activeRunId && visitor?.workspace?.isTestData ? (
                        <span className="shrink-0 text-xs text-muted-foreground">
                            Test data — not live
                        </span>
                    ) : null}
                    <AnalyzedCompanyList
                        activeRunId={activeRunId}
                        enabled={visitor !== undefined && visitor !== null}
                        isAdmissionLoading={visitor === undefined}
                        className="min-w-0 w-full justify-center md:justify-start"
                    />
                </div>
                <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
                    {visitor?.status === "active" ? (
                        <NestedMenu
                            sections={sessionMenuSections}
                            side="bottom"
                            align="end"
                            trigger={
                                <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    className="rounded-tile bg-fill-quiet"
                                    aria-label="Workspace menu">
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
                            onClick={() =>
                                openInvitationDrawer({
                                    onSuccess: ({ role }) => {
                                        void navigate({
                                            to: getWorkspaceDestination(role),
                                        });
                                    },
                                })
                            }>
                            <Icon iconNode={Login02Icon} />
                            Go to Workspace
                        </Button>
                    ) : null}
                </div>
            </div>
        </header>
    );
}
