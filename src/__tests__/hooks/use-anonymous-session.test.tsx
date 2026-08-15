import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { signIn, useAuthActions, useConvexAuth } = vi.hoisted(() => ({
    signIn: vi.fn(),
    useAuthActions: vi.fn(),
    useConvexAuth: vi.fn(),
}));

vi.mock(import("@convex-dev/auth/react"), () => ({
    useAuthActions,
    useConvexAuth,
}));

import { useAnonymousSession } from "@/hooks/use-anonymous-session";

describe("useAnonymousSession", () => {
    beforeEach(() => {
        signIn.mockReset();
        useAuthActions.mockReset();
        useConvexAuth.mockReset();
        useAuthActions.mockReturnValue({ signIn, signOut: vi.fn() });
    });

    afterEach(() => {
        vi.restoreAllMocks();
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
