import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('motion/react', () => ({
    motion: new Proxy(
        {},
        {
            get: () =>
                (props: ComponentProps<'div'>) => <div {...props} />,
        },
    ),
}));

import { ResearchComposer } from '@/components/workspace/research-composer';

describe('probe', () => {
    it('picker state after select', () => {
        render(<ResearchComposer />);
        const search = screen.getByPlaceholderText(/Search company or ticker/i);
        fireEvent.change(search, { target: { value: 'mongo' } });
        fireEvent.click(screen.getByText(/MongoDB/i));

        const picker = screen.getByTestId('smooth-dropdown-container');
        // Force the assertion to surface in test failure output.
        expect({
            dataOpen: picker.getAttribute('data-open'),
            badgePresent: !!screen.queryByTestId('research-company-badge'),
        }).toMatchObject({
            dataOpen: '__expected__',
            badgePresent: true,
        });
    });
});
