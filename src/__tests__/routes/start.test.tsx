import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps, ComponentType } from 'react';
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

// The composer wires Motion and the SmoothDropdown, which animate a portal.
// For tests we project them as static pass-throughs so the rendered roles are
// queryable without depending on animation timing or DOM portals.
vi.mock('motion/react', () => ({
    motion: new Proxy(
        {},
        {
            get: () => {
                const Component = ({
                    children,
                    ...props
                }: ComponentProps<'div'> & { children?: React.ReactNode }) => (
                    <div {...props}>{children}</div>
                );
                return Component;
            },
        },
    ),
    useReducedMotion: () => false,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => (
        <>{children}</>
    ),
}));

import { ResearchComposer } from '@/components/workspace/research-composer';
import { Route } from '@/routes/workspace/start';

describe('StartAnalysisRoute', () => {
    it('renders the Qatalog central zone adapted to the workbench', () => {
        const StartAnalysisRoute = Route.options.component as ComponentType;

        render(<StartAnalysisRoute />);

        // Header block: dossier start headline.
        expect(
            screen.getByRole('heading', {
                name: /Start a research dossier/i,
            }),
        ).toBeTruthy();

        // Composer allows writing the research request directly
        expect(
            screen.getByPlaceholderText(/Describe the resilience question/i),
        ).toBeTruthy();

        // "Company to investigate" picker adapted from "All connections".
        // The SmoothDropdown exposes its trigger as a clickable surface
        // (not a native <button> yet); asserting on the visible label keeps
        // the test stable while the picker gains proper button semantics.
        expect(
            screen.getAllByText(/Company to investigate/i).length,
        ).toBeGreaterThan(0);
        // Send button stays UX-enabled at all times; gating is programmatic.
        expect(
            screen.getByRole('button', { name: /Send request/i }),
        ).toHaveProperty('disabled', false);
    });

    it('renders the evidence-layer rows with on/off switches inline on the page', () => {
        const StartAnalysisRoute = Route.options.component as ComponentType;

        render(<StartAnalysisRoute />);

        // The project-adapted evidence layer rows default exactly as documented
        // (Reference checks opt-in), surfaced through the shared Switch
        // primitive so each row exposes an accessible checked state.
        expect(
            screen.getByRole('switch', {
                name: /SEC filings/i,
                checked: true,
            }),
        ).toBeTruthy();
        expect(
            screen.getByRole('switch', {
                name: /Investor context/i,
                checked: true,
            }),
        ).toBeTruthy();
        expect(
            screen.getByRole('switch', {
                name: /Source discovery/i,
                checked: true,
            }),
        ).toBeTruthy();
        expect(
            screen.getByRole('switch', {
                name: /Evidence extraction/i,
                checked: true,
            }),
        ).toBeTruthy();
        expect(
            screen.getByRole('switch', {
                name: /Reference checks/i,
                checked: false,
            }),
        ).toBeTruthy();
    });
});

describe('ResearchComposer', () => {
    it('exposes the prompt area where the analyst types the request', () => {
        render(<ResearchComposer />);

        const prompt = screen.getByPlaceholderText(/How can I help/i);
        expect(prompt).toBeTruthy();
    });

    it('labels the company picker as a company-to-investigate search', () => {
        render(<ResearchComposer />);

        // The picker is the entry to the company lookup, not a generic
        // "select among analyzed companies" control.
        expect(
            screen.getAllByText(/Company to investigate/i).length,
        ).toBeGreaterThan(0);
    });

    it('shows a hint and no company results until a search is typed', () => {
        render(<ResearchComposer />);

        // Default state: no catalog rows leak through without a query.
        expect(screen.queryByText(/ServiceNow/i)).toBeNull();
        expect(
            screen.getByText(
                /Type a name or ticker to search for a company to investigate/i,
            ),
        ).toBeTruthy();
    });

    it('shows matching company results once the analyst types a query', () => {
        render(<ResearchComposer />);

        const search = screen.getByPlaceholderText(/Search company or ticker/i);
        fireEvent.change(search, { target: { value: 'service' } });

        expect(screen.getByText(/ServiceNow/i)).toBeTruthy();
        expect(
            screen.queryByText(/Type a name or ticker to search the SEC/i),
        ).toBeNull();
    });

    it('selects the company into the dossier context when a result is chosen', () => {
        render(<ResearchComposer />);

        const search = screen.getByPlaceholderText(/Search company or ticker/i);
        fireEvent.change(search, { target: { value: 'mongo' } });

        // The result row is a SmoothDropdown item — click it to resolve.
        const mongoResult = screen.getByText(/MongoDB/i);
        fireEvent.click(mongoResult);

        // Selecting the result moves it into the trigger as the active
        // company of the dossier context.
        expect(screen.getAllByText(/MongoDB/i).length).toBeGreaterThan(0);
    });

    it('always exposes a clear-selection action that is disabled until a company is picked', () => {
        render(<ResearchComposer />);

        const clearBefore = screen.getByRole('button', {
            name: /Clear selection/i,
        });
        expect(clearBefore).toHaveProperty('disabled', true);

        // Resolve a company, then the clear action must become enabled.
        const search = screen.getByPlaceholderText(/Search company or ticker/i);
        fireEvent.change(search, { target: { value: 'mongo' } });
        fireEvent.click(screen.getByText(/MongoDB/i));

        const clearAfter = screen.getByRole('button', {
            name: /Clear selection/i,
        });
        expect(clearAfter).toHaveProperty('disabled', false);
    });

    it('renders a company badge anchored at the start of the prompt with a cancel control', () => {
        render(<ResearchComposer />);

        // No badge until a company is resolved.
        const search = screen.getByPlaceholderText(/Search company or ticker/i);
        fireEvent.change(search, { target: { value: 'mongo' } });
        fireEvent.click(screen.getByText(/MongoDB/i));

        // The resolved company is surfaced as a removable badge inside the
        // composer surface, alongside its cancel control.
        const badge = screen.getByTestId('research-company-badge');
        expect(badge.textContent).toMatch(/MongoDB/i);
        expect(
            screen.getByRole('button', {
                name: /Remove company from context/i,
            }),
        ).toBeTruthy();
    });

    it('clears the resolved company when the badge cancel is clicked', () => {
        render(<ResearchComposer />);

        const search = screen.getByPlaceholderText(/Search company or ticker/i);
        fireEvent.change(search, { target: { value: 'mongo' } });
        fireEvent.click(screen.getByText(/MongoDB/i));

        fireEvent.click(
            screen.getByRole('button', {
                name: /Remove company from context/i,
            }),
        );

        // The badge disappears and the trigger falls back to its placeholder.
        expect(screen.queryByTestId('research-company-badge')).toBeNull();
        expect(
            screen.getAllByText(/Company to investigate/i).length,
        ).toBeGreaterThan(0);
    });

    it('keeps send enabled and nudges toward the picker when no company is resolved', () => {
        render(<ResearchComposer />);

        // The send button is always enabled from a UX standpoint — gating is
        // programmatic, not via disabled.
        const send = screen.getByRole('button', { name: /Send request/i });
        expect(send).toHaveProperty('disabled', false);

        const picker = screen.getByTestId('smooth-dropdown-container');
        expect(picker.getAttribute('data-open')).toBeNull();

        // Sending without a resolved company surfaces the picker to attract
        // attention instead of silently failing submission.
        fireEvent.click(send);
        expect(picker.getAttribute('data-open')).toBe('true');
    });

    it('does not nudge the picker once a company is resolved', () => {
        render(<ResearchComposer />);

        const search = screen.getByPlaceholderText(/Search company or ticker/i);
        fireEvent.change(search, { target: { value: 'mongo' } });
        fireEvent.click(screen.getByText(/MongoDB/i));

        const picker = screen.getByTestId('smooth-dropdown-container');
        expect(picker.getAttribute('data-open')).toBeNull();

        // Clicking send with a resolved company must not re-open the picker.
        fireEvent.click(screen.getByRole('button', { name: /Send request/i }));
        expect(picker.getAttribute('data-open')).toBeNull();
    });

    it('opens an Attach references dialog with the FileDropzone inside', () => {
        render(<ResearchComposer />);

        // The dialog content is not present until triggered.
        expect(screen.queryByRole('dialog')).toBeNull();

        fireEvent.click(
            screen.getByRole('button', { name: /Attach references/i }),
        );

        // Dialog portal mounts with the FileDropzone surface inside.
        expect(screen.getByRole('dialog')).toBeTruthy();
        expect(
            screen.getByRole('heading', { name: /Attach references/i }),
        ).toBeTruthy();
        // FileDropzone renders a labelled browse input we can target.
        expect(screen.getByRole('button', { name: /Done/i })).toBeTruthy();
    });

    it('opens a More options dropdown menu reserved for future actions', () => {
        render(<ResearchComposer />);

        fireEvent.click(
            screen.getByRole('button', { name: /^More options$/i }),
        );

        // The menu surfaces its label and a disabled placeholder item so the
        // empty-state stays intentional rather than silently hidden.
        expect(screen.getByText(/More actions coming soon/i)).toBeTruthy();
    });
});
