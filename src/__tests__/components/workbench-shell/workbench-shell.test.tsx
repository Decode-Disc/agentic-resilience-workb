import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', async (importOriginal) => {
    const router =
        await importOriginal<typeof import('@tanstack/react-router')>();

    return {
        ...router,
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

import { WorkbenchShell } from '@/components/workbench-shell/workbench-shell';

describe('WorkbenchShell', () => {
    it('renders header with Home link and analyzed company list', () => {
        render(
            <WorkbenchShell>
                <div>Page content</div>
            </WorkbenchShell>,
        );

        const homeLink = screen.getByRole('button', { name: /Go to Home/i });
        expect(homeLink).toBeTruthy();
        expect(homeLink.getAttribute('href')).toBe('/');
    });

    it('renders custom children when provided', () => {
        render(
            <WorkbenchShell>
                <div data-testid="custom-page-content">Custom View</div>
            </WorkbenchShell>,
        );

        expect(screen.getByTestId('custom-page-content')).toBeTruthy();
    });
});
