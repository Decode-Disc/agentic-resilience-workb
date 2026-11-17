import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { signIn, useAuthActions, useConvexAuth, serverAuth } = vi.hoisted(
    () => ({
        serverAuth: vi.fn(),
        signIn: vi.fn(),
        useAuthActions: vi.fn(),
        useConvexAuth: vi.fn(),
    }),
);

vi.mock(import("@convex-dev/auth/react"), () => ({
    useAuthActions,
    useConvexAuth,
}));

vi.mock("convex/react", () => ({ useConvexAuth: serverAuth }));

import { useAnonymousSession } from "@/hooks/use-anonymous-session";

describe("useAnonymousSession", () => {
    beforeEach(() => {
        serverAuth.mockReturnValue({
            isLoading: false,
            isAuthenticated: false,
        });
        signIn.mockReset();
        useAuthActions.mockReset();
        useConvexAuth.mockReset();
        useAuthActions.mockReturnValue({ signIn, signOut: vi.fn() });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    test("waits for server authentication without signing in over an existing token", () => {
        useConvexAuth.mockReturnValue({
            isLoading: false,
            isAuthenticated: true,
        });
        serverAuth.mockReturnValue({ isLoading: true, isAuthenticated: false });
        const { result, rerender } = renderHook(() => useAnonymousSession());
        expect(result.current.isSessionReady).toBe(false);
        expect(result.current.isSessionLoading).toBe(true);
        expect(signIn).not.toHaveBeenCalled();
        serverAuth.mockReturnValue({ isLoading: false, isAuthenticated: true });
        rerender();
        expect(result.current.isSessionReady).toBe(true);
    });

    test("starts an anonymous session when workspace auth is empty", async () => {
        useConvexAuth.mockReturnValue({
            isLoading: false,
            isAuthenticated: false,
        });
        signIn.mockResolvedValue({ signingIn: true });

        renderHook(() => useAnonymousSession());

        await waitFor(() => expect(signIn).toHaveBeenCalledWith("anonymous"));
    });

    test("retries a failed anonymous session", async () => {
        useConvexAuth.mockReturnValue({
            isLoading: false,
            isAuthenticated: false,
        });
        signIn
            .mockRejectedValueOnce(new Error("Anonymous sign-in failed"))
            .mockResolvedValueOnce({ signingIn: true });

        const { result } = renderHook(() => useAnonymousSession());

        await waitFor(() =>
            expect(result.current.sessionError).toMatch(/couldn't prepare/i),
        );
        result.current.retrySession();

        await waitFor(() => expect(signIn).toHaveBeenCalledTimes(2));
        expect(result.current.sessionError).toBeNull();
    });
});
