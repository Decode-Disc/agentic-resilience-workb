import {
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from '@testing-library/react';
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
            ...props
        }: ComponentProps<'a'> & {
            to: string;
            search?: Record<string, string>;
        }) => <a href={to} {...props} />,
    };
});

import { IndexPage } from '@/routes/index';

describe('IndexPage', () => {
    it('centers the evidence matrix without product marketing', () => {
        render(<IndexPage />);

        expect(
            screen.getByRole('heading', {
                name: 'Evidence before conclusions.',
            }),
        ).toBeTruthy();
        expect(
            screen.getByRole('heading', { name: 'Evidence matrix' }),
        ).toBeTruthy();
        expect(screen.getByText('Counter-evidence')).toBeTruthy();
        expect(
            screen.getByLabelText('Agentic Resilience Evidence Workbench'),
        ).toBeTruthy();
        expect(
            screen
                .getByRole('link', { name: 'Open workbench' })
                .getAttribute('href'),
        ).toContain('/prototype/workspace');
        expect(screen.queryByText(/analysis complete/i)).toBeNull();
        expect(
            screen.queryByText(/pricing|get started|free trial/i),
        ).toBeNull();
    });

    it('reveals project context from the fixed navigation menu', async () => {
        render(<IndexPage />);

        const navigation = screen.getByRole('navigation', {
            name: 'Project context',
        });
        const projectTrigger = screen.getByRole('button', { name: 'Project' });

        expect(navigation.contains(projectTrigger)).toBe(true);
        expect(
            screen.queryByRole('heading', { name: 'What this is' }),
        ).toBeNull();

        fireEvent.click(projectTrigger);

        expect(
            await screen.findByRole('heading', { name: 'What this is' }),
        ).toBeTruthy();
        expect(
            screen.getByText(/private, evidence-first research prototype/i),
        ).toBeTruthy();

        fireEvent.keyDown(projectTrigger, { key: 'Escape' });
        await waitFor(() => {
            expect(
                screen.queryByRole('heading', { name: 'What this is' }),
            ).toBeNull();
        });
        expect(document.activeElement).toBe(projectTrigger);
    });

    it.each([
        ['Project', 'What this is'],
        ['Purpose', 'Why it exists'],
        ['Workflow', 'How it works'],
        ['Principles', 'What remains non-negotiable'],
    ])('opens the %s panel', async (label, title) => {
        render(<IndexPage />);

        fireEvent.click(screen.getByRole('button', { name: label }));

        expect(
            await screen.findByRole('heading', { name: title }),
        ).toBeTruthy();
    });

    it('repeats the project context and CTA in the mobile sheet', async () => {
        render(<IndexPage />);

        fireEvent.click(
            screen.getByRole('button', { name: 'Open project menu' }),
        );

        const dialog = await screen.findByRole('dialog', {
            name: 'Project context',
        });
        const mobileMenu = within(dialog);
        for (const label of ['Project', 'Purpose', 'Workflow', 'Principles']) {
            expect(
                mobileMenu.getByRole('button', { name: label }),
            ).toBeTruthy();
        }
        expect(
            mobileMenu.getByRole('link', { name: 'Open workbench' }),
        ).toBeTruthy();
    });
});
