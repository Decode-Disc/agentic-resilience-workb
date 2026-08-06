"use client";

import { useAuthActions, useConvexAuth } from "@convex-dev/auth/react";
import { useEffect, useRef, useState } from "react";

function sessionErrorMessage() {
    return "We couldn't prepare the research workspace. Try again.";
}

/** Ensures public workspace routes have a server-recognized anonymous identity. */
export function useAnonymousSession() {
    const { signIn } = useAuthActions();
    const { isLoading, isAuthenticated } = useConvexAuth();
    const attemptedSignIn = useRef(false);
    const [isSigningIn, setIsSigningIn] = useState(false);
    const [sessionError, setSessionError] = useState<string | null>(null);

    useEffect(() => {
        if (isLoading || isAuthenticated || attemptedSignIn.current) {
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
    }, [isAuthenticated, isLoading, signIn]);

    return {
        isSessionLoading: isLoading || isSigningIn,
        isSessionReady: isAuthenticated,
        sessionError,
    };
}
