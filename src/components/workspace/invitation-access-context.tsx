'use client';

import type { api } from '@convex/_generated/api';
import type { FunctionReturnType } from 'convex/server';
import {
    createContext,
    type ReactNode,
    useCallback,
    useContext,
    useMemo,
    useState,
} from 'react';

import { InvitationAccessDrawer } from '@/components/workspace/invitation-access-drawer';

type Admission = FunctionReturnType<typeof api.invitations.claim>;

export interface OpenInvitationDrawerOptions {
    onSuccess?: (admission: Admission) => void | Promise<void>;
    onCancel?: () => void;
}

export interface InvitationAccessContextValue {
    openInvitationDrawer: (options?: OpenInvitationDrawerOptions) => void;
    closeInvitationDrawer: () => void;
    isOpen: boolean;
}

const InvitationAccessContext =
    createContext<InvitationAccessContextValue | null>(null);

export function InvitationAccessProvider({
    children,
}: {
    children: ReactNode;
}) {
    const [isOpen, setIsOpen] = useState(false);
    const [callbacks, setCallbacks] = useState<OpenInvitationDrawerOptions>(
        {},
    );

    const closeInvitationDrawer = useCallback(() => {
        setIsOpen(false);
        callbacks.onCancel?.();
    }, [callbacks]);

    const openInvitationDrawer = useCallback(
        (options?: OpenInvitationDrawerOptions) => {
            setCallbacks(options ?? {});
            setIsOpen(true);
        },
        [],
    );

    const handleAdmitted = async (admission: Admission) => {
        if (callbacks.onSuccess) {
            await callbacks.onSuccess(admission);
        }
        setIsOpen(false);
    };

    const contextValue = useMemo<InvitationAccessContextValue>(
        () => ({
            openInvitationDrawer,
            closeInvitationDrawer,
            isOpen,
        }),
        [openInvitationDrawer, closeInvitationDrawer, isOpen],
    );

    return (
        <InvitationAccessContext.Provider value={contextValue}>
            {children}
            <InvitationAccessDrawer
                open={isOpen}
                onOpenChange={(nextOpen) => {
                    if (!nextOpen) {
                        closeInvitationDrawer();
                    } else {
                        setIsOpen(true);
                    }
                }}
                onAdmitted={handleAdmitted}
            />
        </InvitationAccessContext.Provider>
    );
}

export function useInvitationAccess(): InvitationAccessContextValue {
    const context = useContext(InvitationAccessContext);
    if (!context) {
        throw new Error(
            'useInvitationAccess must be used within an InvitationAccessProvider',
        );
    }
    return context;
}
