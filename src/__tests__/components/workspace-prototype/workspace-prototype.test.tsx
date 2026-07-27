import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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
        useNavigate: () => vi.fn(),
    };
});

vi.mock('convex/react', () => ({
    useQuery: vi.fn().mockReturnValue(undefined),
}));

vi.mock('@convex-dev/auth/react', async (importOriginal) => {
    const auth =
        await importOriginal<typeof import('@convex-dev/auth/react')>();
    return {
        ...auth,
        useAuthActions: () => ({
            signIn: vi.fn(),
            signOut: vi.fn(),
        }),
    };
});

import { WorkspacePrototype } from '@/components/workspace-prototype/workspace-prototype';

class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
}

describe('WorkspacePrototype', () => {
    beforeAll(() => {
        vi.stubGlobal('ResizeObserver', ResizeObserverMock);
        Object.defineProperty(HTMLElement.prototype, 'getAnimations', {
            configurable: true,
            value: () => [],
        });
    });

    afterAll(() => {
        vi.unstubAllGlobals();
        Reflect.deleteProperty(HTMLElement.prototype, 'getAnimations');
    });

    it('uses the global evidence workbench design system', () => {
        render(<WorkspacePrototype variant="a" onVariantChange={vi.fn()} />);

        expect(
            screen
                .getByText('Throwaway UI prototype')
                .closest('.theme-evidence-workbench'),
        ).toBeNull();
    });

    it('places the research rail on a liquid-glass surface', () => {
        render(<WorkspacePrototype variant="a" onVariantChange={vi.fn()} />);

        expect(
            screen
                .getByRole('navigation', { name: 'Research dossier' })
                .closest('[data-slot="liquid-glass-card"]'),
        ).toBeTruthy();
    });

    it('scrolls each workspace column independently', () => {
        render(<WorkspacePrototype variant="a" onVariantChange={vi.fn()} />);

        const researchNavigation = screen.getByRole('navigation', {
            name: 'Research dossier',
        });
        const evidenceMatrix = screen.getByRole('region', {
            name: 'Evidence matrix',
        });
        const dimensionContext = screen
            .getByRole('heading', { name: 'Dimension context' })
            .closest('aside');

        for (const column of [
            researchNavigation,
            evidenceMatrix,
            dimensionContext,
        ]) {
            expect(column?.closest('[data-slot="scroll-area"]')).toBeTruthy();
        }
    });

    it('expands and collapses the compact dossier heading', async () => {
        render(<WorkspacePrototype variant="a" onVariantChange={vi.fn()} />);

        const trigger = screen.getByRole('button', {
            name: 'Expand dossier details',
        });
        const stickyHeading = trigger.closest('header');

        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        expect(stickyHeading?.className).toContain('sticky');
        expect(stickyHeading?.className).toContain('top-0');
        expect(stickyHeading?.className).toContain('rounded-b-lg');
        expect(
            screen.queryByText(/Evidence-led review of workflow control/i),
        ).toBeNull();

        fireEvent.click(trigger);

        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        expect(
            screen.getByText(/Evidence-led review of workflow control/i),
        ).toBeTruthy();
        expect(
            screen.getAllByText('CCC Intelligent Solutions', { exact: true }),
        ).toHaveLength(1);
        expect(screen.getAllByText('Claim review')).toHaveLength(1);

        fireEvent.click(trigger);

        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        await waitFor(() => {
            expect(
                screen.queryByText(/Evidence-led review of workflow control/i),
            ).toBeNull();
        });
    });

    it('resizes the evidence and dimension panels', () => {
        const onVariantChange = vi.fn();
        const { container } = render(
            <WorkspacePrototype
                variant="a"
                onVariantChange={onVariantChange}
            />,
        );

        const panelGroup = container.querySelector(
            '[data-slot="resizable-panel-group"]',
        );

        expect(panelGroup).toBeTruthy();
        expect(
            panelGroup?.querySelectorAll('[data-slot="resizable-panel"]')
                .length,
        ).toBe(2);
        const handle = panelGroup?.querySelector(
            '[data-slot="resizable-handle"]',
        );

        expect(handle).toBeTruthy();

        const keyboardSeparator = document.createElement('div');
        keyboardSeparator.setAttribute('role', 'separator');
        document.body.append(keyboardSeparator);

        fireEvent.keyDown(keyboardSeparator, { key: 'ArrowLeft' });

        expect(onVariantChange).not.toHaveBeenCalled();
        keyboardSeparator.remove();
    });
});
