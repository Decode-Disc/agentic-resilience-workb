"use client";

import {
    useAuthActions,
    useConvexAuth as useTokenAuth,
} from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import { useEffect, useRef, useState } from "react";

function sessionErrorMessage() {
    return "We couldn't prepare the research workspace. Try again.";
}

/** Ensures public workspace routes have a server-recognized anonymous identity. */
export function useAnonymousSession() {
    const { signIn } = useAuthActions();
    const { isLoading, isAuthenticated } = useTokenAuth();
    const serverAuth = useConvexAuth();
    const attemptedSignIn = useRef(false);
    const [isSigningIn, setIsSigningIn] = useState(false);
    const [sessionError, setSessionError] = useState<string | null>(null);

    useEffect(() => {
        if (
            isLoading ||
            isAuthenticated ||
            attemptedSignIn.current ||
            sessionError
        ) {
            return;
        }

        attemptedSignIn.current = true;
        setIsSigningIn(true);
        setSessionError(null);

        void signIn("anonymous")
            .catch(() => {
                attemptedSignIn.current = false;
                setSessionError(sessionErrorMessage());
            })
            .finally(() => {
                setIsSigningIn(false);
            });
    }, [isAuthenticated, isLoading, sessionError, signIn]);

    const retrySession = () => {
        if (isLoading || isAuthenticated || isSigningIn) {
            return;
        }
        attemptedSignIn.current = false;
        setSessionError(null);
    };

    return {
        isSessionLoading: isLoading || isSigningIn || serverAuth.isLoading,
        isSessionReady: serverAuth.isAuthenticated,
        sessionError,
        retrySession,
    };
}
