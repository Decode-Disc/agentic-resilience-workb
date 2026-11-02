"use client";

import type { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import {
    type Context,
    createContext,
    type ReactNode,
    useCallback,
    useContext,
    useMemo,
    useRef,
    useState,
} from "react";

import { InvitationAccessDrawer } from "@/components/workspace/invitation-access-drawer";

type Admission = FunctionReturnType<typeof api.invitations.claim>;

export interface OpenInvitationDrawerOptions {
    onSuccess?: (admission: Admission) => void | Promise<void>;
    onCancel?: () => void;
    onSessionRestored?: (admission: Admission) => void | Promise<void>;
}

export interface InvitationAccessContextValue {
    openInvitationDrawer: (options?: OpenInvitationDrawerOptions) => void;
    closeInvitationDrawer: () => void;
    resolveInvitationDrawer: (
        admission: Admission,
        source?: "claim" | "session",
    ) => Promise<void>;
    isOpen: boolean;
}

// Store on globalThis so the context reference survives Vite HMR re-evaluation.
// Without this, each HMR cycle recreates the context object, breaking the
// Provider ↔ Consumer contract for components mounted before the update.
const InvitationAccessContext = (() => {
    const key = "__INVITATION_ACCESS_CONTEXT__";
    if (!(key in globalThis)) {
        (globalThis as Record<string, unknown>)[key] =
            createContext<InvitationAccessContextValue | null>(null);
    }
    return (globalThis as Record<string, unknown>)[
        key
    ] as Context<InvitationAccessContextValue | null>;
})();

export function InvitationAccessProvider({
    children,
}: {
    children: ReactNode;
}) {
    const [isOpen, setIsOpen] = useState(false);
    const request = useRef<{
        options: OpenInvitationDrawerOptions;
        resolving: boolean;
    } | null>(null);

    const closeInvitationDrawer = useCallback(() => {
        setIsOpen(false);
        const current = request.current;
        request.current = null;
        current?.options.onCancel?.();
    }, []);

    const openInvitationDrawer = useCallback(
        (options?: OpenInvitationDrawerOptions) => {
            request.current = { options: options ?? {}, resolving: false };
            setIsOpen(true);
        },
        [],
    );

    const resolveInvitationDrawer = useCallback(
        async (admission: Admission, source: "claim" | "session" = "claim") => {
            const current = request.current;
            if (!current || current.resolving) return;
            current.resolving = true;
            try {
                const continuation =
                    source === "session"
                        ? (current.options.onSessionRestored ??
                          current.options.onSuccess)
                        : current.options.onSuccess;
                await continuation?.(admission);
                if (request.current === current) {
                    request.current = null;
                    setIsOpen(false);
                }
            } catch (error) {
                current.resolving = false;
                throw error;
            }
        },
        [],
    );

    const contextValue = useMemo<InvitationAccessContextValue>(
        () => ({
            openInvitationDrawer,
            closeInvitationDrawer,
            resolveInvitationDrawer,
            isOpen,
        }),
        [
            openInvitationDrawer,
            closeInvitationDrawer,
            resolveInvitationDrawer,
            isOpen,
        ],
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
                onAdmitted={(admission) => resolveInvitationDrawer(admission)}
            />
        </InvitationAccessContext.Provider>
    );
}

export function useInvitationAccess(): InvitationAccessContextValue {
    const context = useContext(InvitationAccessContext);
    if (!context) {
        throw new Error(
            "useInvitationAccess must be used within an InvitationAccessProvider",
        );
    }
    return context;
}
