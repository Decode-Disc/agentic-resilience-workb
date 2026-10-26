"use client";

import { api } from "@convex/_generated/api";
import { Outlet, useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { LoadErrorBoundary } from "@/components/load-error-boundary";
import { LoadErrorAlert } from "@/components/ui/load-error-alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useInvitationAccess } from "@/components/workspace/invitation-access-context";
import { useAnonymousSession } from "@/hooks/use-anonymous-session";
import { getWorkspaceDestination } from "@/lib/workspace/access-destination";

function ProtectedRouteLoading() {
    return [1, 2, 3].map((index) => (
        <div
            key={`loading-card-${index}`}
            role="status"
            aria-label="Preparing private workspace"
            className="surface-panel mx-auto mt-12 w-full max-w-xl space-y-3 p-6">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-7 w-72 max-w-full" />
            <Skeleton className="h-4 w-full" />
        </div>
    ));
}

/**
 * Keeps protected workspace children unmounted until the current anonymous
 * identity is linked to an active visitor through a workspace access code.
 */
function ProtectedWorkspaceContent() {
    const navigate = useNavigate();
    const visitor = useQuery(api.visitors.current, {});
    const [admissionPending, setAdmissionPending] = useState(false);
    const { openInvitationDrawer, isOpen } = useInvitationAccess();

    useEffect(() => {
        if (
            visitor !== undefined &&
            visitor?.status !== "active" &&
            !admissionPending &&
            !isOpen
        ) {
            openInvitationDrawer({
                onSuccess: ({ role }) => {
                    setAdmissionPending(true);
                    void navigate({
                        to: getWorkspaceDestination(role),
                    });
                },
                onCancel: () => {
                    void navigate({ to: "/workspace/start" });
                },
            });
        }
    }, [visitor, admissionPending, isOpen, openInvitationDrawer, navigate]);

    if (
        visitor === undefined ||
        (admissionPending && visitor?.status !== "active")
    ) {
        return <ProtectedRouteLoading />;
    }

    if (visitor?.status === "active") {
        return <Outlet />;
    }

    return <ProtectedRouteLoading />;
}

export function ProtectedWorkspaceRoute() {
    const { isSessionReady, sessionError, retrySession } =
        useAnonymousSession();

    if (sessionError) {
        return (
            <LoadErrorAlert
                className="mx-auto mt-12 w-full max-w-xl"
                title="Workspace access unavailable"
                description="We couldn’t prepare the private workspace."
                onRetry={retrySession}
            />
        );
    }

    if (!isSessionReady) {
        return <ProtectedRouteLoading />;
    }

    return (
        <LoadErrorBoundary
            className="mx-auto mt-12 w-full max-w-xl"
            title="Workspace access unavailable"
            description="We couldn’t load your workspace access.">
            <ProtectedWorkspaceContent />
        </LoadErrorBoundary>
    );
}
