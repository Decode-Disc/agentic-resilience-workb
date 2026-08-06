import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { SmoothDropdwon } from '@/components/ui/smooth-dropdown';

test('allows a keyboard user to select a dropdown option', () => {
    const onSelect = vi.fn();
    render(
        <SmoothDropdwon
            defaultOpen
            items={[
                {
                    id: 'company-1',
                    label: 'CCC Intelligent Solutions',
                    onSelect,
                },
            ]}
        />,
    );

    fireEvent.keyDown(
        screen.getByRole('option', {
            name: 'CCC Intelligent Solutions',
        }),
        { key: 'Enter' },
    );

    expect(onSelect).toHaveBeenCalledTimes(1);
});

test('renders collection controls outside the option list', () => {
    render(
        <SmoothDropdwon
            defaultOpen
            items={[{ id: 'company-1', label: 'First company' }]}
            footer={<button type="button">Next results</button>}
        />,
    );

    const listbox = screen.getByRole('listbox');
    const footerButton = screen.getByRole('button', { name: 'Next results' });
    expect(listbox.contains(footerButton)).toBe(false);
});
