import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LiquidGlassCard } from '@/components/ui/liquid-glass';

describe('LiquidGlassCard', () => {
    it('is not draggable by default and isolates each SVG filter', () => {
        const { container } = render(
            <>
                <LiquidGlassCard>Source approval</LiquidGlassCard>
                <LiquidGlassCard>Atomic claims</LiquidGlassCard>
            </>,
        );

        expect(
            screen
                .getByText('Source approval')
                .closest('[data-slot]')
                ?.getAttribute('draggable'),
        ).not.toBe('true');

        const filterIds = Array.from(container.querySelectorAll('filter')).map(
            (filter) => filter.id,
        );
        expect(new Set(filterIds).size).toBe(2);
        expect(filterIds.every(Boolean)).toBe(true);
    });
});
