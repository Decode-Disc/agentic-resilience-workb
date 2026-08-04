import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { claimInvitation, navigate, signIn, signOut, useAction, useQuery } =
    vi.hoisted(() => ({
        claimInvitation: vi.fn(),
        navigate: vi.fn(),
        signIn: vi.fn(),
        signOut: vi.fn(),
        useAction: vi.fn(),
        useQuery: vi.fn(),
    }));

vi.mock('@tanstack/react-router', async (importOriginal) => {
    const router =
        await importOriginal<typeof import('@tanstack/react-router')>();

    return {
        ...router,
        useNavigate: () => navigate,
        Link: ({
            to,
            search: _search,
            children,
            ...props
        }: ComponentProps<'a'> & {
            to: string;
            search?: Record<string, string>;
        }) => (
            <a href={to} {...props}>
                {children}
            </a>
        ),
    };
});

vi.mock(import('@convex-dev/auth/react'), async (importOriginal) => {
    const auth = await importOriginal();
    return {
        ...auth,
        useAuthActions: () => ({ signIn, signOut }),
    };
});

vi.mock(import('convex/react'), () => ({
    useAction,
    useQuery,
}));

vi.mock(import('@/components/workbench-shell/analyzed-company-list'), () => ({
    AnalyzedCompanyList: ({
        isAdmissionLoading,
    }: {
        isAdmissionLoading?: boolean;
    }) => (
        <nav
            aria-label={
                isAdmissionLoading
                    ? 'Loading research dossiers'
                    : 'Analyzed companies'
            }
        />
    ),
}));

import { WorkbenchShell } from '@/components/workbench-shell/workbench-shell';

describe('WorkbenchShell', () => {
    beforeEach(() => {
        claimInvitation.mockReset();
        navigate.mockReset();
        signIn.mockReset();
        signOut.mockReset();
        signOut.mockResolvedValue(undefined);
        useAction.mockReset();
        useAction.mockReturnValue(claimInvitation);
        useQuery.mockReset();
        useQuery.mockReturnValue(undefined);
    });

    it('renders header with Home link and analyzed company list', () => {
        render(
            <WorkbenchShell>
                <div>Page content</div>
            </WorkbenchShell>,
        );

        const homeLink = screen.getByRole('button', { name: /Go to Home/i });
        const dossiersLink = screen.getByRole('button', {
            name: /Go to dossiers/i,
        });
        expect(homeLink).toBeTruthy();
        expect(homeLink.getAttribute('href')).toBe('/');
        expect(dossiersLink.getAttribute('href')).toBe('/workspace/dossiers');
        expect(
            homeLink.compareDocumentPosition(dossiersLink) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
    });

    it('renders custom children when provided', () => {
        render(
            <WorkbenchShell>
                <div data-testid="custom-page-content">Custom View</div>
            </WorkbenchShell>,
        );

        expect(screen.getByTestId('custom-page-content')).toBeTruthy();
    });

    it('preserves company navigation space while admission loads', () => {
        render(
            <WorkbenchShell>
                <div>Page content</div>
            </WorkbenchShell>,
        );

        expect(
            screen.getByLabelText(/Loading research dossiers/i),
        ).toBeTruthy();
    });

    it('opens workspace access from the public workspace button', async () => {
        useQuery.mockReturnValue(null);

        render(
            <WorkbenchShell>
                <div>Page content</div>
            </WorkbenchShell>,
        );

        expect(
            screen.queryByRole('button', { name: /Workspace menu/i }),
        ).toBeNull();
        fireEvent.click(
            screen.getByRole('button', { name: /Workspace/i }),
        );

        expect(
            await screen.findByRole('heading', { name: /Protected access/i }),
        ).toBeTruthy();
    });

    it('sends an analyst to their dossiers after workspace access', async () => {
        useQuery.mockReturnValue(null);
        claimInvitation.mockResolvedValue({
            visitorId: 'visitor-analyst',
            role: 'analyst',
        });

        render(
            <WorkbenchShell>
                <div>Page content</div>
            </WorkbenchShell>,
        );

        fireEvent.click(
            screen.getByRole('button', { name: /Workspace/i }),
        );
        fireEvent.change(await screen.findByLabelText(/Access code/i), {
            target: { value: '4207' },
        });
        fireEvent.submit(
            screen.getByRole('form', { name: /Workspace access/i }),
        );

        await waitFor(() =>
            expect(navigate).toHaveBeenCalledWith({
                to: '/workspace/dossiers',
            }),
        );
    });

    it('sends an admin to operations after workspace access', async () => {
        useQuery.mockReturnValue(null);
        claimInvitation.mockResolvedValue({
            visitorId: 'visitor-admin',
            role: 'admin',
        });

        render(
            <WorkbenchShell>
                <div>Page content</div>
            </WorkbenchShell>,
        );

        fireEvent.click(
            screen.getByRole('button', { name: /Workspace/i }),
        );
        fireEvent.change(await screen.findByLabelText(/Access code/i), {
            target: { value: '4207' },
        });
        fireEvent.submit(
            screen.getByRole('form', { name: /Workspace access/i }),
        );

        await waitFor(() =>
            expect(navigate).toHaveBeenCalledWith({
                to: '/workspace/admin',
            }),
        );
    });

    it('lets an admitted analyst sign out without exposing admin operations', async () => {
        useQuery.mockReturnValue({
            role: 'analyst',
            status: 'active',
        });

        render(
            <WorkbenchShell>
                <div>Page content</div>
            </WorkbenchShell>,
        );

        expect(screen.queryByText('Research prototype')).toBeNull();
        expect(screen.getByText('Account')).toBeTruthy();
        expect(
            screen.queryByRole('button', { name: /Workspace/i }),
        ).toBeNull();
        fireEvent.click(
            screen.getByRole('button', { name: /Workspace menu/i }),
        );
        expect(screen.queryByRole('button', { name: 'Operations' })).toBeNull();

        fireEvent.click(await screen.findByRole('button', { name: 'Logout' }));

        await waitFor(() => expect(signOut).toHaveBeenCalledOnce());
        expect(navigate).toHaveBeenCalledWith({ to: '/workspace/start' });
    });

    it('keeps Operations in the session menu for an admitted admin', async () => {
        useQuery.mockReturnValue({
            role: 'admin',
            status: 'active',
        });

        render(
            <WorkbenchShell>
                <div>Page content</div>
            </WorkbenchShell>,
        );

        fireEvent.click(
            screen.getByRole('button', { name: /Workspace menu/i }),
        );
        fireEvent.click(
            await screen.findByRole('button', { name: 'Operations' }),
        );

        expect(navigate).toHaveBeenCalledWith({ to: '/workspace/admin' });
    });
});
