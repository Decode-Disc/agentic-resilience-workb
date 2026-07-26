import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

const mockNavigate = vi.fn();

vi.mock('@tanstack/react-router', async (importOriginal) => {
    const router =
        await importOriginal<typeof import('@tanstack/react-router')>();

    return {
        ...router,
        useNavigate: () => mockNavigate,
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

vi.mock('convex/react', () => ({
    useQuery: vi.fn().mockReturnValue(undefined),
}));

const mockIsMobile = vi.fn().mockReturnValue(false);

vi.mock('@/hooks/use-responsive', () => ({
    useResponsive: () => ({
        isMobile: mockIsMobile(),
        isDesktop: !mockIsMobile(),
    }),
}));

import { AnalyzedCompanyList } from '@/components/workbench-shell/analyzed-company-list';

describe('AnalyzedCompanyList', () => {
    it('renders horizontal company items on desktop with mock data fallback and notification', () => {
        mockIsMobile.mockReturnValue(false);
        render(<AnalyzedCompanyList />);

        expect(screen.getByText(/ServiceNow Inc\./i)).toBeTruthy();
        expect(screen.getByText(/CCC Intelligent Solutions/i)).toBeTruthy();
        expect(screen.getByText(/Mock data/i)).toBeTruthy();
    });

    it('renders nested menu dropdown on mobile view', () => {
        mockIsMobile.mockReturnValue(true);
        render(<AnalyzedCompanyList />);

        expect(screen.getByText(/ServiceNow Inc\./i)).toBeTruthy();
        expect(screen.getByText(/Mock data/i)).toBeTruthy();
    });
});
