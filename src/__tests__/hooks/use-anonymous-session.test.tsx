import type { useAuthActions as authActionsHook } from "@convex-dev/auth/react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { deferred } from "@/__tests__/setup/deferred";

type SignInResult = Awaited<
    ReturnType<ReturnType<typeof authActionsHook>["signIn"]>
>;

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

    test("waits for token restoration before attempting an anonymous sign-in", () => {
        useConvexAuth.mockReturnValue({
            isLoading: true,
            isAuthenticated: false,
        });
        const { result } = renderHook(() => useAnonymousSession());
        expect(result.current.isSessionLoading).toBe(true);
        expect(result.current.isSessionReady).toBe(false);
        expect(signIn).not.toHaveBeenCalled();
    });

    test("keeps one sign-in pending and becomes ready only after server authentication", async () => {
        useConvexAuth.mockReturnValue({
            isLoading: false,
            isAuthenticated: false,
        });
        const pending = deferred<SignInResult>();
        signIn.mockReturnValue(pending.promise);
        const { result, rerender } = renderHook(() => useAnonymousSession());
        expect(result.current.isSessionLoading).toBe(true);
        expect(result.current.isSessionReady).toBe(false);
        rerender();
        act(() => result.current.retrySession());
        expect(signIn).toHaveBeenCalledExactlyOnceWith("anonymous");
        await act(async () => pending.resolve({ signingIn: true }));
        expect(result.current.isSessionReady).toBe(false);
        useConvexAuth.mockReturnValue({
            isLoading: false,
            isAuthenticated: true,
        });
        serverAuth.mockReturnValue({ isLoading: true, isAuthenticated: false });
        rerender();
        expect(result.current.isSessionLoading).toBe(true);
        expect(result.current.isSessionReady).toBe(false);
        serverAuth.mockReturnValue({ isLoading: false, isAuthenticated: true });
        rerender();
        expect(result.current.isSessionLoading).toBe(false);
        expect(result.current.isSessionReady).toBe(true);
        expect(result.current.sessionError).toBeNull();
    });

    test("retries a failed anonymous session", async () => {
        useConvexAuth.mockReturnValue({
            isLoading: false,
            isAuthenticated: false,
        });
        const retry = deferred<SignInResult>();
        signIn
            .mockRejectedValueOnce(new Error("Anonymous sign-in failed"))
            .mockReturnValueOnce(retry.promise);

        const { result, rerender } = renderHook(() => useAnonymousSession());

        await waitFor(() =>
            expect(result.current.sessionError).toMatch(/couldn't prepare/i),
        );
        expect(result.current.isSessionLoading).toBe(false);
        expect(result.current.isSessionReady).toBe(false);
        expect(result.current.sessionError).not.toContain(
            "Anonymous sign-in failed",
        );
        rerender();
        expect(signIn).toHaveBeenCalledTimes(1);
        act(() => result.current.retrySession());
        await waitFor(() => expect(signIn).toHaveBeenCalledTimes(2));
        expect(result.current.isSessionLoading).toBe(true);
        expect(result.current.sessionError).toBeNull();
        await act(async () => retry.resolve({ signingIn: true }));
        useConvexAuth.mockReturnValue({
            isLoading: false,
            isAuthenticated: true,
        });
        serverAuth.mockReturnValue({ isLoading: false, isAuthenticated: true });
        rerender();
        expect(result.current.isSessionReady).toBe(true);
        expect(result.current.isSessionLoading).toBe(false);
        expect(result.current.sessionError).toBeNull();
    });

    test("a rejected sign-in from an unmounted route cannot poison the replacement session", async () => {
        useConvexAuth.mockReturnValue({
            isLoading: false,
            isAuthenticated: false,
        });
        const previous = deferred<SignInResult>();
        const current = deferred<SignInResult>();
        signIn
            .mockReturnValueOnce(previous.promise)
            .mockReturnValueOnce(current.promise);
        const first = renderHook(() => useAnonymousSession());
        first.unmount();
        const second = renderHook(() => useAnonymousSession());
        await act(async () => current.resolve({ signingIn: true }));
        useConvexAuth.mockReturnValue({
            isLoading: false,
            isAuthenticated: true,
        });
        serverAuth.mockReturnValue({ isLoading: false, isAuthenticated: true });
        second.rerender();
        await act(async () => previous.reject(new Error("Old route failed")));
        expect(second.result.current.isSessionReady).toBe(true);
        expect(second.result.current.isSessionLoading).toBe(false);
        expect(second.result.current.sessionError).toBeNull();
        expect(signIn).toHaveBeenCalledTimes(2);
    });
});
