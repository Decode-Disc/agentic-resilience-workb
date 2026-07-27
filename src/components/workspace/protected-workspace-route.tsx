'use client';

import { api } from '@convex/_generated/api';
import { Outlet, useNavigate } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { InvitationAccessDrawer } from '@/components/workspace/invitation-access-drawer';
import { useAnonymousSession } from '@/hooks/use-anonymous-session';

function ProtectedRouteLoading() {
    return (
        <div
            role="status"
            aria-label="Preparing private workspace"
            className="surface-panel mx-auto mt-12 w-full max-w-xl space-y-3 rounded-xl p-6"
        >
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-7 w-72 max-w-full" />
            <Skeleton className="h-4 w-full" />
        </div>
    );
}

/**
 * Keeps protected workspace children unmounted until the current anonymous
 * identity is linked to an active visitor through a workspace access code.
 */
export function ProtectedWorkspaceRoute() {
    const navigate = useNavigate();
    const { isSessionReady, sessionError } = useAnonymousSession();
    const visitor = useQuery(
        api.visitors.current,
        isSessionReady ? {} : 'skip',
    );
    const [admissionPending, setAdmissionPending] = useState(false);

    if (sessionError) {
        return (
            <div
                role="alert"
                className="surface-panel mx-auto mt-12 w-full max-w-xl rounded-xl p-6"
            >
                <h1 className="text-lg font-medium">
                    Workspace access unavailable
                </h1>
                <p className="mt-2 text-sm text-destructive">
                    We couldn’t prepare the private workspace. Try again.
                </p>
            </div>
        );
    }

    if (
        !isSessionReady ||
        visitor === undefined ||
        (admissionPending && visitor?.status !== 'active')
    ) {
        return <ProtectedRouteLoading />;
    }

    if (visitor?.status === 'active') {
        return <Outlet />;
    }

    return (
        <InvitationAccessDrawer
            open
            onOpenChange={(open) => {
                if (!open) {
                    void navigate({ to: '/workspace/start' });
                }
            }}
            onAdmitted={() => {
                setAdmissionPending(true);
            }}
        />
    );
}
