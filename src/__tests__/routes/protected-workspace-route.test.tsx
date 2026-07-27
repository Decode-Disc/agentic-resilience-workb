import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const { claimInvitation, navigate, useAction, useAnonymousSession, useQuery } =
    vi.hoisted(() => ({
        claimInvitation: vi.fn(),
        navigate: vi.fn(),
        useAction: vi.fn(),
        useAnonymousSession: vi.fn(),
        useQuery: vi.fn(),
    }));

vi.mock(import('convex/react'), () => ({ useAction, useQuery }));
vi.mock(import('@tanstack/react-router'), async (importOriginal) => {
    const router = await importOriginal();
    return {
        ...router,
        Outlet: Object.assign(
            () => <div>Protected route content</div>,
            router.Outlet,
        ),
        useNavigate: () => navigate,
    };
});
vi.mock('@/hooks/use-anonymous-session', () => ({ useAnonymousSession }));

import { ProtectedWorkspaceRoute } from '@/components/workspace/protected-workspace-route';

describe('ProtectedWorkspaceRoute', () => {
    beforeEach(() => {
        claimInvitation.mockReset();
        navigate.mockReset();
        useAction.mockReset();
        useAction.mockReturnValue(claimInvitation);
        useAnonymousSession.mockReset();
        useAnonymousSession.mockReturnValue({
            isSessionLoading: false,
            isSessionReady: true,
            sessionError: null,
        });
        useQuery.mockReset();
    });

    test('withholds protected content and opens admission for an anonymous visitor', () => {
        useQuery.mockReturnValue(null);

        render(<ProtectedWorkspaceRoute />);

        expect(screen.queryByText('Protected route content')).toBeNull();
        expect(
            screen.getByRole('heading', { name: /Protected access/i }),
        ).toBeTruthy();
    });

    test('renders protected content for an active visitor', () => {
        useQuery.mockReturnValue({ role: 'analyst', status: 'active' });

        render(<ProtectedWorkspaceRoute />);

        expect(screen.getByText('Protected route content')).toBeTruthy();
        expect(
            screen.queryByRole('heading', { name: /Invitation required/i }),
        ).toBeNull();
    });
});
